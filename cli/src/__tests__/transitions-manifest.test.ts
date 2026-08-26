import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { StoredEvent } from "../intelligence/event-store.js";
import { configureDirectivesStore, listDirectives } from "../transitions/directives-store.js";
import { formatBehaviouralDirectives } from "../resolve.js";

const TEST_PORT = 14817;
const TOKEN = "test-transition-token";

let testRoot = "";
let dbPath = "";
let registryPath = "";

async function readTransitionEvents(): Promise<StoredEvent[]> {
  const { IntelligenceEventStore } = await import("../intelligence/event-store.js");
  const store = new IntelligenceEventStore({ path: dbPath });
  try {
    return store.readFrom(0, 10_000);
  } finally {
    store.close();
  }
}

function transitionEvents(events: StoredEvent[]): StoredEvent[] {
  return events.filter((e) => e.sourceId.startsWith("transition."));
}

async function waitForEvents(
  check: (events: StoredEvent[]) => boolean,
  timeoutMs = 3000
): Promise<StoredEvent[]> {
  const deadline = Date.now() + timeoutMs;
  let events: StoredEvent[] = [];
  for (;;) {
    events = transitionEvents(await readTransitionEvents());
    if (check(events) || Date.now() > deadline) return events;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function postJson(
  path: string,
  token?: string | null,
  body?: Record<string, unknown>
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json() };
}

function manifestBody(invocationId: string): Record<string, unknown> {
  return {
    invocation_id: invocationId,
    environment_revision: 1,
    environment: {
      application: { name: "TestApp", bundle_id: "com.test.app" },
      focused_element: { role: "AXTextArea" },
    },
    intent: "type hello transition world",
    modality: "text",
    invocation_fingerprint: {},
  };
}

describe("transitions manifest capture", () => {
  beforeAll(async () => {
    testRoot = mkdtempSync(join(tmpdir(), "flyd-transitions-manifest-"));
    process.env.HOME = testRoot;
    delete process.env.FLYD_MODEL_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.FLYD_TRANSITIONS_DISABLED;

    mkdirSync(join(testRoot, ".flyd", "overlay"), { recursive: true });
    writeFileSync(join(testRoot, ".flyd", "overlay", "auth-token"), TOKEN, "utf-8");

    dbPath = join(testRoot, "intelligence.sqlite");
    registryPath = join(testRoot, "transition-registry.json");

    const writer = await import("../transitions/writer.js");
    writer.configureTransitionStore({ dbPath, registryPath });

    const server = await import("../server.js");
    await server.startServer(TEST_PORT, "127.0.0.1");
  });

  afterAll(async () => {
    const server = await import("../server.js");
    await server.stopServer();
    const writer = await import("../transitions/writer.js");
    writer.configureTransitionStore({});
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("happy path: manifest + succeeded outcome produces a correlated action/next-state pair", async () => {
    const invocationId = "inv-happy-1";
    const manifest = await postJson("/manifest", TOKEN, manifestBody(invocationId));
    expect(manifest.status).toBe(200);
    expect(manifest.body.mode).toBeDefined();
    expect(manifest.body.invocationId).toBe(invocationId);

    const outcome = await postJson("/manifest/outcome", TOKEN, {
      resolutionId: manifest.body.resolutionId,
      invocationId,
      status: "succeeded",
    });
    expect(outcome.status).toBe(200);
    expect(outcome.body.acknowledged).toBe(true);

    const events = await waitForEvents((evts) =>
      evts.some((e) => e.correlationId === invocationId && e.kind === "verified_outcome")
    );

    const action = events.find(
      (e) => e.sourceId === "transition.overlay" && e.idempotencyKey === `action:${invocationId}`
    );
    const next = events.find(
      (e) => e.sourceId === "transition.overlay" && e.idempotencyKey === `next:${invocationId}:succeeded`
    );

    expect(action).toBeDefined();
    expect(next).toBeDefined();
    expect(action!.correlationId).toBe(invocationId);
    expect(next!.correlationId).toBe(invocationId);
    expect(action!.kind).toBe("proposed_action");
    expect(next!.sequence).toBeGreaterThan(action!.sequence);

    const actionPayload = action!.payload as any;
    expect(actionPayload.action.intent).toBe("type hello transition world");
    expect(actionPayload.action.resolutionMode).toBe(manifest.body.mode);
    expect(actionPayload.actor.surface).toBe("overlay");
    expect(actionPayload.action.appSummary).toBe("com.test.app — AXTextArea");
    expect(JSON.stringify(actionPayload)).not.toContain("screenshot");

    const nextPayload = next!.payload as any;
    expect(nextPayload.nextState.signal).toBe("succeeded");
    expect(nextPayload.nextState.origin).toBe("user");
    expect(nextPayload.nextState.causalComplete).toBe(true);
  });

  it("outcome with unknown invocationId persists a causally-incomplete next-state and responds normally", async () => {
    const invocationId = "inv-orphan-1";
    const before = transitionEvents(await readTransitionEvents()).length;

    const outcome = await postJson("/manifest/outcome", TOKEN, {
      resolutionId: "res-orphan",
      invocationId,
      status: "cancelled",
    });
    expect(outcome.status).toBe(200);
    expect(outcome.body.acknowledged).toBe(true);

    const events = await waitForEvents((evts) =>
      evts.some((e) => e.idempotencyKey === `next:${invocationId}:cancelled`)
    );
    expect(events.length).toBe(before + 1);

    const next = events.find((e) => e.idempotencyKey === `next:${invocationId}:cancelled`)!;
    const payload = next.payload as any;
    expect(payload.nextState.signal).toBe("cancelled");
    expect(payload.nextState.causalComplete).toBe(false);
  });

  it("outcome with correction text carries the correction verbatim on the event payload", async () => {
    const invocationId = "inv-correction-1";
    const correction = "always inspect the repo before proposing a fix";

    const manifest = await postJson("/manifest", TOKEN, manifestBody(invocationId));
    expect(manifest.status).toBe(200);
    const outcome = await postJson("/manifest/outcome", TOKEN, {
      resolutionId: manifest.body.resolutionId,
      invocationId,
      status: "rejected",
      correction,
    });
    expect(outcome.status).toBe(200);

    const events = await waitForEvents((evts) =>
      evts.some((e) => e.idempotencyKey === `next:${invocationId}:rejected`)
    );
    const next = events.find((e) => e.idempotencyKey === `next:${invocationId}:rejected`)!;
    expect((next.payload as any).nextState.correction).toBe(correction);
    expect((next.payload as any).nextState.signal).toBe("rejected");
  });

  it("request without Bearer token returns 401 and writes no events", async () => {
    const before = transitionEvents(await readTransitionEvents()).length;

    const manifest = await postJson("/manifest", null, manifestBody("inv-unauth-1"));
    expect(manifest.status).toBe(401);
    const outcome = await postJson("/manifest/outcome", null, {
      resolutionId: "res-x",
      invocationId: "inv-unauth-1",
      status: "succeeded",
    });
    expect(outcome.status).toBe(401);

    const after = transitionEvents(await readTransitionEvents()).length;
    expect(after).toBe(before);
  });

  it("kill switch: capture disabled yields normal responses with zero new events", async () => {
    const before = transitionEvents(await readTransitionEvents()).length;
    process.env.FLYD_TRANSITIONS_DISABLED = "1";

    try {
      const manifest = await postJson("/manifest", TOKEN, manifestBody("inv-killed-1"));
      expect(manifest.status).toBe(200);
      expect(manifest.body.invocationId).toBe("inv-killed-1");

      const outcome = await postJson("/manifest/outcome", TOKEN, {
        resolutionId: manifest.body.resolutionId,
        invocationId: "inv-killed-1",
        status: "succeeded",
      });
      expect(outcome.status).toBe(200);
      expect(outcome.body.acknowledged).toBe(true);
    } finally {
      delete process.env.FLYD_TRANSITIONS_DISABLED;
    }

    const after = transitionEvents(await readTransitionEvents()).length;
    expect(after).toBe(before);
  });
});

describe("behavioural directive injection into resolution", () => {
  let dirRoot = "";

  const record = (overrides: Record<string, unknown> & { text: string }) => ({
    directiveId: `dir-${Math.random().toString(36).slice(2)}`,
    dedupeKey: overrides.text.toLowerCase(),
    sourceSeq: 1,
    sourceCorrelationId: "inv-x",
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    occurrences: 1,
    corroborations: 0,
    utility: 0,
    negatives: 0,
    active: true,
    ...overrides,
  });

  beforeAll(() => {
    dirRoot = mkdtempSync(join(tmpdir(), "flyd-directives-inject-"));
    configureDirectivesStore(dirRoot);
  });

  afterAll(() => {
    configureDirectivesStore(undefined);
    rmSync(dirRoot, { recursive: true, force: true });
  });

  it("a suppressed directive never renders even when recently created; actives render ranked inside the boundary", () => {
    writeFileSync(join(dirRoot, "directives.json"), JSON.stringify([
      record({ text: "Keep commit messages short.", utility: 4, negatives: 0, corroborations: 3 }),
      record({
        text: "Never use emoji in replies.",
        active: false,
        inactiveReason: "suppressed:negative_outcomes",
        createdAt: new Date().toISOString(),
      }),
      record({ text: "Always inspect the repo before proposing a fix." }),
    ]), { encoding: "utf-8", mode: 0o600 });

    const active = listDirectives({ activeOnly: true });
    expect(active.map((d) => d.text)).toEqual([
      "Keep commit messages short.",
      "Always inspect the repo before proposing a fix.",
    ]);

    const block = formatBehaviouralDirectives(active)!;
    expect(block).toContain("<behavioural_directives>");
    expect(block).toContain("</behavioural_directives>");
    expect(block.indexOf("Keep commit messages short.")).toBeLessThan(block.indexOf("Always inspect the repo"));
    expect(block).not.toContain("Never use emoji in replies.");
    expect(block).not.toContain("suppressed");
    expect(block).not.toMatch(/dir-[a-z0-9]/);
  });
});

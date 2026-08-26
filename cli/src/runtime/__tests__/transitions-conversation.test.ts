import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredEvent } from "../../intelligence/event-store.js";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { configureTransitionStore } from "../../transitions/writer.js";
import { respondToConversation } from "../conversation-responder.js";

const rootDir = mkdtempSync(join(tmpdir(), "flyd-transitions-conversation-"));

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

let dbPath = "";
let registryPath = "";
let projectRoot = "";

beforeEach(() => {
  const id = randomUUID();
  dbPath = join(rootDir, `${id}.sqlite`);
  registryPath = join(rootDir, `consents-${id}.json`);
  projectRoot = mkdtempSync(join(rootDir, `proj-${id}-`));
  configureTransitionStore({ dbPath, registryPath });
});

afterEach(() => {
  delete process.env.FLYD_TRANSITIONS_DISABLED;
  rmSync(projectRoot, { recursive: true, force: true });
});

function readEvents(): StoredEvent[] {
  const store = new IntelligenceEventStore({ path: dbPath });
  try {
    return store.readFrom(0);
  } finally {
    store.close();
  }
}

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  message: "write a short haiku about databases",
  history: [],
  memory: { verdict: "insufficient" as const, matches: [] },
  situation: null,
  onToken: () => undefined,
  ...overrides,
});

const dependencies = {
  resolveConnection: () => ({
    model: "gpt-4.6",
    apiKey: "test-key",
    baseURL: "https://models.example.test/v1",
    providerIdentity: "models.example.test/gpt-4.6",
  }),
  runAgentLoop: async () => "<final>Rows drift like tide.</final>",
  persistReceipt: async (input: unknown) => input as never,
};

describe("conversation transition capture", () => {
  it("two-turn conversation yields two correlated transitions under one session id", async () => {
    const sessionId = "conv-happy";
    await respondToConversation(baseInput({ sessionId, turnNumber: 1 }), dependencies);
    await respondToConversation(
      baseInput({
        sessionId,
        turnNumber: 2,
        history: [
          { role: "user", content: "write a short haiku about databases" },
          { role: "assistant", content: "Rows drift like tide." },
        ],
      }),
      dependencies,
    );

    const events = readEvents();
    expect(events).toHaveLength(4);

    const actions = events.filter((event) => event.kind === "proposed_action");
    const nextStates = events.filter((event) => event.kind === "verified_outcome");
    expect(actions).toHaveLength(2);
    expect(nextStates).toHaveLength(2);

    for (const event of events) {
      expect(event.sourceId).toBe("transition.cli-chat");
      expect((event.payload as { sessionId?: string }).sessionId).toBe(sessionId);
    }
    expect(new Set(events.map((event) => event.correlationId)).size).toBe(2);
    for (const [action, nextState] of [
      [actions[0], nextStates[0]],
      [actions[1], nextStates[1]],
    ]) {
      expect(nextState.correlationId).toBe(action.correlationId);
      expect(nextState.sequence).toBeGreaterThan(action.sequence);
      const payload = nextState.payload as {
        nextState?: { origin?: string; signal?: string };
      };
      expect(payload.nextState).toMatchObject({ origin: "user", signal: "succeeded" });
    }

    const actionPayload = actions[0].payload as {
      actor?: { surface?: string };
      action?: { intent?: string; resolutionMode?: string; model?: string };
    };
    expect(actionPayload.actor).toEqual({ surface: "cli_chat" });
    expect(actionPayload.action?.intent).toBe("write a short haiku about databases");
    expect(actionPayload.action?.resolutionMode).toBe("models.example.test/gpt-4.6");
    expect(actionPayload.action?.model).toBe("gpt-4.6");
  });

  it("responder error mid-turn records action plus error next-state and rethrows unchanged", async () => {
    await expect(
      respondToConversation(
        baseInput({ sessionId: "conv-error", turnNumber: 1 }),
        {
          ...dependencies,
          runAgentLoop: async () => {
            throw new Error("model connection reset");
          },
        },
      ),
    ).rejects.toThrow("model connection reset");

    const events = readEvents();
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("proposed_action");
    expect(events[1].kind).toBe("observation");
    expect(events.every((event) => event.correlationId === events[0].correlationId)).toBe(true);
    const payload = events[1].payload as {
      nextState?: { origin?: string; signal?: string };
    };
    expect(payload.nextState).toMatchObject({ origin: "tool", signal: "error" });
    expect(JSON.stringify(events[1].payload)).not.toContain("model connection reset");
  });

  it("kill switch set keeps behaviour identical with zero events", async () => {
    process.env.FLYD_TRANSITIONS_DISABLED = "1";
    const answer = await respondToConversation(
      baseInput({ sessionId: "conv-disabled", turnNumber: 1 }),
      dependencies,
    );
    expect(answer).toBe("Rows drift like tide.");

    const store = new IntelligenceEventStore({ path: dbPath });
    try {
      expect(store.count()).toBe(0);
    } finally {
      store.close();
    }
  });
});

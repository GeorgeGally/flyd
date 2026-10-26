import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../event-store.js";
import { EXPERIENCE_RUNTIME_CONTRACT } from "../sensors/source-contracts.js";
import { runDreamCycle } from "../dream/cycle.js";
import { persistTurnReceipt } from "../../runtime/turn-receipt.js";
import { repairLatestTurn } from "../../runtime/turn-repair.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function correction(flydDir: string, index: number): Promise<void> {
  const receiptId = `receipt-${index}`;
  await persistTurnReceipt({
    sessionId: "dream-session",
    turnNumber: index,
    route: "conversation",
    message: "Fix the Flyd project code",
    model: "gpt-test",
    providerIdentity: "test-provider",
    memory: { verdict: "insufficient", matches: [] },
    toolCalls: [],
    answer: "A generic answer.",
    status: "succeeded",
    plan: { route: "answer", source: "llm", cover: [] },
  }, {
    flydDir,
    id: () => receiptId,
    now: () => new Date(`2026-10-19T0${index}:00:00.000Z`),
  });
  await repairLatestTurn("Wrong — inspect the current project before answering.", {
    flydDir,
    sessionId: "dream-session",
    expectedTurnReceiptId: receiptId,
    id: () => `repair-${index}`,
    now: () => new Date(`2026-10-19T0${index}:01:00.000Z`),
  });
}

function dreamInsights(store: IntelligenceEventStore) {
  return store.readSource(EXPERIENCE_RUNTIME_CONTRACT.sourceId).filter((event) =>
    !event.erased && event.payload?.type === "dream_insight"
  );
}

describe("Dream Cycle", () => {
  it("does not generalize from one correction", async () => {
    const flydDir = await mkdtemp(join(tmpdir(), "flyd-dream-one-"));
    directories.push(flydDir);
    await correction(flydDir, 1);

    const result = await runDreamCycle({
      flydDir,
      force: true,
      now: () => new Date("2026-10-19T06:00:00.000Z"),
    });

    const store = new IntelligenceEventStore({ path: join(flydDir, "intelligence.sqlite") });
    try {
      expect(result.status).toBe("no_new_insights");
      expect(dreamInsights(store)).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("turns three related explicit corrections into one evidence-backed candidate and stays idempotent", async () => {
    const flydDir = await mkdtemp(join(tmpdir(), "flyd-dream-corrections-"));
    directories.push(flydDir);
    await correction(flydDir, 1);
    await correction(flydDir, 2);
    await correction(flydDir, 3);

    const first = await runDreamCycle({
      flydDir,
      force: true,
      now: () => new Date("2026-10-19T06:00:00.000Z"),
    });

    const store = new IntelligenceEventStore({ path: join(flydDir, "intelligence.sqlite") });
    try {
      const events = dreamInsights(store);
      expect(first.status).toBe("consolidated");
      expect(first.insights).toBe(1);
      expect(events).toHaveLength(1);
      const payload = events[0]?.payload as { insight?: Record<string, unknown> };
      expect(payload.insight).toMatchObject({
        version: 1,
        kind: "correction_cluster",
        supportCount: 3,
        consumer: "self_improve",
      });
      expect((payload.insight?.evidenceRefs as string[]).length).toBe(3);
      expect(JSON.stringify(payload)).not.toContain("Wrong — inspect");
    } finally {
      store.close();
    }

    const second = await runDreamCycle({
      flydDir,
      force: true,
      now: () => new Date("2026-10-19T06:05:00.000Z"),
    });
    const reread = new IntelligenceEventStore({ path: join(flydDir, "intelligence.sqlite") });
    try {
      expect(second.status).toBe("no_new_experience");
      expect(dreamInsights(reread)).toHaveLength(1);
    } finally {
      reread.close();
    }
  });

  it("learns from George correcting Flyd in chat, the signal a reply's own words carry", async () => {
    const flydDir = await mkdtemp(join(tmpdir(), "flyd-dream-chat-"));
    directories.push(flydDir);
    const { recordExperienceFeedback } = await import("../../runtime/experience-trace.js");
    for (const index of [1, 2, 3]) {
      recordExperienceFeedback({
        version: 1, receiptId: `receipt-${index}`, repairId: `chat:receipt-${index}`, recordedAt: `2026-10-19T0${index}:00:00.000Z`,
        source: "chat_correction", signal: "correction", feedback: "that's ai slop, talk like a person",
        failureClasses: ["corrected_in_chat"], repairTargets: ["answer"],
      }, { flydDir });
    }
    const result = await runDreamCycle({ flydDir, force: true, now: () => new Date("2026-10-19T06:00:00.000Z") });
    const store = new IntelligenceEventStore({ path: join(flydDir, "intelligence.sqlite") });
    try {
      expect(result.status).toBe("consolidated");
      expect((dreamInsights(store)[0]?.payload as { insight?: Record<string, unknown> }).insight).toMatchObject({ kind: "correction_cluster", supportCount: 3 });
    } finally {
      store.close();
    }
  });

  it("detects repeated objective tool failures without needing user feedback", async () => {
    const flydDir = await mkdtemp(join(tmpdir(), "flyd-dream-failures-"));
    directories.push(flydDir);

    for (let index = 1; index <= 3; index += 1) {
      await persistTurnReceipt({
        sessionId: "failure-session",
        turnNumber: index,
        route: "conversation",
        message: "Find the current deck",
        model: "gpt-test",
        providerIdentity: "test-provider",
        memory: { verdict: "partial", matches: [] },
        toolCalls: [{ name: "drive_search", input: { query: "deck" }, succeeded: false, error: "provider unavailable" }],
        answer: "",
        status: "failed",
        error: "provider unavailable",
        plan: { route: "act", source: "jev", cover: ["current deck"] },
      }, {
        flydDir,
        id: () => `failed-receipt-${index}`,
        now: () => new Date(`2026-10-19T0${index}:10:00.000Z`),
      });
    }

    const result = await runDreamCycle({
      flydDir,
      force: true,
      now: () => new Date("2026-10-19T07:00:00.000Z"),
    });
    const store = new IntelligenceEventStore({ path: join(flydDir, "intelligence.sqlite") });
    try {
      expect(result.status).toBe("consolidated");
      const payload = dreamInsights(store)[0]?.payload as { insight?: Record<string, unknown> };
      expect(payload.insight).toMatchObject({
        kind: "repeated_failure",
        supportCount: 3,
        facets: { route: "act", memoryVerdict: "partial", failedTools: ["drive_search"] },
      });
    } finally {
      store.close();
    }
  });
});

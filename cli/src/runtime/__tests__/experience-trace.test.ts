import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { persistTurnReceipt } from "../turn-receipt.js";
import { repairLatestTurn } from "../turn-repair.js";
import { EXPERIENCE_SOURCE_ID, EXPERIENCE_TRACE_SCHEMA } from "../experience-trace.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("experience traces", () => {
  it("records a compact versioned trace without duplicating answer text or tool inputs", async () => {
    const flydDir = await mkdtemp(join(tmpdir(), "flyd-experience-"));
    directories.push(flydDir);

    const receipt = await persistTurnReceipt({
      sessionId: "session-1",
      turnNumber: 3,
      route: "conversation",
      message: "Find the latest Nuanu deck",
      model: "gpt-test",
      providerIdentity: "test-provider",
      memory: {
        verdict: "partial",
        matches: [{
          id: "m1",
          path: "memory/project.md",
          excerpt: "private excerpt should not be copied into the trace",
          stale: false,
          authority: "durable_memory",
          outcome: "accepted",
        }],
      },
      toolCalls: [{
        name: "drive_search",
        input: { query: "private query should stay in the receipt" },
        succeeded: true,
      }],
      answer: "private answer body should stay in the receipt",
      status: "succeeded",
      decisionPolicy: "decision-v7",
      plan: { route: "act", source: "jev", cover: ["latest deck"] },
    }, {
      flydDir,
      id: () => "receipt-1",
      now: () => new Date("2026-10-19T01:00:00.000Z"),
    });

    const store = new IntelligenceEventStore({ path: join(flydDir, "intelligence.sqlite") });
    const events = store.readSource(EXPERIENCE_SOURCE_ID);
    store.close();

    expect(events).toHaveLength(1);
    expect(events[0]?.correlationId).toBe(receipt.id);
    expect(events[0]?.policyVersion).toContain(EXPERIENCE_TRACE_SCHEMA);
    const payload = events[0]?.payload as { type?: string; trace?: Record<string, unknown> };
    expect(payload.type).toBe("experience_trace");
    expect(JSON.stringify(payload)).not.toContain("private answer body");
    expect(JSON.stringify(payload)).not.toContain("private query");
    expect(JSON.stringify(payload)).not.toContain("private excerpt");
    expect(payload.trace).toMatchObject({
      version: 1,
      receiptId: "receipt-1",
      route: "act",
      execution: { toolCallCount: 1, failedToolCallCount: 0 },
      outcome: { status: "succeeded" },
      system: {
        traceSchema: EXPERIENCE_TRACE_SCHEMA,
        decisionPolicy: "decision-v7",
        routeSource: "jev",
        model: "gpt-test",
      },
    });
  });

  it("links explicit correction evidence to the originating receipt without promoting a repair", async () => {
    const flydDir = await mkdtemp(join(tmpdir(), "flyd-experience-feedback-"));
    directories.push(flydDir);

    await persistTurnReceipt({
      sessionId: "session-2",
      turnNumber: 1,
      route: "conversation",
      message: "What is Flyd working on?",
      model: "gpt-test",
      providerIdentity: "test-provider",
      memory: { verdict: "insufficient", matches: [] },
      toolCalls: [],
      answer: "A generic answer.",
      status: "succeeded",
      plan: { route: "answer", source: "llm", cover: [] },
    }, {
      flydDir,
      id: () => "receipt-2",
      now: () => new Date("2026-10-19T01:01:00.000Z"),
    });

    await repairLatestTurn("That answer was wrong; inspect current work.", {
      flydDir,
      sessionId: "session-2",
      id: () => "repair-1",
      now: () => new Date("2026-10-19T01:02:00.000Z"),
    });

    const store = new IntelligenceEventStore({ path: join(flydDir, "intelligence.sqlite") });
    const events = store.readSource(EXPERIENCE_SOURCE_ID);
    store.close();

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.correlationId)).toEqual(["receipt-2", "receipt-2"]);
    const feedback = events[1]?.payload as { type?: string; feedback?: Record<string, unknown> };
    expect(feedback.type).toBe("experience_feedback");
    expect(feedback.feedback).toMatchObject({
      receiptId: "receipt-2",
      repairId: "repair-1",
      signal: "correction",
      source: "explicit_command",
    });
    expect(feedback.feedback).not.toHaveProperty("promoted");
  });
});

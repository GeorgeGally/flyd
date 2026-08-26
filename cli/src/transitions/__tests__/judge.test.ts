import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import {
  configureTransitionStore,
  recordAction,
  recordNextState,
} from "../writer.js";
import {
  parseJudgmentResponse,
  resetJudgeAttemptsForTests,
  runJudgeSweep,
  stopTransitionJudge,
} from "../judge.js";

const mockConfigState = vi.hoisted(() => ({ keyless: false }));

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>();
  return {
    ...actual,
    resolveModelConnection: () => {
      if (mockConfigState.keyless) throw new Error("No API key is configured");
      return { model: "test-model", apiKey: "test-key", providerIdentity: "test/test-model" };
    },
  };
});

const rootDir = mkdtempSync(join(tmpdir(), "flyd-judge-"));

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

let flydDir = "";

beforeEach(() => {
  flydDir = join(rootDir, randomUUID());
  process.env.FLYD_DIR = flydDir;
  configureTransitionStore({});
  resetJudgeAttemptsForTests();
  mockConfigState.keyless = false;
});

afterEach(() => {
  delete process.env.FLYD_TRANSITIONS_DISABLED;
  delete process.env.FLYD_DIR;
  stopTransitionJudge();
});

function dbPath(): string {
  return join(flydDir, "intelligence.sqlite");
}

function seedAmbiguousTransition(invocationId: string): number {
  const action = recordAction({
    sessionId: "sess",
    invocationId,
    surface: "overlay",
    intent: `intent for ${invocationId}`,
  });
  if (!action.ok || !action.event) throw new Error(`seed action failed: ${JSON.stringify(action)}`);
  const outcome = recordNextState({
    invocationId,
    origin: "user",
    signal: "ambiguous",
  });
  if (!outcome.ok) throw new Error("seed outcome failed");
  return action.event.sequence;
}

function storedEvents() {
  const store = new IntelligenceEventStore({ path: dbPath() });
  try {
    return store.readFrom(0);
  } finally {
    store.close();
  }
}

describe("parseJudgmentResponse", () => {
  it("parses a strict JSON object", () => {
    expect(parseJudgmentResponse('{"verdict": 1, "confidence": 0.8, "rationale": "worked"}', 5)).toEqual({
      transitionSeq: 5,
      verdict: 1,
      confidence: 0.8,
      rationale: "worked",
    });
  });

  it("tolerates code fences and leading prose", () => {
    const raw = 'Here you go:\n```json\n[{"seq": 3, "verdict": -1, "confidence": 0.6, "rationale": "ignored user"}]\n```\nDone.';
    expect(parseJudgmentResponse(raw, 3)).toEqual({
      transitionSeq: 3,
      verdict: -1,
      confidence: 0.6,
      rationale: "ignored user",
    });
  });

  it("picks the matching item from an array response", () => {
    const raw = '[{"seq": 1, "verdict": 0, "confidence": 0.4, "rationale": "a"},{"seq": 2, "verdict": 1, "confidence": 0.9, "rationale": "b"}]';
    expect(parseJudgmentResponse(raw, 2)?.rationale).toBe("b");
  });

  it("rejects unknown fields (whole-entry rejection)", () => {
    expect(parseJudgmentResponse('{"verdict": 1, "confidence": 0.5, "rationale": "r", "score": 9}', 1)).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(parseJudgmentResponse('{"verdict": 2, "confidence": 0.5, "rationale": "r"}', 1)).toBeNull();
    expect(parseJudgmentResponse('{"verdict": 0, "confidence": 1.5, "rationale": "r"}', 1)).toBeNull();
    expect(parseJudgmentResponse('{"verdict": 0, "confidence": -0.1, "rationale": "r"}', 1)).toBeNull();
  });

  it("rejects missing or empty fields", () => {
    expect(parseJudgmentResponse('{"verdict": 0, "confidence": 0.5}', 1)).toBeNull();
    expect(parseJudgmentResponse('{"verdict": 0, "confidence": 0.5, "rationale": "   "}', 1)).toBeNull();
  });

  it("rejects non-JSON garbage and mismatched seq", () => {
    expect(parseJudgmentResponse("the transition was fine I guess", 1)).toBeNull();
    expect(parseJudgmentResponse('[{"seq": 9, "verdict": 0, "confidence": 0.5, "rationale": "r"}]', 1)).toBeNull();
  });
});

describe("runJudgeSweep", () => {
  it("happy path: parses fixture response and appends judgment events without double-judging", async () => {
    const seq = seedAmbiguousTransition("inv-happy");

    let calls = 0;
    const result = await runJudgeSweep({
      modelCall: async () => {
        calls++;
        return `[{"seq": ${seq}, "verdict": 1, "confidence": 0.85, "rationale": "outcome followed intent"}]`;
      },
    }, { graceMs: 0 });

    expect(result.judged).toBe(1);
    expect(calls).toBe(1);

    const judgeEvents = storedEvents().filter((e) => e.sourceId === "transition.judge");
    expect(judgeEvents).toHaveLength(1);
    expect(judgeEvents[0].payload).toMatchObject({
      transitionSeq: seq,
      verdict: 1,
      confidence: 0.85,
    });

    const rerun = await runJudgeSweep({
      modelCall: async () => {
        calls++;
        return "[]";
      },
    }, { graceMs: 0 });
    expect(rerun.judged).toBe(0);
    expect(rerun.candidates).toBe(0);
    expect(calls).toBe(1);
    expect(storedEvents().filter((e) => e.sourceId === "transition.judge")).toHaveLength(1);
  });

  it("edge case: malformed item is skipped, batch continues, retried at most twice", async () => {
    const seqA = seedAmbiguousTransition("inv-a");
    const seqB = seedAmbiguousTransition("inv-b");

    const responses = [
      `[{"seq": ${seqA}, "verdict": 0, "confidence": 0.5, "rationale": "neutral"},{not json}]`,
      `[{"seq": ${seqB}, "verdict": -1, "confidence": "high", "rationale": "still unparseable"}]`,
      `[{"seq": ${seqB}, "verdict": -1, "confidence": 0.7, "rationale": "third try must not happen"}]`,
    ];
    let call = 0;
    const modelCall = async (): Promise<string> => responses[Math.min(call++, responses.length - 1)];

    const first = await runJudgeSweep({ modelCall }, { graceMs: 0 });
    expect(first.judged).toBe(1);
    expect(first.candidates).toBe(2);
    expect(storedEvents().some((e) => (e.payload as Record<string, unknown>)?.transitionSeq === seqB)).toBe(false);

    const second = await runJudgeSweep({ modelCall }, { graceMs: 0 });
    expect(second.judged).toBe(0);
    expect(second.candidates).toBe(1);

    const third = await runJudgeSweep({ modelCall }, { graceMs: 0 });
    expect(third.candidates).toBe(0);
    expect(third.judged).toBe(0);
    expect(call).toBe(2);
    expect(storedEvents().some((e) => (e.payload as Record<string, unknown>)?.transitionSeq === seqB)).toBe(false);
  });

  it("error path: model call throwing resolves quietly and rows stay eligible", async () => {
    const seq = seedAmbiguousTransition("inv-throw");

    const first = await runJudgeSweep({
      modelCall: async () => {
        throw new Error("model exploded");
      },
    }, { graceMs: 0 });
    expect(first.judged).toBe(0);
    expect(storedEvents().filter((e) => e.sourceId === "transition.judge")).toHaveLength(0);

    const recovered = await runJudgeSweep({
      modelCall: async () => `[{"seq": ${seq}, "verdict": 1, "confidence": 0.9, "rationale": "recovered"}]`,
    }, { graceMs: 0 });
    expect(recovered.judged).toBe(1);
  });

  it("integration: kill switch set → sweep runs but writes nothing", async () => {
    seedAmbiguousTransition("inv-killed");
    process.env.FLYD_TRANSITIONS_DISABLED = "1";

    const result = await runJudgeSweep({
      modelCall: async () => "[{\"seq\": 1, \"verdict\": 1, \"confidence\": 1, \"rationale\": \"r\"}]",
    }, { graceMs: 0 });
    expect(result.judged).toBe(0);
    expect(storedEvents().filter((e) => e.sourceId === "transition.judge")).toHaveLength(0);
  });

  it("integration: no API key configured → sweep exits quietly without work", async () => {
    mockConfigState.keyless = true;
    seedAmbiguousTransition("inv-nokey");

    const result = await runJudgeSweep({
      modelCall: async () => {
        throw new Error("model must not be called");
      },
    }, { graceMs: 0 });
    expect(result.judged).toBe(0);
    expect(storedEvents().filter((e) => e.sourceId === "transition.judge")).toHaveLength(0);
  });

  it("deterministic signals are never judged; actions lacking outcomes are", async () => {
    recordAction({ sessionId: "s", invocationId: "inv-det", surface: "overlay", intent: "deterministic" });
    recordNextState({ invocationId: "inv-det", origin: "user", signal: "succeeded" });
    recordAction({ sessionId: "s", invocationId: "inv-bare", surface: "cli_chat", intent: "no outcome yet" });

    const result = await runJudgeSweep({
      modelCall: async (prompt) => {
        expect(prompt).not.toContain("screen contents");
        return "[]";
      },
    }, { graceMs: 0 });

    expect(result.candidates).toBe(1);
  });

  it("grace window keeps fresh transitions out of the batch", async () => {
    seedAmbiguousTransition("inv-fresh");
    const result = await runJudgeSweep({
      modelCall: async () => "[]",
    }, { graceMs: 60_000 });
    expect(result.candidates).toBe(0);
  });

  it("batch size caps the candidate list", async () => {
    for (let i = 0; i < 13; i++) seedAmbiguousTransition(`inv-cap-${i}`);
    const result = await runJudgeSweep({ modelCall: async () => "[]" }, { graceMs: 0, batchSize: 10 });
    expect(result.candidates).toBe(10);
  });
});

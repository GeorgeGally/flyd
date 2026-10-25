import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crewModel, crewOpenCodeConfig, recordCrewSpend, type CrewTask } from "../crew.js";
import { readSpendLedger } from "../../lib/claude-spend.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-crew-claude-"));
  vi.stubEnv("FLYD_CLAUDE_SPEND_FILE", join(dir, "spend.json"));
  vi.stubEnv("FLYD_CLAUDE", "1");
  vi.stubEnv("CLAUDE_API_KEY", "claude-key");
  vi.stubEnv("FLYD_CREW_MODEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function step(input: number, output: number, read = 0): string {
  return `${JSON.stringify({ type: "step_finish", part: { type: "step-finish", tokens: { input, output, reasoning: 0, cache: { read, write: 0 } } } })}\n`;
}

describe("crew on Claude", () => {
  it("leaves crewmates on OpenCode's own default even with Claude on, FLYD_CREW_MODEL when set", () => {
    expect(crewModel()).toBe("opencode-go/gpt-6-luna");
    vi.stubEnv("FLYD_CREW_MODEL", "anthropic/claude-sonnet-5-5");
    expect(crewModel()).toBe("anthropic/claude-sonnet-5-5");
  });

  it("tells OpenCode the workspace of a user-level key", () => {
    expect(crewOpenCodeConfig(true)).not.toHaveProperty("provider");
    vi.stubEnv("CLAUDE_WORKSPACE_ID", "wrkspc_9");
    expect(crewOpenCodeConfig(true)).toMatchObject({ provider: { anthropic: { options: { headers: { "anthropic-workspace-id": "wrkspc_9" } } } } });
    expect(crewOpenCodeConfig(false)).not.toHaveProperty("provider");
  });

  it("counts each logged step once against the month's Claude spend", () => {
    const log = join(dir, "task.jsonl");
    writeFileSync(log, step(1_000_000, 0) + '{"type":"text","part":{"type":"text","text":"working"}}\n');
    const task = { model: "anthropic/claude-sonnet-5-5", log } as CrewTask;
    const offset = recordCrewSpend(task);
    expect(readSpendLedger().bySource.crew.usd).toBeCloseTo(2);
    // A half-written line waits for the next tick.
    appendFileSync(log, step(0, 100_000) + '{"type":"step_fin');
    const next = recordCrewSpend({ ...task, spendOffset: offset });
    expect(readSpendLedger().bySource.crew.usd).toBeCloseTo(3);
    expect(recordCrewSpend({ ...task, spendOffset: next })).toBe(next);
    expect(readSpendLedger().bySource.crew.calls).toBe(2);
  });

  it("leaves non-Claude crewmates out of Claude spend", () => {
    const log = join(dir, "other.jsonl");
    writeFileSync(log, step(1_000_000, 0));
    recordCrewSpend({ model: "opencode-go/deepseek-v4.1-flash", log } as CrewTask);
    expect(readSpendLedger().calls).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const flydDir = join(tmpdir(), `flyd-export-test-${randomUUID()}`);
const wikiDir = join(flydDir, "wiki");
const plansDir = join(flydDir, "plans");

vi.mock("../lib/config.js", () => ({
  FLYD_DIR: flydDir,
  WIKI_DIR: wikiDir,
  PLANS_DIR: plansDir,
}));

vi.mock("../lib/attention.js", () => ({
  loadCaptureDocs: () => [{
    path: join(flydDir, "raw", "event.md"),
    date: "2026-07-12",
    topics: ["flyd"],
    eventType: "decision",
    outcome: "implemented",
    signal: "important",
    body: "The interface is the intelligence expressed.",
  }],
  computeAttention: () => [{ topic: "flyd", score: 0.8 }],
}));

vi.mock("../lib/tension.js", () => ({
  loadGoals: () => [{ slug: "ship-flyd", title: "Ship Flyd", topics: ["flyd"] }],
  computeTension: (goals: unknown[]) => [{ goal: goals[0], tension: 0.7 }],
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-12T10:00:00Z"));
  mkdirSync(join(wikiDir, "nested"), { recursive: true });
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(wikiDir, "nested", "status-report.md"), "# Flyd Status\nupdated: 2026-07-12\nReady.", "utf8");
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(flydDir, { recursive: true, force: true });
});

describe("intelligence state exporter", () => {
  it("builds the canonical evidence contract with portable report paths", async () => {
    const { buildIntelligenceState } = await import("../export-state.js");
    const state = buildIntelligenceState();

    expect(state.version).toBe("1.0");
    expect(state.source).toBe("flyd-cli");
    expect(state.goals[0]).toMatchObject({
      type: "goal",
      source: "cli.goals",
      epistemicStatus: "user_confirmed",
      confidence: 0.9,
      evidenceRefs: [],
    });
    expect(state.goals[0].id).toMatch(/^goal:/);
    expect(state.reports[0].content.path).toBe("wiki/nested/status-report.md");
    expect(state.recentEvents[0].content.path).toBe("raw/event.md");
  });

  it("writes through a temporary file and leaves only the final JSON", async () => {
    const { buildIntelligenceState, writeIntelligenceState } = await import("../export-state.js");
    const output = join(flydDir, "state.json");

    writeIntelligenceState(buildIntelligenceState(), output);

    expect(existsSync(output)).toBe(true);
    expect(existsSync(`${output}.tmp`)).toBe(false);
    expect(JSON.parse(readFileSync(output, "utf8")).version).toBe("1.0");
  });
});

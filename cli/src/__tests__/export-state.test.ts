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
  loadCaptureDocs: (options?: { includePolluted?: boolean }) => [{
    path: join(flydDir, "raw", "event.md"),
    date: "2026-07-12",
    topics: ["flyd"],
    eventType: "decision",
    outcome: "implemented",
    signal: "important",
    body: "The interface is the intelligence expressed.",
    metadata: {},
  }, ...(options?.includePolluted ? [{
    path: join(flydDir, "raw", "test.md"),
    date: "2026-07-12",
    topics: ["flyd"],
    eventType: "observation",
    outcome: null,
    signal: null,
    body: `test: ${"A".repeat(500)}`,
    metadata: {},
  }] : [])],
  computeAttention: () => [{ topic: "flyd", score: 0.8 }],
}));

vi.mock("../lib/interests.js", () => ({
  getActiveInterests: () => [{ topic: "generative art", keywords: [], priority: "high", auto_extracted: false, first_seen: "2026-01-01", last_active: "2026-07-12", capture_count: 10, staleness_days: 30 }],
}));

vi.mock("../lib/graph.js", () => ({
  getGraphStats: () => ({ entities: 4, edges: 8, bodyEdges: 3, frontmatterEdges: 5, byType: {} }),
}));

vi.mock("../lib/review-store.js", () => ({
  getStats: () => ({ total: 6, due: 2, reviewedToday: 1, avgStability: 3 }),
}));

vi.mock("../commands/dashboard.js", () => ({
  getActiveSuggestions: () => [{ id: "s1", type: "stale", message: "Review memory", action: "flyd review" }],
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
    expect(state.brainHealth[0].content).toMatchObject({ rawCaptures: 2, usableCaptures: 1, quarantinedCaptures: 1, wikiPages: 1 });
    expect(state.profile[0].content.interests).toHaveLength(1);
    expect(state.knowledge[0].content.graph).toMatchObject({ entities: 4, edges: 8 });
    expect(state.review[0].content).toMatchObject({ total: 6, due: 2 });
    expect(state.suggestions[0].content.message).toBe("Review memory");
    const manifest = state.capabilities[0].content.manifest as Record<string, { integration: string }>;
    expect(manifest.ask.integration).toBe("targeted");
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

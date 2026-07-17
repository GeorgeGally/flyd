import { describe, expect, it } from "vitest";
import type { CaptureDoc } from "../attention.js";
import type { Interest } from "../interests.js";
import { assessBrainState, isPollutedCapture } from "../brain-state.js";

function capture(body: string, date = "2026-07-15 10:00:00"): CaptureDoc {
  return {
    path: "capture.md",
    body,
    metadata: { source: "cli" },
    date,
    topics: ["flyd"],
    eventType: "observation",
    outcome: null,
    signal: null,
  };
}

function interest(topic: string, autoExtracted = true): Interest {
  return {
    topic,
    keywords: [],
    priority: "medium",
    auto_extracted: autoExtracted,
    first_seen: "2026-06-01 00:00:00",
    last_active: "2026-07-15 00:00:00",
    capture_count: 12,
    staleness_days: 30,
  };
}

describe("brain state", () => {
  it("quarantines obvious test payloads without deleting normal captures", () => {
    expect(isPollutedCapture(capture("test: " + "A".repeat(500)))).toBe(true);
    expect(isPollutedCapture(capture("hello from test suite"))).toBe(true);
    expect(isPollutedCapture(capture("The poster interface should adapt to the decision."))).toBe(false);
  });

  it("reports archive health and excludes implementation-token interests", () => {
    const state = assessBrainState({
      docs: [capture("test: " + "A".repeat(500)), capture("Creative coding and generative art")],
      interests: [interest("controllers"), interest("creative coding"), interest("My explicit interest", false)],
      wikiCount: 72,
      graph: { entities: 20, edges: 35, bodyEdges: 10, frontmatterEdges: 25, byType: {} },
      review: { total: 8, due: 3, reviewedToday: 1, avgStability: 4.2 },
      suggestions: [{ id: "s1", type: "stale", message: "Review an old belief", action: "flyd review" }],
      now: new Date("2026-07-16T00:00:00Z"),
    });

    expect(state.health).toMatchObject({ rawCaptures: 2, usableCaptures: 1, quarantinedCaptures: 1, wikiPages: 72 });
    expect(state.profile.interests.map((item) => item.topic)).toEqual(["My explicit interest", "creative coding"]);
    expect(state.profile.taste.preferences).toContain("weird_over_practical");
    expect(state.profile.taste.favors).toContain("internet_archaeology");
    expect(state.knowledge.graph).toMatchObject({ entities: 20, edges: 35 });
    expect(state.review.due).toBe(3);
    expect(state.suggestions).toHaveLength(1);
    expect(Object.keys(state.capabilities.manifest)).toContain("ask");
  });
});

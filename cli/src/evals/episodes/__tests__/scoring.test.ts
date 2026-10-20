import { describe, expect, it } from "vitest";
import { evidenceRecall, evaluatePromotionGate, parseEpisodeJudge } from "../scoring.js";
import { selectDrillRoots } from "../context.js";
import type { EpisodeNode } from "../../../intelligence/episodes/types.js";

function node(id: string, summary: string, endSequence: number): EpisodeNode {
  return {
    id,
    level: 0,
    leafStart: endSequence - 1,
    leafEnd: endSequence,
    startSequence: endSequence,
    endSequence,
    startTime: "2026-10-01T00:00:00.000Z",
    endTime: "2026-10-01T00:00:00.000Z",
    eventCount: 1,
    summary,
    sourceHash: id,
    summaryVersion: 1,
    generatedAt: "2026-10-20T00:00:00.000Z",
  };
}

describe("episodic eval scoring", () => {
  it("measures exact evidence recall without rewarding duplicates", () => {
    expect(evidenceRecall([1, 2, 3, 4], [2, 2, 4, 9])).toBe(0.5);
    expect(evidenceRecall([], [])).toBe(1);
  });

  it("parses bounded judge output", () => {
    expect(parseEpisodeJudge('{"score":9,"reason":"accurate"}')).toEqual({ score: 9, reason: "accurate" });
    expect(parseEpisodeJudge('{"score":11,"reason":"bad"}')).toBeNull();
  });

  it("selects drill roots by query relevance before recency", () => {
    const nodes = [
      node("old-nuanu", "Nuanu venue negotiation moved from fixed rent toward revenue share", 10),
      node("recent-code", "Flyd mobile deployment and code review", 20),
      node("recent-nuanu", "Christmas decorations at Nuanu", 30),
    ];
    const selected = selectDrillRoots(nodes, "How did the Nuanu venue negotiation change?", 2);
    expect(selected[0]?.id).toBe("old-nuanu");
    expect(selected.map((item) => item.id)).toContain("recent-nuanu");
  });

  it("promotes only when quality improves without material regressions", () => {
    expect(evaluatePromotionGate({
      currentQuality: 7.2,
      drillQuality: 8.0,
      currentPasses: 6,
      drillPasses: 8,
      currentMedianSeconds: 5,
      drillMedianSeconds: 7,
      currentContextCharacters: 4000,
      drillContextCharacters: 9000,
    }).promoted).toBe(true);

    const blocked = evaluatePromotionGate({
      currentQuality: 7.5,
      drillQuality: 7.7,
      currentPasses: 7,
      drillPasses: 6,
      currentMedianSeconds: 5,
      drillMedianSeconds: 14,
      currentContextCharacters: 4000,
      drillContextCharacters: 20000,
    });
    expect(blocked.promoted).toBe(false);
    expect(blocked.reasons.length).toBeGreaterThan(1);
  });
});

import { describe, expect, it } from "vitest";
import { ImportanceJudge } from "../importance-judge.js";
import type { ShowItem } from "../show.js";

function jev(probability: number) {
  const bodies: unknown[] = [];
  const fetchFn = (async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ model: "jev-1.13.0", answers: { matters_to_george: { type: "noul", noul: probability, probability, confidence: Math.max(probability, 1 - probability) } }, usage: { input_tokens: 10, output_tokens: 1 } }) };
  }) as unknown as typeof fetch;
  return { judge: new ImportanceJudge({ apiKey: "test", fetchFn, now: () => Date.parse("2026-10-18T12:00:00Z") }), bodies };
}
const stale: ShowItem = { id: "ready:capfive-deals", kind: "ready", headline: "CapFive Deals padding change is waiting to land.", why: "", project: "capfive", at: "2026-10-14T12:00:00Z" };

describe("ImportanceJudge", () => {
  it("shows an item until Flyd has judged it", () => {
    const { judge } = jev(0.1);
    expect(judge.matters(stale)).toBeUndefined();
  });

  it("takes an item Flyd is sure is not his off his screen, telling the judge its age and what he said lately", async () => {
    const { judge, bodies } = jev(0.1);
    await judge.request(stale, ["fix the GNM email", "the left bar is broken"]);
    expect(judge.matters(stale)).toBe(false);
    expect(JSON.stringify(bodies[0])).toContain("96");
    expect(JSON.stringify(bodies[0])).toContain("fix the GNM email");
  });

  it("keeps an item Flyd is sure is his", async () => {
    const { judge } = jev(0.92);
    await judge.request(stale, []);
    expect(judge.matters(stale)).toBe(true);
  });

  it("leaves an unsure call unsettled, so the item still shows, and never asks it again", async () => {
    const { judge, bodies } = jev(0.5);
    expect(await judge.request(stale, [])).toBe(false);
    expect(judge.matters(stale)).toBeUndefined();
    expect(judge.asked(stale)).toBe(true);
    // Asking again on every refresh redrew his screen in a loop.
    expect(await judge.request(stale, [])).toBe(false);
    expect(bodies).toHaveLength(1);
  });

  it("says the screen must change only when an item comes off it", async () => {
    expect(await jev(0.1).judge.request(stale, [])).toBe(true);
    expect(await jev(0.95).judge.request(stale, [])).toBe(false);
  });
});

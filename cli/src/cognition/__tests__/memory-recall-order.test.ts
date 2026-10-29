import { expect, it, vi } from "vitest";

vi.mock("../../lib/brain-retrieval.js", () => ({
  retrieveLiveBrainEvidence: async () => ({
    retrievalRoute: "lexical",
    matches: [
      { id: "correction", confidence: 0.55, epistemicStatus: "observation", content: { excerpt: "George changed the speaking style Flyd uses.", path: "correction.md", lastUpdated: "2026-09-27" }, confidenceProfile: { freshness: 0.3 } },
      { id: "unrelated", confidence: 0.9, epistemicStatus: "observation", content: { excerpt: "George likes a style.", path: "other.md", lastUpdated: "2026-10-28" }, confidenceProfile: { freshness: 0.9 } },
    ],
  }),
}));

it("keeps recall ranking and source identity through unified memory", async () => {
  const { queryMemory } = await import("../memory.js");
  const result = await queryMemory({ text: "What speaking style does George want Flyd to use now?", useJev: false });
  expect(result.relevant.map((item) => item.source)).toEqual(["correction.md", "other.md"]);
  expect(result.relevant[0]?.content).toBe("George changed the speaking style Flyd uses.");
});

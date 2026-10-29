import { expect, it } from "vitest";
import { shouldEscalateRecall, combineRecallMatches } from "../recall-escalation.js";

it("escalates explicit recall only when the top lexical result has weak query overlap", () => {
  expect(shouldEscalateRecall("What did I want Flyd research to search in parallel?", "a note about unrelated work")).toBe(true);
  expect(shouldEscalateRecall("What did I want Flyd research to search in parallel?", "Flyd research should search many sources in parallel")).toBe(false);
  expect(shouldEscalateRecall("What is a black hole?", "an unrelated note")).toBe(false);
  expect(shouldEscalateRecall("remember this: I prefer aisle seats", "")).toBe(false);
});

it("keeps both source records when hybrid adds a different candidate", () => {
  const combined = combineRecallMatches([{ content: { path: "hybrid.md", excerpt: "new" } }], [{ content: { path: "lexical.md", excerpt: "old" } }, { content: { path: "hybrid.md", excerpt: "same" } }]);
  expect(combined.map((m) => m.content.path)).toEqual(["hybrid.md", "lexical.md"]);
  expect(combined[1]?.content.excerpt).toBe("old");
  const differentArchives = combineRecallMatches([{ content: { path: "same.md", archive: "raw" } }], [{ content: { path: "same.md", archive: "wiki" } }]);
  expect(differentArchives).toHaveLength(2);
});

it("ranks a more relevant current-time correction ahead of weaker results without changing the records", async () => {
  const { rerankTemporalRecall } = await import("../recall-escalation.js");
  const records = [
    { content: { path: "unrelated.md", excerpt: "George likes a style.", lastUpdated: "2026-10-28" } },
    { content: { path: "correction.md", excerpt: "George changed the speaking style Flyd uses.", lastUpdated: "2026-09-27" } },
  ];
  const result = rerankTemporalRecall("What speaking style does George want Flyd to use now?", records);
  expect(result.map((m) => m.content.path)).toEqual(["correction.md", "unrelated.md"]);
  expect(result[0]).toBe(records[1]);
  expect(rerankTemporalRecall("What is a black hole?", records)).toEqual(records);
});

it("falls back to the lexical result if local hybrid search fails or stalls", async () => {
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { vi } = await import("vitest");
  const cache = mkdtempSync(join(tmpdir(), "recall-qmd-"));
  vi.stubEnv("XDG_CACHE_HOME", cache);
  vi.stubEnv("FLYD_QMD_HYBRID", "1");
  const qmd = await import("../qmd.js");
  const { RAW_DIR } = await import("../config.js");
  const { retrieveLiveBrainEvidence } = await import("../brain-retrieval.js");
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(join(RAW_DIR, "fallback-test.md"), "---\nsource: cli\ntimestamp: 2026-10-27 12:00:00\n---\n\nUltraviolet was a private idea.");
  for (let i = 0; i < 20; i++) writeFileSync(join(RAW_DIR, `other-${i}.md`), `---\nsource: cli\n---\n\nUnrelated garden note ${i}.`);
  mkdirSync(join(process.env.XDG_CACHE_HOME!, "qmd"), { recursive: true });
  const { createStore } = await import("@tobilu/qmd");
  const store = await createStore({ dbPath: qmd.qmdDbPath(), config: { collections: { "flyd-raw": { path: RAW_DIR, pattern: "**/*.md" } } } });
  await store.update({ collections: ["flyd-raw"] });
  await store.close();
  const found = await qmd.searchLexical("ultraviolet", "flyd-raw");
  expect(found.length).toBeGreaterThan(0);
  const hybrid = vi.spyOn(qmd, "searchLocalHybrid").mockRejectedValue(new Error("offline"));
  try {
    const result = await retrieveLiveBrainEvidence("What did I want ultraviolet research to search in parallel?");
    expect(result.retrievalRoute).toBe("hybrid_failed");
    expect(result.matches.map((m) => m.content.path)).toContain("fallback-test.md");
    vi.stubEnv("FLYD_QMD_HYBRID_TIMEOUT_MS", "50");
    hybrid.mockReturnValue(new Promise(() => {}));
    const slow = await retrieveLiveBrainEvidence("What did I want ultraviolet research to search in parallel?");
    expect(slow.retrievalRoute).toBe("hybrid_failed");
    expect(slow.matches.map((m) => m.content.path)).toContain("fallback-test.md");
  } finally { hybrid.mockRestore(); await qmd.closeStore(); vi.unstubAllEnvs(); rmSync(cache, { recursive: true, force: true }); }
});

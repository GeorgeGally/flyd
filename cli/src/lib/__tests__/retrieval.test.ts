import { describe, expect, it } from "vitest";
import { mergeEntries, MAX_ENTRIES, type BaseEntry } from "../retrieval.js";

function wikiEntry(i: number): BaseEntry {
  return { path: `wiki/entry-${i}.md`, body: "wiki body", score: 60, metadata: {}, source: "wiki" };
}

function rawEntry(i: number): BaseEntry {
  return { path: `raw/entry-${i}.md`, body: "raw body", score: 60, metadata: {}, source: "raw" };
}

describe("mergeEntries", () => {
  it("does not drop raw entries once wiki entries alone would have filled the old MAX_ENTRIES cap", () => {
    const wiki = Array.from({ length: MAX_ENTRIES }, (_, i) => wikiEntry(i));
    const raw = [rawEntry(0), rawEntry(1)];

    const merged = mergeEntries(raw, wiki);

    expect(merged.length).toBe(wiki.length + raw.length);
    expect(merged.some((e) => e.path === "raw/entry-0.md")).toBe(true);
    expect(merged.some((e) => e.path === "raw/entry-1.md")).toBe(true);
  });

  it("still dedupes by path, with wiki winning on conflict", () => {
    const wiki = [{ ...wikiEntry(0), path: "shared.md", body: "wiki version" }];
    const raw = [{ ...rawEntry(0), path: "shared.md", body: "raw version" }];

    const merged = mergeEntries(raw, wiki);

    expect(merged.length).toBe(1);
    expect(merged[0].body).toBe("wiki version");
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtefactFeed, composeArtefact, memoryHighlights, newsHighlights, parseBearings, tasteHighlights } from "../artefact.js";

const BEARINGS = {
  schema: "fm-bearings.v1",
  generated: "2026-10-09T10:56:01Z",
  decisions_open: [{ id: "jev", summary: "Review the Jev decision log: keep or remove it?" }],
  in_flight: [
    { id: "a", state: "working", repo: "flyd", name: "Artefact mode must always show something real", doing: "harness busy" },
    { id: "b", state: "done", repo: "flyd", name: "Already finished", doing: "landed" },
  ],
  landed: [{ id: "flyd-show-mode", what: "Flyd: visual show mode", artifact: "https://github.com/GeorgeGally/flyd/pull/79" }],
  gates: [{ id: "flyd-icon-led", title: "Add a subtle flat green light to the Flyd icon", blocked_by: "-" }],
};

describe("parseBearings", () => {
  it("maps firstmate's snapshot to calls, live, landed and next", () => {
    const fleet = parseBearings(BEARINGS);
    expect(fleet.generated).toBe("2026-10-09T10:56:01Z");
    expect(fleet.unavailable).toBeUndefined();
    expect(fleet.calls).toEqual([{ label: "Review the Jev decision log: keep or remove it?" }]);
    expect(fleet.live).toEqual([{ label: "Artefact mode must always show something real", detail: "harness busy", repo: "flyd" }]);
    expect(fleet.landed).toEqual([{ label: "Flyd: visual show mode", url: "https://github.com/GeorgeGally/flyd/pull/79" }]);
    expect(fleet.next).toEqual([{ label: "Add a subtle flat green light to the Flyd icon" }]);
  });

  it("says plainly when the snapshot is not the expected shape", () => {
    expect(parseBearings({ schema: "something-else" }).unavailable).toContain("something-else");
    expect(parseBearings("not json").unavailable).toBeTruthy();
  });
});

describe("member reads", () => {
  it("takes the newest open commitment from memory", () => {
    const md = "# Flyd memory\n\n## Commitments\n- George wants Bloom finished, not just launched. <!--p:2026-09-29-->\n- Second one.\n";
    expect(memoryHighlights(md)).toEqual(["George wants Bloom finished, not just launched."]);
    expect(memoryHighlights("# Flyd memory\n\n## Lately\n- something\n")).toEqual([]);
  });

  it("takes the first relevant news item", () => {
    const edition = { items: [{ kind: "watching", title: "skip" }, { kind: "relevant", title: "Hybrid RAG", url: "https://x.test/1", why: "speaks to your search" }] };
    expect(newsHighlights(edition)).toEqual([{ title: "Hybrid RAG", url: "https://x.test/1", why: "speaks to your search" }]);
  });

  it("reads taste rules, not their quotes", () => {
    const md = "## Everywhere\n\n- No eyebrow/kicker label above a headline. <!--taste:x-->\n  - \"we don't need the eyebrow\" — Claude Code\n- Colour alone marks the active item. <!--taste:y-->\n";
    expect(tasteHighlights(md)).toEqual(["No eyebrow/kicker label above a headline.", "Colour alone marks the active item."]);
  });
});

describe("composeArtefact", () => {
  it("builds one line per input, fleet first, in Flyd's own kinds", () => {
    const items = composeArtefact({
      fleet: parseBearings(BEARINGS),
      memories: ["George wants Bloom finished."],
      news: [{ title: "Hybrid RAG", url: "https://x.test/1", why: "speaks to your search" }],
      taste: ["No eyebrow above a headline."],
    });
    expect(items.map((item) => [item.kind, item.headline])).toEqual([
      ["call", "Review the Jev decision log: keep or remove it?"],
      ["live", "Artefact mode must always show something real"],
      ["landed", "Flyd: visual show mode"],
      ["waiting", "Add a subtle flat green light to the Flyd icon"],
      ["news", "George wants Bloom finished."],
      ["news", "Hybrid RAG"],
    ]);
    expect(items[0]!.why).toBe("");
    expect(items[2]!.links).toEqual([{ label: "flyd #79", url: "https://github.com/GeorgeGally/flyd/pull/79" }]);
    expect(items[4]).toMatchObject({ why: "from your memory" });
  });

  it("says so plainly when the fleet snapshot could not be read", () => {
    const items = composeArtefact({ fleet: { unavailable: "timed out", calls: [], live: [], landed: [], next: [] }, memories: [], news: [], taste: [] });
    expect(items[0]).toMatchObject({ kind: "news", why: "fleet status unknown" });
    expect(items[0]!.headline).toContain("timed out");
  });
});

describe("ArtefactFeed", () => {
  it("reads memory, news and taste, and reports a missing snapshot honestly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "artefact-feed-"));
    writeFileSync(join(dir, "MEMORY.md"), "## Commitments\n- Ship the artefact panel.\n");
    writeFileSync(join(dir, "edition.json"), JSON.stringify({ items: [{ kind: "relevant", title: "A story" }] }));
    writeFileSync(join(dir, "TASTE.md"), "## Everywhere\n- Plain and spare.\n");
    const feed = new ArtefactFeed({ home: join(dir, "no-firstmate-here"), memoryFile: join(dir, "MEMORY.md"), newsFile: join(dir, "edition.json"), tasteFile: join(dir, "TASTE.md") });
    await feed.refresh();
    const inputs = feed.current();
    expect(inputs.fleet?.unavailable).toBeTruthy();
    expect(inputs.memories).toEqual(["Ship the artefact panel."]);
    expect(inputs.news).toEqual([{ title: "A story", url: undefined, why: undefined }]);
    expect(inputs.taste).toEqual(["Plain and spare."]);
  });
});

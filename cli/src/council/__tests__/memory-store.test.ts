import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMemoryOps, entryId, memoryPaths, memoryPromptText, readMemoryEntries, searchDailyNotes, staleEntries, type MemoryPaths,
} from "../memory-store.js";

describe("tiered memory store", () => {
  let dir: string;
  let paths: MemoryPaths;
  const day = (text: string) => new Date(`${text}T12:00:00`);
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-memory-")); paths = memoryPaths(dir); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("adds, updates, reinforces and archives with provenance", () => {
    const receipt = applyMemoryOps([
      { op: "add", section: "Commitments", text: "Ship CleanX to the Chrome Web Store by 3 Oct", tier: "perishable", sources: ["j1"] },
      { op: "add", section: "decisions", text: "CleanX uses one-time credit packs, no subscription", sources: ["cap7"] },
      { op: "add", section: "Decisions", text: "CleanX uses one-time credit packs, no subscription" },
      { op: "reinforce", id: "nope" },
    ], { now: day("2026-09-27"), paths });
    expect(receipt).toMatchObject({ added: 2, rejected: [expect.stringContaining("duplicate"), "reinforce: unknown [nope]"] });
    expect(readFileSync(paths.memory, "utf8")).toContain("## Commitments\n- Ship CleanX to the Chrome Web Store by 3 Oct <!--p:2026-09-27-->");

    const id = entryId("CleanX uses one-time credit packs, no subscription");
    applyMemoryOps([{ op: "update", id, text: "CleanX uses three one-time credit packs ($10/$15/$20)", sources: ["j9"] }], { now: day("2026-09-28"), paths });
    const entries = readMemoryEntries(paths);
    expect(entries.map((entry) => entry.text)).toContain("CleanX uses three one-time credit packs ($10/$15/$20)");
    expect(readFileSync(paths.archive, "utf8")).toContain("CleanX uses one-time credit packs, no subscription — Decisions, aging, last confirmed 2026-09-27; superseded by");
    expect(JSON.parse(readFileSync(paths.sources, "utf8"))[entryId("CleanX uses three one-time credit packs ($10/$15/$20)")]).toEqual(["cap7", "j9"]);
  });

  it("flags stale entries by tier and retires long-unconfirmed ones on its own", () => {
    applyMemoryOps([
      { op: "add", section: "Commitments", text: "Call the landlord this week", tier: "perishable" },
      { op: "add", section: "Facts", text: "Studio is in Canggu" },
    ], { now: day("2026-09-01"), paths });
    expect(staleEntries(readMemoryEntries(paths), day("2026-09-09")).map((entry) => entry.text)).toEqual(["Call the landlord this week"]);
    applyMemoryOps([], { now: day("2026-09-20"), paths });
    expect(readMemoryEntries(paths).map((entry) => entry.text)).toEqual(["Studio is in Canggu"]);
    expect(readFileSync(paths.archive, "utf8")).toContain("unconfirmed for 14+ days");
  });

  it("renders prompt text without markers and searches daily notes on demand", () => {
    applyMemoryOps([
      { op: "add", section: "People", text: "Maya is George's partner" },
      { op: "daily_note", text: "Discussed moving the studio launch to October", sources: ["j3"] },
    ], { now: day("2026-09-27"), paths });
    expect(memoryPromptText(paths)).toBe("## People\n- Maya is George's partner");
    expect(searchDailyNotes("studio launch", paths)).toEqual(["2026-09-27: Discussed moving the studio launch to October (j3)"]);
  });

  it("parses hand edits and keeps unknown sections", () => {
    writeFileSync(paths.memory, "# Flyd memory\n\n## Travel\n- Prefers aisle seats <!--a:2026-09-20-->\n");
    applyMemoryOps([{ op: "add", section: "Facts", text: "Uses a Mac" }], { now: day("2026-09-27"), paths });
    const text = readFileSync(paths.memory, "utf8");
    expect(text).toContain("## Travel\n- Prefers aisle seats <!--a:2026-09-20-->");
    expect(text).toContain("## Facts\n- Uses a Mac <!--a:2026-09-27-->");
  });
});

describe("budget eviction", () => {
  it("forgets project detail before who George is", async () => {
    const { applyMemoryOps, readMemoryEntries, memoryPaths, MEMORY_BUDGET_CHARS } = await import("../memory-store.js");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const paths = memoryPaths(mkdtempSync(join(tmpdir(), "flyd-budget-")));
    const now = new Date("2026-09-27T10:00:00Z");
    applyMemoryOps([{ op: "add", section: "Who he is", text: "Has ADHD and prefers short, scannable replies." }], { now, paths });
    const filler = Array.from({ length: Math.ceil(MEMORY_BUDGET_CHARS / 90) + 5 }, (_, index) => ({
      op: "add" as const, section: "Projects", text: `Project detail number ${index} about some service wiring that nobody needs to remember forever.`,
    }));
    applyMemoryOps(filler, { now, paths });
    const entries = readMemoryEntries(paths);
    expect(entries.some((entry) => entry.text.startsWith("Has ADHD"))).toBe(true);
    expect(entries.filter((entry) => entry.section === "Projects").length).toBeLessThan(filler.length);
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { investigate, nextArea, parseFindings } from "../investigator.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-investigator-"));
  process.env.FLYD_INVESTIGATOR_DIR = join(home, "state");
  process.env.FLYD_MEMORY_DIR = join(home, "memory");
  process.env.FLYD_USER_PROFILE = join(home, "USER.md");
  process.env.FLYD_INVESTIGATOR = "1";
});
afterEach(() => {
  process.env.FLYD_INVESTIGATOR = "0";
  rmSync(home, { recursive: true, force: true });
});

describe("investigator", () => {
  it("looks into the thinnest area of his life first, and rotates", () => {
    const profile = "## People\n- Sam is his brother.\n- Lee is his partner.\n## Routines\n- Runs at 6am.\n";
    expect(nextArea(profile, [])).toBe(2);
    expect(nextArea(profile, [], 2)).toBe(3);
  });

  it("keeps only facts that cite evidence it was shown", () => {
    const ops = parseFindings(JSON.stringify({ facts: [
      { section: "People", text: "Sam is George's brother; they have dinner most Sundays.", sources: ["e2"] },
      { section: "Facts", text: "Invented fact.", sources: ["e9"] },
      { section: "Facts", text: "No source." },
    ] }), 3);
    expect(ops).toEqual([{ op: "add", section: "People", text: "Sam is George's brother; they have dinner most Sundays.", tier: "aging", sources: ["investigator:e2"] }]);
  });

  it("goes looking in his own data and quietly adds what it learns to memory", async () => {
    writeFileSync(process.env.FLYD_USER_PROFILE!, "## About me\n- Artist in Cape Town.\n");
    const complete = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("calendar (past month): Sunday dinner with Sam");
      return JSON.stringify({ facts: [{ section: "People", text: "George has Sunday dinner with Sam.", sources: ["e1"] }] });
    });
    const result = await investigate({
      complete,
      calendar: async (from) => (from < "2026-09-27" ? "Sunday dinner with Sam — 2026-09-20 19:00" : "No calendar events"),
      reminders: async () => "Call Sam",
      recall: async () => "",
      now: () => new Date("2026-09-27T10:00:00Z"),
    });
    expect(result).toEqual({ status: "done", area: expect.stringContaining("people"), added: 1 });
    expect(readFileSync(join(home, "memory", "MEMORY.md"), "utf8")).toContain("George has Sunday dinner with Sam.");
    expect((await investigate({ complete, now: () => new Date("2026-09-27T12:00:00Z") })).status).toBe("not_due");
  });
});

describe("archive backfill", () => {
  it("reads everything George ever fed Flyd, once, in batches, keeping only his side of conversations", async () => {
    const { backfillArchive } = await import("../investigator.js");
    const { mkdirSync } = await import("node:fs");
    const raw = join(home, "raw");
    mkdirSync(raw);
    writeFileSync(join(raw, "2026-08-13-profile.md"), "---\nsource: cli\n---\nWriting preference: avoid constructions like 'it's not X, it's Y'.\n");
    writeFileSync(join(raw, "conversation-1.md"), "---\nsource: cli\n---\n**George** my sister Ana visits in October\n**Flyd** Noted, lovely.\n");
    writeFileSync(join(raw, "runtime-event-1.md"), "---\n---\nignored runtime noise here\n");
    const complete = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("avoid constructions like");
      expect(prompt).toContain("George: my sister Ana visits in October");
      expect(prompt).not.toContain("Noted, lovely");
      expect(prompt).not.toContain("runtime noise");
      return JSON.stringify({ facts: [
        { section: "Who he is", text: "Dislikes the phrasing 'it's not X, it's Y'.", sources: ["e1"] },
        { section: "People", text: "Ana is George's sister.", sources: ["e2"] },
      ] });
    });
    expect(await backfillArchive({ complete, rawDir: raw })).toEqual({ status: "done", read: 2, added: 2 });
    expect(await backfillArchive({ complete, rawDir: raw })).toEqual({ status: "finished", read: 0, added: 0 });
    expect(complete).toHaveBeenCalledTimes(1);
    const memory = readFileSync(join(home, "memory", "MEMORY.md"), "utf8");
    expect(memory).toContain("## Who he is");
    expect(memory).toContain("Ana is George's sister.");
  });
});

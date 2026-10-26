import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { looksBack, readSuperseded, supersedeOnCapture, withoutReplaced } from "../raw-supersession.js";

let home: string;
let rawDir: string;
let ledgerPath: string;

const note = (name: string, text: string) => writeFileSync(join(rawDir, name), `---\ntimestamp: ${name.slice(0, 10)}\n---\n${text}\n`);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-supersede-"));
  rawDir = join(home, "raw");
  mkdirSync(rawDir);
  ledgerPath = join(home, "memory-superseded.json");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("raw note supersession", () => {
  it("records the older note a newer one replaces, and only what the model names", async () => {
    note("2026-09-01-10-00-00.md", "The studio gate code is 4417.");
    note("2026-09-02-10-00-00.md", "I lived in Cape Town for twelve years.");
    note("2026-10-26-09-00-00.md", "The studio gate code changed to 8820.");
    const complete = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("I lived in Cape Town");
      return '{"replaced": [{"id": 1, "why": "new gate code"}]}';
    });
    const replaced = await supersedeOnCapture(join(rawDir, "2026-10-26-09-00-00.md"), "The studio gate code changed to 8820.", {
      search: async () => [{ path: "2026-09-01-10-00-00.md" }, { path: "2026-09-02-10-00-00.md" }, { path: "2026-10-26-09-00-00.md" }],
      complete, rawDir, ledgerPath, now: new Date("2026-10-26T09:00:00Z"),
    });
    expect(Object.keys(replaced)).toEqual(["2026-09-01-10-00-00.md"]);
    expect(readSuperseded(ledgerPath)["2026-09-01-10-00-00.md"]).toMatchObject({ by: "2026-10-26-09-00-00.md", why: "new gate code" });
    expect(readSuperseded(ledgerPath)["2026-09-02-10-00-00.md"]).toBeUndefined();
  });

  it("never offers a newer note as replaced, and changes nothing on a reply it can't read", async () => {
    note("2026-11-01-10-00-00.md", "Later note.");
    const complete = vi.fn(async () => "no idea");
    const replaced = await supersedeOnCapture(join(rawDir, "2026-10-26-09-00-00.md"), "Gate code is 8820 now.", {
      search: async () => [{ path: "2026-11-01-10-00-00.md" }], complete, rawDir, ledgerPath,
    });
    expect(replaced).toEqual({});
    expect(complete).not.toHaveBeenCalled();
  });

  it("leaves replaced notes out of a present question and keeps them for a question about the past", () => {
    const ledger = { "old.md": { by: "new.md", at: "2026-10-26T00:00:00Z" } };
    const entries = [{ path: "old.md", source: "raw" }, { path: "new.md", source: "raw" }, { path: "old.md", source: "wiki" }];
    expect(withoutReplaced(entries, "what's the studio gate code?", ledger).map((e) => `${e.source}:${e.path}`)).toEqual(["raw:new.md", "wiki:old.md"]);
    expect(withoutReplaced(entries, "what was the gate code before?", ledger)).toHaveLength(3);
    expect(looksBack("where did I use to live?")).toBe(true);
    expect(looksBack("where do I live?")).toBe(false);
  });
});

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { searchLiveWiki } from "../brain-retrieval.js";
import { WIKI_DIR } from "../config.js";
import { searchWiki } from "../retrieval.js";

describe("live wiki recall", () => {
  it("searches runtime corrections and leaves the frozen June wiki to explicit search", () => {
    const page = (dir: string, name: string, body: string) => {
      mkdirSync(join(WIKI_DIR, dir), { recursive: true });
      writeFileSync(join(WIKI_DIR, dir, name), `---\ntype: project\nstatus: working\n---\n\n${body}\n`);
    };
    page("projects", "bridgestone.md", "Bridgestone retainer renews in June.");
    page("people", "sam.md", "Sam manages the Bridgestone retainer.");
    page("corrections", "flyd-fix-1.md", "Correction: the Bridgestone retainer ended in September.");

    expect(searchLiveWiki("bridgestone retainer", ["bridgestone", "retainer"]).map((entry) => entry.path)).toEqual(["corrections/flyd-fix-1.md"]);
    expect(searchWiki("bridgestone retainer", ["bridgestone", "retainer"]).map((entry) => entry.path).sort())
      .toEqual(["corrections/flyd-fix-1.md", "people/sam.md", "projects/bridgestone.md"]);
  });
});

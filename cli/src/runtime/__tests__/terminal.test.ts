import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  loadInputHistory,
  parseInputHistory,
  rememberInputLine,
  saveInputHistory,
  wrapDisplayText,
  formatChatReply,
} from "../terminal.js";

describe("CLI input history", () => {
  it("parses newest-first lines and drops blanks", () => {
    expect(parseInputHistory("newest\n\nmiddle\noldest\n", 10)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("caps loaded history", () => {
    expect(parseInputHistory("a\nb\nc\n", 2)).toEqual(["a", "b"]);
  });

  it("round-trips through the history file", () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-input-history-"));
    const path = join(dir, "cli-input-history");
    saveInputHistory(path, ["third", "second", "first"], 10);
    expect(readFileSync(path, "utf8")).toBe("third\nsecond\nfirst\n");
    expect(loadInputHistory(path, 10)).toEqual(["third", "second", "first"]);
  });

  it("returns empty history when the file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-input-history-"));
    expect(loadInputHistory(join(dir, "missing"), 10)).toEqual([]);
  });

  it("creates parent directories when saving", () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-input-history-"));
    const path = join(dir, "nested", "cli-input-history");
    saveInputHistory(path, ["hello"], 10);
    expect(loadInputHistory(path)).toEqual(["hello"]);
  });

  it("remembers lines newest-first and dedupes", () => {
    expect(rememberInputLine(["b", "a"], "c", 10)).toEqual(["c", "b", "a"]);
    expect(rememberInputLine(["b", "a"], "a", 10)).toEqual(["a", "b"]);
    expect(rememberInputLine(["a"], "", 10)).toEqual(["a"]);
    expect(rememberInputLine(["c", "b", "a"], "d", 2)).toEqual(["d", "c"]);
  });
});

describe("wrapDisplayText", () => {
  it("wraps on word boundaries instead of splitting tokens", () => {
    const wrapped = wrapDisplayText(
      "  Flyd drives the view — coordinating active workstreams across Good Neighbours.",
      40,
    );
    expect(wrapped.split("\n").every((line) => line.length <= 40)).toBe(true);
    expect(wrapped).not.toMatch(/workstrea\n/);
    expect(wrapped).toContain("workstreams");
    expect(wrapped).toMatch(/Good\n\s+Neighbours/);
  });

  it("keeps ASCII art lines intact", () => {
    const art = "  ╔══════════╗";
    expect(wrapDisplayText(art, 8)).toBe(art);
  });
});

describe("formatChatReply", () => {
  it("caps measure and indents prose", () => {
    const reply = formatChatReply(
      "Dead Internet Radio last moved 5 weeks ago — admin generation form redesign. Working tree still has uncommitted work across app, src, and shows.json. Next move: finish or park that dirty tree before starting something new.",
      48,
    );
    const lines = reply.split("\n");
    expect(lines.every((line) => line.length <= 48)).toBe(true);
    expect(reply.startsWith("  ")).toBe(true);
    expect(reply).toMatch(/\n\n/);
  });

  it("keeps list hanging indents readable", () => {
    const reply = formatChatReply(
      [
        "The order today:",
        "",
        "- Inspect Dead Internet Radio git status before answering from memory",
        "- Keep Good Neighbours and CleanX in view",
      ].join("\n"),
      40,
    );
    expect(reply).toMatch(/^  - /m);
    expect(reply.split("\n").every((line) => line.length <= 40)).toBe(true);
  });
});

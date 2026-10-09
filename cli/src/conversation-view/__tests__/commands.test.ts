import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverCommands, frontMatter, matchCommand } from "../commands.js";

let dir: string;
const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-view-commands-"));
  const claude = join(dir, "claude");
  write(join(claude, "skills", "design-review", "SKILL.md"), "---\nname: design-review\ndescription: >\n  Designer's eye QA:\n  finds visual inconsistency.\n---\n# Design review\n");
  write(join(claude, "skills", "internal-only", "SKILL.md"), "---\nname: internal-only\nuser-invocable: false\ndescription: not for people\n---\n");
  write(join(claude, "commands", "git", "commit.md"), "Write a commit message for the staged diff.\n");
  const plugin = join(dir, "plugins", "caveman");
  write(join(plugin, "skills", "caveman", "SKILL.md"), "---\nname: caveman\ndescription: \"Terse mode\"\n---\n");
  write(join(claude, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "caveman@caveman": [{ installPath: plugin }] } }));
  write(join(dir, "firstmate", ".claude", "skills", "fm-status", "SKILL.md"), "---\ndescription: Fleet status at a glance\n---\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("slash commands", () => {
  it("lists the skills and commands Claude Code would offer for '/'", () => {
    const commands = discoverCommands({ claudeHome: join(dir, "claude"), projectDir: join(dir, "firstmate") });
    expect(commands).toEqual([
      { name: "caveman:caveman", description: "Terse mode" },
      { name: "design-review", description: "Designer's eye QA: finds visual inconsistency." },
      { name: "fm-status", description: "Fleet status at a glance" },
      { name: "git:commit", description: "Write a commit message for the staged diff." },
    ]);
  });

  it("skips a dangling symlink in a commands folder", () => {
    symlinkSync(join(dir, "missing.md"), join(dir, "claude", "commands", "gone.md"));
    symlinkSync(join(dir, "missing-folder"), join(dir, "claude", "commands", "gone-folder"));
    const names = discoverCommands({ claudeHome: join(dir, "claude") }).map((command) => command.name);
    expect(names).toEqual(["caveman:caveman", "design-review", "git:commit"]);
  });

  it("recognises a message that runs one of them", () => {
    const commands = discoverCommands({ claudeHome: join(dir, "claude") });
    expect(matchCommand("/design-review the cards look flat", commands)?.name).toBe("design-review");
    expect(matchCommand("/caveman:caveman", commands)?.name).toBe("caveman:caveman");
    expect(matchCommand("/not-a-skill hi", commands)).toBeUndefined();
    expect(matchCommand("see /design-review later", commands)).toBeUndefined();
  });

  it("reads plain, quoted and folded front matter", () => {
    expect(frontMatter("---\nname: x\ndescription: 'quoted'\nother: |\n  line one\n  line two\n---\nbody")).toEqual({
      name: "x",
      description: "quoted",
      other: "line one line two",
    });
    expect(frontMatter("no front matter")).toEqual({});
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundledSkillsDir, importSkill, loadSkills, parseSkill, seedSkills, skillPromptBlock } from "../skills.js";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "flyd-skills-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("skills", () => {
  it("seeds the bundled skills once, and one he deletes stays deleted", () => {
    const added = seedSkills(home, bundledSkillsDir());
    expect(added.sort()).toEqual(["chase-payment", "launch-plan", "plan-week", "prioritize", "research-brief", "write-message"]);
    expect(loadSkills(home).find((skill) => skill.name === "chase-payment")?.description).toMatch(/^Getting money George is owed paid/);
    rmSync(join(home, "prioritize"), { recursive: true });
    expect(seedSkills(home, bundledSkillsDir())).toEqual([]);
    expect(loadSkills(home).map((skill) => skill.name)).not.toContain("prioritize");
  });

  it("imports one of his own skills, and refuses one without a description", () => {
    const claude = join(home, "claude");
    mkdirSync(join(claude, "copywriting"), { recursive: true });
    writeFileSync(join(claude, "copywriting", "SKILL.md"), "---\nname: copywriting\ndescription: Writing marketing copy\n---\n\nLead with the benefit.\n");
    mkdirSync(join(claude, "bare"), { recursive: true });
    writeFileSync(join(claude, "bare", "SKILL.md"), "---\nname: bare\n---\nbody\n");
    const target = join(home, "flyd");
    expect(importSkill("copywriting", target, [claude]).path).toBe(join(target, "copywriting", "SKILL.md"));
    expect(loadSkills(target).map((skill) => skill.name)).toEqual(["copywriting"]);
    expect(() => importSkill("bare", target, [claude])).toThrow(/no name\/description/);
    expect(() => importSkill("missing", target, [claude])).toThrow(/No skill named missing/);
  });

  it("parses the SKILL.md format and renders the know-how for one turn", () => {
    const skill = parseSkill('---\nname: "chase-payment"\ndescription: Getting money paid\n---\n\n# Chase\n1. Facts first.', "/x/SKILL.md");
    expect(skill).toEqual({ name: "chase-payment", description: "Getting money paid", body: "# Chase\n1. Facts first.", path: "/x/SKILL.md" });
    expect(skillPromptBlock(skill!)).toBe("## How to do this well (chase-payment)\n# Chase\n1. Facts first.");
    expect(parseSkill("no frontmatter", "/x")).toBeNull();
  });
});

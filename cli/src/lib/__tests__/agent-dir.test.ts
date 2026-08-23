import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  discoverSkills,
  resetAuthoredSkillsCache,
  skillsDirectory,
} from "../agent-dir.js";

describe("agent-dir skill discovery", () => {
  let dir: string | null = null;

  afterEach(() => {
    delete process.env.FLYD_AGENT_DIR;
    resetAuthoredSkillsCache();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("parses frontmatter skills with triggers, contracts and templates", () => {
    dir = join(tmpdir(), `agent-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "focus.md"), `---
name: focus_check
triggers:
  - focus check
  - am i focused
contract_goal: Surface what is actually being worked on right now
dimensions:
  - SPECIFIC — names the current artifact
hard_fails:
  - Must not invent work
journal_event: coach_checkin
---
What are you working on, {{message}}? Grounding: {{grounding}}
`);

    process.env.FLYD_AGENT_DIR = dir;
    resetAuthoredSkillsCache();
    const skills = discoverSkills();
    const focus = skills.find((s) => s.name === "focus_check");
    expect(focus).toBeTruthy();
    expect(focus?.triggers).toEqual(["focus check", "am i focused"]);
    expect(focus?.contractGoal).toContain("actually being worked on");
    expect(focus?.dimensions).toHaveLength(1);
    expect(focus?.journalEvent).toBe("coach_checkin");
    expect(focus?.template).toContain("{{message}}");
    expect(focus?.groundingRequired).toBeUndefined();
  });

  it("defaults the name to the file name and skips unparseable files", () => {
    dir = join(tmpdir(), `agent-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "unnamed.md"), "---\ntriggers:\n  - ping\ncontract_goal: respond to pings\n---\nbody {{message}}");
    writeFileSync(join(dir, "broken.md"), "no frontmatter here");

    process.env.FLYD_AGENT_DIR = dir;
    resetAuthoredSkillsCache();
    const skills = discoverSkills();
    expect(skills.map((s) => s.name)).toEqual(["unnamed"]);
  });

  it("defaults grounding_required off and honors it when true", () => {
    dir = join(tmpdir(), `agent-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "deep.md"), "---\ncontract_goal: coach deeply\ngrounding_required: true\n---\nCoach: {{message}}");

    process.env.FLYD_AGENT_DIR = dir;
    resetAuthoredSkillsCache();
    expect(discoverSkills()[0]?.groundingRequired).toBe(true);
  });

  it("reports null when no agent directory exists", () => {
    delete process.env.FLYD_AGENT_DIR;
    resetAuthoredSkillsCache();
    // In the repo checkout cli/agent exists; the override path is what matters.
    process.env.FLYD_AGENT_DIR = join(tmpdir(), `missing-${randomUUID()}`);
    resetAuthoredSkillsCache();
    expect(skillsDirectory()).toBeNull();
    expect(discoverSkills()).toEqual([]);
  });
});

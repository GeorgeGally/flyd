import { describe, expect, it } from "vitest";
import {
  formatProjectNeedsReply,
  isProjectNeedsQuestion,
  resolveMentionedProject,
} from "../project-mention.js";
import type { BriefRepo } from "../repo-registry.js";

const DIR: BriefRepo = {
  root: "/Users/radarboy3000/Documents/dead-internet-radio",
  name: "dead-internet-radio",
  branch: "main",
  dirty: true,
  lastCommitRelative: "5 weeks ago",
  isForeground: false,
};

const CLEANX: BriefRepo = {
  root: "/Users/radarboy3000/Documents/cleanx",
  name: "cleanx",
  branch: "main",
  dirty: false,
  lastCommitRelative: "2 days ago",
  isForeground: false,
};

describe("project mentions", () => {
  it("resolves DIR / dead internet radio to the Documents repo", () => {
    expect(resolveMentionedProject("what needs to be done on DIR?", [DIR, CLEANX])?.repo.root)
      .toBe(DIR.root);
    expect(resolveMentionedProject("status of dead internet radio", [DIR])?.label)
      .toMatch(/Dead Internet Radio/);
  });

  it("detects needs/status questions", () => {
    expect(isProjectNeedsQuestion("what needs to be done on DIR?")).toBe(true);
    expect(isProjectNeedsQuestion("where are we on CleanX")).toBe(true);
    expect(isProjectNeedsQuestion("good morning")).toBe(false);
    expect(isProjectNeedsQuestion('“the missing piece is making Flyd consume its real evidence” - what does this mean?')).toBe(false);
    expect(isProjectNeedsQuestion("what does this mean?")).toBe(false);
  });

  it("answers from git snapshot, not the to-do list", () => {
    const reply = formatProjectNeedsReply(
      { repo: DIR, label: "Dead Internet Radio (DIR)" },
      {
        lastSubject: "feat: admin generation form redesign",
        lastRelative: "5 weeks ago",
        dirtyCount: 18,
        dirtyPaths: [
          "app/controllers/admin/generation_controller.rb",
          "src/visuals/isocubes.js",
          "shows.json",
        ],
      },
    );
    expect(reply).toMatch(/Dead Internet Radio last moved 5 weeks ago/);
    expect(reply).toMatch(/admin generation form redesign/);
    expect(reply).toMatch(/uncommitted work/);
    expect(reply).toMatch(/app|src|shows\.json/);
    expect(reply).not.toMatch(/to-do|Present Model|no concrete/i);
  });
});

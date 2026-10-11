import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrewProgress, plainStep, stepIn } from "../crew-progress.js";
import type { Exchange } from "../types.js";

const WORKTREE = "/Users/george/.treehouse/site-1/2/site";
const assistant = (...content: unknown[]) => JSON.stringify({ type: "assistant", isSidechain: false, message: { role: "assistant", content } });
const tool = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", name, input });

describe("a crewmate's step", () => {
  it("is its own short words, or a tool's purpose, in plain English", () => {
    expect(stepIn(assistant({ type: "text", text: "Let me look at the footer spacing." }, tool("Bash", { command: "ls" })))).toBe("Looking at the footer spacing");
    expect(stepIn(assistant(tool("Bash", { command: "npm test", description: "Run the site's tests" })))).toBe("Running the site's tests");
    expect(stepIn(assistant(tool("Skill", { skill: "flyd-taste-spacing" })))).toBe("Checking how you like spacing");
    expect(stepIn(assistant(tool("Read", { file_path: "/Users/george/.claude/projects/x/memory/MEMORY.md" })))).toBe("Checking memory");
    expect(stepIn(assistant(tool("TodoWrite", { todos: [{ status: "in_progress", activeForm: "Making the header wider" }] })))).toBe("Making the header wider");
  });

  it("never shows paths, code, tools or the crew behind Flyd", () => {
    for (const raw of ["Read living.ts", "Find inline() helper", "Report to firstmate", "Run git status", "Check stepIn output", "Push branch to origin"]) {
      expect(plainStep(raw)).toBeUndefined();
    }
    expect(stepIn(assistant(tool("Read", { file_path: "/src/page.ts" })))).toBeUndefined();
    expect(stepIn(JSON.stringify({ type: "user", message: { content: "Let me look at it" } }))).toBeUndefined();
  });
});

describe("CrewProgress", () => {
  let home: string;
  let projects: string;
  let transcript: string;
  const sent = "2026-10-11T11:00:00Z";
  const exchange = (text: string, extra: Partial<Exchange> = {}): Exchange => ({ question: { id: "note:1", role: "user", text, timestamp: sent }, handoff: "queued", waiting: "Working on it", ...extra });

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "crew-home-"));
    projects = mkdtempSync(join(tmpdir(), "crew-projects-"));
    mkdirSync(join(home, "state"));
    mkdirSync(join(home, "data", "site-footer"), { recursive: true });
    writeFileSync(join(home, "state", "site-footer.meta"), `worktree=${WORKTREE}\nharness=claude\n`);
    writeFileSync(join(home, "state", "site-footer.status"), "working [at=1]: setup done\n");
    writeFileSync(join(home, "data", "site-footer", "brief.md"), "# Task\n## Captain's intent\nThe footer’s spacing is off — make it calmer please.\n\n## Firstmate spec\n- fix\n");
    const dir = join(projects, WORKTREE.replace(/[^A-Za-z0-9]/g, "-"));
    mkdirSync(dir);
    transcript = join(dir, "s1.jsonl");
    writeFileSync(transcript, `${assistant(tool("Skill", { skill: "flyd-taste-spacing" }))}\n`);
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(projects, { recursive: true, force: true });
  });

  it("finds the crewmate whose brief carries his note, and follows its session", () => {
    let now = 0;
    const crew = new CrewProgress({ home, claudeProjects: projects, now: () => now });
    const note = exchange("the footer's spacing is off - make it calmer please");
    expect(crew.steps([note]).get("note:1")).toBe("Checking how you like spacing");
    appendFileSync(transcript, `${assistant(tool("Bash", { description: "Tighten the gap under the footer links" }))}\n`);
    expect(crew.steps([note]).get("note:1")).toBe("Checking how you like spacing");
    now += 2_000;
    expect(crew.steps([note]).get("note:1")).toBe("Tightening the gap under the footer links");
  });

  it("finds a later note firstmate passed on to a crewmate already at work", () => {
    mkdirSync(join(home, "state", "site-footer.inbox", "handled"), { recursive: true });
    writeFileSync(join(home, "state", "site-footer.inbox", "handled", "001.msg"), "schema=fm-task-inbox.v1\n--\nMore from the captain: “Everything here still says 'working on it'.” Fix the column too.\n");
    const later = { ...exchange("everything here still says “working on it”"), question: { id: "note:1", role: "user" as const, text: "everything here still says “working on it”", timestamp: "2030-01-01T00:00:00Z" } };
    expect(new CrewProgress({ home, claudeProjects: projects }).steps([later]).get("note:1")).toBe("Checking how you like spacing");
  });

  it("says when the crewmate has finished or is held up, and leaves other notes alone", () => {
    writeFileSync(join(home, "state", "site-footer.status"), "working [at=1]: setup done\ndone [at=2]: PR https://example.com/pr/1\n");
    const crew = new CrewProgress({ home, claudeProjects: projects });
    expect(crew.steps([exchange("the footer's spacing is off")]).get("note:1")).toBe("Finished, checking it over");
    expect(new CrewProgress({ home, claudeProjects: projects }).steps([exchange("make the header bigger please")]).size).toBe(0);
    expect(new CrewProgress({ home, claudeProjects: projects }).steps([exchange("the footer's spacing is off", { answered: true })]).size).toBe(0);
  });

  it("ignores a session older than the task", () => {
    utimesSync(transcript, new Date(0), new Date(0));
    const crew = new CrewProgress({ home, claudeProjects: projects });
    expect(crew.steps([exchange("the footer's spacing is off")]).get("note:1")).toBe("Setup done");
  });
});

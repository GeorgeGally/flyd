import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBacklog, type ArtefactRow } from "../artefact.js";
import { OvertakenCalls } from "../overtaken.js";
import { gatherStaleEvidence, originOf, StaleCallJudge, stalePrompt, staleVerdict } from "../stale-calls.js";
import type { Project } from "../../council/projects.js";

// George, 2026-10-24: a three-week-old "land the Truchet hero lab?" kept
// ringing while the CapFive site was already live. "flyd needs to be smarter.
// its seen ive done work on getting the site up etc. and it can check the code
// to see whats happened."

const hold = (text: string) => `fm-hold-v1:${Buffer.from(text).toString("base64")}`;
const BACKLOG = [
  `- [ ] capfive-truchet-rebase - CapFive: carry the Truchet hero lab commit onto current main (repo: capfive) (kind: ship) (since 2026-10-24) (hold: ${hold("Truchet hero lab is ready to land on local CapFive main: lab pages only. Land it?")})`,
  "  Supersedes capfive-truchet-hero-lab (branch 1535 commits behind).",
  "- [ ] capfive-truchet-hero-lab - CapFive Find-an-adviser hero: Truchet shader lab (repo: capfive) (kind: ship) (since 2026-10-03)",
].join("\n");
const ROW: ArtefactRow = { label: "Land the Truchet hero lab?", task: "capfive-truchet-rebase", repo: "capfive", detail: "Land the Truchet hero lab on CapFive main?" };

function sh(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "George", GIT_COMMITTER_NAME: "George", GIT_AUTHOR_EMAIL: "g@x", GIT_COMMITTER_EMAIL: "g@x" } });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "stale-calls-"));
  const repo = join(root, "cap5");
  mkdirSync(join(repo, "lab"), { recursive: true });
  sh(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "lab", "advisor-truchet-lab.html"), "v1");
  sh(repo, "add", ".");
  sh(repo, "commit", "-q", "-m", "Lab: truchet hero");
  sh(repo, "checkout", "-q", "-b", "fm/capfive-truchet-rebase");
  writeFileSync(join(repo, "lab", "advisor-truchet-lab.html"), "v2");
  writeFileSync(join(repo, "lab", "advisor-truchet-lab-fine.html"), "fine");
  sh(repo, "add", ".");
  sh(repo, "commit", "-q", "-m", "Add variants to truchet hero lab");
  sh(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "index.html"), "live");
  sh(repo, "add", ".");
  sh(repo, "commit", "-q", "-m", "Deploy CapFive site to Kinsta");
  const home = join(root, "firstmate");
  mkdirSync(join(home, "state"), { recursive: true });
  writeFileSync(join(home, "state", "capfive-truchet-rebase.meta"), `project=${repo}\nbranch=fm/capfive-truchet-rebase\n`);
  const projects: Project[] = [{ id: "capfive", name: "CapFive", what: "Site", kind: "client", status: "active", now: "Site is live on Kinsta", people: [], repos: [repo] } as unknown as Project];
  return { repo, home, projects };
}

describe("an old call weighed against what happened since", () => {
  it("dates the work from the oldest task it supersedes", () => {
    expect(originOf("capfive-truchet-rebase", parseBacklog(BACKLOG))).toBe("2026-10-03");
  });

  it("reads main, what the branch still adds, and the project's standing", async () => {
    const { home, projects } = fixture();
    const entries = parseBacklog(BACKLOG);
    const evidence = await gatherStaleEvidence(ROW, entries.get("capfive-truchet-rebase"), entries, { home, projects, now: Date.parse("2026-10-24T12:00:00Z") });
    expect(evidence?.ageDays).toBe(21);
    expect(evidence?.mainSince.some((line) => /Deploy CapFive site/.test(line))).toBe(true);
    expect(evidence?.onMain).toEqual(["lab/advisor-truchet-lab.html"]);
    expect(evidence?.notOnMain).toEqual(["lab/advisor-truchet-lab-fine.html"]);
    expect(evidence?.branchAdds).toMatch(/2 files changed/);
    const prompt = stalePrompt(evidence!);
    expect(prompt).toContain("Site is live on Kinsta");
    expect(prompt).toContain("21 days ago");
  });

  it("settles only on a confident overtaken verdict with a reason", () => {
    expect(staleVerdict('{"overtaken": true, "confidence": 0.9, "why": "The site went live without it."}')).toBe("The site went live without it.");
    expect(staleVerdict('{"overtaken": true, "confidence": 0.6, "why": "maybe"}')).toBeUndefined();
    expect(staleVerdict('{"overtaken": false, "confidence": 0.95, "why": "still a choice"}')).toBeUndefined();
    expect(staleVerdict('{"overtaken": true, "confidence": 0.95, "why": ""}')).toBeUndefined();
    expect(staleVerdict("not json")).toBeUndefined();
  });

  it("never judges a fresh call, and asks the model once a day for an old one", async () => {
    const { home, projects } = fixture();
    const entries = parseBacklog(BACKLOG);
    let calls = 0;
    let now = Date.parse("2026-10-24T12:00:00Z");
    const judge = new StaleCallJudge({ home, file: null, now: () => now, projects: () => projects, complete: async () => {
      calls += 1;
      return '{"overtaken": true, "confidence": 0.9, "why": "The CapFive site went live without these lab pages."}';
    } });
    const why = await judge.judge(ROW, entries.get("capfive-truchet-rebase"), entries);
    expect(why).toBe("The CapFive site went live without these lab pages.");
    await judge.judge(ROW, entries.get("capfive-truchet-rebase"), entries);
    expect(calls).toBe(1);
    now += 25 * 3_600_000;
    await judge.judge(ROW, entries.get("capfive-truchet-rebase"), entries);
    expect(calls).toBe(2);

    const fresh = parseBacklog("- [ ] new-ask - Pick a layout (repo: capfive) (since 2026-10-23)");
    expect(await judge.judge({ label: "Pick a layout", task: "new-ask" }, fresh.get("new-ask"), fresh)).toBeUndefined();
    expect(calls).toBe(2);
  });

  it("keeps the call in front of him when the model fails", async () => {
    const { home, projects } = fixture();
    const entries = parseBacklog(BACKLOG);
    const judge = new StaleCallJudge({ home, file: null, projects: () => projects, complete: async () => { throw new Error("down"); } });
    expect(await judge.judge(ROW, entries.get("capfive-truchet-rebase"), entries)).toBeUndefined();
  });

  it("is consulted only when the staff's record leaves the call open", async () => {
    const asked: string[] = [];
    const calls = new OvertakenCalls({ send: async () => undefined, stale: { judge: async (row) => { asked.push(row.task!); return "moved on"; } } });
    const finished = parseBacklog("- [x] done-task - Done (repo: capfive) (merged: 2026-10-16)");
    expect(await calls.check(finished.get("done-task"), { label: "Done", task: "done-task" }, finished)).toBe("its task finished 2026-10-16");
    expect(asked).toEqual([]);
    const entries = parseBacklog(BACKLOG);
    expect(await calls.check(entries.get("capfive-truchet-rebase"), ROW, entries)).toBe("moved on");
    expect(asked).toEqual(["capfive-truchet-rebase"]);
  });
});

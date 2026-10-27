import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SnapshotDiffer } from "../server.js";
import { digestHash } from "../job-digest.js";
import { editJob, jobsFrom, type JobRun } from "../jobs.js";
import type { Project } from "../../council/projects.js";
import type { ShowScreen } from "../show.js";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");

function project(over: Partial<Project> = {}): Project {
  return {
    id: "cap5", name: "Cap5", what: "Pricing work", kind: "client", status: "active", now: "Librarian narration, not a status",
    next: "Send the deck", people: [], repos: [], updated: "2026-10-20", ...over,
  };
}

function run(over: Partial<JobRun> = {}): JobRun {
  return {
    id: "run-1", status: "working", project: "Cap5", outcome: "Revise the deck", owner: "FirstMate",
    updatedAt: "2026-10-26T11:00:00.000Z", artifacts: [], ...over,
  };
}

const screen = { title: "", summary: "", items: [], counts: {}, live: false, read: "2026-10-26T00:00:00.000Z" } as ShowScreen;

describe("jobsFrom", () => {
  it("keeps an active project with no run as waiting, and does not treat project.now as status", () => {
    const board = jobsFrom({ projects: [project()], now: NOW });
    expect(board.jobs).toHaveLength(1);
    expect(board.jobs[0]).toMatchObject({ id: "cap5", group: "waiting", state: "Waiting", project: "Client", next: "Send the deck", owner: "you" });
    expect(board.jobs[0]!.next).not.toContain("Librarian");
    expect(board.fleetKnown).toBe(false);
  });

  it("groups CapFive, Capfire and Cap5 as one job", () => {
    const board = jobsFrom({
      projects: [project()],
      sessions: [{ id: "s1", title: "Pricing", project: "CapFive", updatedAt: "2026-10-25T00:00:00.000Z" }],
      runs: [run({ project: "Capfire", status: "working" })],
      now: NOW,
    });
    expect(board.jobs).toHaveLength(1);
    expect(board.jobs[0]).toMatchObject({ id: "cap5", group: "working", owner: "FirstMate" });
    expect(board.jobs[0]!.threads.map((thread) => thread.title).sort()).toEqual(["Pricing", "Revise the deck"]);
    expect(board.inferred).toEqual([]);
  });

  it("puts a decision on Needs you and names the question", () => {
    const board = jobsFrom({
      projects: [project()],
      runs: [run({ status: "needs_decision", question: "Which price should ship?" })],
      now: NOW,
    });
    expect(board.jobs[0]).toMatchObject({ group: "needs", owner: "you", ask: "Which price should ship?" });
  });

  it("keeps a pull request and a file that exists, and drops a file that does not", () => {
    const board = jobsFrom({
      runs: [run({
        artifacts: ["/tmp/missing.pdf", "/tmp/there.png", "https://github.com/GeorgeGally/flyd/pull/12"],
      })],
      exists: (path) => path === "/tmp/there.png",
      now: NOW,
    });
    expect(board.jobs[0]!.files).toEqual([{ label: "there.png" }]);
    expect(board.jobs[0]!.links).toEqual([{ label: "Pull request", url: "https://github.com/GeorgeGally/flyd/pull/12" }]);
  });

  it("infers a job from a conversation name and waits, without pretending a run is open", () => {
    const board = jobsFrom({
      sessions: [{ id: "s9", title: "Kickoff", project: "Northwind", updatedAt: "2026-10-26T01:00:00.000Z" }],
      now: NOW,
    });
    expect(board.inferred).toEqual([{ name: "Northwind", kind: "product" }]);
    expect(board.jobs[0]).toMatchObject({ group: "waiting", next: "Nothing is moving this.", owner: "you" });
  });

  it("attaches a stored digest by hash and does not ask again for the same text", () => {
    const text = `${"The third tier is gone. ".repeat(20)}Send the one offer.`;
    const hash = digestHash(text);
    const digest = {
      hash, project: "Cap5", changed: "The third tier is gone.", means: "One offer is enough.", needed: "Send it.",
      link: "https://example.com/deck", at: "2026-10-26T10:00:00.000Z", model: "claude-haiku-5-5", inputTokens: 10, outputTokens: 8, usd: 0,
    };
    const input = { projects: [project()], reports: [{ project: "Cap5", title: "Deck", text }], digests: [digest], now: NOW };
    const once = jobsFrom(input);
    const twice = jobsFrom(input);
    expect(once.jobs[0]!.digest).toEqual({ changed: "The third tier is gone.", means: "One offer is enough.", needed: "Send it.", link: "https://example.com/deck" });
    expect(once.pending).toEqual([]);
    expect(twice.jobs[0]!.digest).toEqual(once.jobs[0]!.digest);
    expect(once.jobs[0]!.group).toBe("waiting");
  });

  it("hides a closed project that landed more than three weeks ago", () => {
    const board = jobsFrom({ projects: [project({ status: "done", updated: "2026-01-01" })], now: NOW });
    expect(board.jobs).toEqual([]);
  });

  it("leaves the update without jobs unless the view asked for them", () => {
    const bare = new SnapshotDiffer().next({ messages: [], working: false });
    expect(bare.jobs).toBeUndefined();
    const listed = new SnapshotDiffer(undefined, { jobs: () => ({ jobs: [], fleetKnown: true }) }).next({ messages: [], working: false });
    expect(listed.jobs).toEqual([]);
    expect(listed.jobsFleetKnown).toBe(true);
  });
});

describe("editJob", () => {
  it("creates, renames and closes on the project list", () => {
    const path = join(mkdtempSync(join(tmpdir(), "flyd-jobs-")), "projects.json");
    const created = editJob({ op: "create", name: "Cap5" }, { path, now: NOW });
    expect(created.job).toMatchObject({ id: "cap5", title: "Cap5", group: "waiting", next: "Say what the next step is." });
    const renamed = editJob({ op: "rename", id: "cap5", name: "Cap Five" }, { path, now: NOW });
    expect(renamed.job).toMatchObject({ id: "cap5", title: "Cap Five" });
    const closed = editJob({ op: "close", id: "cap5" }, { path, now: NOW });
    expect(closed.job).toMatchObject({ id: "cap5", group: "done" });
    expect(editJob({ op: "close", id: "missing" }, { path, now: NOW }).error).toBe("That job is not on the list.");
  });
});

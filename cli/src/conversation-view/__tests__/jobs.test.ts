import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SnapshotDiffer } from "../server.js";
import { digestHash } from "../job-digest.js";
import { editJob, jobRunFromDomain, jobsFrom, type JobRun } from "../jobs.js";
import { heldItems, parseBearings } from "../artefact.js";
import type { DomainRun } from "../../command/types.js";
import { applyProjectOps, readProjects, type Project } from "../../council/projects.js";
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
  it("gives every running worker its own card, even two on one project or one beside a call", () => {
    const item = (kind: string, id: string, over = {}) => ({ id: `${kind}:${id}`, kind, headline: id, why: "", task: id, project: "Cap5", ...over });
    const show = { ...screen, calls: [item("call", "pick")], underway: [item("live", "one"), item("live", "two")] } as unknown as ShowScreen;
    const board = jobsFrom({ projects: [project()], show, now: NOW });
    expect(board.jobs.filter((job) => job.group === "working").map((job) => [job.id, job.project])).toEqual([["live:one", "Cap5"], ["live:two", "Cap5"]]);
    expect(board.jobs.find((job) => job.id === "cap5")!.group).toBe("needs");
  });

  it("keeps a call Flyd answered by his rules as its own handled line he can take back, even beside the project's open call", () => {
    const item = (kind: string, id: string, over = {}) => ({ id: `${kind}:${id}`, kind, headline: id, why: "", task: id, project: "Cap5", ...over });
    const handledLine = item("landed", "sync", { headline: "Said yes for you: rebase and push.", status: "handled", executiveDecisionId: "dec-1", at: "2026-10-26T10:00:00.000Z" });
    const show = { ...screen, calls: [item("call", "pick")], done: [handledLine, item("landed", "shipped", { at: "2026-10-26T09:00:00.000Z" })] } as unknown as ShowScreen;
    const board = jobsFrom({ projects: [project()], show, now: NOW });
    const handled = board.jobs.find((job) => job.id === "landed:sync");
    expect(handled).toMatchObject({ group: "done", state: "Handled for you", handled: { decisionId: "dec-1", task: "sync" } });
    expect(board.jobs.find((job) => job.id === "cap5")).toMatchObject({ group: "needs" });
    expect(board.jobs.filter((job) => job.handled).map((job) => job.id)).toEqual(["landed:sync"]);
  });

  it("carries the run start separately from its latest update", () => {
    const board = jobsFrom({ runs: [run({ started: "2026-10-26T09:00:00Z", updatedAt: "2026-10-26T11:59:00Z" })], now: NOW });
    expect(board.jobs.find((job) => job.group === "working")).toMatchObject({ started: "2026-10-26T09:00:00Z", at: "2026-10-26T11:59:00Z" });
  });

  it("does not count queued work or a run gone quiet as working", () => {
    const show = { ...screen, next: [{ id: "next:q", kind: "next", headline: "Queued thing", why: "", task: "q" }] } as unknown as ShowScreen;
    const board = jobsFrom({ show, runs: [run({ id: "stale", project: "", updatedAt: "2026-10-20T11:00:00.000Z" }), run({ id: "note", project: "", status: "queued" })], now: NOW });
    expect(board.jobs.filter((job) => job.group === "working")).toEqual([]);
    expect(board.jobs.find((job) => job.id === "next:q")).toMatchObject({ group: "waiting", state: "Queued" });
    expect(board.jobs.find((job) => job.id === "stale")).toMatchObject({ group: "waiting", state: "Waiting" });
    expect(board.jobs.find((job) => job.id === "note")).toMatchObject({ group: "waiting", state: "Queued" });
  });

  it("shows paused, parked and blocked workers as paused without requiring attention", () => {
    const fleet = parseBearings({ in_flight: ["paused", "parked", "blocked"].map((state) => ({ id: state, name: `${state} worker`, state })) });
    const show = { ...screen, held: heldItems(fleet) };
    const board = jobsFrom({ show, now: NOW });
    expect(board.jobs.map((job) => [job.title, job.group, job.state, job.ask])).toEqual([
      ["Paused worker", "waiting", "Paused", ""],
      ["Parked worker", "waiting", "Paused", ""],
      ["Blocked worker", "waiting", "Paused", ""],
    ]);
  });

  it("keeps a paused worker on an unknown repo path to its Paused card across boards", () => {
    const path = join(mkdtempSync(join(tmpdir(), "flyd-jobs-")), "projects.json");
    const show = {
      ...screen,
      held: [{ id: "held:lab", kind: "waiting", headline: "Lab hardware pass", why: "", project: "/Users/g/.treehouse/pierre-hardware-lab", status: "paused" }],
    } as unknown as ShowScreen;
    const first = jobsFrom({ projects: readProjects(path), show, now: NOW });
    // The server registers whatever the board infers, then draws the board again.
    applyProjectOps(first.inferred.map((item) => ({ op: "upsert" as const, name: item.name, kind: item.kind, status: "active", what: "" })), { knownRepos: [], path });
    expect(readProjects(path)).toEqual([]);
    const board = jobsFrom({ projects: readProjects(path), show, now: NOW });
    expect(board.jobs.map((job) => [job.title, job.group, job.state])).toEqual([["Lab hardware pass", "waiting", "Paused"]]);
  });

  it("retains the paused count on a project card alongside its leading signal", () => {
    const held = ["paused", "parked", "blocked"].map((state) => ({
      id: `held:${state}`, kind: "waiting" as const, headline: `${state} worker`, why: "", project: "Cap5", status: "paused",
    }));
    const call = { id: "call:pick", kind: "call" as const, headline: "Choose a direction", why: "", project: "Cap5" };
    const ready = { id: "ready:lab", kind: "ready" as const, headline: "Lab ready", why: "", project: "Cap5" };
    for (const extra of [{}, { calls: [call] }, { ready: [ready] }]) {
      const board = jobsFrom({ projects: [project()], show: { ...screen, held, ...extra }, now: NOW });
      expect(board.jobs).toHaveLength(1);
      expect(board.jobs[0]).toMatchObject({ id: "cap5", group: Object.keys(extra).length ? "needs" : "waiting", state: expect.stringContaining("3 paused") });
      if ("calls" in extra) expect(board.jobs[0]!.ask).toBe("Choose a direction");
    }
  });

  it("uses the fleet for FirstMate workers while retaining domain decisions", () => {
    const show = { ...screen, underway: [{ id: "live:worker", kind: "live", headline: "Revise", why: "", task: "worker", project: "Cap5" }] } as unknown as ShowScreen;
    const board = jobsFrom({ projects: [project()], show, runs: [run({ id: "domain-123", transport: "firstmate" }), run({ id: "domain-456", transport: "native" }), run({ id: "domain-789", transport: "firstmate", status: "needs_decision" })], now: NOW });
    expect(board.jobs.filter((job) => job.group === "working").map((job) => job.id).sort()).toEqual(["live:worker", "run:domain-456"]);
    expect(board.jobs.find((job) => job.id === "run:domain-789")?.group).toBe("needs");
    expect(board.jobs.find((job) => job.id === "cap5")).toBeUndefined();
  });

  it("suppresses an idle project when a worker or decision is active", () => {
    const worker = { ...screen, underway: [{ id: "live:worker", kind: "live", headline: "Revise", why: "", task: "worker", project: "Cap5" }] } as unknown as ShowScreen;
    for (const input of [{ show: worker }, { runs: [run({ status: "needs_decision" })] }]) {
      const board = jobsFrom({ projects: [project()], sessions: [{ id: "s", title: "Chat", project: "Cap5", updatedAt: "2026-10-26" }], ...input, now: NOW });
      expect(board.jobs.find((job) => job.id === "cap5")).toBeUndefined();
    }
  });

  it("finds the known project of a worker's repo path when its folder and name differ", () => {
    const path = "/work/capfive-abc";
    const item = (kind: string, id: string, status = "") => ({ id: `${kind}:${id}`, kind, headline: id, why: "", task: id, project: path, status });
    const repos = project({ repos: [path] });
    const running = jobsFrom({ projects: [repos], show: { ...screen, underway: [item("live", "worker")] } as unknown as ShowScreen, now: NOW });
    expect(running.jobs.map((job) => [job.id, job.project])).toEqual([["live:worker", "Cap5"]]);
    const paused = jobsFrom({ projects: [repos], show: { ...screen, held: [item("waiting", "held", "paused")] } as unknown as ShowScreen, now: NOW });
    expect(paused.jobs.map((job) => job.id)).toEqual(["cap5"]);
    expect(paused.inferred).toEqual([]);
  });

  it("offers an answer only to a domain run that can still take one", () => {
    const board = jobsFrom({ runs: [run({ id: "open", status: "needs_decision", phase: "checking" }), run({ id: "finished", status: "needs_decision", phase: "done" }), run({ id: "plain", status: "needs_decision" })], now: NOW });
    const answer = (id: string) => board.jobs.find((job) => job.id === `run:${id}`)?.domainRun;
    expect(["open", "finished", "plain"].map(answer)).toEqual(["open", undefined, "plain"]);
    expect(board.jobs.find((job) => job.id === "run:finished")?.group).toBe("needs");
  });

  it("keeps project conversations and reports on active cards without an idle card", () => {
    const text = "A detailed report on the project. ".repeat(12);
    const hash = digestHash(text);
    const session = { id: "session-1", title: "Project conversation", project: "Cap5", updatedAt: "2026-10-26T10:00:00Z" };
    const report = { project: "Cap5", title: "Project report", text };
    const digest = { hash, project: "Cap5", changed: "The report changed.", means: "Review it.", needed: "Choose.", at: "2026-10-26T10:00:00Z", model: "test", inputTokens: 0, outputTokens: 0, usd: 0 };
    const worker = { ...screen, underway: [{ id: "live:worker", kind: "live", headline: "Revise", why: "", task: "worker", project: "Cap5" }] } as unknown as ShowScreen;
    for (const input of [{ show: worker }, { runs: [run()] }, { runs: [run({ status: "needs_decision" })] }]) {
      const base = { projects: [project()], sessions: [session], reports: [report], ...input, now: NOW };
      const board = jobsFrom(base);
      expect(board.jobs).toHaveLength(1);
      expect(board.jobs[0]!.threads).toContainEqual({ id: session.id, title: session.title, at: session.updatedAt, kind: "conversation" });
      expect(board.pending).toMatchObject([{ hash, text }]);
      const withDigest = jobsFrom({ ...base, digests: [digest] });
      expect(withDigest.jobs[0]!.digest).toMatchObject({ changed: digest.changed, means: digest.means, needed: digest.needed });
      expect(withDigest.pending).toEqual([]);
    }
  });

  it("shows the boss question rather than an outgoing answer and hides Flyd notes", () => {
    const domain: DomainRun = {
      id: "domain-123", status: "needs_decision", owner: "FirstMate", createdAt: "2026-10-26T09:00:00Z", updatedAt: "2026-10-26T11:00:00Z",
      request: { id: "domain-123", domain: "coding", originalMessage: "Build", intendedOutcome: "Build", doneWhen: [], createdAt: "2026-10-26T09:00:00Z" },
      transport: { kind: "firstmate", requestId: "domain-123" },
      messages: [{ id: "answer", kind: "decision", body: "yes", at: "2026-10-26T11:00:00Z" }],
      result: { format: "raw", brief: "Which version?", detailedReport: "", decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low" },
    };
    expect(jobsFrom({ runs: [jobRunFromDomain(domain)], now: NOW }).jobs[0]?.ask).toBe("Which version?");
    expect(jobsFrom({ runs: [jobRunFromDomain({ ...domain, request: { ...domain.request, source: "flyd" } })], now: NOW }).jobs).toEqual([]);
    expect(jobRunFromDomain({ ...domain, result: { ...domain.result!, unresolvedQuestions: ["Ship now?"] } }).question).toBe("Ship now?");
  });

  it("says finished work is ready and a finished report is a report", () => {
    const item = (id: string, status: string) => ({ id: `ready:${id}`, kind: "ready", headline: id, why: "", task: id, status });
    const board = jobsFrom({ show: { ...screen, ready: [item("lab", "on its branch"), item("scout", "report available")] } as unknown as ShowScreen, now: NOW });
    expect(board.jobs.map((job) => [job.id, job.group, job.state])).toEqual(expect.arrayContaining([["ready:lab", "needs", "Ready to land"], ["ready:scout", "needs", "Report ready"]]));
  });

  it("keeps an active project with no run as waiting, and does not treat project.now as status", () => {
    const board = jobsFrom({ projects: [project()], now: NOW });
    expect(board.jobs).toHaveLength(1);
    expect(board.jobs[0]).toMatchObject({ id: "cap5", group: "waiting", state: "Waiting", project: "Client", next: "Send the deck", owner: "you" });
    expect(board.jobs[0]!.next).not.toContain("Librarian");
    expect(board.fleetKnown).toBe(false);
  });

  it("keeps active runs distinct beside a project decision", () => {
    const board = jobsFrom({ projects: [project()], runs: [run(), run({ id: "run-2", outcome: "Review the deck" }), run({ id: "choice", status: "needs_decision" })], now: NOW });
    expect(board.jobs.filter((job) => job.group === "working").map((job) => job.id).sort()).toEqual(["run:run-1", "run:run-2"]);
    expect(board.jobs.find((job) => job.id === "run:choice")?.group).toBe("needs");
  });

  it("puts a decision on Needs you and names the question", () => {
    const board = jobsFrom({
      projects: [project()],
      runs: [run({ status: "needs_decision", question: "Which price should ship?" })],
      now: NOW,
    });
    expect(board.jobs[0]).toMatchObject({ group: "needs", owner: "you", ask: "Which price should ship?" });
  });

  it("carries a needs item's decisions onto its job, with what is already done", () => {
    const decision = {
      task: "flyd-live", question: "Two decisions are needed on Flyd live activity", choices: ["V1 Departures", "V2 Picture desk", "V3 Notch"], recommended: "V3 Notch",
      decisions: [
        { question: "Ship fixes 1-3 from the report first", options: ["Yes", "No"], done: "Done: fixes 1-3 landed (flyd #238)" },
        { question: "Which direction to build on top", options: ["V1 Departures", "V2 Picture desk", "V3 Notch"], recommended: "V3 Notch" },
      ],
    };
    const show = { ...screen, calls: [{ id: "call-1", kind: "call", headline: "Two decisions are needed on Flyd live activity", why: "", decision }] } as ShowScreen;
    const board = jobsFrom({ show, now: NOW });
    expect(board.jobs[0]).toMatchObject({ group: "needs", decision });
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

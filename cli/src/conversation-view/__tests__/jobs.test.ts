import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SnapshotDiffer } from "../server.js";
import { digestHash } from "../job-digest.js";
import { editJob, jobRunFromDomain, jobsFrom, runTitle, type JobRun } from "../jobs.js";
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

  it("never names the staff or how the work runs on a card, whatever a run's status", () => {
    const statuses = ["queued", "accepted", "working", "needs_decision", "completed", "incomplete", "failed", "cancelled"] as const;
    const runs = statuses.map((status, index) => run({ id: status, status, project: `P${index}`, outcome: "", owner: "Design Mate", ...(status === "needs_decision" ? { question: "Ready on branch fm/x: merge it?" } : {}) }));
    const board = jobsFrom({ runs: [...runs, run({ id: "quiet", project: "Q", outcome: "", updatedAt: "2026-10-20T11:00:00.000Z" })], now: NOW });
    expect(board.jobs.length).toBeGreaterThan(0);
    for (const job of board.jobs) {
      expect(["you", "Flyd", ""]).toContain(job.owner);
      expect(`${job.next} ${job.ask}`).not.toMatch(/Design Mate|worker|handoff|branch|fm\/|Nothing has moved/i);
    }
    const stalled = jobsFrom({ runs: [run({ id: "stalled", status: "failed", project: "S", outcome: "The last handoff stalled." })], now: NOW });
    expect(stalled.jobs[0]!.next).toBe("The last step stalled.");
    // The decision is his: its card keeps the question, said once, without the branch.
    expect(board.jobs.find((job) => job.group === "needs")).toMatchObject({ next: "", ask: "Ready: merge it?" });
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
    const fleet = parseBearings({ in_flight: ["paused", "parked", "blocked"].map((state) => ({ id: state, name: `${state} job`, state })) });
    const show = { ...screen, held: heldItems(fleet) };
    const board = jobsFrom({ show, now: NOW });
    expect(board.jobs.map((job) => [job.title, job.group, job.state, job.ask])).toEqual([
      ["Paused job", "waiting", "Paused", ""],
      ["Parked job", "waiting", "Paused", ""],
      ["Blocked job", "waiting", "Paused", ""],
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
      expect(withDigest.jobs[0]!.digest).toEqual({ changed: digest.changed, needed: digest.needed });
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

  it("keeps a ready run in Needs you for a day from when it settled, then calls it done, PR or not", () => {
    const pr = "https://github.com/acme/site/pull/42";
    const ready = (over: Partial<JobRun>) => run({ status: "completed", work: "ready", ...over });
    const groupOf = (board: ReturnType<typeof jobsFrom>, id: string) => board.jobs.find((job) => job.threads.some((thread) => thread.id === id))?.group;
    const board = jobsFrom({
      runs: [
        ready({ id: "fresh-pr", artifacts: [pr], settled: "2026-10-26T02:00:00.000Z" }),
        ready({ id: "fresh", settled: "2026-10-26T02:00:00.000Z" }),
        // Settled two days ago; a later message bumped its update time, which does not restart the day.
        ready({ id: "old-pr", artifacts: [pr], settled: "2026-10-24T11:00:00.000Z", updatedAt: "2026-10-26T11:30:00.000Z" }),
        ready({ id: "old", project: "Other", settled: "2026-10-24T11:00:00.000Z" }),
      ],
      now: NOW,
    });
    expect(groupOf(board, "fresh-pr")).toBe("needs");
    expect(groupOf(board, "fresh")).toBe("needs");
    expect(groupOf(board, "old-pr")).toBe("done");
    expect(groupOf(board, "old")).toBe("done");
  });

  it("says finished work is ready and a finished report is a report", () => {
    const item = (id: string, status: string) => ({ id: `ready:${id}`, kind: "ready", headline: id, why: "", task: id, status });
    const board = jobsFrom({ show: { ...screen, ready: [item("lab", "on its branch"), item("scout", "report available")] } as unknown as ShowScreen, now: NOW });
    expect(board.jobs.map((job) => [job.id, job.group, job.state])).toEqual(expect.arrayContaining([["ready:lab", "needs", "Ready for you"], ["ready:scout", "needs", "Report ready"]]));
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

  it("speaks a reading stored in the third person to him, in two sentences", () => {
    // The CapFive card as it was stored before Flyd spoke to him directly.
    const text = "CapFive lab round 5. ".repeat(20);
    const digest = {
      hash: digestHash(text), project: "Cap5",
      changed: "The CapFive lab round 5 captain has posted three open questions about the Review and Opinion section, the Reports band heading, and V5 tombstones.",
      means: "Design decisions are pending on the Opinion section content and empty-state handling, the Reports band heading wording, and whether V5 tombstones keep their date captions.",
      needed: "George needs to answer the three questions: Opinion section back-fill or drop, Reports heading wording, and whether to keep or restore V5 date captions.",
      at: "2026-10-26T10:00:00.000Z", model: "claude-haiku-5-5", inputTokens: 10, outputTokens: 8, usd: 0,
    };
    const board = jobsFrom({ projects: [project()], reports: [{ project: "Cap5", title: "Lab", text }], digests: [digest], runs: [run({ status: "needs_decision", question: "Still open: his picks for the other five sections - v01 hero buttons, v03 deals on phones." })], now: NOW });
    const job = board.jobs[0]!;
    expect(job.digest).toEqual({
      changed: "I have three open questions about the Review and Opinion section, the Reports band heading, and V5 tombstones.",
      needed: "You need to answer the three questions: Opinion section back-fill or drop, Reports heading wording, and whether to keep or restore V5 date captions.",
    });
    expect(job.ask).toBe("Still open: your picks for the other five sections - v01 hero buttons, v03 deals on phones.");
    const shown = [job.ask, job.next, job.digest!.changed, job.digest!.needed].join("\n");
    expect(shown).not.toMatch(/George needs|his picks|\bGeorge\b|\bcaptain\b|Design decisions are pending/);
  });

  it("gives a decision its named answers as one-tap choices, and an open question none", () => {
    const text = "The Liesel board for Pierre's Radio direction is finished and passing all checks. ".repeat(4);
    const digest = {
      hash: digestHash(text), project: "Cap5", changed: "The Liesel board is finished and passing all checks.",
      needed: "Say merge, and I'll merge both waiting Flyd updates and restart Flyd; I recommend it.",
      at: "2026-10-26T10:00:00.000Z", model: "m", inputTokens: 0, outputTokens: 0, usd: 0,
    };
    const said = jobsFrom({ projects: [project()], reports: [{ project: "Cap5", title: "Board", text }], digests: [digest], runs: [run({ status: "needs_decision", question: "Waiting on your go-ahead." })], now: NOW }).jobs[0]!;
    expect(said).toMatchObject({ group: "needs", domainRun: "run-1", choices: ["Merge"], recommended: "Merge", labels: { Merge: "Go ahead" } });
    const asked = jobsFrom({ runs: [run({ status: "needs_decision", question: "Should I merge now or wait?" })], now: NOW }).jobs[0]!;
    expect(asked.choices).toEqual(["Merge now", "Wait"]);
    expect(asked.labels).toEqual({ "Merge now": "Go ahead now", Wait: "Wait" });
    const open = jobsFrom({ runs: [run({ status: "needs_decision", question: "Which price should ship?" })], now: NOW }).jobs[0]!;
    expect(open.choices).toBeUndefined();
  });

  it("puts a run's numbered questions on the job one by one, and gives the Timeline the whole brief", () => {
    const outcome = "Rework the Today page so the WhatsApp card, the horoscope source and the News tab each follow what you decided in the last review round.";
    const job = jobsFrom({ runs: [run({ status: "needs_decision", outcome, question: "1) WhatsApp card: remove it, or keep it; 2) News tab: anything else?" })], now: NOW }).jobs[0]!;
    expect(job.decisions).toEqual([
      { question: "WhatsApp card", options: ["Remove it", "Keep it"] },
      { question: "News tab: anything else?", options: ["No, that's all"] },
    ]);
    expect(job.choices).toBeUndefined();
    expect(job.threads[0]!.title.length).toBeLessThanOrEqual(90);
    expect(job.threads[0]!.full).toBe(outcome);
  });

  it("keeps a run's numbered answers to one question as one question", () => {
    const job = jobsFrom({ runs: [run({ status: "needs_decision", question: "Which direction should I build? 1. Departures 2. Picture desk 3. Notch" })], now: NOW }).jobs[0]!;
    expect(job.decisions).toBeUndefined();
  });

  it("gives a run's numbered answers to one question as that question's buttons", () => {
    const asked = (question: string) => jobsFrom({ runs: [run({ status: "needs_decision", question })], now: NOW }).jobs[0]!;
    const trailing = asked("Which should I make? 1. Departures 2. Picture desk 3. Notch?");
    expect(trailing.decisions).toBeUndefined();
    expect(trailing.choices).toEqual(["Departures", "Picture desk", "Notch"]);
    const described = asked("Which direction? 1. Departures: big type, quiet 2. Picture desk");
    expect(described.decisions).toBeUndefined();
    expect(described.choices).toEqual(["Departures", "Picture desk"]);
  });

  it("puts a run's numbered questions on their own cards after a lead-in that says what it needs", () => {
    const job = jobsFrom({ runs: [run({ status: "needs_decision", question: "Here's what I need from you: 1) WhatsApp card: remove it, or keep it; 2) horoscope source: AstroVed or another; 3) news tab: anything beyond news, weather and horoscope?" })], now: NOW }).jobs[0]!;
    expect(job.decisions).toEqual([
      { question: "WhatsApp card", options: ["Remove it", "Keep it"] },
      { question: "Horoscope source", options: ["AstroVed", "Another"] },
      { question: "News tab: anything beyond news, weather and horoscope?", options: ["No, that's all"] },
    ]);
    expect(job.choices).toBeUndefined();
  });

  it("puts a run's numbered instruction on its own card beside the question it is numbered with", () => {
    const job = jobsFrom({ runs: [run({ status: "needs_decision", question: "(1) keep the lab version - yes/no; (2) tell me the new tab's name" })], now: NOW }).jobs[0]!;
    expect(job.decisions?.map((decision) => decision.question)).toEqual(["Keep the lab version", "Tell me the new tab's name"]);
    expect(job.choices).toBeUndefined();
  });

  it("gives a card the reading of its own item, never another item's in the same project", () => {
    // The Week page PR and the WhatsApp card are both Flyd work; the WhatsApp reading is newer.
    const week = "The Week page now shows each hour's changes when you hover a bar. ".repeat(6);
    const whatsapp = "WhatsApp is still unlinked so the Link WhatsApp card stays. ".repeat(6);
    const item = (id: string, kind: string, headline: string, detail: string, at: string) => ({ id, kind, headline, detail, why: "", task: id, project: "Flyd", at });
    const show = { ...screen, ready: [item("ready:week", "ready", "Week view", week, "2026-10-26T12:06:00.000Z")], held: [item("waiting:wa", "waiting", "WhatsApp card", whatsapp, "2026-10-26T09:00:00.000Z")] } as unknown as ShowScreen;
    const reading = (text: string, changed: string, at: string) => ({ hash: digestHash(text), project: "Flyd", changed, needed: "Nothing", at, model: "m", inputTokens: 0, outputTokens: 0, usd: 0 });
    const digests = [reading(week, "The Week page shows details when you hover a bar.", "2026-10-26T12:10:00.000Z"), reading(whatsapp, "WhatsApp is still unlinked, so its card stays.", "2026-10-26T12:20:00.000Z")];
    const board = jobsFrom({ projects: [project({ id: "flyd", name: "Flyd", kind: "product" })], show, digests, now: NOW });
    const card = board.jobs.find((job) => job.title === "Flyd")!;
    expect(card.digest?.changed).toBe("The Week page shows details when you hover a bar.");
    expect(JSON.stringify(card)).not.toContain("WhatsApp is still unlinked, so its card stays.");
  });

  it("never borrows a reading that only shares the project's name", () => {
    const show = { ...screen, ready: [{ id: "ready:waits", kind: "ready", headline: "Flyd CoS 13c: explicit waits (audit #2)", detail: "Checks green: PR ready for review (still monitoring for merge/close):…", why: "", task: "flyd-cos-waits", project: "Flyd" }] } as unknown as ShowScreen;
    const whatsapp = { hash: "e5230039a9902629", project: "Flyd", changed: "WhatsApp is still unlinked, so the 'Link WhatsApp' card stays on screen.", needed: "Link WhatsApp on your phone.", at: "2026-11-09T02:50:35.212Z", model: "m", inputTokens: 0, outputTokens: 0, usd: 0 };
    const card = jobsFrom({ projects: [project({ id: "flyd", name: "Flyd", kind: "product" })], show, digests: [whatsapp], now: NOW }).jobs.find((job) => job.title === "Flyd")!;
    expect(card.digest).toBeNull();
    expect(card.ask).toBe("This is finished and ready for you to look over.");
  });

  it("never heads a ready card with the staff's status line", () => {
    const show = { ...screen, ready: [{ id: "ready:week", kind: "ready", headline: "The Week page", detail: "Checks green: PR ready for review (still monitoring for merge/close): https://example.com/pull/274", why: "", task: "week", project: "Flyd" }] } as unknown as ShowScreen;
    const card = jobsFrom({ projects: [project({ id: "flyd", name: "Flyd", kind: "product" })], show, now: NOW }).jobs.find((job) => job.title === "Flyd")!;
    expect(card.ask).toBe("This is finished and ready for you to look over.");
    expect(`${card.ask} ${card.next}`).not.toMatch(/Checks green|monitoring|PR ready|\bland\b/i);
  });

  it("takes a card's title only from Flyd's own hand-off, never from his request", () => {
    expect(runTitle("Remove the card titled “Stale tasks” from the Week page")).toBe("Remove the card titled “Stale tasks” from the Week page");
  });

  it("names a passed-on question by its subject, says it once and never cuts it mid-word", () => {
    const question = "Jev was a second opinion I was supposed to ask before big choices. In six weeks it was used only 5 times, last on 9 October, and it never changed anything. I recommend removing it. Do you want me to remove it, or keep it running for another month?";
    const outcome = `Answer George's question, reading whatever code is needed, and change nothing: George got a card titled "Answer to pending decision jev-firstmate-review: Review Jev decision log: did Jev change or improve firstmate decisions? captain decides keep or remove" and asked what it means.`;
    const domain = { id: "domain-jev", status: "needs_decision", transport: { kind: "firstmate" }, request: { source: "view", intendedOutcome: outcome, originalMessage: "what is this?" }, owner: "FirstMate", updatedAt: "2026-10-26T12:06:00.000Z", result: { unresolvedQuestions: [question], artifacts: [], detailedReport: "" } } as unknown as Parameters<typeof jobRunFromDomain>[0];
    const card = jobsFrom({ runs: [jobRunFromDomain(domain)], now: NOW }).jobs[0]!;
    expect(card.title).toBe("Review Jev decision log");
    expect(card.ask).toBe(question);
    expect(card.next).toBe("");
    expect(card.threads.map((thread) => thread.title)).toEqual(["Review Jev decision log"]);
    expect(JSON.stringify(card)).not.toMatch(/George|Answer your question|pending decision|reading whatever code/);
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
    expect(once.jobs[0]!.digest).toEqual({ changed: "The third tier is gone.", needed: "Send it.", link: "https://example.com/deck" });
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

describe("a decision card's pictures and links", () => {
  const dir = project({ id: "dir", name: "DIR", repos: ["/Users/g/Documents/dead-internet-radio"] });
  const item = (kind: string, id: string, over = {}) => ({ id: `${kind}:${id}`, kind, headline: id, why: "", task: id, project: "/Users/g/Documents/dead-internet-radio", ...over });

  it("shows only what the start-button question carries, its board first and named, never the project's other pictures", () => {
    const show = {
      ...screen,
      calls: [item("call", "dir-start-board-calls", {
        headline: "Start buttons beyond approved Numbers and Terminal",
        decision: { task: "dir-start-board-calls", question: "Start buttons beyond approved Numbers and Terminal", choices: ["Teletext", "Test card"] },
        shots: [{ src: "/api/board-shot?board=2f91aa58f2222856&v=1", label: "DIR start control board" }],
        links: [{ label: "Open DIR start control board", url: "/open-board/2f91aa58f2222856" }, { label: "Open DIR start control board", url: "/open-board/2f91aa58f2222856" }],
      })],
      held: [item("waiting", "held-dir-key-labels", { status: "paused", shots: [{ src: "/api/board-shot?board=97933d40aea87c36&v=1", label: "Board for DIR key labels" }], links: [{ label: "Open board", url: "/open-board/97933d40aea87c36" }] })],
      done: [item("landed", "landed-dir-signal-lab", {
        shots: [{ src: "/api/artefact-shot?task=dir-signal-lab&file=review%2Fv0-live-now-desktop.png", label: "v0-live-now-desktop.png" }, { src: "/api/artefact-shot?task=dir-signal-lab&file=review%2Fv0-live-now-phone.png", label: "v0-live-now-phone.png" }],
        links: [{ label: "dead-internet-radio #42", url: "https://github.com/GeorgeGally/dead-internet-radio/pull/42" }, { label: "Open board", url: "/open-board/e9a23aab1684b277" }],
      })],
    } as unknown as ShowScreen;
    const job = jobsFrom({ projects: [dir], show, now: NOW }).jobs.find((one) => one.id === "dir")!;
    expect(job.group).toBe("needs");
    expect(job.shots).toEqual([{ src: "/api/board-shot?board=2f91aa58f2222856&v=1", label: "DIR start control board" }]);
    expect(job.links).toEqual([{ label: "Open DIR start control board", url: "/open-board/2f91aa58f2222856" }]);
  });

  it("pictures the tracklist question with the tracklist board, never another DIR decision's board", () => {
    const call = (id: string, at: string, board: string, name: string) => item("call", id, {
      headline: id, at, decision: { task: id, question: id, choices: [] },
      shots: [{ src: `/api/board-shot?board=${board}&v=1`, label: `${name} board` }],
      links: [{ label: `Open ${name} board`, url: `/open-board/${board}` }],
    });
    const show = {
      ...screen,
      calls: [
        call("Start buttons beyond approved Numbers and Terminal", "2026-10-26T09:00:00.000Z", "2f91aa58f2222856", "DIR start control"),
        call("Which set tracklist should be built for the live player?", "2026-10-26T11:00:00.000Z", "ceecabda1bfc42e7", "DIR tracklist"),
      ],
    } as unknown as ShowScreen;
    const job = jobsFrom({ projects: [dir], show, now: NOW }).jobs.find((one) => one.id === "dir")!;
    expect(job.ask).toBe("Which set tracklist should be built for the live player?");
    expect(job.shots).toEqual([{ src: "/api/board-shot?board=ceecabda1bfc42e7&v=1", label: "DIR tracklist board" }]);
    expect(job.links).toEqual([{ label: "Open DIR tracklist board", url: "/open-board/ceecabda1bfc42e7" }]);
  });

  it("shows no picture rather than an unrelated one when the question carries none", () => {
    const show = {
      ...screen,
      calls: [item("call", "flyd-design-team-call", { headline: "The Flyd design team has mostly failed, so I suggest cutting it.", decision: { task: "flyd-design-team-call", question: "Cut or keep?", choices: ["Cut", "Keep"] } })],
      done: [item("landed", "flyd-ui-lab", { shots: [{ src: "/api/artefact-shot?task=flyd-ui-lab&file=board.png", label: "board.png" }], links: [{ label: "flyd #291", url: "https://github.com/GeorgeGally/flyd/pull/291" }] })],
    } as unknown as ShowScreen;
    const job = jobsFrom({ projects: [dir], show, now: NOW }).jobs.find((one) => one.id === "dir")!;
    expect(job.shots).toEqual([]);
    expect(job.links).toEqual([]);
  });

  it("leads any other card with its own pictures, each once, and never two labels alike", () => {
    const show = {
      ...screen,
      held: [item("waiting", "held", { status: "paused", shots: [{ src: "/a.png", label: "Board" }], links: [{ label: "Open board", url: "/open-board/aaaaaaaa" }] })],
      done: [item("landed", "lab", { shots: [{ src: "/b.png", label: "Board" }, { src: "/a.png", label: "Board" }], links: [{ label: "Open board", url: "/open-board/bbbbbbbb" }] })],
    } as unknown as ShowScreen;
    const job = jobsFrom({ projects: [dir], show, now: NOW }).jobs.find((one) => one.id === "dir")!;
    expect(job.shots).toEqual([{ src: "/a.png", label: "Board" }, { src: "/b.png", label: "Board · 2" }]);
    expect(job.links.map((link) => link.label)).toEqual(["Open board", "Open board · 2"]);
  });

  it("links and pictures the board a run's decision names in its evidence, by the board's name", () => {
    const domain = {
      id: "domain-hftw", status: "needs_decision", owner: "FirstMate", createdAt: "2026-11-11T04:23:33.219Z", updatedAt: "2026-11-11T12:18:22Z",
      request: { id: "domain-hftw", domain: "coding", originalMessage: "HFTW heroes", intendedOutcome: "Replace the HFTW product-shot heroes", doneWhen: [], createdAt: "2026-11-11T04:23:33.219Z", source: "chat", project: { name: "HFTW" } },
      transport: { kind: "firstmate", requestId: "domain-hftw" },
      result: { format: "structured", brief: "Pick keep, A or B for each hero; the lab page only changes after you do.", evidence: ["http://127.0.0.1:4747/board/871dc848190e24e1"], artifacts: [], unresolvedQuestions: [] },
    } as unknown as DomainRun;
    const board = jobsFrom({
      runs: [jobRunFromDomain(domain)], now: NOW,
      boardName: (key) => (key === "871dc848190e24e1" ? "HFTW hero images" : undefined),
      boardPicture: (key) => `/api/board-shot?board=${key}&v=1`,
    });
    const job = board.jobs.find((one) => one.group === "needs")!;
    expect(job.links).toEqual([{ label: "Open HFTW hero images board", url: "/open-board/871dc848190e24e1" }]);
    expect(job.shots).toEqual([{ src: "/api/board-shot?board=871dc848190e24e1&v=1", label: "HFTW hero images board" }]);
  });

  it("never asks for a picture of a board a finished run names, but still links it", () => {
    const run = { ...jobRunFromDomain({
      id: "domain-old", status: "completed", owner: "FirstMate", createdAt: "2026-10-25T04:00:00Z", updatedAt: "2026-10-25T05:00:00Z",
      request: { id: "domain-old", domain: "coding", originalMessage: "Old heroes", intendedOutcome: "Old hero pick", doneWhen: [], createdAt: "2026-10-25T04:00:00Z", source: "chat", project: { name: "HFTW" } },
      transport: { kind: "firstmate", requestId: "domain-old" },
      result: { format: "structured", brief: "Done.", evidence: ["http://127.0.0.1:4747/board/871dc848190e24e1"], artifacts: [], unresolvedQuestions: [] },
    } as unknown as DomainRun), work: "landed" as const };
    const asked: string[] = [];
    const board = jobsFrom({ runs: [run], now: NOW, boardPicture: (key) => { asked.push(key); return `/api/board-shot?board=${key}&v=1`; } });
    expect(asked).toEqual([]);
    expect(board.jobs.flatMap((job) => job.shots)).toEqual([]);
    expect(board.jobs.flatMap((job) => job.links.map((link) => link.url))).toContain("/open-board/871dc848190e24e1");
  });
});

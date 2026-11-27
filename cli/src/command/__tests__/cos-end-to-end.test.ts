import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Librarian's specialists are background jobs: here they are recorded, never run.
const specialists: string[] = [];
vi.mock("../../runtime/background-jobs.js", async (original) => ({
  ...(await original<typeof import("../../runtime/background-jobs.js")>()),
  runningJobs: () => [],
  startBackgroundJob: (contract: { task: string }) => { specialists.push(contract.task); return `spec-${specialists.length}`; },
}));

const { IntelligenceEventStore } = await import("../../intelligence/event-store.js");
const { runAssistantTool } = await import("../../runtime/assistant-tools.js");
const { chatToolSet } = await import("../../runtime/conversation-responder.js");
const { briefDispatcher } = await import("../cos/dispatch.js");
const { listObjectives, readObjective } = await import("../cos/objectives.js");
const planOfRun = (id: string) => readObjective(id)?.plan?.[0];
const { tellWork } = await import("../cos/steer.js");
const { cosReports, cosTick } = await import("../cos/tick.js");
const { FirstmateDomainTransport } = await import("../firstmate.js");
const { sendRunMessage } = await import("../messages.js");
const { createDomainRun, listDomainRuns, readDomainRun, updateDomainRun } = await import("../store.js");
const { cosJobRuns, cosRequestIds } = await import("../../conversation-view/cos-jobs.js");
const { parseBearings, withoutCosFleet } = await import("../../conversation-view/artefact.js");
type DomainRun = import("../types.js").DomainRun;
type DomainResult = import("../types.js").DomainResult;
type CosReport = import("../cos/types.js").CosReport;
type Dispatch = import("../cos/dispatch.js").Dispatch;
type ExecutiveDecisionRecord = import("../../intelligence/executive/decision-step.js").ExecutiveDecisionRecord;
type FirstmateExec = import("../firstmate.js").FirstmateExec;

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-cos-e2e-"));
  process.env.FLYD_COMMAND_DIR = join(home, "command");
  process.env.FLYD_COS = "1";
  specialists.length = 0;
});
afterEach(() => {
  delete process.env.FLYD_COMMAND_DIR;
  process.env.FLYD_COS = "0";
  rmSync(home, { recursive: true, force: true });
});

const result = (brief: string, questions: string[] = []): DomainResult => ({
  format: "structured", brief, detailedReport: `${brief} (the specialist's full report)`, decisionsMade: [], unresolvedQuestions: questions,
  risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low",
});

const decisionFor = (run: DomainRun): ExecutiveDecisionRecord => {
  const question = run.result?.unresolvedQuestions[0];
  return {
    schema: "flyd.executive-decision.v1", decisionId: `decision-${run.id}`, sourceId: `domain.${run.request.domain}`, sourceEventId: `event-${run.id}`, taskId: run.id,
    disposition: question ? "ask_george" : "handle_internally", reason: question ? "his call" : "finished", summary: question ?? run.result?.brief ?? "done",
    ...(question ? { question, options: ["Ship it", "Hold it"], recommendation: { option: "Ship it", rationale: "Verified on staging" } } : {}), evidenceRefs: [`domain-run:${run.id}`],
    verification: { status: question ? "unknown" : "verified", evidenceRefs: [] }, show: true, notify: true, createdAt: new Date().toISOString(),
  } as ExecutiveDecisionRecord;
};

/**
 * One Flyd with fake teams behind the real entry points: FirstMate's inbox script is a fake exec (each request id
 * accepted once, the same id again a replay), the Librarian's specialists and Design Mate's start are recorded.
 */
function flyd(plan: Record<string, unknown>) {
  const notes: Array<{ requestId: string; body: string }> = [];
  const messages: Array<{ run: string; body: string }> = [];
  const accepted = new Set<string>();
  const exec: FirstmateExec = async (_script, args, options) => {
    if (args[0] === "ready") return { stdout: JSON.stringify({ can_receive: true, running: true }), stderr: "" };
    if (args[0] === "note") {
      const requestId = args[2]!;
      const replay = accepted.has(requestId);
      accepted.add(requestId);
      if (!replay) notes.push({ requestId, body: String(options.input ?? "") });
      return { stdout: JSON.stringify({ schema: "fm-inbox-note.v1", outcome: replay ? "replay" : "created", id: `note-${requestId}`, saved: true, acknowledged: true }), stderr: "" };
    }
    if (args[0] === "message" || args[0] === "reply" || args[0] === "send") {
      messages.push({ run: args.join(" "), body: String(options.input ?? "") });
      return { stdout: JSON.stringify({ id: `msg-${messages.length}`, saved: true }), stderr: "" };
    }
    return { stdout: JSON.stringify({ id: `fm-${args[0]}`, saved: true }), stderr: "" };
  };
  const firstmate = new FirstmateDomainTransport({ script: join(home, "fm-inbox.sh"), exec });
  const designs: string[] = [];
  const teams = briefDispatcher({ startDesign: (run) => { designs.push(run.id); } });
  const dispatches: string[] = [];
  // Coding goes through FirstMate's own transport (the coding entry point refuses every test worker before it).
  const dispatch: Dispatch = async (objective, brief, requestId, options = {}) => {
    dispatches.push(requestId);
    if (brief.team !== "coding") return teams(objective, brief, requestId, options);
    const at = new Date().toISOString();
    const run = await firstmate.submit({ id: requestId, domain: "coding", originalMessage: objective.words, intendedOutcome: brief.outcome, doneWhen: brief.doneWhen, createdAt: at, source: "chat", objectiveId: objective.id, decisions: brief.decisions, ...(objective.contextRefs.length ? { contextRefs: objective.contextRefs } : {}) });
    return { ref: run.id };
  };
  const said: CosReport[] = [];
  const told: string[] = [];
  const send = ((input) => sendRunMessage({ ...input, transport: firstmate })) as typeof sendRunMessage;
  const deps = (store = new IntelligenceEventStore({ path: join(home, "intelligence.sqlite") })) => ({
    store, dispatch, send,
    complete: async (prompt: string) => prompt.includes("Flyd handed you this piece") ? JSON.stringify(plan) : JSON.stringify({ met: true }),
    decide: async (run: DomainRun) => decisionFor(run),
    tell: async (_run: DomainRun, _decision: ExecutiveDecisionRecord, key: string) => { told.push(key); },
    say: async (report: CosReport) => { said.push(report); },
  });
  const move = (id: string, change: Partial<DomainRun>) =>
    updateDomainRun(id, (run) => ({ ...run, ...change, updatedAt: new Date(Date.parse(run.updatedAt) + 1_000).toISOString() }));
  return { notes, messages, designs, dispatches, said, told, deps, send, move };
}

const handOff = (words: string, attachmentRefs: string[] = []) => runAssistantTool("hand_off", { words: "the model's paraphrase", notes: "He wants it today" }, {
  userMessage: words, sessionId: "window:abcdefgh1", turnId: "turn-1", ...(attachmentRefs.length ? { attachmentRefs } : {}),
  situation: { project: "cap5", projectRoot: home },
} as Parameters<typeof runAssistantTool>[2]);

describe("George → Flyd → Chief of Staff → team → back, with fake teams", () => {
  it("carries a coding request end to end: one dispatch, progress stays backstage, one decision, his answer, one reviewed report", async () => {
    const legacyAt = new Date().toISOString();
    // A job from before the cutover, still under way with its original owner.
    createDomainRun({ id: "legacy-run", owner: "FirstMate", status: "working", createdAt: legacyAt, updatedAt: legacyAt, transport: { kind: "firstmate", requestId: "legacy-run", externalId: "note-legacy" },
      request: { id: "legacy-run", domain: "coding", originalMessage: "older work", intendedOutcome: "older work", doneWhen: ["done"], createdAt: legacyAt } });
    const team = flyd({ team: "coding", outcome: "Fix the gallery header", done_when: ["the header is fixed on staging"], project: { root: home }, decisions: { comes_back: ["whether to ship"], settled_by_policy: [] } });

    // George's turn: Flyd sees only the hand-over tools, and his exact words become one objective.
    expect(chatToolSet(null, false).map((tool) => tool.name)).toContain("hand_off");
    expect(chatToolSet(null, false).map((tool) => tool.name)).not.toContain("start_coding_task");
    expect(await handOff("fix the gallery header, it overlaps on mobile", ["/tmp/flyd-view-images/shot.png"])).toMatch(/^Work recorded/);
    const [objective] = listObjectives();
    expect(objective).toMatchObject({ words: "fix the gallery header, it overlaps on mobile", contextRefs: ["/tmp/flyd-view-images/shot.png"], status: "intake" });

    // Intake, then dispatch; a restart (a new store, a new tick) replays the same request id and sends nothing new.
    await cosTick(team.deps());
    await cosTick(team.deps());
    await cosTick(team.deps());
    const runId = `${objective!.id}-r1`;
    expect(team.notes.map((note) => note.requestId)).toEqual([runId]);
    expect(team.notes[0]!.body).toContain("fix the gallery header, it overlaps on mobile");
    expect(readDomainRun(runId)).toMatchObject({ request: { objectiveId: objective!.id, originalMessage: "fix the gallery header, it overlaps on mobile" }, transport: { kind: "firstmate", requestId: runId } });
    // The request is bound: its fleet row is the objective's, and only the objective's projection reaches the screen.
    const requests = cosRequestIds(listDomainRuns(), listObjectives());
    expect(requests.has(runId)).toBe(true);
    const fleet = withoutCosFleet(parseBearings({ schema: "fm-bearings.v1", in_flight: [{ id: "gallery-task", name: "Gallery header", state: "working", request_id: runId }, { id: "legacy-task", name: "Older work", state: "working", request_id: null }], decisions_open: [], gates: [], landed: [] }), requests);
    expect(fleet.fleet.live.map((row) => row.task)).toEqual(["legacy-task"]);

    // Worker progress is activity: nothing is reported and the objective is simply working.
    team.move(runId, { status: "working", progress: "Reproduced the overlap at 375px" } as Partial<DomainRun>);
    await cosTick(team.deps());
    expect(team.said).toEqual([]);
    expect(team.told).toEqual([]);
    expect(cosJobRuns(listDomainRuns(), listObjectives(), [], Date.now()).find((job) => job.id === objective!.id)).toMatchObject({ status: "working", artifacts: [] });

    // A genuine decision: George is asked once, and his answer goes to that run once.
    team.move(runId, { status: "needs_decision", result: result("Fixed on staging", ["Should we deploy the header fix to production?"]) });
    const store = new IntelligenceEventStore({ path: join(home, "intelligence.sqlite") });
    await cosTick(team.deps(store));
    await cosTick(team.deps(store));
    const waiting = readObjective(objective!.id)!;
    expect(waiting.status).toBe("needs_george");
    expect(waiting.waitingOn?.question).toContain("deploy");
    expect(team.told).toHaveLength(1);
    const answer = await tellWork({ objectiveId: objective!.id, expectedReportId: waiting.waitingOn!.reportId, kind: "decision", message: "Ship it to production." }, team.send);
    expect(answer.delivered).toBe(true);
    // The same answer again (a double click, a replayed request) is not a second message.
    await tellWork({ objectiveId: objective!.id, expectedReportId: waiting.waitingOn!.reportId, kind: "decision", message: "Ship it to production." }, team.send);
    expect(readDomainRun(runId)!.messages?.filter((message) => message.body.includes("Ship it to production.")).length).toBe(1);

    // The specialist's report: reviewed against done_when and reported to Flyd once, even when the result arrives twice.
    team.move(runId, { status: "completed", result: result("The header no longer overlaps; deployed") });
    await cosTick(team.deps(store));
    await cosTick(team.deps(store));
    await cosTick(team.deps());
    const done = readObjective(objective!.id)!;
    expect(done.status).toBe("done");
    expect(cosReports(objective!.id, store).filter((report) => report.kind === "done")).toHaveLength(1);
    expect(team.told).toHaveLength(2);
    // FirstMate received the request once and his answer once, as its own note on that run.
    expect(team.notes.filter((note) => note.requestId === runId)).toHaveLength(1);
    expect(team.notes.filter((note) => note.body.includes("Ship it to production."))).toHaveLength(1);
    expect(team.notes).toHaveLength(2);

    // Flyd shows the objective once, from its reviewed report; the legacy job stays a legacy job.
    const reports = cosReports(objective!.id, store);
    const jobs = cosJobRuns(listDomainRuns(), listObjectives(), reports, Date.now());
    expect(jobs.filter((job) => job.id === objective!.id)).toHaveLength(1);
    expect(jobs.find((job) => job.id === objective!.id)).toMatchObject({ status: "completed", cosObjective: true });
    expect(jobs.find((job) => job.id === "legacy-run")).toMatchObject({ status: "working" });
    expect(jobs.find((job) => job.id === "legacy-run")?.cosObjective).toBeUndefined();
    expect(readDomainRun("legacy-run")?.request.objectiveId).toBeUndefined();
    expect(listObjectives()).toHaveLength(1);
    store.close();
  });

  it("dispatches knowledge work to the Librarian once, by request id, with his exact words", async () => {
    const team = flyd({ team: "knowledge", outcome: "Compare Stripe and Paddle fees at his volume", done_when: ["both fee tables are sourced"], decisions: { comes_back: ["which provider to sign up with"], settled_by_policy: [] } });
    await handOff("stripe or paddle for the shop?");
    const [objective] = listObjectives();
    await cosTick(team.deps());
    await cosTick(team.deps());
    const runId = `${objective!.id}-r1`;
    expect(readDomainRun(runId)).toMatchObject({ owner: "Librarian", request: { domain: "knowledge", originalMessage: "stripe or paddle for the shop?", objectiveId: objective!.id } });
    expect(specialists).toHaveLength(2);
    // A restart reconciles by the same request id: the Librarian replays its run and starts no second team.
    await cosTick(team.deps());
    expect(specialists).toHaveLength(2);
    team.move(runId, { status: "completed", result: result("Stripe is cheaper at his volume") });
    await cosTick(team.deps());
    await cosTick(team.deps());
    expect([readObjective(objective!.id)?.status, team.told.length, team.notes.length]).toEqual(["done", 1, 0]);
  });

  it("dispatches design work to Design Mate once, by request id, and reports the finished lab through the objective", async () => {
    const team = flyd({ team: "creative", outcome: "Three directions for the gallery page", done_when: ["three versions on a board"], decisions: { comes_back: ["which version to build"], settled_by_policy: [] } });
    await handOff("give me three takes on the gallery page");
    const [objective] = listObjectives();
    await cosTick(team.deps());
    await cosTick(team.deps());
    await cosTick(team.deps());
    const runId = `${objective!.id}-r1`;
    expect(team.designs).toEqual([runId]);
    expect(readDomainRun(runId)).toMatchObject({ request: { domain: "creative", originalMessage: "give me three takes on the gallery page", objectiveId: objective!.id } });
    team.move(runId, { status: "completed", result: result("Three versions are on the board") });
    await cosTick(team.deps());
    await cosTick(team.deps());
    expect([readObjective(objective!.id)?.status, team.told.length, team.designs.length]).toEqual(["done", 1, 1]);
  });

  it("never guesses which objective an answer without an id is for, and sends nothing", async () => {
    const team = flyd({ team: "coding", outcome: "Fix it", done_when: ["fixed"], project: { root: home }, decisions: { comes_back: [], settled_by_policy: [] } });
    await handOff("fix the header");
    await handOff("fix the footer");
    await cosTick(team.deps());
    await cosTick(team.deps());
    const before = listDomainRuns().map((run) => run.messages?.length ?? 0);
    const outcome = await tellWork({ message: "use the darker blue", kind: "correction" }, team.send);
    expect(outcome).toMatchObject({ delivered: false, reason: "ambiguous" });
    expect(listDomainRuns().map((run) => run.messages?.length ?? 0)).toEqual(before);
    expect(team.notes).toHaveLength(2);
  });

  it("leaves a dispatch whose effect is unknown unconfirmed, never sending it twice", async () => {
    const team = flyd({ team: "coding", outcome: "Fix it", done_when: ["fixed"], project: { root: home }, decisions: { comes_back: [], settled_by_policy: [] } });
    await handOff("fix the header");
    const [objective] = listObjectives();
    const deps = team.deps();
    // The team's inbox fails after the request may have been saved: the outcome is unknown. Every later pass only
    // looks it up by the same request id (a replay the team answers from its own record), never a fresh send.
    const calls: Array<{ id: string; replay?: boolean }> = [];
    const unsure: Dispatch = async (_objective, _brief, id, options) => {
      calls.push({ id, replay: options?.replay });
      if (calls.length === 1) throw new Error("socket closed after write");
      return { unknown: "the inbox cannot say" };
    };
    for (let pass = 0; pass < 4; pass++) await cosTick({ ...deps, dispatch: unsure });
    expect(new Set(calls.map((call) => call.id))).toEqual(new Set([`${objective!.id}-r1`]));
    expect(calls.filter((call) => !call.replay)).toHaveLength(1);
    expect(planOfRun(objective!.id)).toMatchObject({ state: "unknown" });
    expect(team.notes).toHaveLength(0);
    expect(readObjective(objective!.id)?.status).not.toBe("done");
    deps.store.close();
  });

  it("takes George's notes on an objective's design board into an objective the Chief of Staff reports, once", async () => {
    const team = flyd({ team: "creative", outcome: "Three directions for the gallery page", done_when: ["three versions on a board"], decisions: { comes_back: [], settled_by_policy: [] } });
    await handOff("give me three takes on the gallery page");
    const [objective] = listObjectives();
    await cosTick(team.deps());
    await cosTick(team.deps());
    const labId = `${objective!.id}-r1`;
    team.move(labId, { status: "completed", result: result("Three versions are on the board") });
    await cosTick(team.deps());
    await cosTick(team.deps());
    const { answerFromBoard } = await import("../design-mate.js");
    const feedback = { notes: ["warmer palette, less type"], ids: ["board-note-1"] };
    await answerFromBoard(readDomainRun(labId)!, feedback);
    // The same board message again is the same follow-up, not a second one.
    await answerFromBoard(readDomainRun(labId)!, feedback);
    const followups = listDomainRuns().filter((run) => run.request.parentRequestId === labId);
    expect(followups).toHaveLength(1);
    const adopted = readObjective(followups[0]!.request.objectiveId!)!;
    expect(adopted).toMatchObject({ status: "working", runs: [followups[0]!.id], contextRefs: [`objective:${objective!.id}`, `domain-run:${labId}`], brief: { team: "creative" } });
    expect(listObjectives().filter((item) => item.id === adopted.id)).toHaveLength(1);
    // Its result is reviewed and reported once through the adopted objective.
    team.move(followups[0]!.id, { status: "completed", result: result("A warmer round is on the board") });
    await cosTick(team.deps());
    await cosTick(team.deps());
    expect(readObjective(adopted.id)?.status).toBe("done");
    expect(team.told).toHaveLength(2);
    expect(readObjective(objective!.id)?.status).toBe("done");
  });

  it("rolls back with FLYD_COS=0: objectives pause with their runs, new work takes the legacy path, and re-enabling resumes them", async () => {
    const team = flyd({ team: "knowledge", outcome: "Compare fees", done_when: ["sourced"], decisions: { comes_back: [], settled_by_policy: [] } });
    await handOff("stripe or paddle?");
    const [objective] = listObjectives();
    await cosTick(team.deps());
    await cosTick(team.deps());
    const runId = `${objective!.id}-r1`;
    process.env.FLYD_COS = "0";
    // The installed tick does nothing while rolled back; the objective keeps its run and nothing is replayed.
    await cosTick();
    expect(readObjective(objective!.id)).toMatchObject({ status: "working", runs: [runId] });
    expect(await handOff("another job")).toMatch(/not available/);
    expect(chatToolSet(null, false).map((tool) => tool.name)).toContain("start_knowledge_task");
    const paused = cosJobRuns(listDomainRuns(), listObjectives(), [], Date.now(), false);
    expect(paused.find((job) => job.id === objective!.id)).toMatchObject({ status: "incomplete", cosObjective: true });
    // The run finishes meanwhile; its result waits for its objective (the scheduler never delivers it directly: cos.test.ts).
    team.move(runId, { status: "completed", result: result("Stripe is cheaper") });
    process.env.FLYD_COS = "1";
    await cosTick(team.deps());
    await cosTick(team.deps());
    expect([readObjective(objective!.id)?.status, team.told.length, specialists.length, listObjectives().length]).toEqual(["done", 1, 2, 1]);
  });
});

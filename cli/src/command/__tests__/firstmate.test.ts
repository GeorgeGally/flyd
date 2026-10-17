import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FirstmateDomainTransport, firstmateRequestBody, syncFirstmateDomainRuns, type FirstmateExec } from "../firstmate.js";
import { parseDomainResult } from "../result.js";
import { notifyRun } from "../scheduler.js";
import { listDomainRuns, saveDomainRun } from "../store.js";
import type { DomainRequest, DomainRun } from "../types.js";

describe("FirstMate domain transport", () => {
  let dir: string;
  let oldDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-command-"));
    oldDir = process.env.FLYD_COMMAND_DIR;
    process.env.FLYD_COMMAND_DIR = dir;
  });

  afterEach(() => {
    if (oldDir === undefined) delete process.env.FLYD_COMMAND_DIR;
    else process.env.FLYD_COMMAND_DIR = oldDir;
    rmSync(dir, { recursive: true, force: true });
  });

  const request = (): DomainRequest => ({
    id: "domain-test-1",
    domain: "coding",
    originalMessage: "No, keep the abstraction. Fix where it is called.",
    intendedOutcome: "Fix the call site without replacing the existing abstraction.",
    doneWhen: ["the existing abstraction remains", "the incorrect call site is fixed"],
    createdAt: "2026-10-09T00:00:00.000Z",
    project: { root: "/work/flyd" },
  });

  it("preserves George's original words and asks for a layered durable reply", () => {
    const body = firstmateRequestBody(request());
    expect(body).toContain("No, keep the abstraction. Fix where it is called.");
    expect(body).toContain("detailed_report");
    expect(body).toContain("fm-inbox.sh reply");
  });

  it("submits with an idempotent request id", async () => {
    const calls: Array<{ args: string[]; input?: string }> = [];
    const exec: FirstmateExec = async (_script, args, options) => {
      calls.push({ args, input: options.input });
      if (args[0] === "ready") return { stdout: JSON.stringify({ can_receive: true }), stderr: "" };
      return { stdout: JSON.stringify({ schema: "fm-inbox-note.v1", outcome: "created", id: "note-1", saved: true, acknowledged: false }), stderr: "" };
    };
    const transport = new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec });
    const run = await transport.submit(request());

    expect(calls[1]!.args).toEqual(["note", "--request-id", "domain-test-1", "--json", "-"]);
    expect(calls[1]!.input).toContain("ORIGINAL REQUEST");
    expect(run.transport.externalId).toBe("note-1");
    expect(listDomainRuns()).toHaveLength(1);
  });

  it("stores the whole reply while exposing its layers", async () => {
    const run: DomainRun = {
      id: "domain-test-1",
      request: request(),
      owner: "FirstMate",
      status: "queued",
      createdAt: request().createdAt,
      updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    };
    saveDomainRun(run);
    const reply = JSON.stringify({
      status: "needs_decision",
      brief: "The fix exposes an architecture choice.",
      recommendation: { action: "Keep Postgres", reasoning: "Avoid dual authority", confidence: 0.91 },
      detailed_report: "Worker A found X. Worker B verified Y. The concurrency edge is Z.",
      unresolved_questions: ["May we remove the legacy path?"],
      evidence: ["commit abc", "src/runtime/store.ts"],
      specialist_outputs: [{ specialist: "repo scout", outcome: "Found the legacy path", raw: "full scout detail" }],
      information_loss_risk: "high",
    });
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [],
      handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", at: "2026-10-09T01:00:00.000Z", body: reply, cursor: "000000000001" } }],
      replies: [],
      reply_cursor: "000000000001",
    }), stderr: "" });
    const changed = await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }) });

    expect(changed[0]!.status).toBe("needs_decision");
    expect(changed[0]!.result?.brief).toContain("architecture choice");
    expect(changed[0]!.result?.detailedReport).toContain("concurrency edge");
    expect(changed[0]!.result?.specialistOutputs[0]?.raw).toContain("full scout detail");
    expect(changed[0]!.result?.raw[0]).toBe(reply);
    expect(changed[0]!.incompleteReason).toBeUndefined();
  });

  it("never destroys detail when FirstMate replies with prose", async () => {
    const prose = "Short answer.\n\nA very specific technical finding follows here and must survive unchanged.";
    const run: DomainRun = {
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    };
    saveDomainRun(run);
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [], handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", body: prose, cursor: "2" } }],
    }), stderr: "" });
    const [changed] = await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }) });
    expect(changed!.result?.detailedReport).toBe(prose);
    expect(changed!.result?.raw).toEqual([prose]);
    expect(changed!.result?.informationLossRisk).toBe("high");
  });

  it("takes a prose reply as the outcome its words give, keeps it whole, and notes the format gap", async () => {
    const prose = "Done and live: the heading now reads 'What we look for in brands' on the partners page.";
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const replies = [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", at: "2026-10-09T01:00:00.000Z", body: prose, cursor: "000000000001" } }];
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({ pending: [], handled: replies }), stderr: "" });
    const transport = new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec });
    const sent: string[] = [];
    const judged: string[] = [];
    const onChanged = (run: DomainRun) => notifyRun(run, async (_title, message) => { sent.push(message); });
    const judge = async (reply: string, outcome: string) => { judged.push(`${outcome}|${reply}`); return "completed" as const; };

    const [settled] = await syncFirstmateDomainRuns({ transport, onChanged, judge });
    expect(judged).toEqual([`${request().intendedOutcome}|${prose}`]);
    expect(settled!.status).toBe("completed");
    expect(settled!.incompleteReason).toBe("domain handoff contract unmet: missing brief, report, evidence");
    expect(settled!.result?.raw).toEqual([prose]);
    expect(settled!.result?.detailedReport).toBe(prose);
    expect(sent).toEqual([prose]);
  });

  it("reads a prose reply by its words when no model can judge it", async () => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const prose = "status=needs_decision: copy swap is ready in invite.html and remind_me.html. Going live stays George's call.";
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [], handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", body: prose, cursor: "1" } }],
    }), stderr: "" });
    const [read] = await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }), judge: async () => { throw new Error("no model"); } });
    expect(read!.status).toBe("needs_decision");
  });

  it("records a structured handoff with no evidence as done, noting the missing layer", async () => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const body = JSON.stringify({ status: "completed", brief: "Fixed.", detailed_report: "Changed the call site." });
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [], handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", body, cursor: "1" } }],
    }), stderr: "" });
    const [done] = await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }) });
    expect(done!.status).toBe("completed");
    expect(done!.incompleteReason).toBe("domain handoff contract unmet: missing evidence");
    expect(done!.result?.brief).toBe("Fixed.");
  });

  it("keeps a contract-meeting structured reply without a status done, never read as prose", async () => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const body = JSON.stringify({ brief: "The race is fixed.", detailed_report: "Reworked the lock; the fix is merged.", evidence: ["commit abc123"] });
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [], handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", body, cursor: "1" } }],
    }), stderr: "" });
    let judged = 0;
    const judge = async () => { judged += 1; return "working" as const; };
    const [done] = await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }), judge });
    expect(done!.status).toBe("completed");
    expect(done!.incompleteReason).toBeUndefined();
    expect(judged).toBe(0);
  });

  it("reads again a structured run left incomplete as done, never read as prose", async () => {
    const now = new Date("2026-10-17T00:00:00.000Z");
    const structured = parseDomainResult(JSON.stringify({ status: "completed", brief: "Fixed.", detailed_report: "Changed the call site." })).result;
    saveDomainRun({
      id: "domain-structured", request: { ...request(), id: "domain-structured" }, owner: "FirstMate", status: "incomplete",
      createdAt: request().createdAt, updatedAt: "2026-10-16T20:00:00.000Z",
      transport: { kind: "firstmate", requestId: "domain-structured", externalId: "note-structured", replyCursor: "1" },
      result: structured,
      incompleteReason: "domain handoff contract unmet: missing evidence",
    });
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({ pending: [], handled: [{ id: "note-structured", request_id: "domain-structured", acknowledged: true, reply: null }] }), stderr: "" });
    let judged = 0;
    const judge = async () => { judged += 1; return "working" as const; };
    const [read] = await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }),
      now: () => now,
      judge,
    });
    expect(read!.status).toBe("completed");
    expect(judged).toBe(0);
  });

  it("reads again a run once left incomplete, announcing it only if recent", async () => {
    const prose = "Done: the footer link now opens the right page.";
    const now = new Date("2026-10-17T00:00:00.000Z");
    const legacy = (id: string, updatedAt: string): DomainRun => ({
      id, request: { ...request(), id }, owner: "FirstMate", status: "incomplete",
      createdAt: request().createdAt, updatedAt,
      transport: { kind: "firstmate", requestId: id, externalId: `note-${id}`, replyCursor: "1" },
      result: parseDomainResult(prose).result,
      incompleteReason: "domain handoff contract unmet: missing brief, report, evidence",
    });
    saveDomainRun(legacy("domain-recent", "2026-10-16T20:00:00.000Z"));
    saveDomainRun(legacy("domain-old", "2026-10-12T00:00:00.000Z"));
    const handled = ["domain-recent", "domain-old"].map((id) => ({ id: `note-${id}`, request_id: id, acknowledged: true, reply: { id: `note-${id}`, body: prose, cursor: "1" } }));
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({ pending: [], handled }), stderr: "" });
    const sent: string[] = [];
    const changed = await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }),
      now: () => now,
      onChanged: (run) => notifyRun(run, async (_title, message) => { sent.push(message); }),
    });
    expect(changed.map((run) => [run.id, run.status, run.notified ?? false]).sort()).toEqual([
      ["domain-old", "completed", true],
      ["domain-recent", "completed", false],
    ]);
    expect(sent).toEqual([prose]);
  });

  it.each([
    ["Captain, shipshape.", []],
    ["Captain, got it — fixed the typo and pushed to main.", ["Got it — fixed the typo and pushed to main."]],
  ])("completes the run on a well-formed reply and notifies only outcomes: %s", async (brief, expected) => {
    const body = JSON.stringify({ status: "completed", brief, detailed_report: "Typo in the header fixed.", evidence: ["commit abc123"] });
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [], handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", at: "2026-10-09T01:00:00.000Z", body, cursor: "3" } }],
    }), stderr: "" });
    const transport = new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec });
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };

    const [settled] = await syncFirstmateDomainRuns({ transport, onChanged: (run) => notifyRun(run, notify) });
    expect(settled!.status).toBe("completed");
    expect(sent).toEqual(expected);
    expect(listDomainRuns().find((run) => run.id === "domain-test-1")?.notified).toBe(true);
  });

  // A run waiting on George: FirstMate asked for a decision on note-1, he
  // answered, and that answer went out as its own note (note-2).
  const awaitingDecision = (): DomainRun => ({
    id: "domain-test-1", request: request(), owner: "FirstMate", status: "needs_decision",
    createdAt: request().createdAt, updatedAt: "2026-10-09T01:00:00.000Z", notified: true,
    transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1", replyCursor: "000000000001" },
    result: { format: "raw", brief: "Verified; merge?", detailedReport: "Verified; merge?", decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: ["Verified; merge?"], informationLossRisk: "high" },
    messages: [{ id: "domain-test-1:decision:abc", kind: "decision", body: "Yes, merge it.", at: "2026-10-09T02:00:00.000Z", deliveredAt: "2026-10-09T02:00:01.000Z", externalId: "note-2" }],
  });
  const original = { id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", at: "2026-10-09T01:00:00.000Z", body: JSON.stringify({ status: "needs_decision", brief: "Verified; merge?" }), cursor: "000000000001" } };

  it("settles a run from FirstMate's reply to George's later decision, and tells him the outcome", async () => {
    saveDomainRun(awaitingDecision());
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [],
      handled: [original, { id: "note-2", request_id: "domain-test-1:decision:abc", acknowledged: true, reply: { id: "note-2", at: "2026-10-09T03:00:00.000Z", body: JSON.stringify({ status: "completed", brief: "Merged and deployed.", detailed_report: "Merged after the decision; deploy check green.", evidence: ["https://github.com/GeorgeGally/flyd/pull/1"] }), cursor: "000000000002" } }],
    }), stderr: "" });
    const sent: string[] = [];
    const [settled] = await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }),
      onChanged: (run) => notifyRun(run, async (_title, message) => { sent.push(message); }),
    });

    expect(settled!.status).toBe("completed");
    expect(settled!.result?.brief).toBe("Merged and deployed.");
    expect(settled!.transport.replyCursor).toBe("000000000002");
    expect(sent).toEqual(["Merged and deployed."]);
    expect(listDomainRuns()[0]!.notified).toBe(true);
  });

  it("matches a follow-up note by its request id alone, and never goes back to an older reply", async () => {
    saveDomainRun({ ...awaitingDecision(), messages: [{ ...awaitingDecision().messages![0]!, externalId: undefined }] });
    const followUp = { id: "note-2", request_id: "domain-test-1:decision:abc", acknowledged: true, reply: { id: "note-2", at: "2026-10-09T03:00:00.000Z", body: JSON.stringify({ status: "failed", brief: "The deploy failed." }), cursor: "000000000002" } };
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({ pending: [], handled: [followUp, original] }), stderr: "" });
    const transport = new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec });

    const [failed] = await syncFirstmateDomainRuns({ transport });
    expect(failed!.status).toBe("failed");
    expect(failed!.failure).toBe("The deploy failed.");

    saveDomainRun({ ...failed!, status: "needs_decision" });
    expect(await syncFirstmateDomainRuns({ transport })).toEqual([]);
  });

  it("leaves a run waiting while FirstMate has not answered the follow-up yet", async () => {
    saveDomainRun(awaitingDecision());
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [{ id: "note-2", request_id: "domain-test-1:decision:abc", acknowledged: false, reply: null }],
      handled: [original],
    }), stderr: "" });
    expect(await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }) })).toEqual([]);
    expect(listDomainRuns()[0]!.status).toBe("needs_decision");
  });

  const proseReply = (prose: string) => ({
    id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", body: prose, cursor: "1" },
  });

  it("never calls an unclear prose reply done, and announces nothing for it", async () => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const prose = "Investigated the race; the fix still needs a rebase before it can land.";
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({ pending: [], handled: [proseReply(prose)] }), stderr: "" });
    const sent: string[] = [];
    const [read] = await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }),
      judge: async () => { throw new Error("no model"); },
      onChanged: (run) => notifyRun(run, async (_title, message) => { sent.push(message); }),
    });
    expect(read!.status).toBe("working");
    expect(sent).toEqual([]);
  });

  it("never calls an affirmative prose reply failed on the newest reply", async () => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const prose = "The build couldn't be greener — it's shipped and green.";
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({ pending: [], handled: [proseReply(prose)] }), stderr: "" });
    const [read] = await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }),
      judge: async () => { throw new Error("no model"); },
    });
    expect(read!.status).not.toBe("failed");
  });

  it("reads again a run left incomplete without calling it done or failed", async () => {
    const now = new Date("2026-10-17T00:00:00.000Z");
    const legacy = (id: string, prose: string): DomainRun => ({
      id, request: { ...request(), id }, owner: "FirstMate", status: "incomplete",
      createdAt: request().createdAt, updatedAt: "2026-10-16T20:00:00.000Z",
      transport: { kind: "firstmate", requestId: id, externalId: `note-${id}`, replyCursor: "1" },
      result: parseDomainResult(prose).result,
      incompleteReason: "domain handoff contract unmet: missing brief, report, evidence",
    });
    const unclear = "Investigated the race; the fix still needs a rebase before it can land.";
    const green = "The build couldn't be greener — it's shipped and green.";
    saveDomainRun(legacy("domain-unclear", unclear));
    saveDomainRun(legacy("domain-green", green));
    const handled = [["domain-unclear", unclear], ["domain-green", green]].map(([id, body]) => ({
      id: `note-${id}`, request_id: id, acknowledged: true, reply: { id: `note-${id}`, body, cursor: "1" },
    }));
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({ pending: [], handled }), stderr: "" });
    const changed = await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }),
      now: () => now,
      judge: async () => { throw new Error("no model"); },
    });
    const byId = Object.fromEntries(changed.map((run) => [run.id, run.status]));
    expect(byId["domain-unclear"]).not.toBe("completed");
    expect(byId["domain-green"]).not.toBe("failed");
  });
});

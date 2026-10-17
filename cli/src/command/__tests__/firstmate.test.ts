import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstmateDomainTransport, firstmateRequestBody, startFirstmateSession, syncFirstmateDomainRuns, type FirstmateExec } from "../firstmate.js";
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

  const queuedRun = (): DomainRun => ({
    id: "domain-test-1", request: request(), owner: "FirstMate", status: "queued",
    createdAt: request().createdAt, updatedAt: request().createdAt,
    transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
  });

  it("preserves George's original words and asks for a layered durable reply", () => {
    const body = firstmateRequestBody(request());
    expect(body).toContain("No, keep the abstraction. Fix where it is called.");
    expect(body).toContain("detailed_report");
    expect(body).toContain("fm-inbox.sh reply");
  });

  it("starts a session only when the inbox cannot receive work and no harness is live", async () => {
    const calls: string[] = [];
    const exec: FirstmateExec = async (script) => {
      calls.push(script);
      return { stdout: "", stderr: "" };
    };
    const result = await startFirstmateSession({
      home: "/fake/firstmate", script: "/fake/fm-inbox.sh", exec,
      readiness: { available: true, canReceive: false, liveHarness: false },
      recordAttempt: vi.fn(),
    });
    expect(result.started).toBe(true);
    expect(calls).toEqual(["claude"]);
  });

  it("does not start a second session while a harness is live", async () => {
    const exec = vi.fn<FirstmateExec>();
    const result = await startFirstmateSession({
      home: "/fake/firstmate", script: "/fake/fm-inbox.sh", exec,
      readiness: { available: true, canReceive: false, liveHarness: true },
      recordAttempt: vi.fn(),
    });
    expect(result).toEqual({ started: false });
    expect(exec).not.toHaveBeenCalled();
  });

  it("tries the next runtime when the first reports a usage limit", async () => {
    const calls: string[] = [];
    const exec: FirstmateExec = async (runtime) => {
      calls.push(runtime);
      if (runtime === "claude") return { stdout: "Claude usage limit reached", stderr: "" };
      return { stdout: "started", stderr: "" };
    };
    const result = await startFirstmateSession({
      home: "/fake/firstmate", script: "/fake/fm-inbox.sh", exec,
      readiness: { available: true, canReceive: false, liveHarness: false },
      recordAttempt: vi.fn(),
    });
    expect(result.started).toBe(true);
    expect(calls).toEqual(["claude", "codex"]);
  });

  it("returns one plain failure after every runtime fails", async () => {
    const calls: string[] = [];
    const exec: FirstmateExec = async (runtime) => { calls.push(runtime); throw new Error("not installed"); };
    const result = await startFirstmateSession({
      home: "/fake/firstmate", script: "/fake/fm-inbox.sh", exec,
      readiness: { available: true, canReceive: false, liveHarness: false },
      recordAttempt: vi.fn(),
    });
    expect(result).toEqual({ started: false, failure: "I couldn't start the work right now. I'll keep it safe and try again when I can." });
    expect(calls).toEqual(["claude", "codex", "opencode"]);
  });

  it("starts a session without the paid Anthropic API variables in its environment", async () => {
    const previous = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    };
    process.env.ANTHROPIC_API_KEY = "sk-paid-api-key";
    process.env.ANTHROPIC_AUTH_TOKEN = "paid-auth-token";
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    try {
      const launchedEnv: NodeJS.ProcessEnv[] = [];
      const exec: FirstmateExec = async (_script, _args, options) => {
        launchedEnv.push(options.env);
        return { stdout: "started", stderr: "" };
      };
      const result = await startFirstmateSession({
        home: "/fake/firstmate", script: "/fake/fm-inbox.sh", exec,
        readiness: { available: true, canReceive: false, liveHarness: false },
        recordAttempt: vi.fn(),
      });
      expect(result.started).toBe(true);
      expect(launchedEnv).toHaveLength(1);
      expect(launchedEnv[0].ANTHROPIC_API_KEY).toBeUndefined();
      expect(launchedEnv[0].ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(launchedEnv[0].ANTHROPIC_BASE_URL).toBeUndefined();
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("keeps a run queued and retryable when no runtime can start, and matches a later reply", async () => {
    let readyCalls = 0;
    const exec: FirstmateExec = async (_script, args) => {
      if (args[0] === "ready") { readyCalls += 1; return { stdout: JSON.stringify({ can_receive: false, lock: { live_harness: false } }), stderr: "" }; }
      if (args[0] === "note") return { stdout: JSON.stringify({ id: "note-1", saved: true, acknowledged: false }), stderr: "" };
      throw new Error("not installed");
    };
    const run = await new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }).submit(request());

    expect(run.status).toBe("queued");
    expect(run.failure).toBe("I couldn't start the work right now. I'll keep it safe and try again when I can.");
    expect(run.launchRetry?.attempts).toBe(1);
    expect(readyCalls).toBe(1);
    expect(listDomainRuns()).toHaveLength(1);

    const reply: FirstmateExec = async (_script, args) => {
      if (args[0] === "receipts") {
        return { stdout: JSON.stringify({
          pending: [],
          handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", at: "2026-10-09T02:00:00.000Z", body: JSON.stringify({ status: "completed", brief: "Fixed the call site.", detailed_report: "Changed where it was called.", evidence: ["commit abc"] }), cursor: "000000000001" } }],
        }), stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };
    const changed = await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec: reply }),
      now: () => new Date("2026-10-09T02:00:00.000Z"),
    });

    expect(changed[0]!.status).toBe("completed");
    expect(listDomainRuns()[0]!.launchRetry).toBeUndefined();
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

  it("records an unstructured handoff as incomplete with the reason, keeps the raw detail, and settles it on a later well-formed reply", async () => {
    const prose = "status=needs_decision: copy swap dispatched (found in invite.html and remind_me.html). Going live stays George's call.";
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const replies = [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", at: "2026-10-09T01:00:00.000Z", body: prose, cursor: "000000000001" } }];
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({ pending: [], handled: replies }), stderr: "" });
    const transport = new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec });
    const sent: string[] = [];
    const onChanged = (run: DomainRun) => notifyRun(run, async (_title, message) => { sent.push(message); });

    const [flagged] = await syncFirstmateDomainRuns({ transport, onChanged });
    expect(flagged!.status).toBe("incomplete");
    expect(flagged!.incompleteReason).toBe("domain handoff contract unmet: missing brief, report, evidence");
    expect(flagged!.result?.raw).toEqual([prose]);
    expect(flagged!.result?.detailedReport).toBe(prose);
    expect(sent).toEqual([]);
    expect(listDomainRuns()[0]!.notified).toBeUndefined();

    // Still open: FirstMate's next, well-formed reply settles it and clears the reason.
    replies[0] = { ...replies[0]!, reply: { id: "note-1", at: "2026-10-09T02:00:00.000Z", body: JSON.stringify({ status: "completed", brief: "Headline swapped on the Christmas branch.", detailed_report: "invite.html and remind_me.html updated.", evidence: ["commit a5bf7ab"] }), cursor: "000000000002" } };
    const [settled] = await syncFirstmateDomainRuns({ transport, onChanged });
    expect(settled!.status).toBe("completed");
    expect(settled!.incompleteReason).toBeUndefined();
    expect(sent).toEqual(["There is an update on your work."]);
  });

  it("records a structured handoff with no evidence as incomplete", async () => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const body = JSON.stringify({ status: "completed", brief: "Fixed.", detailed_report: "Changed the call site." });
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [], handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", body, cursor: "1" } }],
    }), stderr: "" });
    const [flagged] = await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }) });
    expect(flagged!.status).toBe("incomplete");
    expect(flagged!.incompleteReason).toBe("domain handoff contract unmet: missing evidence");
    expect(flagged!.result?.brief).toBe("Fixed.");
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
      pending: [{ id: "note-2", request_id: "domain-test-1:decision:abc", acknowledged: false, reply: null, at: "2026-10-09T01:30:00.000Z" }],
      handled: [original],
    }), stderr: "" });
    expect(await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }) })).toEqual([]);
    expect(listDomainRuns()[0]!.status).toBe("needs_decision");
  });

  it("starts a session when an unread inbox note has waited too long and no harness is live", async () => {
    saveDomainRun(queuedRun());
    const started: string[] = [];
    const exec: FirstmateExec = async (script, args) => {
      if (args[0] === "receipts") return { stdout: JSON.stringify({ pending: [{ id: "note-1", request_id: "domain-test-1", acknowledged: false, reply: null, at: "2026-10-09T00:00:00.000Z" }] }), stderr: "" };
      if (args[0] === "ready") return { stdout: JSON.stringify({ can_receive: false, lock: { live_harness: false } }), stderr: "" };
      started.push(script);
      return { stdout: "started", stderr: "" };
    };
    await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ home: join(dir, "firstmate"), script: "/fake/fm-inbox.sh", exec }),
      now: () => new Date("2026-10-09T01:00:00.000Z"),
    });
    expect(started).toEqual(["claude"]);
  });

  it("does not start a session while the unread note is still fresh", async () => {
    saveDomainRun(queuedRun());
    const started: string[] = [];
    const exec: FirstmateExec = async (script, args) => {
      if (args[0] === "receipts") return { stdout: JSON.stringify({ pending: [{ id: "note-1", request_id: "domain-test-1", acknowledged: false, reply: null, at: "2026-10-09T00:59:00.000Z" }] }), stderr: "" };
      if (args[0] === "ready") return { stdout: JSON.stringify({ can_receive: false, lock: { live_harness: false } }), stderr: "" };
      started.push(script);
      return { stdout: "started", stderr: "" };
    };
    await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }),
      now: () => new Date("2026-10-09T01:00:00.000Z"),
    });
    expect(started).toEqual([]);
  });

  it("waits out the backoff before retrying a stalled launch", async () => {
    saveDomainRun({ ...queuedRun(), failure: "couldn't start", launchRetry: { attempts: 2, nextAt: "2026-10-09T01:30:00.000Z" } });
    const started: string[] = [];
    const exec: FirstmateExec = async (script, args) => {
      if (args[0] === "receipts") return { stdout: JSON.stringify({ pending: [{ id: "note-1", request_id: "domain-test-1", acknowledged: false, reply: null, at: "2026-10-09T00:00:00.000Z" }] }), stderr: "" };
      if (args[0] === "ready") return { stdout: JSON.stringify({ can_receive: false, lock: { live_harness: false } }), stderr: "" };
      started.push(script);
      return { stdout: "started", stderr: "" };
    };
    const transport = new FirstmateDomainTransport({ home: join(dir, "firstmate"), script: "/fake/fm-inbox.sh", exec });
    await syncFirstmateDomainRuns({ transport, now: () => new Date("2026-10-09T01:00:00.000Z") });
    expect(started).toEqual([]);

    await syncFirstmateDomainRuns({ transport, now: () => new Date("2026-10-09T01:31:00.000Z") });
    expect(started).toEqual(["claude"]);
    expect(listDomainRuns()[0]!.failure).toBeUndefined();
    expect(listDomainRuns()[0]!.launchRetry?.attempts).toBe(2);
  });

  it("keeps advancing the backoff across a spawn that then fails", async () => {
    saveDomainRun({ ...queuedRun(), failure: "couldn't start", launchRetry: { attempts: 2, nextAt: "2026-10-09T01:00:00.000Z" } });
    let failing = false;
    const exec: FirstmateExec = async (script, args) => {
      if (args[0] === "receipts") return { stdout: JSON.stringify({ pending: [{ id: "note-1", request_id: "domain-test-1", acknowledged: false, reply: null, at: "2026-10-09T00:00:00.000Z" }] }), stderr: "" };
      if (args[0] === "ready") return { stdout: JSON.stringify({ can_receive: false, lock: { live_harness: false } }), stderr: "" };
      if (failing) throw new Error("not installed");
      return { stdout: "started", stderr: "" };
    };
    const transport = new FirstmateDomainTransport({ home: join(dir, "firstmate"), script: "/fake/fm-inbox.sh", exec });

    await syncFirstmateDomainRuns({ transport, now: () => new Date("2026-10-09T01:00:00.000Z") });
    expect(listDomainRuns()[0]!.failure).toBeUndefined();
    expect(listDomainRuns()[0]!.launchRetry?.attempts).toBe(2);

    failing = true;
    await syncFirstmateDomainRuns({ transport, now: () => new Date("2026-10-09T01:06:00.000Z") });
    expect(listDomainRuns()[0]!.launchRetry?.attempts).toBe(3);
  });

  it("cools the home down instead of relaunching every tick for an unconsumed note", async () => {
    saveDomainRun({ ...queuedRun(), id: "domain-test-2", transport: { kind: "firstmate", requestId: "domain-test-2", externalId: "note-2" } });
    const started: string[] = [];
    const exec: FirstmateExec = async (script, args) => {
      if (args[0] === "receipts") return { stdout: JSON.stringify({ pending: [{ id: "note-9", request_id: "domain-test-9", acknowledged: false, reply: null, at: "2026-10-09T00:00:00.000Z" }] }), stderr: "" };
      if (args[0] === "ready") return { stdout: JSON.stringify({ can_receive: false, lock: { live_harness: false } }), stderr: "" };
      started.push(script);
      return { stdout: "started", stderr: "" };
    };
    const transport = new FirstmateDomainTransport({ home: join(dir, "firstmate"), script: "/fake/fm-inbox.sh", exec });
    await syncFirstmateDomainRuns({ transport, now: () => new Date("2026-10-09T01:00:00.000Z") });
    expect(started).toEqual(["claude"]);

    await syncFirstmateDomainRuns({ transport, now: () => new Date("2026-10-09T01:01:00.000Z") });
    expect(started).toEqual(["claude"]);

    await syncFirstmateDomainRuns({ transport, now: () => new Date("2026-10-09T01:06:00.000Z") });
    expect(started).toEqual(["claude", "claude"]);
  });
});

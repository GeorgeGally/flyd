import { parseExecutiveDecision } from "../../intelligence/executive/decision-step.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstmateDomainTransport, firstmateRequestBody, startFirstmateSession, syncFirstmateDomainRuns, type FirstmateExec } from "../firstmate.js";
import { captainNotice } from "../notice.js";
import { parseDomainResult } from "../result.js";
import { notifyRun } from "../scheduler.js";
import { listDomainRuns, saveDomainRun } from "../store.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";
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

  function decisionForTest(run: DomainRun): ExecutiveDecisionRecord {
    const notice = captainNotice(run);
    const question = run.status === "needs_decision" || run.status === "failed" ? notice ?? run.result?.brief ?? "" : "";
    const decision = parseExecutiveDecision({
      schema: "flyd.executive-decision.v1",
      decisionId: `test:${run.id}:${run.status}`,
      sourceId: "firstmate.change",
      sourceEventId: `${run.id}:${run.status}`,
      taskId: run.id,
      disposition: question ? "ask_george" : notice ? "handle_internally" : "backstage",
      reason: notice ? "test evidence says this outcome matters" : "routine test fixture",
      summary: notice ?? run.result?.brief ?? "No material outcome.",
      evidenceRefs: [`domain-run:${run.id}`],
      ...(question ? { question, options: [], recommendation: { rationale: "Choose the scope you want." } } : {}),
      verification: run.status === "completed" ? { status: "verified", evidenceRefs: [`domain-run:${run.id}:completed`] } : { status: "unknown", evidenceRefs: [] },
      show: Boolean(notice),
      notify: Boolean(notice),
      createdAt: run.updatedAt,
    });
    if (!decision) throw new Error("Invalid test decision");
    return decision;
  }

  function notifyWithTestDecision(run: DomainRun, notify?: Parameters<typeof notifyRun>[1], send?: Parameters<typeof notifyRun>[2]): Promise<void> {
    return notifyRun(run, notify, send, async (changed) => decisionForTest(changed));
  }

  it("preserves George's original words and asks for a layered durable reply", () => {
    const body = firstmateRequestBody(request());
    expect(body).toContain("No, keep the abstraction. Fix where it is called.");
    expect(body).toContain("detailed_report");
    expect(body).toContain("fm-inbox.sh reply");
  });

  it("hands the matched skill and its process to FirstMate after Flyd's interpretation", () => {
    const body = firstmateRequestBody({ ...request(), skill: { name: "design-lab", body: "Explore three directions, then critique." } });
    expect(body).toContain("FLYD INTERPRETATION:\nFix the call site without replacing the existing abstraction.\nUSE SKILL: design-lab\nFollow this skill's process for this request:\nExplore three directions, then critique.");
  });

  it("does not add a skill section when no skill matched", () => {
    expect(firstmateRequestBody(request())).not.toContain("USE SKILL:");
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
    const onChanged = (run: DomainRun) => notifyWithTestDecision(run, async (_title, message) => { sent.push(message); });
    const judge = async (reply: string, outcome: string) => { judged.push(`${outcome}|${reply}`); return "completed" as const; };

    const [settled] = await syncFirstmateDomainRuns({ transport, onChanged, judge });
    expect(judged).toEqual([`${request().intendedOutcome}|${prose}`]);
    expect(settled!.status).toBe("completed");
    expect(settled!.incompleteReason).toBe("domain handoff contract unmet: missing brief, report, evidence");
    expect(settled!.result?.raw).toEqual([prose]);
    expect(settled!.result?.detailedReport).toBe(prose);
    expect(sent).toEqual([prose]);
  });

  it("closes a run from FirstMate's own status/brief reply, without a model, never leaving it working", async () => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    // The reply the staff actually sent to a handoff: a status line and a brief.
    const reply = "status: completed\nbrief: Done and live: the sidebar opens on Artefacts, with a tab to switch it to Changes.";
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [],
      handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", at: "2026-10-09T01:00:00.000Z", body: reply, cursor: "000000000001" } }],
    }), stderr: "" });
    const sent: string[] = [];
    const onChanged = (run: DomainRun) => notifyWithTestDecision(run, async (_title, message) => { sent.push(message); });
    let judged = 0;
    const judge = async () => { judged += 1; return null; };

    const [settled] = await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }), onChanged, judge });
    // A clear line is read on its own: no model call, and the run is never left "working".
    expect(judged).toBe(0);
    expect(settled!.status).toBe("completed");
    expect(settled!.result?.brief).toContain("sidebar opens on Artefacts");
    expect(sent).toEqual([expect.stringContaining("sidebar opens on Artefacts")]);
  });

  it("reads again a status/brief reply taken while it could not be read, and closes the run it left working", async () => {
    const reply = "status: completed\nbrief: Done and live: the sidebar opens on Artefacts, with a tab to switch it to Changes.";
    // Taken before "status: …" lines counted: kept raw, the run left working.
    const raw = { ...parseDomainResult("Done and live.").result, raw: [reply], detailedReport: reply };
    const at = new Date().toISOString();
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "working",
      createdAt: request().createdAt, updatedAt: at, result: raw,
      incompleteReason: "domain handoff contract unmet: missing brief, report, evidence",
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1", replyCursor: "000000000001" },
    });
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({
      pending: [],
      handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", at, body: reply, cursor: "000000000001" } }],
    }), stderr: "" });
    let judged = 0;
    const judge = async () => { judged += 1; return null; };

    const [settled] = await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }), judge });
    expect(judged).toBe(0);
    expect(settled!.status).toBe("completed");
    expect(settled!.result?.format).toBe("structured");
    expect(settled!.incompleteReason).toBe("domain handoff contract unmet: missing evidence");
  });

  it("leaves a prose reply no model could judge open, and asks the staff how it ended", async () => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const prose = "status=needs_decision: copy swap is ready in invite.html and remind_me.html. Going live stays George's call.";
    const notes: string[] = [];
    const exec: FirstmateExec = async (_script, args, options) => {
      if (args[0] === "note") { notes.push(String(options.input)); return { stdout: JSON.stringify({ id: "note-x", saved: true }), stderr: "" }; }
      return { stdout: JSON.stringify({ pending: [], handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", body: prose, cursor: "1" } }] }), stderr: "" };
    };
    const [read] = await syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }), judge: async () => { throw new Error("no model"); } });
    expect(read!.status).toBe("working");
    expect(notes).toHaveLength(1);
  });

  it("keeps one check-in open until a reply is read, asking for a line it can read without a model", async () => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const notes: string[] = [];
    let reply = { body: "Merged and green, all done.", cursor: "1" };
    const exec: FirstmateExec = async (_script, args, options) => {
      if (args[0] === "note") { notes.push(String(options.input)); return { stdout: JSON.stringify({ id: `note-${notes.length + 1}`, saved: true }), stderr: "" }; }
      return { stdout: JSON.stringify({ pending: [], handled: [{ id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", ...reply } }] }), stderr: "" };
    };
    const sync = () => syncFirstmateDomainRuns({ transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }), judge: async () => null });
    const status = () => listDomainRuns().find((run) => run.id === "domain-test-1")!.status;

    await sync();
    expect(status()).toBe("working");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('{"status":');

    reply = { body: "completed, merged and green", cursor: "2" };
    await sync();
    expect(status()).toBe("working");
    expect(notes).toHaveLength(1);

    reply = { body: JSON.stringify({ status: "working", brief: "Rebasing before it lands." }), cursor: "3" };
    await sync();
    expect(status()).toBe("working");
    expect(notes).toHaveLength(1);

    reply = { body: "Still going, nearly there.", cursor: "4" };
    await sync();
    expect(notes).toHaveLength(2);

    reply = { body: JSON.stringify({ status: "completed", brief: "Merged; the footer link works." }), cursor: "5" };
    await sync();
    expect(status()).toBe("completed");
    expect(notes).toHaveLength(2);
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
      judge: async () => "completed" as const,
      onChanged: (run) => notifyWithTestDecision(run, async (_title, message) => { sent.push(message); }),
    });
    expect(changed.map((run) => [run.id, run.status, run.notified ?? false]).sort()).toEqual([
      ["domain-old", "completed", true],
      ["domain-recent", "completed", false],
    ]);
    expect(sent).toEqual(["The footer link now opens the right page."]);
  });

  it("still tells George when a stale re-read is a decision or a failure, silent only on done", async () => {
    const now = new Date("2026-10-17T00:00:00.000Z");
    const legacy = (id: string, prose: string): DomainRun => ({
      id, request: { ...request(), id }, owner: "FirstMate", status: "incomplete",
      createdAt: request().createdAt, updatedAt: "2026-10-12T00:00:00.000Z",
      transport: { kind: "firstmate", requestId: id, externalId: `note-${id}`, replyCursor: "1" },
      result: parseDomainResult(prose).result,
      incompleteReason: "domain handoff contract unmet: missing brief, report, evidence",
    });
    const decided = "status=needs_decision: the copy change is ready; publishing the new pricing page is your call.";
    const broke = "status=failed: the deploy failed and rolled back.";
    const done = "Done: the footer link now opens the right page.";
    saveDomainRun(legacy("domain-decided", decided));
    saveDomainRun(legacy("domain-broke", broke));
    saveDomainRun(legacy("domain-done", done));
    const handled = [["domain-decided", decided], ["domain-broke", broke], ["domain-done", done]].map(([id, body]) => ({
      id: `note-${id}`, request_id: id, acknowledged: true, reply: { id: `note-${id}`, body, cursor: "1" },
    }));
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({ pending: [], handled }), stderr: "" });
    const sent: string[] = [];
    const changed = await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }),
      now: () => now,
      judge: async (reply) => reply.startsWith("status=needs_decision") ? "needs_decision" : reply.startsWith("status=failed") ? "failed" : "completed",
      onChanged: (run) => notifyWithTestDecision(run, async (_title, message) => { sent.push(message); }),
    });
    const byId = Object.fromEntries(changed.map((run) => [run.id, run]));
    expect(byId["domain-decided"]!.status).toBe("needs_decision");
    expect(byId["domain-broke"]!.status).toBe("failed");
    expect(byId["domain-done"]!.status).toBe("completed");
    expect(sent.some((message) => message.includes("the copy change is ready"))).toBe(true);
    expect(sent.some((message) => message.includes("is blocked"))).toBe(true);
    expect(sent.some((message) => message.includes("footer link"))).toBe(false);
    expect(listDomainRuns().find((run) => run.id === "domain-done")?.notified).toBe(true);
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

    const [settled] = await syncFirstmateDomainRuns({ transport, onChanged: (run) => notifyWithTestDecision(run, notify) });
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
      onChanged: (run) => notifyWithTestDecision(run, async (_title, message) => { sent.push(message); }),
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

  it("surfaces each unread-too-long note once to Flyd's internal callback", async () => {
    saveDomainRun(queuedRun());
    const note = { id: "note-1", request_id: "domain-test-1", acknowledged: false, at: "2026-10-09T00:00:00.000Z" };
    const exec: FirstmateExec = async (_script, args) => args[0] === "receipts"
      ? { stdout: JSON.stringify({ pending: [note] }), stderr: "" }
      : { stdout: JSON.stringify({ can_receive: false, lock: { live_harness: true } }), stderr: "" };
    const onUnreadTooLong = vi.fn();
    const transport = new FirstmateDomainTransport({ home: join(dir, "firstmate"), script: "/fake/fm-inbox.sh", exec });
    await syncFirstmateDomainRuns({ transport, now: () => new Date("2026-10-09T01:00:00.000Z"), onUnreadTooLong });
    await syncFirstmateDomainRuns({ transport, now: () => new Date("2026-10-09T01:01:00.000Z"), onUnreadTooLong });
    expect(onUnreadTooLong).toHaveBeenCalledTimes(1);
    expect(onUnreadTooLong).toHaveBeenCalledWith([note]);
  });

  it("does not restart a live helper when it still owns the inbox", async () => {
    saveDomainRun(queuedRun());
    const started: string[] = [];
    const exec: FirstmateExec = async (_script, args) => args[0] === "receipts"
      ? { stdout: JSON.stringify({ pending: [{ id: "note-1", request_id: "domain-test-1", acknowledged: false, at: "2026-10-09T00:00:00.000Z" }] }), stderr: "" }
      : { stdout: JSON.stringify({ can_receive: false, lock: { live_harness: true } }), stderr: "" };
    await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ home: join(dir, "firstmate"), script: "/fake/fm-inbox.sh", exec: async (script, args, options) => {
        if (args[0] !== "receipts" && args[0] !== "ready") started.push(script);
        return exec(script, args, options);
      } }),
      now: () => new Date("2026-10-09T01:00:00.000Z"),
    });
    expect(started).toEqual([]);
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

  const proseReply = (prose: string) => ({
    id: "note-1", request_id: "domain-test-1", acknowledged: true, reply: { id: "note-1", body: prose, cursor: "1" },
  });

  it.each([
    "All tests passed; zero failed.",
    "Merged and deployed; nothing broke.",
    "Investigated the race; the fix still needs a rebase before it can land.",
  ])("keeps a prose reply no model can read open and silent, and asks the staff how it ended: %s", async (prose) => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const notes: string[] = [];
    const exec: FirstmateExec = async (_script, args, options) => {
      if (args[0] === "note") { notes.push(String(options.input)); return { stdout: JSON.stringify({ id: "note-x", saved: true }), stderr: "" }; }
      return { stdout: JSON.stringify({ pending: [], handled: [proseReply(prose)] }), stderr: "" };
    };
    const sent: string[] = [];
    const [read] = await syncFirstmateDomainRuns({
      transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }),
      judge: async () => { throw new Error("no model"); },
      onChanged: (run) => notifyWithTestDecision(run, async (_title, message) => { sent.push(message); }),
    });
    expect(read!.status).toBe("working");
    expect(sent).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('{"status": "completed|needs_decision|failed|working"');
  });

  it("gives a caller that passes no judge Flyd's model, settling a prose reply rather than words alone", async () => {
    saveDomainRun({
      id: "domain-test-1", request: request(), owner: "FirstMate", status: "accepted",
      createdAt: request().createdAt, updatedAt: request().createdAt,
      transport: { kind: "firstmate", requestId: "domain-test-1", externalId: "note-1" },
    });
    const prose = "Rebased and merged; green.";
    const exec: FirstmateExec = async () => ({ stdout: JSON.stringify({ pending: [], handled: [proseReply(prose)] }), stderr: "" });
    const sent: string[] = [];
    const savedVitest = process.env.VITEST;
    const savedFixture = process.env.FLYD_MODEL_FIXTURE;
    delete process.env.VITEST;
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({ fallback: "{\"status\": \"completed\"}" });
    try {
      const [settled] = await syncFirstmateDomainRuns({
        transport: new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec }),
        onChanged: (run) => notifyWithTestDecision(run, async (_title, message) => { sent.push(message); }),
      });
      expect(settled!.status).toBe("completed");
      expect(sent).toEqual([prose]);
    } finally {
      if (savedVitest === undefined) delete process.env.VITEST; else process.env.VITEST = savedVitest;
      if (savedFixture === undefined) delete process.env.FLYD_MODEL_FIXTURE; else process.env.FLYD_MODEL_FIXTURE = savedFixture;
    }
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

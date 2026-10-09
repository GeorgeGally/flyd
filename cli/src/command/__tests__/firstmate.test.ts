import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FirstmateDomainTransport, firstmateRequestBody, syncFirstmateDomainRuns, type FirstmateExec } from "../firstmate.js";
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

  it.each([
    ["Captain, shipshape.", []],
    ["Captain, got it — fixed the typo and pushed to main.", ["Got it — fixed the typo and pushed to main."]],
  ])("completes the run on any reply and notifies only outcomes: %s", async (body, expected) => {
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
});

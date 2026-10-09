import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FirstmateDomainTransport, type FirstmateExec } from "../firstmate.js";
import { activeDomainRuns, sendDomainMessage } from "../messages.js";
import { listDomainRuns, saveDomainRun } from "../store.js";
import type { DomainRun } from "../types.js";

describe("domain manager messages", () => {
  let dir: string;
  let previous: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-domain-message-"));
    previous = process.env.FLYD_COMMAND_DIR;
    process.env.FLYD_COMMAND_DIR = dir;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.FLYD_COMMAND_DIR;
    else process.env.FLYD_COMMAND_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  function run(id = "domain-one", domain: "coding" | "knowledge" = "coding"): DomainRun {
    return {
      id,
      request: {
        id, domain, originalMessage: "Build it", intendedOutcome: "Build it",
        doneWhen: ["works"], createdAt: "2026-10-09T00:00:00.000Z", source: "chat",
      },
      owner: domain === "coding" ? "FirstMate" : "Librarian",
      status: "working",
      createdAt: "2026-10-09T00:00:00.000Z",
      updatedAt: "2026-10-09T00:00:00.000Z",
      transport: { kind: domain === "coding" ? "firstmate" : "native", requestId: id, externalId: domain === "coding" ? "note-1" : undefined },
    };
  }

  it("forwards George's correction verbatim to the only active FirstMate run", async () => {
    saveDomainRun(run());
    const calls: Array<{ args: string[]; input?: string }> = [];
    const exec: FirstmateExec = async (_script, args, options) => {
      calls.push({ args, input: options.input });
      return { stdout: JSON.stringify({ id: "note-correction", saved: true }), stderr: "" };
    };
    const transport = new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec });
    const outcome = await sendDomainMessage({
      domain: "coding", kind: "correction",
      body: "No, keep the abstraction. Fix where it is called.",
      transport,
    });

    expect(outcome.delivered).toBe(true);
    expect(calls[0]!.args[0]).toBe("note");
    expect(calls[0]!.input).toContain("No, keep the abstraction. Fix where it is called.");
    expect(listDomainRuns()[0]!.messages?.[0]?.externalId).toBe("note-correction");
  });

  it("does not guess when two runs in the same domain are active", async () => {
    saveDomainRun(run("domain-one"));
    saveDomainRun(run("domain-two"));
    const outcome = await sendDomainMessage({ domain: "coding", kind: "correction", body: "Stop changing the schema." });
    expect(outcome).toMatchObject({ delivered: false, reason: "ambiguous_active_runs" });
    expect(activeDomainRuns("coding")).toHaveLength(2);
  });

  it("makes identical corrections idempotent", async () => {
    saveDomainRun(run());
    let sends = 0;
    const exec: FirstmateExec = async () => {
      sends += 1;
      return { stdout: JSON.stringify({ id: "note-correction", saved: true }), stderr: "" };
    };
    const transport = new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec });
    const input = { domain: "coding" as const, kind: "correction" as const, body: "Keep the existing model.", transport };
    expect((await sendDomainMessage(input)).delivered).toBe(true);
    expect((await sendDomainMessage(input)).delivered).toBe(true);
    expect(sends).toBe(1);
  });

  it("stores knowledge corrections for the Librarian's next manager wake", async () => {
    saveDomainRun(run("knowledge-one", "knowledge"));
    const outcome = await sendDomainMessage({ domain: "knowledge", kind: "priority_change", body: "Focus on current evidence first." });
    expect(outcome.delivered).toBe(true);
    expect(listDomainRuns()[0]!.messages?.[0]).toMatchObject({
      kind: "priority_change",
      body: "Focus on current evidence first.",
    });
  });
});

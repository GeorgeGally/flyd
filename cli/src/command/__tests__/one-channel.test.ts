import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FirstmateDomainTransport, type FirstmateExec } from "../firstmate.js";
import { StaffMonitor, WORKER_WAIT_MS } from "../fleet-monitor.js";
import { activeDomainRuns } from "../messages.js";
import { notifyRun } from "../scheduler.js";
import { listDomainRuns, readDomainRun } from "../store.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("one channel to the coding staff", () => {
  it("runs fm-inbox.sh from the command layer's transport alone", () => {
    const runners: string[] = [];
    const scriptPaths: string[] = [];
    const lowLevel: string[] = [];
    for (const path of sources(SRC)) {
      const text = readFileSync(path, "utf8");
      const file = relative(SRC, path);
      // An fm-inbox subcommand handed to an exec: note, ready, receipts, reply, drain, announce.
      if (/\[\s*"note"\s*,\s*"--request-id"|\[\s*"ready"\s*\]|\[\s*"receipts"\s*,\s*"--|\[\s*"(?:reply|drain|announce)"\s*,\s*"/.test(text)) runners.push(file);
      if (/["'`]fm-inbox\.sh["'`]/.test(text)) scriptPaths.push(file);
      if (/\bdefaultFirstmateExec\b|\bfirstmateStdout\b/.test(text)) lowLevel.push(file);
    }
    expect(runners).toEqual(["command/firstmate.ts"]);
    expect(scriptPaths).toEqual(["lib/firstmate-home.ts"]);
    expect(lowLevel).toEqual(["command/firstmate.ts"]);
  });
});

describe("Flyd's own notes to the staff", () => {
  let root: string;
  let previous: string | undefined;
  const sent: Array<{ args: string[]; input?: string }> = [];
  const exec: FirstmateExec = async (_script, args, options) => {
    if (args[0] === "ready") return { stdout: JSON.stringify({ lock: { state: "held", pid: 1, live_harness: true }, can_receive: true }), stderr: "" };
    if (args[0] === "receipts") return { stdout: "{}", stderr: "" };
    if (args[0] === "note") {
      sent.push({ args, input: options.input });
      return { stdout: JSON.stringify({ id: `note-${sent.length}`, saved: true, acknowledged: false }), stderr: "" };
    }
    throw new Error(`unexpected ${args.join(" ")}`);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "flyd-one-channel-"));
    previous = process.env.FLYD_COMMAND_DIR;
    process.env.FLYD_COMMAND_DIR = join(root, "command");
    sent.length = 0;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.FLYD_COMMAND_DIR;
    else process.env.FLYD_COMMAND_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });

  it("go as domain runs of their own: George's words kept as the original, done_when and the return contract on the note", async () => {
    const transport = new FirstmateDomainTransport({ home: join(root, "fm"), script: "/fake/fm-inbox.sh", exec });
    const { run, replayed } = await transport.sendFlydNote({
      requestId: "flyd-decision-abc",
      body: "George's answer to the recorded decision which size?:\n\nthe smaller one",
      outcome: "Act on George's answer to: which size?",
      georgesWords: "the smaller one",
      parentRequestId: "desk-0b5e7c1d-1111-2222-3333-444455556666",
    });
    expect(replayed).toBe(false);
    expect(run.request).toMatchObject({ source: "flyd", originalMessage: "the smaller one", parentRequestId: "desk-0b5e7c1d-1111-2222-3333-444455556666" });
    expect(run.request.doneWhen.length).toBeGreaterThan(0);
    expect(sent[0]!.args).toEqual(["note", "--request-id", "flyd-decision-abc", "--json", "-"]);
    expect(sent[0]!.input).toContain("GEORGE'S OWN WORDS — preserve this wording as authority:\nthe smaller one");
    expect(sent[0]!.input).toContain("Follow-up to prior Flyd domain run: desk-0b5e7c1d-1111-2222-3333-444455556666");
    expect(sent[0]!.input).toContain("RETURN CONTRACT: reply to this note (fm-inbox.sh reply)");
    // The same note again is a replay, never a second note.
    expect((await transport.sendFlydNote({ requestId: "flyd-decision-abc", body: "again", outcome: "x" })).replayed).toBe(true);
    expect(sent).toHaveLength(1);
    await expect(transport.sendFlydNote({ requestId: "desk-not-flyd", body: "x", outcome: "x" })).rejects.toThrow(/flyd- request id/);
  });

  it("are never announced to George, never chased as handoffs, and never take his corrections", async () => {
    const transport = new FirstmateDomainTransport({ home: join(root, "fm"), script: "/fake/fm-inbox.sh", exec });
    const { run } = await transport.sendFlydNote({ requestId: "flyd-close-gnm-7", body: "Close the overtaken call.", outcome: "Close the overtaken call on gnm-7" });
    expect(activeDomainRuns("coding")).toEqual([]);
    const told: string[] = [];
    const settled = { ...run, status: "completed" as const, result: { format: "raw" as const, brief: "Closed.", detailedReport: "Closed.", decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: ["Closed."], informationLossRisk: "high" as const } };
    await notifyRun(settled, async (_title, message) => { told.push(message); }, undefined, async () => { throw new Error("no decision step for Flyd's own note"); });
    expect(told).toEqual([]);
    expect(readDomainRun(run.id)?.notified).toBe(true);
  });

  it("include the staff watch's worker check-ins, kept out of the handoffs it chases", async () => {
    const home = join(root, "fm");
    mkdirSync(join(home, "state"), { recursive: true });
    const t0 = Date.parse("2026-10-17T00:00:00.000Z");
    writeFileSync(join(home, "state", "home-summary.json"), JSON.stringify({ active_children: [{ id: "island-text", state: "needs-decision", name: "Restore readable island text" }], decisions_open: [], counts: {} }));
    writeFileSync(join(home, "state", "island-text.status"), `needs-decision [at=${t0 / 1000}]: which size?\n`);
    const dir = join(root, "command");
    const view = await new StaffMonitor({ home, script: "/fake/fm-inbox.sh", exec, dir, sessionsDir: join(root, "sessions"), now: () => t0 + WORKER_WAIT_MS + 60_000, notify: async () => {} }).tick();
    expect(sent).toHaveLength(1);
    const [checkIn] = listDomainRuns(dir);
    expect(checkIn).toMatchObject({ id: sent[0]!.args[2], request: { source: "flyd", contextRefs: ["worker:island-text"] }, transport: { kind: "firstmate" } });
    expect(view!.snapshot.handoffs).toEqual([]);
  });
});

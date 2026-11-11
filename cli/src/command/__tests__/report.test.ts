import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FirstmateDomainTransport, syncFirstmateDomainRuns, type FirstmateExec } from "../firstmate.js";
import { dueReport, shownLine } from "../report.js";
import { notifyRun, tellDue, tellHeld } from "../scheduler.js";
import { readDomainRun, saveDomainRun, updateDomainRun } from "../store.js";
import { parseDomainResult } from "../result.js";
import { deliveredPromptBlock } from "../../runtime/delivery.js";
import { deliveryState, heldReports } from "../../runtime/delivered.js";
import type { DomainRun } from "../types.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";

// The report record (command/report.ts): one record per outcome of a run, `due` written with the outcome, swept by
// the command tick, "shown" only when George saw it, and a held call withdrawn once it is no longer worth telling.

const LINE = "Done: keep the island quiet. https://github.com/GeorgeGally/flyd/pull/9";

function finished(id: string): ExecutiveDecisionRecord {
  return {
    schema: "flyd.executive-decision.v1", decisionId: `decision-${id}`, sourceId: "firstmate.change", sourceEventId: `event-${id}`,
    taskId: id, disposition: "handle_internally", reason: "finished work, checked: its change is in", summary: LINE,
    delivery: { line: LINE, checked: true, url: "https://github.com/GeorgeGally/flyd/pull/9" }, evidenceRefs: [id],
    verification: { status: "verified", evidenceRefs: ["https://github.com/GeorgeGally/flyd/pull/9"] }, show: true, notify: true,
    createdAt: "2026-11-10T10:00:00.000Z",
  };
}

function call(id: string, question: string): ExecutiveDecisionRecord {
  return {
    schema: "flyd.executive-decision.v1", decisionId: `decision-${id}`, sourceId: "firstmate.change", sourceEventId: `event-${id}`,
    taskId: id, disposition: "ask_george", reason: "George owns the choice", summary: question, evidenceRefs: [id], question,
    options: ["Yes", "Not yet"], recommendation: { option: "Not yet", rationale: "It can wait for a look." },
    verification: { status: "unknown", evidenceRefs: [] }, show: true, notify: true, createdAt: "2026-11-10T10:00:00.000Z",
  };
}

function run(id: string, reply: string, extra: Partial<DomainRun> = {}): DomainRun {
  const parsed = parseDomainResult(reply);
  return {
    id,
    request: { id, domain: "coding", originalMessage: "Fix the island", intendedOutcome: "Fix the island", doneWhen: ["the island is quiet"], createdAt: "2026-11-10T09:00:00.000Z" },
    owner: "FirstMate",
    status: parsed.status ?? "completed",
    createdAt: "2026-11-10T09:00:00.000Z",
    updatedAt: "2026-11-10T09:00:00.000Z",
    transport: { kind: "firstmate", requestId: id },
    result: parsed.result,
    ...extra,
  };
}

/** Focus can't be read: told now. */
const now = async () => { throw new Error("no signals"); };

describe("the report record", () => {
  let dir: string;
  let oldDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-report-"));
    oldDir = process.env.FLYD_COMMAND_DIR;
    process.env.FLYD_COMMAND_DIR = dir;
  });

  afterEach(() => {
    if (oldDir === undefined) delete process.env.FLYD_COMMAND_DIR;
    else process.env.FLYD_COMMAND_DIR = oldDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("still tells a run whose review a restart cut off: due is written with the outcome, and the tick's sweep tells it", async () => {
    const id = "domain-restart-1";
    const reply = JSON.stringify({ status: "completed", brief: "Keep the island quiet is merged." });
    const exec: FirstmateExec = async () => ({
      stdout: JSON.stringify({ pending: [], handled: [{ id: "note-1", request_id: id, acknowledged: true, reply: { id: "note-1", at: "2026-11-10T10:00:00.000Z", body: reply, cursor: "000000000001" } }] }),
      stderr: "",
    });
    const transport = new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec });
    saveDomainRun({ ...run(id, "working"), status: "accepted", result: undefined, transport: { kind: "firstmate", requestId: id, externalId: "note-1" } });

    // The sync records the outcome and its due report in one write, and tells nobody itself.
    await syncFirstmateDomainRuns({ transport });
    expect(readDomainRun(id)).toMatchObject({ status: "completed", report: { state: "due", status: "completed" } });

    // Core goes down mid-review: the review never finishes.
    let entered!: () => void;
    const reviewing = new Promise<void>((resolve) => { entered = resolve; });
    void tellDue({ decide: () => { entered(); return new Promise<ExecutiveDecisionRecord>(() => undefined); }, attention: now, notify: async () => { throw new Error("never said"); } });
    await reviewing;
    expect(readDomainRun(id)?.report?.state).toBe("reviewing");

    // After the restart, the first tick's sweep reviews it again and tells it, once.
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    await tellDue({ decide: async () => finished(id), attention: now, notify });
    await tellDue({ decide: async () => finished(id), attention: now, notify });
    expect(sent).toEqual([LINE]);
    expect(readDomainRun(id)?.report).toMatchObject({ state: "shown", line: LINE });
    expect(shownLine(readDomainRun(id)!)).toBe(LINE);
  });

  it("tells a later outcome of the same run on its own, and never records it shown when it was not said", async () => {
    const id = "domain-second-outcome";
    saveDomainRun(run(id, "Captain, done.", { report: dueReport("completed", "2026-11-10T09:00:00.000Z") }));
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    await tellDue({ decide: async () => finished(id), attention: now, notify });
    expect(sent).toEqual([LINE]);

    // He sends a correction; FirstMate comes back completed again with a new result: a new outcome, due.
    const second = "Done again: the island is quiet on every screen.";
    updateDomainRun(id, (current) => ({ ...current, report: dueReport("completed", "2026-11-10T11:00:00.000Z") }));
    const again = (): ExecutiveDecisionRecord => {
      const base = finished(id);
      return { ...base, decisionId: "decision-again", summary: second, delivery: { ...base.delivery!, line: second } };
    };
    await tellDue({ decide: async () => again(), attention: now, notify: async (title, message) => { await notify(title, message); return "kept"; } });
    expect(sent).toHaveLength(2);
    expect(readDomainRun(id)?.report?.state).toBe("screened");
    expect(shownLine(readDomainRun(id)!)).toBeUndefined();
  });

  it("never treats a line the notification gate screened out as sent: it stays out of the next chat turn", async () => {
    const screened = run("domain-screened-1", "Captain, done.", { report: dueReport("completed", "2026-11-10T09:00:00.000Z") });
    const shown = run("domain-shown-1", "Captain, done.", { report: dueReport("completed", "2026-11-10T09:00:00.000Z") });
    saveDomainRun(screened);
    saveDomainRun(shown);

    await notifyRun(screened, async () => "kept", undefined, async () => finished(screened.id), () => false, now);
    await notifyRun(shown, async () => "shown", undefined, async () => finished(shown.id), () => false, now);

    const after = [readDomainRun(screened.id)!, readDomainRun(shown.id)!];
    expect(after.map((item) => item.report?.state)).toEqual(["screened", "shown"]);
    expect(shownLine(after[0]!)).toBeUndefined();
    // Only the shown one is what he was sent.
    const block = deliveredPromptBlock(new Date("2026-11-10T10:00:00.000Z"), after);
    expect(block.match(/^- /gm)).toHaveLength(1);
    expect(block).toContain(LINE);
  });

  it("withdraws a held call once he answered it, and it never rings; an unanswered one still does", async () => {
    const question = "Blue or green for the header?";
    const ask = (id: string): DomainRun => {
      const base = run(id, JSON.stringify({ status: "needs_decision", brief: question }), { report: dueReport("needs_decision", "2026-11-10T09:00:00.000Z") });
      return { ...base, request: { ...base.request, project: { name: "cap5" } } };
    };
    saveDomainRun(ask("domain-held-answered"));
    saveDomainRun(ask("domain-held-open"));
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    const decide = async (asked: DomainRun) => call(asked.id, question);

    // On Bloom: an ordinary call about cap5 waits for a natural break.
    await tellDue({ decide, attention: async () => ({ project: "Bloom" }), notify });
    expect(sent).toEqual([]);
    expect(readDomainRun("domain-held-answered")?.report?.state).toBe("held");
    const key = readDomainRun("domain-held-answered")!.report!.key!;

    // He answers it from the window before his focus breaks: the run goes back to work.
    updateDomainRun("domain-held-answered", (current) => ({
      ...current, status: "working",
      messages: [{ id: "answer-1", kind: "decision", body: "Not yet", at: new Date(Date.now() + 1_000).toISOString() }],
    }));

    await tellHeld(async () => ({ project: "cap5" }), notify);
    // Only the unanswered call rings.
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain("domain-held-answered");
    expect(readDomainRun("domain-held-answered")?.report?.state).toBe("withdrawn");
    expect(deliveryState(key)).toBe("withdrawn");
    expect(heldReports().some((held) => held.key === key)).toBe(false);
    expect(readDomainRun("domain-held-open")?.report?.state).toBe("shown");

    // Never again, whatever his focus does next.
    await tellHeld(async () => ({}), notify);
    expect(sent).toHaveLength(1);
  });
});

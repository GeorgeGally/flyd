import { parseExecutiveDecision } from "../../intelligence/executive/decision-step.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selfReviewDir } from "../../council/reply-review.js";
import { captainNotice, isRoutineChatter } from "../notice.js";
import { parseDomainResult } from "../result.js";
import { decideRun, notifyRun, tellHeld } from "../scheduler.js";
import type { sendRunMessage } from "../messages.js";
import { HANDLE_IT_YOURSELF } from "../../intelligence/executive/decision-step.js";
import { deliverOwed } from "../../runtime/delivered.js";
import { readDomainRun, saveDomainRun } from "../store.js";
import { MAX_REVIEW_TRIES } from "../report.js";
import type { DomainRun, DomainRunStatus } from "../types.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";

function run(reply: string, status?: DomainRunStatus): DomainRun {
  const parsed = parseDomainResult(reply);
  return {
    id: "domain-notice-1",
    request: {
      id: "domain-notice-1",
      domain: "coding",
      originalMessage: "Fix the island",
      intendedOutcome: "Fix the island",
      doneWhen: ["the island is quiet"],
      createdAt: "2026-10-09T00:00:00.000Z",
    },
    owner: "FirstMate",
    status: status ?? parsed.status ?? "completed",
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
    transport: { kind: "firstmate", requestId: "domain-notice-1" },
    result: parsed.result,
  };
}

describe("captain notices", () => {
  it("keeps firstmate's supervision chatter off the screen", () => {
    for (const chatter of [
      "Captain, shipshape.",
      "Captain, no news yet.",
      "Captain, the Flyd island worker has posted an update.",
      "Captain, the Flyd island worker had acknowledged my decision on the layout.",
      "Captain, the Flyd island work is moving again.",
      "Captain, a worker is now on the Flyd fixes: it will trace the island alerts.",
      "Acknowledged — dispatched a crewmate; I'll report back when it lands.",
      "On it.",
      "Captain, noted.",
      "Captain, no change yet.",
      "On it — will report once it's fixed.",
      "Got it; I'll let you know when it's merged.",
      "Acknowledged; I'll let you know when it's merged.",
    ]) {
      expect(isRoutineChatter(chatter), chatter).toBe(true);
      expect(captainNotice(run(chatter)), chatter).toBeNull();
    }
  });

  it("shows outcomes in plain words, without the salutation", () => {
    expect(captainNotice(run("Captain, the Flyd island redesign is ready for your review: https://github.com/GeorgeGally/flyd/pull/68")))
      .toBe("The Flyd island redesign is ready for your review: https://github.com/GeorgeGally/flyd/pull/68");
    expect(captainNotice(run("Captain, your local Flyd copy is updated with the 30 new commits.")))
      .toBe("Your local Flyd copy is updated with the 30 new commits.");
    expect(captainNotice(run("Dark mode is merged."))).toBe("Dark mode is merged.");
    // Who on the staff did it is backstage: the notice says what came of it, never the worker.
    expect(captainNotice(run("The worker finished: dark mode is merged."))).toBe("Dark mode is merged.");
    expect(captainNotice(run("Captain, offline support now runs through a service worker.")))
      .toBe("Offline support now runs through a service worker.");
    expect(captainNotice(run("Captain, the status line now shows plan limits.")))
      .toBe("The status line now shows plan limits.");
    expect(captainNotice(run("Captain, the conversation pane wraps long lines again; a test now covers it.")))
      .toBe("The conversation pane wraps long lines again; a test now covers it.");
    expect(captainNotice(run("Captain, no change needed — the bug was already fixed on main.")))
      .toBe("No change needed — the bug was already fixed on main.");
  });

  it("lets a settled outcome through even when it opens with an acknowledgement", () => {
    expect(captainNotice(run("Got it — the fix is merged."))).toBe("Got it — the fix is merged.");
    expect(captainNotice(run("Captain, shipshape: dark mode is merged."))).toBe("Shipshape: dark mode is merged.");
    expect(captainNotice(run("Captain, got it — fixed the typo and pushed to main.")))
      .toBe("Got it — fixed the typo and pushed to main.");
    expect(captainNotice(run("Captain, got it — once CI passed, I merged it."))).toBe("Got it — once CI passed, I merged it.");
    expect(captainNotice(run("Got it — when I checked, it was already fixed."))).toBe("Got it — when I checked, it was already fixed.");
    expect(captainNotice(run("On it. Landed the island fix; it will ship tonight."))).toBe("On it. Landed the island fix; it will ship tonight.");
    expect(captainNotice(run("Captain, shipshape. The Flyd island checks are moving slowly."))).toBeNull();
  });

  it("always surfaces decisions and failures", () => {
    expect(captainNotice(run(JSON.stringify({ status: "needs_decision", brief: "Captain, merge PR 68 or hold it?" }))))
      .toBe('I need your decision on "Fix the island".');
    expect(captainNotice(run(JSON.stringify({ status: "failed", brief: "Command failed: npm test exited with code 1" }))))
      .toBe("Fix the island is blocked: it couldn't be finished. Tell me whether to try another way or drop it.");
  });

  it("says nothing for unsettled runs", () => {
    expect(captainNotice(run("Dark mode is merged.", "working"))).toBeNull();
    expect(captainNotice({ ...run("x"), result: undefined })).toBeNull();
  });
});

describe("notices keep the one voice", () => {
  const verdicts = () => readFileSync(join(selfReviewDir(), "verdicts.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((line) => JSON.parse(line) as { text: string; held?: boolean; surface?: string });

  it("brings a completion that names backstage as a neutral line naming the work, never claiming how it went, and records it", () => {
    const news = 'There is news on "Fix the island". Ask Flyd for the details.';
    for (const reply of [
      "Firstmate merged fm/sidebar-default; the sidebar opens on Artefacts.",
      "The crewmate finished 2 jobs.",
      "Merged the fix on fm/island-filter; the island is quiet.",
      "Fixed it in the worktree; 2 files changed.",
      "The merge is blocked; the crewmate failed the checks.",
      "The fix is not merged yet; the branch is waiting on review.",
      "Firstmate has not read 3 notes you sent.",
      "Jev reviewed 4 requests.",
      "The Council reviewed 6 items.",
      "The Librarian curated 12 memories.",
      "The Scout surfaced 4 stories.",
      "Task id task-9 is stuck.",
      "The pipeline ran 5 checks.",
      "The crew shipped the island fix.",
      "The merge is blocked; the crew failed the checks.",
    ]) {
      const notice = captainNotice(run(reply));
      expect(notice, reply).toBe(news);
      expect(notice, reply).not.toMatch(/\b(done|finished|failed)\b/i);
    }
    expect(verdicts()).toContainEqual(expect.objectContaining({ text: "Task id task-9 is stuck.", surface: "notification", held: true }));
    expect(verdicts()).toContainEqual(expect.objectContaining({ text: "Firstmate merged fm/sidebar-default; the sidebar opens on Artefacts.", surface: "notification", held: true }));
  });

  it("replaces domain notices naming backstage and preserves clean wording exactly", () => {
    expect(captainNotice(run("FirstMate finished the System-1 replay; the sidebar now opens on Artefacts.")))
      .toBe('There is news on "Fix the island". Ask Flyd for the details.');
    expect(captainNotice(run("The sidebar now opens on Artefacts."))).toBe("The sidebar now opens on Artefacts.");
  });

  it("keeps a completion that only carries a commit id, but rewrites branch mentions", () => {
    expect(captainNotice(run("The sidebar fix is merged at a1b2c3d."))).toBe("The sidebar fix is merged.");
    expect(captainNotice(run("Merged the branch and deployed."))).toBe('There is news on "Fix the island". Ask Flyd for the details.');
    expect(captainNotice(run("Done and live: https://github.com/GeorgeGally/flyd/commit/c170683"))).toBe("Done and live: https://github.com/GeorgeGally/flyd/commit/c170683");
    expect(verdicts()).toContainEqual(expect.objectContaining({ text: "Merged the branch and deployed.", surface: "notification", held: true }));
  });

  it("brings a decision or failure that names backstage as a line naming the work, and records it", () => {
    const decision = captainNotice(run(JSON.stringify({ status: "needs_decision", brief: "Firstmate needs your call on the sidebar: Artefacts or Changes first?" })));
    expect(decision).toBe('I need your decision on "Fix the island".');
    // An implementation call (a composer guard) is Flyd's to make, not relayed as his decision.
    expect(captainNotice(run(JSON.stringify({ status: "needs_decision", brief: "Firstmate needs your call on a composer idle-row guard." })))).toBeNull();
    const failure = captainNotice(run(JSON.stringify({ status: "failed", brief: "the branch fm/x is broken" })));
    expect(failure).toBe("Fix the island is blocked: it couldn't be finished. Tell me whether to try another way or drop it.");
    expect(verdicts()).toContainEqual(expect.objectContaining({ text: "I need your decision: Firstmate needs your call on the sidebar: Artefacts or Changes first?", surface: "notification", held: true }));
  });

  it("names the work in a few words, and never falls to a content-free line when the work itself names backstage", () => {
    const withOutcome = (intendedOutcome: string, brief: string, status: DomainRunStatus) => {
      const base = run(JSON.stringify({ status, brief }));
      return captainNotice({ ...base, request: { ...base.request, intendedOutcome } });
    };
    const machinery = "Guard relayed updates from firstmate, crewmates and the Council";
    expect(withOutcome(machinery, "Working on it", "needs_decision")).toBe("I need your decision on some of your work.");
    expect(withOutcome(machinery, "Working on it", "failed")).toBe("Some of your work is blocked: it couldn't be finished. Tell me whether to try another way or drop it.");
    expect(withOutcome(machinery, "Merged the branch and deployed.", "completed")).toBeNull();
    const long = withOutcome(`The sidebar opens on Artefacts by default. ${"More detail follows here. ".repeat(10)}`, "Looking into it", "needs_decision")!;
    expect(long.length).toBeLessThan(130);
    expect(long).toMatch(/^I need your decision on "The sidebar opens on Artefacts by default\. .*…"\.$/);
    expect(long).not.toMatch(/There is an update/);
  });
});

describe("a notice the outgoing-answer checks hold back", () => {
  it("never shows a placeholder or a phrase he ruled out, and records what it kept from him", () => {
    expect(captainNotice(run("Looking into it"))).toBeNull();
    expect(captainNotice(run("One moment please sir, pulling that up now."))).toBeNull();
    const verdicts = readFileSync(join(selfReviewDir(), "verdicts.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((line) => JSON.parse(line) as { text: string; held?: boolean; surface?: string });
    expect(verdicts).toContainEqual(expect.objectContaining({ text: "Looking into it", surface: "notification", held: true }));
  });
});

describe("a decision or failure the checks catch", () => {
  it("still reaches George: a phrase he ruled out is stripped, a placeholder gives way to the work it is about", () => {
    const decision = captainNotice(run("One moment please sir, the sidebar can open on Artefacts or Changes: which?", "needs_decision"));
    expect(decision).toMatch(/^I need your decision: /);
    expect(decision).toContain("the sidebar can open on Artefacts or Changes");
    expect(decision).not.toMatch(/one moment/i);
    expect(captainNotice(run("Working on it", "needs_decision"))).toBe('I need your decision on "Fix the island".');
    expect(captainNotice(run("Looking into it", "failed"))).toBe("Fix the island is blocked: it couldn't be finished. Tell me whether to try another way or drop it.");
    const verdicts = readFileSync(join(selfReviewDir(), "verdicts.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((line) => JSON.parse(line) as { text: string; held?: boolean; surface?: string });
    expect(verdicts).toContainEqual(expect.objectContaining({ text: "I need your decision: Working on it", surface: "notification", held: true }));
  });
});

describe("the relay gate on the self-review's evidence", () => {
  // The exact lines Flyd's self-review caught reaching George: one names the
  // backstage helper, the other hands him an implementation call.
  const BACKSTAGE = "Flyd is re-requesting unstructured FirstMate handoffs";
  const INTERNAL_CALL = "Tell me whether to add Teletext, Test card and Tuning dial buttons";
  const verdicts = () => readFileSync(join(selfReviewDir(), "verdicts.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((line) => JSON.parse(line) as { text: string; held?: boolean; surface?: string; shortfalls: Array<{ requirement: string }> });

  it("never shows either line verbatim in a domain-run notice, whatever the run's status, and records each hold", () => {
    for (const status of ["completed", "needs_decision", "failed"] as const) {
      for (const line of [BACKSTAGE, INTERNAL_CALL]) {
        const notice = captainNotice(run(JSON.stringify({ status, brief: line })));
        expect(notice ?? "", `${status}: ${line}`).not.toContain(line);
        expect(notice ?? "", `${status}: ${line}`).not.toMatch(/firstmate|handoff/i);
      }
    }
    expect(verdicts()).toContainEqual(expect.objectContaining({ text: expect.stringContaining("re-requesting unstructured FirstMate"), surface: "notification", held: true }));
    expect(verdicts()).toContainEqual(expect.objectContaining({
      text: `I need your decision: ${INTERNAL_CALL}`, held: true,
      shortfalls: expect.arrayContaining([expect.objectContaining({ requirement: "decisions_handled" })]),
    }));
  });

  it("keeps an implementation call off his screen as a decision, and brings him a call on what the page carries", () => {
    expect(captainNotice(run(JSON.stringify({ status: "needs_decision", brief: "Tell me whether to lay out the TV page with CSS grid or flexbox." })))).toBeNull();
    expect(captainNotice(run(JSON.stringify({ status: "needs_decision", brief: "Tell me whether to add Teletext and Tuning dial buttons." }))))
      .toBe("I need your decision: Tell me whether to add Teletext and Tuning dial buttons.");
    expect(captainNotice(run(JSON.stringify({ status: "needs_decision", brief: "The logo can be red or blue: which do you want?" }))))
      .toBe("I need your decision: The logo can be red or blue: which do you want?");
  });

  it("brings an unstructured handoff as a neutral line naming the work, never its reason code or a process call, and records it", () => {
    const base = run("--body-file /tmp/flyd-df.json");
    const notice = captainNotice({ ...base, incompleteReason: "handoff:missing brief,report,evidence" });
    expect(notice).toBe("Fix the island came back without a clear report, so nothing counts as done yet.");
    expect(verdicts()).toContainEqual(expect.objectContaining({ text: expect.stringContaining("handoff:missing"), surface: "notification", held: true }));
  });

  it("holds task and run ids, fm/ branches and worktree paths", () => {
    for (const line of ["The island fix in run-12 is merged.", "Merged fm/flyd-island into main.", "Fixed in ~/.treehouse/flyd-c351a7/11/flyd; the island is quiet."]) {
      expect(captainNotice(run(line)), line).toBe('There is news on "Fix the island". Ask Flyd for the details.');
    }
  });

  it("may name the machinery when George asked how Flyd works", () => {
    const base = run("FirstMate picked the island fix and the crewmate merged it.");
    expect(captainNotice({ ...base, request: { ...base.request, originalMessage: "How does Flyd work when I hand it a fix?" } }))
      .toBe("FirstMate picked the island fix and the crewmate merged it.");
  });
});

describe("notifyRun", () => {
  let dir: string;
  let oldDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-notice-"));
    oldDir = process.env.FLYD_COMMAND_DIR;
    process.env.FLYD_COMMAND_DIR = dir;
  });

  afterEach(() => {
    if (oldDir === undefined) delete process.env.FLYD_COMMAND_DIR;
    else process.env.FLYD_COMMAND_DIR = oldDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("notifies an outcome once and marks chatter handled without showing it", async () => {
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    const decision = (summary: string, notify: boolean): ExecutiveDecisionRecord => ({
      schema: "flyd.executive-decision.v1",
      decisionId: "decision-1",
      sourceId: "firstmate.change",
      sourceEventId: "event-1",
      taskId: "domain-notice-1",
      disposition: "handle_internally",
      reason: "verified result",
      summary,
      evidenceRefs: ["domain-notice-1"],
      verification: { status: "verified", evidenceRefs: ["domain-notice-1:completed"] },
      show: true,
      notify,
      createdAt: "2026-10-21T00:00:00.000Z",
    });

    await notifyRun(run("Captain, shipshape."), notify, undefined, async () => decision("No result to share.", false));
    expect(sent).toEqual([]);
    expect(readDomainRun("domain-notice-1")?.notified).toBe(true);
    expect(readDomainRun("domain-notice-1")?.told).toBeUndefined();

    const outcome = run("Captain, dark mode is merged.");
    await notifyRun(outcome, notify, undefined, async () => decision("Dark mode is merged.", true));
    expect(readDomainRun("domain-notice-1")?.told?.line).toBe("Dark mode is merged.");
    await notifyRun({ ...outcome, notified: true }, notify, undefined, async () => decision("Dark mode is merged.", true));
    expect(sent).toEqual(["Dark mode is merged."]);
  });

  it("announces work he started from the window unless that conversation is open, once, in its checked line", async () => {
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    const finished: ExecutiveDecisionRecord = {
      schema: "flyd.executive-decision.v1",
      decisionId: "decision-window",
      sourceId: "firstmate.change",
      sourceEventId: "event-window",
      taskId: "domain-notice-1",
      disposition: "handle_internally",
      reason: "finished work; its outcome could not be checked",
      summary: "The work on “Fix the island” is finished; I haven't checked it yet.",
      delivery: { line: "The work on “Fix the island” is finished; I haven't checked it yet.", checked: false },
      evidenceRefs: ["domain-notice-1"],
      verification: { status: "unknown", evidenceRefs: [] },
      show: true,
      notify: true,
      createdAt: "2026-10-21T00:00:00.000Z",
    };
    const fromWindow = (id: string): DomainRun => {
      const base = run("Captain, done.");
      // A Librarian run: Core announces non-FirstMate work itself.
      return { ...base, id, owner: "Librarian", transport: { kind: "native", requestId: id }, request: { ...base.request, id, domain: "knowledge", source: "view", session: "session-a" } };
    };
    let decided = 0;
    const decide = async () => { decided++; return finished; };
    // Open on that conversation: the reply shows under his message, and it is never told later, even once he moves on.
    await notifyRun(fromWindow("desk-seen-1"), notify, undefined, decide, (session) => session === "session-a");
    expect([sent, decided, readDomainRun("desk-seen-1")?.notified]).toEqual([[], 0, true]);
    await notifyRun(fromWindow("desk-seen-1"), notify, undefined, decide, (session) => session === "session-b");
    expect(sent).toEqual([]);
    // Another conversation (or the News tab) open does not show his reply under his message: told, once.
    await notifyRun(fromWindow("domain-notice-1"), notify, undefined, decide, (session) => session === "session-b");
    await notifyRun(fromWindow("domain-notice-1"), notify, undefined, decide, (session) => session === "session-b");
    expect(sent).toEqual(["The work on “Fix the island” is finished; I haven't checked it yet."]);
  });

  it("keeps a report it could not deliver owed, and the tick's sweep tells it once when delivery comes back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-10T10:00:00Z"));
      const sent: string[] = [];
      let up = false;
      const notify = async (_title: string, message: string) => {
        if (!up) throw new Error("adapter not connected");
        sent.push(message);
      };
      const line = "Done: keep the island quiet. https://github.com/GeorgeGally/flyd/pull/9";
      const finished: ExecutiveDecisionRecord = {
        schema: "flyd.executive-decision.v1", decisionId: "decision-owed", sourceId: "firstmate.change", sourceEventId: "event-owed",
        taskId: "domain-owed-1", disposition: "handle_internally", reason: "finished work, checked: its change is in", summary: line,
        delivery: { line, checked: true, url: "https://github.com/GeorgeGally/flyd/pull/9" }, evidenceRefs: ["domain-owed-1"],
        verification: { status: "verified", evidenceRefs: ["https://github.com/GeorgeGally/flyd/pull/9"] }, show: true, notify: true,
        createdAt: "2026-11-10T10:00:00.000Z",
      };
      const owedRun = (): DomainRun => ({ ...run("Captain, done."), id: "domain-owed-1", owner: "Librarian", transport: { kind: "native", requestId: "domain-owed-1" }, request: { ...run("Captain, done.").request, id: "domain-owed-1", domain: "knowledge" } });
      await notifyRun(owedRun(), notify, undefined, async () => finished);
      expect([sent, readDomainRun("domain-owed-1")?.notified]).toEqual([[], undefined]);
      // The sync loops never come back to a finished run: the sweep every command tick runs is what says it again.
      const say = async (_title: string, message: string) => { await notify("Flyd", message); return "shown" as const; };
      vi.setSystemTime(new Date("2026-11-10T10:06:00Z"));
      await deliverOwed({ say: async () => "undelivered" });
      up = true;
      // The wait doubles: ten minutes after the second try.
      vi.setSystemTime(new Date("2026-11-10T10:17:00Z"));
      await deliverOwed({ say });
      await deliverOwed({ say });
      expect(sent).toEqual([line]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds another project's finished work while he is focused, and tells it once his focus breaks", async () => {
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    const line = "Done: keep the island quiet. https://github.com/GeorgeGally/flyd/pull/9";
    const finished: ExecutiveDecisionRecord = {
      schema: "flyd.executive-decision.v1", decisionId: "decision-held", sourceId: "firstmate.change", sourceEventId: "event-held",
      taskId: "domain-held-1", disposition: "handle_internally", reason: "finished work, checked: its change is in", summary: line,
      delivery: { line, checked: true, url: "https://github.com/GeorgeGally/flyd/pull/9" }, evidenceRefs: ["domain-held-1"],
      verification: { status: "verified", evidenceRefs: ["https://github.com/GeorgeGally/flyd/pull/9"] }, show: true, notify: true,
      createdAt: "2026-11-10T10:00:00.000Z",
    };
    const held: DomainRun = { ...run("Captain, done."), id: "domain-held-1", request: { ...run("Captain, done.").request, id: "domain-held-1", project: { name: "flyd" } } };
    // On Bloom: the flyd change waits for a natural break.
    await notifyRun(held, notify, undefined, async () => finished, () => false, async () => ({ project: "Bloom" }));
    expect([sent, readDomainRun("domain-held-1")?.notified, readDomainRun("domain-held-1")?.told]).toEqual([[], true, undefined]);
    await tellHeld(async () => ({ project: "Bloom" }), notify);
    expect(sent).toEqual([]);
    // He moves to flyd: told now, once, and recorded as told.
    await tellHeld(async () => ({ project: "flyd" }), notify);
    await tellHeld(async () => ({}), notify);
    expect(sent).toEqual([line]);
    expect(readDomainRun("domain-held-1")?.told?.line).toBe(line);
  });

  it("tells an off-focus call to publish, pay or for his key now, and holds ordinary ones", async () => {
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    const ask = (id: string, question: string): [DomainRun, ExecutiveDecisionRecord] => {
      const base = run(JSON.stringify({ status: "needs_decision", brief: question }));
      const request = { ...base.request, id, project: { name: "cap5" }, originalMessage: "Make the cap5 pricing page", intendedOutcome: "Make the cap5 pricing page" };
      return [{ ...base, id, request }, {
        schema: "flyd.executive-decision.v1", decisionId: `decision-${id}`, sourceId: "firstmate.change", sourceEventId: `event-${id}`,
        taskId: id, disposition: "ask_george", reason: "George owns the choice", summary: question, evidenceRefs: [id], question,
        options: ["Yes", "Not yet"], recommendation: { option: "Not yet", rationale: "It can wait for a look." }, verification: { status: "unknown", evidenceRefs: [] }, show: true, notify: true, createdAt: "2026-11-10T10:00:00.000Z",
      }];
    };
    const onBloom = async () => ({ project: "Bloom", meetingEndsAt: Date.now() + 60_000 });
    const calls = [
      ["domain-call-1", "Publish the cap5 website now?"], ["domain-call-2", "Pay the cap5 hosting invoice now?"],
      ["domain-call-3", "Can I have your Stripe API key?"], ["domain-call-9", "Can you send me your 2FA code?"], ["domain-call-4", "Blue or green for the header?"],
      ["domain-call-5", "Should I redesign your login page?"], ["domain-call-6", "Keep your token parser or swap it?"],
      ["domain-call-7", "Refactor the 2FA code module first?"], ["domain-call-8", "Should users sign in to the dashboard with Google?"],
    ];
    for (const [id, question] of calls) {
      const [asked, decided] = ask(id!, question!);
      await notifyRun(asked, notify, undefined, async () => decided, () => false, onBloom);
    }
    expect(sent).toHaveLength(4);
    expect(sent.join(" ")).not.toMatch(/Blue or green|login page|token parser|2FA code module|sign in to the dashboard/);
  });

  it("gates the scheduler's notice on the outgoing review: an implementation call is Flyd's, machinery gives way to the work, and each hold is recorded", async () => {
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    const ask = (id: string, question: string): [DomainRun, ExecutiveDecisionRecord] => {
      const base = run(JSON.stringify({ status: "needs_decision", brief: question }));
      return [{ ...base, id, request: { ...base.request, id } }, {
        schema: "flyd.executive-decision.v1", decisionId: `decision-${id}`, sourceId: "firstmate.change", sourceEventId: `event-${id}`,
        taskId: id, disposition: "ask_george", reason: "George owns the choice", summary: question, evidenceRefs: [id], question,
        options: ["Yes", "Not yet"], recommendation: { option: "Yes", rationale: "It keeps the page moving." }, verification: { status: "unknown", evidenceRefs: [] }, show: true, notify: true, createdAt: "2026-11-10T10:00:00.000Z",
      }];
    };
    const verdicts = () => readFileSync(join(selfReviewDir(), "verdicts.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((line) => JSON.parse(line) as { text: string; held?: boolean; source?: string; shortfalls: Array<{ requirement: string }> });
    const toBoss: Array<{ run: string; body: string }> = [];
    const send: typeof sendRunMessage = async (input) => {
      toBoss.push({ run: input.run.id, body: input.body });
      const at = "2026-11-10T10:01:00.000Z";
      return { delivered: true, run: { ...input.run, messages: [...(input.run.messages ?? []), { id: `${input.run.id}:${input.kind}:1`, kind: input.kind, body: input.body, from: "flyd", at, deliveredAt: at }] } };
    };
    const calls: Array<[string, string]> = [
      ["domain-gate-a", "Tell me whether to lay out the TV page with CSS grid or flexbox."],
      ["domain-gate-b", "Flyd is re-requesting unstructured FirstMate handoffs"],
      ["domain-gate-c", "Tell me whether to add Teletext and Tuning dial buttons."],
      ["domain-gate-d", "Should the button CSS be red or blue?"],
    ];
    for (const [id, question] of calls) {
      const [asked, decided] = ask(id, question);
      await notifyRun(asked, notify, send, async () => decided, () => false, async () => ({}));
    }
    expect(sent).toEqual(["Your call is needed: Fix the island.", "Tell me whether to add Teletext and Tuning dial buttons.", "Should the button CSS be red or blue?"]);
    // The layout method is Flyd's call: the boss is told to make it and report the outcome, so the run carries on.
    expect(toBoss).toEqual([{ run: "domain-gate-a", body: HANDLE_IT_YOURSELF }]);
    expect(verdicts()).toContainEqual(expect.objectContaining({
      text: "Tell me whether to lay out the TV page with CSS grid or flexbox.", source: "domain:domain-gate-a", surface: "notification", held: true,
      shortfalls: expect.arrayContaining([expect.objectContaining({ requirement: "decisions_handled" })]),
    }));
    expect(verdicts()).toContainEqual(expect.objectContaining({ text: expect.stringContaining("FirstMate handoffs"), source: "domain:domain-gate-b", held: true }));
  });

  it("never lets an implementation call go quiet: a failed hand-back is retried, and a boss that insists after it brings the call to George", async () => {
    const question = "Tell me whether to lay out the TV page with CSS grid or flexbox.";
    const decided = (id: string): ExecutiveDecisionRecord => ({
      schema: "flyd.executive-decision.v1", decisionId: `decision-${id}`, sourceId: "firstmate.change", sourceEventId: `event-${id}`,
      taskId: id, disposition: "ask_george", reason: "George owns the choice", summary: question, evidenceRefs: [id], question,
      options: ["Grid", "Flexbox"], recommendation: { option: "Grid", rationale: "It fits the page." }, verification: { status: "unknown", evidenceRefs: [] }, show: true, notify: true, createdAt: "2026-11-10T10:00:00.000Z",
    });
    const asked = (id: string, messages: DomainRun["messages"] = []): DomainRun => {
      const base = run(JSON.stringify({ status: "needs_decision", brief: question }));
      return { ...base, id, request: { ...base.request, id }, messages, report: { state: "due", status: "needs_decision", since: base.updatedAt, at: base.updatedAt } };
    };
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    const toBoss: string[] = [];
    let up = false;
    const send: typeof sendRunMessage = async (input) => {
      if (!up) return { delivered: false, run: input.run };
      toBoss.push(input.body);
      const at = "2026-11-10T10:01:00.000Z";
      return { delivered: true, run: { ...input.run, messages: [...(input.run.messages ?? []), { id: `${input.run.id}:${input.kind}:1`, kind: input.kind, body: input.body, from: "flyd", at, deliveredAt: at }] } };
    };

    // The boss cannot be reached: the report stays due for the next pass, and George is not handed the call.
    saveDomainRun(asked("domain-back-a"));
    await notifyRun(readDomainRun("domain-back-a")!, notify, send, async () => decided("domain-back-a"), () => false, async () => ({}));
    expect([sent, toBoss, readDomainRun("domain-back-a")?.report?.state]).toEqual([[], [], "due"]);
    up = true;
    await notifyRun(readDomainRun("domain-back-a")!, notify, send, async () => decided("domain-back-a"), () => false, async () => ({}));
    expect([sent, toBoss, readDomainRun("domain-back-a")?.report?.state]).toEqual([[], [HANDLE_IT_YOURSELF], "quiet"]);

    // A boss that cannot be reached at all: once every hand-back has failed, the call is brought to him rather than left to go quiet.
    up = false;
    saveDomainRun(asked("domain-back-c"));
    for (let pass = 0; pass < MAX_REVIEW_TRIES; pass++) {
      await notifyRun(readDomainRun("domain-back-c")!, notify, send, async () => decided("domain-back-c"), () => false, async () => ({}));
    }
    expect([sent, readDomainRun("domain-back-c")?.report?.state]).toEqual([[], "due"]);
    await notifyRun(readDomainRun("domain-back-c")!, notify, send, async () => decided("domain-back-c"), () => false, async () => ({}));
    expect(sent).toEqual([question]);
    expect(readDomainRun("domain-back-c")?.report?.state).toBe("shown");
    sent.length = 0;
    up = true;

    // Reviews that failed before one finished are not failed hand-backs: the call still goes to the boss, not to him.
    saveDomainRun(asked("domain-back-d"));
    let failing = MAX_REVIEW_TRIES - 1;
    const flaky = async () => {
      if (failing-- > 0) throw new Error("review timed out");
      return decided("domain-back-d");
    };
    for (let pass = 0; pass < MAX_REVIEW_TRIES; pass++) {
      await notifyRun(readDomainRun("domain-back-d")!, notify, send, flaky, () => false, async () => ({}));
    }
    expect([sent, toBoss, readDomainRun("domain-back-d")?.report?.state]).toEqual([[], [HANDLE_IT_YOURSELF, HANDLE_IT_YOURSELF], "quiet"]);
    toBoss.length = 1;

    // A review that never finishes does not leave his call quiet either: it reaches him, screened like any notice.
    saveDomainRun(asked("domain-back-e"));
    for (let pass = 0; pass < MAX_REVIEW_TRIES; pass++) {
      await notifyRun(readDomainRun("domain-back-e")!, notify, send, async () => { throw new Error("review timed out"); }, () => false, async () => ({}));
    }
    expect(sent).toEqual([question]);
    expect(readDomainRun("domain-back-e")?.report?.state).toBe("shown");
    sent.length = 0;

    // Told to make it itself, the boss says it is his after all: Flyd brings it to him, as its note promised.
    const handedBack = [{ id: "m-back", kind: "decision" as const, body: HANDLE_IT_YOURSELF, from: "flyd" as const, at: "2026-11-10T10:01:00.000Z", deliveredAt: "2026-11-10T10:01:00.000Z" }];
    saveDomainRun(asked("domain-back-b", handedBack));
    await notifyRun(readDomainRun("domain-back-b")!, notify, send, async () => decided("domain-back-b"), () => false, async () => ({}));
    expect(sent).toEqual([question]);
    expect(toBoss).toEqual([HANDLE_IT_YOURSELF]);
  });

  it("quotes only George's own words for a finished run, and says Flyd's stand-ins as the bare fact", async () => {
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    const base = run(JSON.stringify({ status: "completed", brief: "Finished." }));
    const finished = (id: string, request: Partial<DomainRun["request"]>): DomainRun => ({
      ...base, id, request: { ...base.request, id, ...request }, transport: { kind: "firstmate", requestId: id },
    });
    const decide = (item: DomainRun, deliver: Parameters<typeof decideRun>[1]) => decideRun(item, deliver, async () => "{}");
    const closed = () => false;
    // His /review from the window: Flyd wrote the outcome, so it is never quoted as his.
    await notifyRun(finished("desk-review", { source: "view", session: "s", originalMessage: "/review", intendedOutcome: "Run /review as George typed it" }), notify, undefined, decide, closed);
    // His own first line from the window, and his own chat message, are quoted as he said them.
    await notifyRun(finished("desk-own", { source: "view", session: "s", originalMessage: "The footer link is broken", intendedOutcome: "The footer link is broken" }), notify, undefined, decide, closed);
    await notifyRun(finished("chat-own", { source: "chat", originalMessage: "can you make the island quieter\nthanks", intendedOutcome: "Reduce island notifications" }), notify, undefined, decide, closed);
    // An outcome the model wrote with no message of his: the bare fact.
    await notifyRun(finished("chat-model", { source: "chat", originalMessage: "Reduce island notifications", intendedOutcome: "Reduce island notifications" }), notify, undefined, decide, closed);
    // A message sent from an artefact card or a decision: the window's addressing line is not his, the words under it are.
    await notifyRun(finished("chat-card", { source: "chat", originalMessage: "About the artefact \"Logan\"\n\nin liesel settings, let me choose every screen format", intendedOutcome: "Let Liesel's settings toggle every screen format" }), notify, undefined, decide, closed);
    await notifyRun(finished("desk-card", { source: "view", session: "s", originalMessage: "About the artefact \"Map\"\nthe pins are off by a block", intendedOutcome: "About the artefact \"Map\"" }), notify, undefined, decide, closed);
    expect(sent).toEqual([
      "A piece of your work is finished; I haven't checked it yet.",
      "Your request “The footer link is broken” is finished; I haven't checked it yet.",
      "Your request “can you make the island quieter” is finished; I haven't checked it yet.",
      "A piece of your work is finished; I haven't checked it yet.",
      "Your request “in liesel settings, let me choose every screen format” is finished; I haven't checked it yet.",
      "Your request “the pins are off by a block” is finished; I haven't checked it yet.",
    ]);
  });

  it("announces each finished FirstMate run once under its own id, unless its reply already shows in the open conversation", async () => {
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    const line = (id: string) => `Done: ${id}. https://github.com/GeorgeGally/flyd/pull/7`;
    const finished = (taskId: string): ExecutiveDecisionRecord => ({
      schema: "flyd.executive-decision.v1", decisionId: `decision-${taskId}`, sourceId: "firstmate.change", sourceEventId: `event-${taskId}`,
      taskId, disposition: "handle_internally", reason: "finished work", summary: line(taskId),
      delivery: { line: line(taskId), checked: true, url: "https://github.com/GeorgeGally/flyd/pull/7" }, evidenceRefs: [], verification: { status: "verified", evidenceRefs: [] },
      show: true, notify: true, createdAt: "2026-11-10T10:00:00.000Z",
    });
    const base = run(JSON.stringify({ status: "completed", brief: "Merged in https://github.com/GeorgeGally/flyd/pull/7." }));
    const firstmate = (id: string, source: "chat" | "view", session?: string): DomainRun => ({
      ...base, id, request: { ...base.request, id, source, ...(session ? { session } : {}) }, transport: { kind: "firstmate", requestId: id },
    });
    const openOnA = (session: string) => session === "session-a";
    // From chat, and from a window conversation that is not open: each told once, however often it is seen.
    for (const item of [firstmate("domain-chat", "chat"), firstmate("domain-desk-b", "view", "session-b")]) {
      await notifyRun(item, notify, undefined, async () => finished(item.id), openOnA);
      await notifyRun(item, notify, undefined, async () => finished(item.id), openOnA);
    }
    // Its reply already showing under his message in the open conversation: never rung, even once he moves on.
    await notifyRun(firstmate("domain-desk-a", "view", "session-a"), notify, undefined, async () => finished("domain-desk-a"), openOnA);
    await notifyRun(firstmate("domain-desk-a", "view", "session-a"), notify, undefined, async () => finished("domain-desk-a"), () => false);
    expect(sent).toEqual([line("domain-chat"), line("domain-desk-b")]);
    expect(["domain-chat", "domain-desk-b", "domain-desk-a"].map((id) => readDomainRun(id)?.notified)).toEqual([true, true, true]);
  });
  it("reaches George once with a decision, and says nothing for a quiet run", async () => {
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };

    const decision = run(JSON.stringify({ status: "needs_decision", brief: "Merge the sidebar change or hold it?" }));
    const decided: ExecutiveDecisionRecord = {
      schema: "flyd.executive-decision.v1",
      decisionId: "decision-2",
      sourceId: "firstmate.change",
      sourceEventId: "event-2",
      taskId: "domain-notice-1",
      disposition: "ask_george",
      reason: "George owns the choice",
      summary: "The review needs your call.",
      evidenceRefs: ["domain-notice-1"],
      question: "Merge the sidebar change or hold it?",
      options: ["Merge the sidebar change", "Hold it"],
      recommendation: { option: "Hold it", rationale: "The request still has an open requirement." },
      verification: { status: "unknown", evidenceRefs: [] },
      show: true,
      notify: true,
      createdAt: "2026-10-21T00:00:00.000Z",
    };
    await notifyRun(decision, notify, undefined, async () => decided);
    await notifyRun({ ...decision, notified: true }, notify, undefined, async () => decided);
    expect(sent).toEqual(["Merge the sidebar change or hold it?"]);
  });

  it("shows only decisions and notable verified outcomes selected by the executive record", async () => {
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };
    const record = (overrides: Partial<ExecutiveDecisionRecord>): ExecutiveDecisionRecord => {
    const parsed = parseExecutiveDecision({
      schema: "flyd.executive-decision.v1",
      decisionId: "decision-1",
      sourceId: "firstmate.change",
      sourceEventId: "event-1",
      taskId: "domain-notice-1",
      disposition: "backstage",
      reason: "routine state stays backstage",
      summary: "No result to surface.",
      evidenceRefs: ["domain-notice-1"],
      verification: { status: "unknown", evidenceRefs: [] },
      show: false,
      notify: false,
      createdAt: "2026-10-21T00:00:00.000Z",
      ...overrides,
     });
    if (!parsed) throw new Error("Invalid executive fixture");
    return parsed;
  };

    await notifyRun(run("Captain, dark mode is merged."), notify, undefined, async () => record({}));
    await notifyRun(run("The review needs a decision.", "needs_decision"), notify, undefined, async () => record({
      disposition: "ask_george",
      summary: "The review needs your call.",
      question: "Keep the current review or add the missing tools?",
      options: ["Keep the current review", "Add the missing tools"],
      recommendation: { option: "Add the missing tools", rationale: "They remain required by the task." },
      show: true,
      notify: true,
    }));
    await notifyRun(run("The site is live."), notify, undefined, async () => record({
      disposition: "handle_internally",
      summary: "The requested release is verified.",
      verification: { status: "verified", evidenceRefs: ["receipt:release"] },
      show: true,
      notify: true,
    }));

    expect(sent).toEqual([
      "Keep the current review or add the missing tools?",
      "The requested release is verified.",
    ]);
  });

  it("sends a failed run back to its boss, and brings George only his call on it, without the error", async () => {
    const sent: Array<{ message: string; kind?: string }> = [];
    const notify = async (_title: string, message: string, kind?: string) => { sent.push({ message, kind }); };
    const asked: string[] = [];
    const send: Parameters<typeof notifyRun>[2] = async ({ run: failed, kind, body, from }) => {
      asked.push(body);
      const message = { id: "m1", kind, body, at: "2026-10-09T01:00:00.000Z", deliveredAt: "2026-10-09T01:00:00.000Z", ...(from ? { from } : {}) };
      return { delivered: true, run: { ...failed, messages: [...(failed.messages ?? []), message] } };
    };
    const failed = run(JSON.stringify({ status: "failed", brief: "Command failed: npm test exited with code 1" }));

    await notifyRun(failed, notify, send, (item, deliver) => decideRun(item, deliver, async () => JSON.stringify({ kind: "unclear", summary: "The run failed.", evidenceRefs: [] })));
    expect(sent).toEqual([]);
    expect(asked).toHaveLength(1);
    const reopened = readDomainRun("domain-notice-1")!;
    expect(reopened.status).toBe("working");
    expect(reopened.notified).toBeFalsy();

    const blocked: ExecutiveDecisionRecord = {
      schema: "flyd.executive-decision.v1", decisionId: "decision-3", sourceId: "firstmate.change", sourceEventId: "event-3",
      taskId: "domain-notice-1", disposition: "ask_george", reason: "Flyd is out of moves", summary: "The island fix is still failing.",
      evidenceRefs: ["domain-notice-1"], question: "Try the island fix another way or drop it?", options: ["Try another way", "Drop it"],
      recommendation: { option: "Try another way", rationale: "The fix is still wanted." },
      verification: { status: "unknown", evidenceRefs: [] }, show: true, notify: true, createdAt: "2026-10-21T00:00:00.000Z",
    };
    await notifyRun({ ...reopened, status: "failed" }, notify, send, async () => blocked);
    expect(asked).toHaveLength(1);
    expect(sent).toEqual([{ message: "Try the island fix another way or drop it?", kind: "decision" }]);
    expect(readDomainRun("domain-notice-1")?.notified).toBe(true);
  });
});

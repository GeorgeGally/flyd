import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selfReviewDir } from "../../council/reply-review.js";
import { captainNotice, isRoutineChatter } from "../notice.js";
import { parseDomainResult } from "../result.js";
import { notifyRun } from "../scheduler.js";
import { readDomainRun } from "../store.js";
import type { DomainRun, DomainRunStatus } from "../types.js";

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
    expect(captainNotice(run("The worker finished: dark mode is merged."))).toBe("The worker finished: dark mode is merged.");
    expect(captainNotice(run("Captain, the status line now shows plan limits.")))
      .toBe("The status line now shows plan limits.");
    expect(captainNotice(run("Captain, the conversation pane wraps long lines again; the worker added a test.")))
      .toBe("The conversation pane wraps long lines again; the worker added a test.");
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
      .toBe("I need your decision: Merge PR 68 or hold it?");
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

  it("keeps a completion that only carries a commit id, but rewrites branch mentions", () => {
    expect(captainNotice(run("The sidebar fix is merged at a1b2c3d."))).toBe("The sidebar fix is merged.");
    expect(captainNotice(run("Merged the branch and deployed."))).toBe('There is news on "Fix the island". Ask Flyd for the details.');
    expect(captainNotice(run("Done and live: https://github.com/GeorgeGally/flyd/commit/c170683"))).toBe("Done and live: https://github.com/GeorgeGally/flyd/commit/c170683");
    expect(verdicts()).toContainEqual(expect.objectContaining({ text: "Merged the branch and deployed.", surface: "notification", held: true }));
  });

  it("brings a decision or failure that names backstage as a line naming the work, and records it", () => {
    const decision = captainNotice(run(JSON.stringify({ status: "needs_decision", brief: "Firstmate needs your call on a composer idle-row guard." })));
    expect(decision).toBe('I need your decision on "Fix the island".');
    const failure = captainNotice(run(JSON.stringify({ status: "failed", brief: "the branch fm/x is broken" })));
    expect(failure).toBe("Fix the island is blocked: it couldn't be finished. Tell me whether to try another way or drop it.");
    expect(verdicts()).toContainEqual(expect.objectContaining({ text: "I need your decision: Firstmate needs your call on a composer idle-row guard.", surface: "notification", held: true }));
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

    await notifyRun(run("Captain, shipshape."), notify);
    expect(sent).toEqual([]);
    expect(readDomainRun("domain-notice-1")?.notified).toBe(true);

    const outcome = run("Captain, dark mode is merged.");
    await notifyRun(outcome, notify);
    await notifyRun({ ...outcome, notified: true }, notify);
    expect(sent).toEqual(["Dark mode is merged."]);
  });

  it("reaches George once with a decision, and says nothing for a quiet run", async () => {
    const sent: string[] = [];
    const notify = async (_title: string, message: string) => { sent.push(message); };

    const decision = run(JSON.stringify({ status: "needs_decision", brief: "Merge the sidebar change or hold it?" }));
    await notifyRun(decision, notify);
    await notifyRun({ ...decision, notified: true }, notify);
    expect(sent).toEqual(["I need your decision: Merge the sidebar change or hold it?"]);
  });

  it("sends a failed run back to its boss once, and only then tells George it is blocked, without the error", async () => {
    const sent: Array<{ message: string; kind?: string }> = [];
    const notify = async (_title: string, message: string, kind?: string) => { sent.push({ message, kind }); };
    const asked: string[] = [];
    const send: Parameters<typeof notifyRun>[2] = async ({ run: failed, kind, body, from }) => {
      asked.push(body);
      const message = { id: "m1", kind, body, at: "2026-10-09T01:00:00.000Z", deliveredAt: "2026-10-09T01:00:00.000Z", ...(from ? { from } : {}) };
      return { delivered: true, run: { ...failed, messages: [...(failed.messages ?? []), message] } };
    };
    const failed = run(JSON.stringify({ status: "failed", brief: "Command failed: npm test exited with code 1" }));

    await notifyRun(failed, notify, send);
    expect(sent).toEqual([]);
    expect(asked).toHaveLength(1);
    const reopened = readDomainRun("domain-notice-1")!;
    expect(reopened.status).toBe("working");
    expect(reopened.notified).toBeFalsy();

    await notifyRun({ ...reopened, status: "failed" }, notify, send);
    expect(asked).toHaveLength(1);
    expect(sent).toEqual([{ message: "Fix the island is blocked: I sent it back once and it failed again. Tell me whether to try another way or drop it.", kind: "blocker" }]);
    expect(readDomainRun("domain-notice-1")?.notified).toBe(true);
  });
});

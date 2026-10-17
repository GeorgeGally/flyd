import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(captainNotice(run(JSON.stringify({ status: "failed", brief: "the build is broken on main" }))))
      .toBe("Work hit a problem: The build is broken on main");
  });

  it("says nothing for unsettled runs", () => {
    expect(captainNotice(run("Dark mode is merged.", "working"))).toBeNull();
    expect(captainNotice({ ...run("x"), result: undefined })).toBeNull();
  });
});

describe("notices keep the one voice", () => {
  const BACKSTAGE = /firstmate|crew ?mates?|crewmember|Jev|Librarian|Critic|Strategist|Muse|Scout|council|task id|run id|branch|worktree|pipeline|fm\//i;

  it("never lets a backstage term reach George, keeping the counts", () => {
    const cases: Array<[string, string | null]> = [
      ["Firstmate has not read 3 notes you sent.", "3 notes"],
      ["Firstmate has not read 2 notes you sent; the oldest has waited 57 min.", "57 min"],
      ["Firstmate has not read 13 notes you sent; the oldest has waited 1 h 4 min.", "1 h 4 min"],
      ["Firstmate has not read 1 note you sent 4 min ago.", "1 note"],
      ["The crewmate finished 2 jobs.", "2 jobs"],
      ["Jev reviewed 4 requests.", "4 requests"],
      ["The Council reviewed 6 items.", "6 items"],
      ["Council reviewed 6 items.", "6 items"],
      ["The Librarian curated 12 memories.", "12 memories"],
      ["The Librarians curated 12 memories.", "12 memories"],
      ["The Critic advised on 2 plans.", "2 plans"],
      ["The Strategist dismissed 3 ideas.", "3 ideas"],
      ["The Muse offered 5 notes.", "5 notes"],
      ["The Muses offered 5 notes.", "5 notes"],
      ["The Scout surfaced 4 stories.", "4 stories"],
      ["Merged the fix on fm/island-filter; the island is quiet.", null],
      ["Task id task-9 is stuck.", null],
      ["Run id run-9 is stuck.", null],
      ["Merged the fix on the branch fm/x; 3 tests added.", "3 tests"],
      ["Fixed it in the worktree; 2 files changed.", "2 files"],
      ["The pipeline ran 5 checks.", "5 checks"],
    ];
    for (const [reply, kept] of cases) {
      const notice = captainNotice(run(reply));
      expect(notice, reply).toBeTruthy();
      expect(notice!.trim(), reply).not.toBe("");
      expect(notice!, reply).not.toMatch(BACKSTAGE);
      if (kept) expect(notice!, reply).toContain(kept);
    }
  });

  it("fails a notice that names machinery closed to a neutral outcome line", () => {
    expect(captainNotice(run("Checked by 2 Firstmates."))).toBe("There is an update on your work.");
  });

  it("scrubs decisions and failures too, keeping them readable as a decision or a problem", () => {
    const decision = captainNotice(run(JSON.stringify({ status: "needs_decision", brief: "Firstmate asks: merge the branch fm/x or hold?" })));
    expect(decision).toBe("I need your decision: There is an update on your work.");
    const failure = captainNotice(run(JSON.stringify({ status: "failed", brief: "the branch fm/x is broken" })));
    expect(failure).toBe("Work hit a problem: There is an update on your work.");
  });

  it("never renders a fragment or an empty notice", () => {
    expect(captainNotice(run("The fix is on fm/island-filter."))).toBe("There is an update on your work.");
    expect(captainNotice(run("fm/x"))).toBe("There is an update on your work.");
    expect(captainNotice(run("the worktree is dirty; 2 files changed"))).toBe("Update — 2 files.");
    expect(captainNotice(run("Firstmate has not read 3 notes you sent."))).toBe("Update — 3 notes.");
    expect(captainNotice(run("Merged the branch and deployed."))).toBe("There is an update on your work.");
    expect(captainNotice(run("Dispatched a crewmate to fix the layout and pushed."))).toBe("There is an update on your work.");
    expect(captainNotice(run("Firstmate merged the island filter."))).toBe("There is an update on your work.");
    expect(captainNotice(run("Ready for review on the branch feature/dark-mode — 7 files changed."))).toBe("Update — 7 files.");
  });

  it("keeps counts whole and never mines a number out of a hash, id, clock or date", () => {
    const cases: Array<[string, string]> = [
      ["Fixed it in commit 0a1b2c3d.", "There is an update on your work."],
      ["Merged the branch at 14:00.", "There is an update on your work."],
      ["The worktree holds 2026-10-12 notes.", "There is an update on your work."],
      ["Task id task-9 is stuck.", "There is an update on your work."],
      ["Firstmate checked 4 tests 2 failed.", "Update — 4 tests."],
      ["Firstmate: 4 jobs 2 failed.", "Update — 4 jobs."],
      ["Firstmate sent 3 notes 2026 pending.", "Update — 3 notes."],
    ];
    for (const [reply, expected] of cases) {
      expect(captainNotice(run(reply)), reply).toBe(expected);
    }
    expect(captainNotice(run("The worktree holds 2 files."))).toBe("Update — 2 files.");
    expect(captainNotice(run("Firstmate has not read 2 notes you sent; the oldest has waited 57 min.")))
      .toBe("Update — 2 notes, 57 min.");
    const counted: Array<[string, string]> = [
      ["Firstmate finished 2/3 jobs.", "Update — 2/3 jobs."],
      ["The crewmate worked 2-3 hours on the island fix.", "Update — 2-3 hours."],
      ["Firstmate: 3/4 tests pass.", "Update — 3/4 tests."],
      ["Firstmate waited 1.5 h.", "Update — 1.5 h."],
    ];
    for (const [reply, expected] of counted) {
      expect(captainNotice(run(reply)), reply).toBe(expected);
    }
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
});

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

  it("scrubs every backstage term on every notice path, keeping the outcome", () => {
    const cases: Array<[string, string]> = [
      ["Firstmate has not read 3 notes you sent.", "3 notes"],
      ["Firstmate has not read 13 notes you sent; the oldest has waited 1 h 4 min.", "1 h 4 min"],
      ["Firstmate has not read 1 note you sent 4 min ago.", "1 note"],
      ["The crewmate finished 2 jobs.", "2 jobs"],
      ["Jev reviewed 4 requests.", "4 requests"],
      ["The Council reviewed 6 items.", "6 items"],
      ["The Librarian curated 12 memories.", "12 memories"],
      ["The Librarians curated 12 memories.", "12 memories"],
      ["The Critic advised on 2 plans.", "2 plans"],
      ["The Strategist dismissed 3 ideas.", "3 ideas"],
      ["The Muse offered 5 notes.", "5 notes"],
      ["The Muses offered 5 notes.", "5 notes"],
      ["The Scout surfaced 4 stories.", "4 stories"],
      ["Merged the fix on fm/island-filter; the island is quiet.", "island is quiet"],
      ["Task id task-9 is stuck.", "work is stuck"],
      ["Run id run-9 is stuck.", "work is stuck"],
      ["Merged the fix on the branch fm/x; 3 tests added.", "3 tests"],
      ["Fixed it in the worktree; 2 files changed.", "2 files"],
      ["The pipeline ran 5 checks.", "5 checks"],
    ];
    for (const [reply, kept] of cases) {
      const notice = captainNotice(run(reply));
      expect(notice, reply).toBeTruthy();
      expect(notice!, reply).not.toMatch(BACKSTAGE);
      expect(notice!, reply).toContain(kept);
    }
  });

  it("fails a notice that cannot be rephrased closed to a neutral outcome line", () => {
    const notice = captainNotice(run("Checked by 2 Firstmates."));
    expect(notice).not.toBeNull();
    expect(notice!).not.toMatch(BACKSTAGE);
    expect(notice!).not.toContain("Firstmate");
    expect(notice!).toContain("2");
  });

  it("scrubs decisions and failures too, not only completions", () => {
    const decision = captainNotice(run(JSON.stringify({ status: "needs_decision", brief: "Firstmate asks: merge the branch fm/x or hold?" })));
    expect(decision).not.toBeNull();
    expect(decision!).not.toMatch(BACKSTAGE);
    expect(decision!).toContain("decision");
    const failure = captainNotice(run(JSON.stringify({ status: "failed", brief: "the branch fm/x is broken" })));
    expect(failure).not.toBeNull();
    expect(failure!).not.toMatch(BACKSTAGE);
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

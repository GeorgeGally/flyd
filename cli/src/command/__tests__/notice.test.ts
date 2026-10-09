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

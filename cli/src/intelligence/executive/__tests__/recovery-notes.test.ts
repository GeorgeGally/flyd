import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstmateInbox, stoppedEvidence } from "../../../conversation-view/firstmate-inbox.js";
import { IntelligenceEventStore } from "../../event-store.js";
import { authorityForStaffRun, processFirstmateChange, type FirstmateChange, type FirstmateDecisionOptions } from "../firstmate-decision.js";

// The three "recover it" notes Flyd sent firstmate on 14 Nov 2026 (19:51 and 19:54 local) about workers
// firstmate had stopped on purpose, superseded or seen finish. Each fixture is firstmate's record as it stood
// when the note went: the task's status file and backlog row, and the fleet row bearings reported for it.
const NOTES = [
  {
    task: "capfive-dashboard-lab-3",
    doing: "backend target gone: default:w10:p2",
    backlog: "- [ ] capfive-dashboard-lab-3 - CapFive: dashboard lab round 3 - five genuinely different ideas (repo: capfive) (kind: scout) (since 2026-10-28)\n",
    status: [
      "needs-decision [at=1793173581] [key=board-review]: All five dashboard concepts are ready for review",
      "resolved [key=board-review] [at=1793173849]: answered: Closed: round 3 is superseded by the reference-based Opus lab (capfive-dashboard-ref-lab); the captain will judge the dashboard there. No more work needed",
    ],
  },
  {
    task: "flyd-picture-desk",
    doing: "backend target gone: default:wA6:p2",
    backlog: "- [ ] flyd-picture-desk - Flyd: build the Picture desk live view (one page, scrolling content, fixed bottom) after fixes land (kind: ship) (since 2026-11-07)\n",
    status: [
      "paused [at=1794021743]: committed Picture desk held before PR pending redesign direction",
      "needs-decision [at=1794145771]: Picture desk conflicts with Shipping Flyd today: section 8 excludes the Picture desk frame; this commit makes it the front page with a fixed Live work/Conversation bottom nav, while Today specifies a centre event feed, header Today/News tabs and right-column Jobs cards. Stopping per redesign steer.",
    ],
  },
  {
    // Firstmate stopped this worker after its done line and wrote its own "stopped on purpose" line 20 minutes
    // after Flyd's note: the worker's own done line is what stood at 19:54.
    task: "dir-about-headline-jump",
    doing: "harness state unavailable (unknown missing)",
    backlog: "- [ ] dir-about-headline-jump - DIR About page: no jump between 2- and 3-line headlines (repo: dead-internet-radio) (kind: ship) (since 2026-11-14)\n",
    status: [
      "working [at=1794656525]: setup done on fm/dir-about-headline-jump; reproducing headline jump",
      "done [at=1794656901]: About text below headline now starts at same height on all 3 pages at every width; commit d288ad7",
    ],
  },
];

let dir: string;
let home: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-recovery-notes-"));
  home = join(dir, "firstmate");
  mkdirSync(join(home, "state"), { recursive: true });
  mkdirSync(join(home, "data"), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The fleet row as decideChanges prepares it in the view: firstmate's stop evidence, and authority only for live work. */
function prepared(inbox: FirstmateInbox, task: string, doing: string): FirstmateChange {
  const stopped = inbox.taskStopped(task);
  const authority = authorityForStaffRun({ runId: task, firstmate: true, active: stopped.length === 0 && !inbox.taskClosed(task), autonomy: "trusted" });
  return {
    eventId: task, taskId: task, kind: "fleet_state", state: "unknown", label: task, detail: doing, evidenceRefs: [`firstmate-task:${task}`],
    ...(stopped.length ? { stopped } : {}), ...(authority.length ? { authority } : {}),
  };
}

/** The interpreter proposes a status check and Jev confirms it: the strongest case for sending a note. */
function options(store: IntelligenceEventStore, task: string, executeInternalAction: NonNullable<FirstmateDecisionOptions["executeInternalAction"]>) {
  return {
    store,
    complete: vi.fn(async () => JSON.stringify({ kind: "internal_action", summary: "Check where it stands.", action: { kind: "request_status", target: task, evidence: task }, evidenceRefs: [`firstmate-task:${task}`] })),
    executeInternalAction,
    jev: { apiKey: "test", fetchFn: async () => new Response(JSON.stringify({ answers: { executive_change_route: { type: "choice", choice: "handle_internally", confidence: 0.95, probabilities: { handle_internally: 0.95 } } } }), { status: 200 }) },
  };
}

describe("recovery notes for work firstmate stopped on purpose", () => {
  for (const note of NOTES) {
    it(`sends no recovery note for ${note.task}, as on 14 Nov`, async () => {
      writeFileSync(join(home, "state", `${note.task}.status`), `${note.status.join("\n")}\n`);
      writeFileSync(join(home, "data", "backlog.md"), `# Backlog\n\n## In flight\n${note.backlog}`);
      const inbox = new FirstmateInbox({ home, script: join(home, "missing.sh") });
      expect(inbox.taskStopped(note.task)).not.toEqual([]);

      const store = new IntelligenceEventStore({ path: join(dir, "events.sqlite") });
      const execute = vi.fn(async () => ({ status: "verified" as const, evidenceRefs: ["firstmate-note:sent"] }));
      const opts = options(store, note.task, execute);
      const decision = await processFirstmateChange(prepared(inbox, note.task, note.doing), opts);
      store.close();
      expect(decision).toMatchObject({ disposition: "backstage", show: false, notify: false });
      expect(decision).not.toHaveProperty("action");
      expect(opts.complete).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    });
  }

  it("never turns an unconfirmed status check on a gone worker into a recovery note", async () => {
    writeFileSync(join(home, "state", "gnm-7.status"), "working [at=1794656525]: building the page\n");
    const inbox = new FirstmateInbox({ home, script: join(home, "missing.sh") });
    expect(inbox.taskStopped("gnm-7")).toEqual([]);
    const store = new IntelligenceEventStore({ path: join(dir, "events.sqlite") });
    const execute = vi.fn(async () => ({ status: "verified" as const, evidenceRefs: ["firstmate-note:sent"] }));
    // Jev is off: nothing confirms the status request.
    const { jev: _jev, ...withoutJev } = options(store, "gnm-7", execute);
    const decision = await processFirstmateChange(prepared(inbox, "gnm-7", "backend target gone: default:w1:p2"), withoutJev);
    store.close();
    expect(decision).toMatchObject({ disposition: "backstage", reason: "the status request was not confirmed; it stays backstage" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("reads a stop, a supersession or a finish only from the task's own record or the task that replaced it", () => {
    expect(stoppedEvidence("dir-about-headline-jump", { status: "paused [at=1794658428]: stopped on purpose by firstmate (wrong target; captain meant Flyd Week). no worker needed.\n" }))
      .toEqual(["firstmate-status-stopped:dir-about-headline-jump"]);
    expect(stoppedEvidence("flyd-picture-desk", { backlog: `- [ ] flyd-picture-desk - Flyd: Picture desk (hold: fm-hold-v1:${Buffer.from("Picture desk not shipping; worker stopped on purpose").toString("base64")}) (kind: ship)\n` }))
      .toEqual(["firstmate-backlog-stopped:flyd-picture-desk"]);
    expect(stoppedEvidence("dir-dither-filter", { archive: "- [x] dir-dither-filter-land - DIR: land the dither filter\n  Carries commit 3e8cd32 forward. Supersedes dir-dither-filter.\n" }))
      .toEqual(["firstmate-superseded:dir-dither-filter"]);
    // Round 3 replaced an earlier choice; nothing replaced round 3.
    expect(stoppedEvidence("capfive-dashboard-lab-3", { backlog: "- [ ] capfive-dashboard-lab-2 - CapFive: round 2\n  2026-10-28: superseded. round 3 (capfive-dashboard-lab-3) replaces this choice.\n" })).toEqual([]);
    // Another task's id that merely starts with this one is not this task.
    expect(stoppedEvidence("dir-ident-rotation", { archive: "Supersedes dir-ident-rotation-live." })).toEqual([]);
    // A worker that is gone with no word of a stop is still recoverable work.
    expect(stoppedEvidence("gnm-7", { status: "working [at=1]: building\nblocked [at=2]: tests red\n" })).toEqual([]);
  });
});

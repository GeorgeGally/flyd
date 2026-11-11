import type { DeliveryShape } from "../../runtime/delivery.js";
import type { BriefDecisions, DomainId } from "../types.js";

// The Chief of Staff's own records (split plan "Contracts"; behind FLYD_COS=1).

/** A run that didn't finish is a wait on George (`needs_george`, `retry`), never a terminal state of its own. */
export type ObjectiveStatus = "intake" | "working" | "needs_george" | "done" | "cancelled";

/** One run intake plans: a team's brief, and the runs (by key) it waits on. */
export interface RunBrief {
  /** "r1", "r2", …: the run's key in its objective; its first request id is `<objective>-<key>`. */
  key: string;
  team: DomainId;
  outcome: string;
  doneWhen: string[];
  project?: { name?: string; root?: string };
  after: string[];
}

/** What intake decided: the team, the brief it writes them, and the decisions field. */
export interface CosBrief {
  /** The final run's team (the only one, for one-team work). */
  team: DomainId;
  /** The objective's own outcome and done_when: what acceptance checks the finished work against. */
  outcome: string;
  doneWhen: string[];
  project?: { name?: string; root?: string };
  decisions: BriefDecisions;
  /** Work that needs more than one team: the runs known now, in plan order. Absent for one-team work (one run). */
  runs?: RunBrief[];
}

/**
 * Where a planned run stands. `dispatching` is written before the executor is called, so a restart reconciles it by
 * request id rather than sending it twice; `unknown` is one its executor could not answer for: it is never re-sent on its
 * own, each pass looks again, and past `UNCONFIRMED_MS` it becomes George's call (send it again, or drop it).
 */
export type PlannedRunState = "queued" | "dispatching" | "dispatched" | "unknown" | "completed" | "failed" | "dropped" | "cancelled";

/** A run of an objective's plan (v8 Phase 6), kept on the objective. */
export interface PlannedRun extends Omit<RunBrief, "after"> {
  state: PlannedRunState;
  /** Dispatches so far; attempt n > 1 goes out as `<objective>-<key>-<n>`, so a re-run is never replayed as the old one. */
  attempt: number;
  /** The executor's record once dispatched: a DomainRun id, or "job:<id>" / "crew:<id>". */
  ref?: string;
  dispatching?: { pid: number; at: string };
  /** The brief as dispatched (a join's synthesis, a correction, the failure it is re-briefed with), kept for replay. */
  sent?: string;
  /** The objective's `briefRevision` this run's result holds for; an older one is kept and never delivered. */
  validFor: number;
  /** Earlier results it was re-run over, attached as prior work. */
  prior?: string[];
  /** Why its last attempt failed, carried into its one re-brief. */
  failure?: string;
  /** Its one alternative is used. */
  adapted?: boolean;
  /** The settled result already reviewed (`<ref>:<status>:<updatedAt>`), so each result is reviewed and told once. */
  reviewed?: string;
  /** Left mid-dispatch by a pass that died, and asked again by its request id. */
  reconciled?: boolean;
  /** Its team reported a second result after the first was kept; the first stands. */
  reportedTwice?: boolean;
  /** When it was left `unknown`, so the wait to confirm it is bounded. */
  unknownAt?: string;
}

/** One adaptation the Chief of Staff made on its own, with why, so `work_status` can explain it. */
export interface Adaptation {
  run: string;
  at: string;
  action: "rebrief" | "cancel" | "add" | "drop";
  reason: string;
}

export interface Objective {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  origin: { surface: "chat" | "view" | "agenda" | "live"; sessionId?: string; turnId?: string };
  /** George's exact words; never rewritten. */
  words: string;
  /** What Flyd knew and judged at handoff (project, people, taste, urgency). */
  flydNotes: string;
  contextRefs: string[];
  urgency?: "now" | "today" | "whenever";
  /** The project Flyd was in when he asked, a hint for intake. */
  project?: { name?: string; root?: string };
  /** He asked in Flyd's general chat, not a project's: the work is for a project only if his words name one. */
  general?: boolean;
  status: ObjectiveStatus;
  /** Set once intake has decided; a restart dispatches it again by the same request id instead of asking again. */
  brief?: CosBrief;
  /** DomainRun ids, or "job:<id>" / "crew:<id>" for background jobs and the compatibility crew, as dispatched. */
  runs: string[];
  /** The plan (v8 Phase 6): absent until intake has briefed it. */
  plan?: PlannedRun[];
  /** Each planned run's dependencies, by key, inside this objective. */
  after?: Record<string, string[]>;
  /** The revision of what he asked for: bumped by each correction (`revision` counts every write). */
  briefRevision?: number;
  /** His corrections, in order, with the run each one targeted. */
  corrections?: Array<{ revision: number; run: string; text: string; at: string }>;
  adaptations?: Adaptation[];
  /** What it waits on George for, once asked (v8 Phase 7): every wait carries a question, and his reply resumes it. */
  waitingOn?: Waiting;
  /** He set the wait aside until then: nothing is raised again before, and the rest of the work carries on. */
  snooze?: { until: string; reportId?: string; at: string };
  /** When anything last moved: a run sent or settled, his reply. */
  progressAt?: string;
  /** What the Chief of Staff chose each time it went quiet for a day, with why. */
  triage?: Array<{ at: string; choice: "nudge" | "park" | "ongoing" | "asked"; reason: string }>;
  /** Waiting on something outside Flyd's control: never chased. */
  parked?: { at: string; reason: string };
  /** Meant to run continuously: never treated as stuck. */
  ongoing?: boolean;
  /** He took a result that fell short as it is (its finals' reviewed keys): delivered without another check. */
  takenAsIs?: string;
  reportIds: string[];
  /** Intake taken by a process, so two ticks never brief it twice; a claim older than the lease is taken over. */
  claim?: { pid: number; at: string };
}

/**
 * What a wait is for, so his reply resumes the right thing. Each kind takes its own answers (`WAIT_ANSWERS`):
 * - `intake`: work that couldn't start; any words, briefed again with them.
 * - `run`: a run's own call; passed to that run.
 * - `question`: a wait raised with nothing asked yet; any words, passed to the run that asks, if any.
 * - `retry`: a run that didn't finish; try another way (with his words) or drop it.
 * - `accept`: a result that fell short of done; take it as it is, or try another way.
 * - `stuck`: work gone quiet; nudge it, park it, or it's ongoing.
 * - `unconfirmed`: a run whose hand-over was never confirmed; send it again, or drop it.
 */
export type WaitKind = "run" | "retry" | "accept" | "intake" | "stuck" | "question" | "unconfirmed";

/** The options each wait offers; an empty list takes his words as they are. */
export const WAIT_ANSWERS: Record<WaitKind, readonly string[]> = {
  intake: [],
  run: [],
  question: [],
  retry: ["Try another way", "Drop it"],
  accept: ["Take it as it is", "Try another way"],
  stuck: ["Nudge", "Park it", "It's ongoing"],
  unconfirmed: ["Send it again", "Drop it"],
};

export interface Waiting {
  reportId: string;
  kind: WaitKind;
  question: string;
  options?: string[];
  at: string;
}

export type CosReportKind = "done" | "decision" | "blocked" | "credential" | "irreversible";

export interface CosReport {
  id: string;
  objectiveId: string;
  kind: CosReportKind;
  /** L0: one line, outcome first. */
  outcome: string;
  /** L1: what matters and why. */
  detail: string;
  recommendation?: string;
  options?: string[];
  /** L2: DomainResult, artefacts, screenshots. */
  evidenceRefs: string[];
  shape: DeliveryShape;
  artefacts: string[];
  urgency: "now" | "today" | "whenever";
}

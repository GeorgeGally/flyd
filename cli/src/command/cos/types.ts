import type { DeliveryShape } from "../../runtime/delivery.js";
import type { BriefDecisions, DomainId } from "../types.js";

// The Chief of Staff's own records (split plan "Contracts"; behind FLYD_COS=1).

export type ObjectiveStatus = "intake" | "working" | "needs_george" | "done" | "failed" | "cancelled";

/** What intake decided: the team, the brief it writes them, and the decisions field. */
export interface CosBrief {
  team: DomainId;
  outcome: string;
  doneWhen: string[];
  project?: { name?: string; root?: string };
  decisions: BriefDecisions;
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
  status: ObjectiveStatus;
  /** Set once intake has decided; a restart dispatches it again by the same request id instead of asking again. */
  brief?: CosBrief;
  /** DomainRun ids, or "job:<id>" / "crew:<id>" for background jobs and the compatibility crew, in plan order. */
  runs: string[];
  after?: Record<string, string[]>;
  reportIds: string[];
  /** Intake taken by a process, so two ticks never brief it twice; a claim older than the lease is taken over. */
  claim?: { pid: number; at: string };
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

/** Local mirror of EvidenceItem — do not widen overlay EvidenceItem unions. */
export type HypothesisEvidenceSource =
  | "repository"
  | "conversation"
  | "user_correction"
  | "task"
  | "foreground";

export interface HypothesisEvidenceItem<T> {
  value: T;
  source: HypothesisEvidenceSource;
  confidence: "high" | "medium" | "low";
  provenance: string;
  sourceTimestamp: string;
  isHypothesis: boolean;
}

export interface WorkThread {
  root: string;
  name: string;
  repositoryId?: string;
  lastCommitAt?: string;
  latestSubject?: string;
  isDirty: boolean;
  hasTasks: boolean;
  isForeground: boolean;
  signals: string[];
  demoted: boolean;
}


export interface WorkHypothesis {
  id: string;
  /** Human-readable projection for startup/chat. */
  hypothesisText: string;
  primaryThreads: WorkThread[];
  secondaryThreads: WorkThread[];
  objective?: HypothesisEvidenceItem<string>;
  confidence: "high" | "medium" | "low";
  uncertainty: { field: string; reason: string }[];
  evidenceRefs: string[];
  /** Project names hard-demoted until reaffirm. */
  demotions: string[];
  /** Derived insight layer — workstreams vs moves vs tensions. */
  insights?: PresentInsights;
  revisedAt: string;
  generatedAt: string;
  fromCache: boolean;
}

export interface PresentInsights {
  workstreams: string[];
  latestMoves: { name: string; subject: string; at?: string }[];
  tensions: string[];
  stalledThreads: string[];
  finishedProjects: string[];
  nextTodo?: string;
  nextDueAt?: string;
  nextLeverage?: string;
}

export interface HypothesisCorrection {
  id: string;
  hypothesisId?: string;
  kind: "demote" | "promote" | "exclude" | "reaffirm";
  projectName?: string;
  projectRoot?: string;
  text: string;
  createdAt: string;
}

export interface CandidateRepoInput {
  id: string;
  name: string;
  root: string;
  /** Live git last commit ISO time, preferred. */
  lastCommitAt?: string;
  latestSubject?: string;
  isDirty: boolean;
  hasTasks: boolean;
  isForeground: boolean;
  /** Common git dir for worktree dedupe. */
  gitCommonDir?: string;
}

/** Days: dirty support only when last commit is within this window. */
export const RECENT_COMMIT_DAYS = 14;

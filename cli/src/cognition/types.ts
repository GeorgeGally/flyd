import type { DerivedClaim } from "../intelligence/world/world-model.js";
import type { WorldRelation } from "../intelligence/world/types.js";

export type IntentKind =
  | "question"
  | "current_state"
  | "historical_recall"
  | "task_resume"
  | "action"
  | "correction"
  | "conversation";

export interface IntentInterpretation {
  intentKind: IntentKind;
  entities: string[];
  projectIds: string[];
  referents: string[];
  temporalFrame: "past" | "present" | "future" | "mixed";
  needsCurrentState: boolean;
  needsDeepMemory: boolean;
  needsExternalEvidence: boolean;
  requestedAction?: string;
  source: "jev" | "deterministic";
  confidence: number;
  systemOne?: { model?: string; predicates: Record<string, number>; latencyMs: number; error?: string };
}

export interface ConversationState {
  topic?: string;
  goal?: string;
  entities: string[];
  referents: Record<string, string>;
  decisions: string[];
  unresolved: string[];
  artifacts: string[];
  recap: string;
}

export interface PresentState {
  generatedAt: string;
  projection?: string;
  foregroundProject?: string;
  activeProjects: string[];
  dirtyRepos: Array<{ root: string; branch?: string; changed: string[] }>;
  recentRepoMovement: Array<{ project: string; subject: string; at?: string }>;
  unfinishedTasks: string[];
  openDecisions: string[];
  waitingOn: string[];
  upcoming: string[];
  recentlyCompleted: string[];
  activeWorkers: string[];
  sourceRefs: string[];
  gaps: string[];
}

export interface UnifiedMemoryResult {
  current: DerivedClaim[];
  relevant: Array<{
    id: string;
    content: string;
    source: string;
    relevance: number;
    epistemicStatus: string;
    freshness: number;
    temporalStatus: string;
  }>;
  historical: DerivedClaim[];
  conflicts: Array<{ entityId: string; attribute: string; claims: string[] }>;
  gaps: string[];
  relations: WorldRelation[];
  systemOne?: { model?: string; predicates: Record<string, number>; latencyMs: number; error?: string };
}

export interface CompiledContext {
  generatedAt: string;
  interpretation: IntentInterpretation;
  user: {
    profile: string;
    autonomy: string[];
    communication: string[];
  };
  present: PresentState;
  projects: Array<{ id: string; projection: string }>;
  conversation: ConversationState;
  memory: UnifiedMemoryResult;
  environment: {
    app?: string;
    documentPath?: string;
    projectRoot?: string;
    repository?: { root: string; branch?: string; dirty?: boolean };
  };
  capabilities: string[];
  trace: {
    sources: string[];
    timings: Record<string, number>;
    omissions: string[];
    jev?: { model?: string; predicates: Record<string, number>; latencyMs?: number; error?: string };
  };
}

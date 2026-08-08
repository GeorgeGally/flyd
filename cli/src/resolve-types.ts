import type { ConsequenceAssessment, HandoffReport } from "./verification-types.js";
import type { Diagnosis, Intervention, ActionProposal, CurrentWork, EvidenceSummary } from "./work-intelligence/types.js";

export interface NativeOperation {
  target: string;
  kind: "insert_text" | "replace_text" | "replace_selection";
  text: string;
}

export interface AugmentOperation {
  kind: "explanation" | "choice" | "annotation" | "control" | "execution" | "task_plan";
  content: string;
  placement: "beside_selection" | "below_element" | "cursor";
  options?: string[];
  commands?: { command: string; workingDirectory?: string; explanation: string; isDestructive?: boolean }[];
  fileOperations?: { kind: string; path: string; pattern?: string; explanation: string }[];
  taskPlan?: Record<string, unknown>;
  temporalSpan?: {
    delayMs: number;
    durationMs: number;
  };
}

export type ResolutionMode = "native" | "requires_augment" | "requires_compose" | "requires_execution" | "requires_task";

export interface Resolution {
  resolutionId: string;
  invocationId: string;
  environmentRevision: number;
  mode: ResolutionMode;
  rationale: string;
  operations: NativeOperation[];
  augmentations?: AugmentOperation[];
  composeRationale?: string;
  composeUrl?: string;
  delegationEnvelope?: Record<string, unknown>;
  consequence?: ConsequenceAssessment;
  requiresConfirmation?: boolean;
  handoff?: HandoffReport;
  workSessionId?: string;
}

export interface WorkIntelligenceOutcome {
  diagnosis: Diagnosis;
  intervention: Intervention;
  actionProposal?: ActionProposal;
  resolutionOutcome: "requires_augment" | "requires_compose";
  workSessionId: string;
  groundingContext: GroundingEvidence;
}

export interface GroundingEvidence {
  foregroundApp: string;
  artifactKind: string;
  artifactTitle: string;
  repositoryRoot?: string;
  branch?: string;
  documentPath?: string;
  hasScreenshot: boolean;
  elementRole: string;
  elementValue: string;
  selectedText: string;
  sufficiency: "semantic" | "partial";
  evidenceSummary: EvidenceSummary;
  currentWork?: CurrentWork;
}

export interface ResolutionOutcome {
  resolutionId: string;
  invocationId: string;
  status: "succeeded" | "rejected" | "failed" | "cancelled";
  correction: string | null;
}

export interface ResolutionError {
  error: string;
  code: "invalid_ref" | "invalid_kind" | "empty_text" | "invalid_mode" | "char_limit_exceeded" | "unknown";
}

const ALLOWED_KINDS: Set<string> = new Set(["insert_text", "replace_text", "replace_selection"]);
const ALLOWED_MODES: Set<string> = new Set(["native", "requires_augment", "requires_compose", "requires_execution", "requires_task"]);
const MAX_OPERATION_CHARS = 2000;

export function validateResolution(resolution: Resolution): ResolutionError | null {
  if (!resolution.resolutionId || !resolution.invocationId) {
    return { error: "Missing resolutionId or invocationId", code: "unknown" };
  }

  if (!ALLOWED_MODES.has(resolution.mode)) {
    return { error: `Invalid mode: ${resolution.mode}`, code: "invalid_mode" };
  }

  if (resolution.mode === "native") {
    if (!Array.isArray(resolution.operations) || resolution.operations.length === 0) {
      return { error: "Native mode requires at least one operation", code: "invalid_kind" };
    }

    for (const op of resolution.operations) {
      if (!op.target || typeof op.target !== "string") {
        return { error: "Operation missing target ref", code: "invalid_ref" };
      }
      if (!ALLOWED_KINDS.has(op.kind)) {
        return { error: `Invalid operation kind: ${op.kind}`, code: "invalid_kind" };
      }
      if (!op.text || op.text.trim().length === 0) {
        return { error: "Operation text cannot be empty", code: "empty_text" };
      }
      if (op.text.length > MAX_OPERATION_CHARS) {
        return { error: `Operation exceeds ${MAX_OPERATION_CHARS} character limit`, code: "char_limit_exceeded" };
      }
      if (!op.target.startsWith("el_")) {
        return { error: `Invalid element ref: ${op.target}. Must start with 'el_'`, code: "invalid_ref" };
      }
      if (op.target !== "el_01") {
        return { error: `Unknown element ref: ${op.target}. Must target captured ref 'el_01'`, code: "invalid_ref" };
      }
    }
  }

  if (resolution.mode === "requires_augment") {
    if (!resolution.augmentations || resolution.augmentations.length === 0) {
      return { error: "Augment mode requires at least one augmentation", code: "invalid_mode" };
    }
  }

  if (resolution.mode === "requires_execution") {
    if (!resolution.augmentations || resolution.augmentations.length === 0) {
      return { error: "Execution mode requires at least one augmentation with commands", code: "invalid_mode" };
    }
    const hasExecutionCard = resolution.augmentations.some(a => a.kind === 'execution' && a.commands && a.commands.length > 0);
    if (!hasExecutionCard) {
      return { error: "Execution mode requires an execution augmentation with commands", code: "invalid_mode" };
    }
  }

  if (resolution.mode === "requires_compose" && !resolution.composeRationale) {
    return { error: "Compose mode requires a rationale", code: "invalid_mode" };
  }

  // Consequential native resolutions should carry the confirmation flag when
  // the resolved operations themselves have external consequences (click, send,
  // delete, purchase). Currently all native operations are text insert/replace,
  // so requiresConfirmation is effectively never set. The field exists for
  // future operation kinds.

  return null;
}

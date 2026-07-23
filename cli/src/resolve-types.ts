export interface NativeOperation {
  target: string;
  kind: "insert_text" | "replace_text" | "replace_selection";
  text: string;
}

export interface AugmentOperation {
  kind: "explanation" | "choice" | "annotation" | "control";
  content: string;
  placement: "beside_selection" | "below_element" | "cursor";
  options?: string[];
  temporalSpan?: {
    delayMs: number;
    durationMs: number;
  };
}

export type ResolutionMode = "native" | "requires_augment" | "requires_compose";

export interface Resolution {
  resolutionId: string;
  invocationId: string;
  mode: ResolutionMode;
  rationale: string;
  operations: NativeOperation[];
  augmentations?: AugmentOperation[];
  composeRationale?: string;
  composeUrl?: string;
  delegationEnvelope?: Record<string, unknown>;
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
const ALLOWED_MODES: Set<string> = new Set(["native", "requires_augment", "requires_compose"]);
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
    }
  }

  if (resolution.mode === "requires_augment") {
    if (!resolution.augmentations || resolution.augmentations.length === 0) {
      return { error: "Augment mode requires at least one augmentation", code: "invalid_mode" };
    }
  }

  if (resolution.mode === "requires_compose" && !resolution.composeRationale) {
    return { error: "Compose mode requires a rationale", code: "invalid_mode" };
  }

  return null;
}

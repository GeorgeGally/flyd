/**
 * Shared contracts for consequence gating, artifact verification, and
 * delegation/compose handoff. These types are the wire contract between
 * Flyd Core, delegated runners, and the Mac adapter — every field the
 * adapter decodes must remain optional-tolerant (see FlydClient.swift).
 */

export type ConsequentialVerb =
  | "create"
  | "modify"
  | "send"
  | "purchase"
  | "delete"
  | "publish";

export type ConsequenceClass = "benign" | "consequential";

export type ConsequenceTarget =
  | "text_in_focus"
  | "external_system"
  | "file_system"
  | "unknown";

export interface ConsequenceAssessment {
  class: ConsequenceClass;
  verbs: ConsequentialVerb[];
  target: ConsequenceTarget;
  reason: string;
  /** Which mechanism produced this assessment. */
  source: "heuristic" | "classifier";
}

export interface ArtifactClaim {
  kind: "file" | "url" | "inline_text";
  path?: string;
  url?: string;
  /** e.g. "application/pdf", "application/json", "text/markdown" */
  expectedMediaType?: string;
  description: string;
}

export type ArtifactCheckKind =
  | "exists"
  | "nonzero"
  | "format"
  | "user_facing"
  | "url_responds";

export interface ArtifactCheckFailure {
  check: ArtifactCheckKind;
  detail: string;
}

export interface ArtifactCheckResult {
  claim: ArtifactClaim;
  passed: boolean;
  failures: ArtifactCheckFailure[];
  byteSize?: number;
  sha256?: string;
  httpStatus?: number;
  /** ISO timestamp — evidence that the check preceded any completion claim. */
  checkedAt: string;
}

export interface HandoffLocation {
  kind: "file" | "url" | "repository" | "element" | "panel" | "clipboard";
  location: string;
}

/**
 * The handoff triad: every delegated/composed result must answer
 * what was produced, where it is, and what it contains.
 */
export interface HandoffReport {
  what: string;
  where: HandoffLocation;
  contains: string;
  artifactChecks: ArtifactCheckResult[];
  verifiedAt: string;
}

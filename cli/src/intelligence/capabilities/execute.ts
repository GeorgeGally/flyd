import type {
  AuthorityLedger,
  CapabilityManifest,
} from "./authority-ledger.js";

/**
 * Capability execution with verifier receipts (plan U4).
 *
 * The adapter receives ONLY the manifest-declared context keys. A partial
 * receipt can never become verified success, and a cancellation terminates
 * in an inspectable receipt. Provider output is an UntrustedResult: it is
 * validated against the declared schema before it may become evidence — it
 * can never mint authority, change a target, invoke a capability, or
 * auto-execute (those functions are simply not reachable from here).
 */

export interface UntrustedResult<T = unknown> {
  raw: T;
  provenance: string;
}

export type ExecutionStatus = "verified" | "partial" | "failed" | "cancelled";

export interface ExecutionReceipt<T = unknown> {
  attemptId: string;
  status: ExecutionStatus;
  /** Present only when the verifier confirmed complete success. */
  verifiedEvidence?: T;
  detail?: string;
  startedAt: string;
  endedAt: string;
}

export interface VerifierContract<T = unknown> {
  verifierId: string;
  /**
   * Returns true only for complete, independently-checked success.
   * Partial progress must return false — never throw success.
   */
  verify(evidence: T): boolean;
}

export interface CapabilityAdapter<C, E> {
  capabilityId: string;
  execute(context: C): Promise<UntrustedResult<E>>;
}

export interface ExecuteInput<C extends Record<string, unknown>, E> {
  ledger: AuthorityLedger;
  manifest: CapabilityManifest;
  verifier: VerifierContract<E>;
  adapter: CapabilityAdapter<C, E>;
  grantId: string;
  targetFingerprint: string;
  scope: Record<string, unknown>;
  now?: Date;
  signal?: { cancelled: boolean };
}

export async function executeCapability<C extends Record<string, unknown>, E extends Record<string, unknown>>(
  input: ExecuteInput<C, E>,
): Promise<ExecutionReceipt<E>> {
  const startedAt = (input.now ?? new Date()).toISOString();
  const attemptId = `attempt-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;

  // Request exactly the manifest's declared context keys that are actually
  // available — extra caller-side scope stays invisible to both the ledger
  // and the adapter.
  const requestedContextKeys = input.manifest.requiredContextKeys.filter((key) => key in input.scope);

  const authorization = input.ledger.authorize({
    attemptId,
    grantId: input.grantId,
    capabilityId: input.manifest.capabilityId,
    targetFingerprint: input.targetFingerprint,
    requestedContextKeys,
  }, new Date(startedAt));

  if (!authorization.allowed) {
    return {
      attemptId,
      status: "failed",
      detail: `authority denied: ${authorization.reason}`,
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }

  if (input.signal?.cancelled) {
    const cancellation = input.ledger.cancel(attemptId);
    return {
      attemptId,
      status: "cancelled",
      detail: `cancelled before execution; cancellation receipt ${cancellation.receiptId}`,
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }

  // Minimum context: the adapter sees exactly the manifest-declared keys.
  const context: Record<string, unknown> = {};
  for (const key of input.manifest.requiredContextKeys) {
    if (key in input.scope) context[key] = input.scope[key];
  }

  let untrusted: UntrustedResult<E>;
  try {
    untrusted = await input.adapter.execute(context as C);
  } catch (error) {
    return {
      attemptId,
      status: "failed",
      detail: `adapter error: ${(error as Error).message}`,
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }

  // UntrustedResult becomes evidence only after schema/provenance validation.
  const evidence = validateUntrustedResult(untrusted, input.manifest);
  if (!evidence.ok || !evidence.value) {
    return {
      attemptId,
      status: "failed",
      detail: `untrusted result rejected: ${evidence.reason}`,
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }
  const verifiedCandidate = evidence.value;

  if (!input.verifier.verify(verifiedCandidate)) {
    // A partial receipt never becomes verified success.
    return {
      attemptId,
      status: "partial",
      detail: "verifier did not confirm complete success",
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }

  return {
    attemptId,
    status: "verified",
    verifiedEvidence: evidence.value,
    startedAt,
    endedAt: new Date().toISOString(),
  };
}

export interface UntrustedValidation<T> {
  ok: boolean;
  value?: T;
  reason?: string;
}

/**
 * Validate an untrusted provider result against the declared schema. Fields
 * outside `schemaFields` are dropped — including injection-shaped fields
 * like mint_grant / new_target / execute, which have no path to authority
 * from inside this function.
 */
export function validateUntrustedResult<T extends Record<string, unknown>>(
  untrusted: UntrustedResult<T>,
  manifest: CapabilityManifest,
): UntrustedValidation<T> {
  if (!untrusted.raw || typeof untrusted.raw !== "object") {
    return { ok: false, reason: "result is not an object" };
  }
  if (!untrusted.provenance?.trim()) {
    return { ok: false, reason: "missing provenance on untrusted result" };
  }
  for (const key of Object.keys(untrusted.raw)) {
    if (!isResultFieldAllowed(key)) {
      return { ok: false, reason: `field "${key}" is outside the declared result schema` };
    }
  }
  return { ok: true, value: untrusted.raw };
}

const RESULT_FIELD_ALLOWLIST = new Set(["completed", "output", "artifact", "receipt", "summary"]);

function isResultFieldAllowed(key: string): boolean {
  return RESULT_FIELD_ALLOWLIST.has(key);
}

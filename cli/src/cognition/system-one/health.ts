import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveFlydDir } from "../../lib/flyd-dir.js";
import type { JevFailureKind, PredicateEvaluation } from "./types.js";

export interface JevHealth {
  version: 1;
  state: "ready" | "degraded";
  checkedAt: string;
  /** Stable for an uninterrupted failure, so repeated fallbacks do not ring again. */
  since: string;
  incidentId: string;
  failureKind?: JevFailureKind;
  httpStatus?: number;
}

const FAILURE_MESSAGES: Record<JevFailureKind, string> = {
  credits_exhausted: "Jev's account quota or credit is exhausted. Its decisions are using fallbacks; top up or check the TypeSafe account limit.",
  billing: "Jev's account needs credit or a billing fix. Its decisions are using fallbacks; check the TypeSafe account.",
  rate_limited: "Jev is rate limited. Its decisions are using fallbacks until the service accepts requests again.",
  authentication: "Jev rejected its API key. Its decisions are using fallbacks; check the TypeSafe credentials.",
  provider_unavailable: "Jev is unavailable. Its decisions are using fallbacks until the service recovers.",
  timeout: "Jev did not answer in time. Its decisions are using fallbacks.",
  network: "Flyd could not reach Jev. Its decisions are using fallbacks.",
  invalid_response: "Jev returned an unusable answer. Its decisions are using fallbacks.",
  not_configured: "Jev was requested without an API key. Its decisions are using fallbacks; configure the TypeSafe credentials.",
};

const ACTION_REQUIRED = new Set<JevFailureKind>(["credits_exhausted", "billing", "authentication", "not_configured"]);

export function jevHealthPath(): string {
  return join(resolveFlydDir(), "cognition", "jev-health.json");
}

/** Last observed provider health, shared by Core, the conversation view and doctor. No network probe. */
export function readJevHealth(): JevHealth | null {
  try {
    const value = JSON.parse(readFileSync(jevHealthPath(), "utf8")) as JevHealth;
    if (value.version !== 1 || !["ready", "degraded"].includes(value.state)
      || typeof value.incidentId !== "string"
      || !Number.isFinite(Date.parse(value.checkedAt)) || !Number.isFinite(Date.parse(value.since))) return null;
    if (value.state === "degraded" && (!value.failureKind || !Object.hasOwn(FAILURE_MESSAGES, value.failureKind))) return null;
    return value;
  } catch {
    return null;
  }
}

export function jevHealthMessage(health: JevHealth | null): string {
  if (!health) return "Jev has not been checked; account credit is unknown.";
  return health.state === "ready" ? "Jev's last request succeeded; account credit balance is unknown."
    : FAILURE_MESSAGES[health.failureKind!];
}

/** Provider errors remain visible even when every caller takes its ordinary fallback. */
export function recordJevHealth(evaluation: PredicateEvaluation): void {
  // Disabled calls, local policy denials and malformed local questions say nothing
  // about provider availability. They must not clear a credit failure from another caller.
  if ((!evaluation.ok && !evaluation.failureKind) || evaluation.evaluator === "gemini") return;
  const previous = readJevHealth();
  const state = evaluation.ok ? "ready" : "degraded";
  // A later timeout or a disabled call is not evidence that an account problem
  // was fixed. Clear an actionable warning only on a successful provider call.
  const retainIssue = !evaluation.ok && previous?.failureKind && ACTION_REQUIRED.has(previous.failureKind)
    && !ACTION_REQUIRED.has(evaluation.failureKind!);
  const failureKind = retainIssue ? previous.failureKind : evaluation.failureKind;
  const httpStatus = retainIssue ? previous.httpStatus : evaluation.httpStatus;
  const same = previous?.state === state && previous.failureKind === failureKind;
  const next: JevHealth = {
    version: 1, state, checkedAt: evaluation.evaluatedAt,
    since: same ? previous.since : evaluation.evaluatedAt,
    incidentId: same ? previous.incidentId : randomUUID(),
    ...(!evaluation.ok && failureKind ? { failureKind } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
  if (state === "degraded" && !same) console.warn(`[Jev] ${jevHealthMessage(next)}`);
  const path = jevHealthPath();
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, JSON.stringify(next) + "\n", { mode: 0o600 });
    renameSync(temporary, path);
  } catch {
    // Reporting must never break a predicate/fallback, and a failed status write
    // must itself be reported without dumping a path, payload or credential.
    console.warn(`[Jev] Could not save provider health. ${jevHealthMessage(next)}`);
  } finally {
    try { rmSync(temporary, { force: true }); } catch { /* the write failure was already reported */ }
  }
}

export function jevRuntimeStatus() {
  const health = readJevHealth();
  return {
    globallyEnabled: process.env.FLYD_JEV_ENABLED === "true",
    configured: Boolean(process.env.TYPESAFE_API_KEY || process.env.FLYD_JEV_API_KEY || process.env.BEACON_JEV_API_KEY),
    health,
    message: jevHealthMessage(health),
  };
}

/** Reuse the existing notice column and island, without another alert owner or scheduler. */
export function jevHealthNotice(): { id: string; kind: "attention"; text: string; at: string } | undefined {
  const health = readJevHealth();
  if (!health || health.state !== "degraded" || !ACTION_REQUIRED.has(health.failureKind!)) return undefined;
  return { id: `jev:${health.incidentId}`, kind: "attention", text: jevHealthMessage(health), at: health.since };
}

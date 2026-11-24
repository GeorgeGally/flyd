import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
  /** Opaque hashes only: never a credential or endpoint containing credentials. */
  scope?: string;
  provider?: string;
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

export function jevHealthScope(endpoint: string, apiKey: string | undefined): { scope: string; provider: string } {
  const provider = createHash("sha256").update(endpoint.replace(/\/+$/, "")).digest("hex");
  return { provider, scope: createHash("sha256").update(JSON.stringify([provider, apiKey ?? ""])).digest("hex") };
}

export function jevHealthPath(scope?: string): string {
  const root = join(resolveFlydDir(), "cognition");
  if (scope && !/^[a-f0-9]{64}$/.test(scope)) throw new Error("Invalid Jev health scope");
  return scope ? join(root, "jev-health", `${scope}.json`) : join(root, "jev-health.json");
}

/** Last observed provider health, shared by Core, the conversation view and doctor. No network probe. */
function readHealthFile(path: string): JevHealth | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as JevHealth;
    if (value.version !== 1 || !["ready", "degraded"].includes(value.state)
      || typeof value.incidentId !== "string"
      || !Number.isFinite(Date.parse(value.checkedAt)) || !Number.isFinite(Date.parse(value.since))) return null;
    if (value.state === "degraded" && (!value.failureKind || !Object.hasOwn(FAILURE_MESSAGES, value.failureKind))) return null;
    return value;
  } catch {
    return null;
  }
}

export function readJevHealths(): JevHealth[] {
  let files: string[] = [];
  try { files = readdirSync(dirname(jevHealthPath("0".repeat(64)))).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)); } catch { /* no scoped calls yet */ }
  return [readHealthFile(jevHealthPath()), ...files.map((name) => readHealthFile(jevHealthPath(name.slice(0, -5))))]
    .filter((value): value is JevHealth => value !== null);
}

/** A healthy account cannot erase another account's unresolved problem. */
export function readJevHealth(scope?: string): JevHealth | null {
  if (scope) return readHealthFile(jevHealthPath(scope));
  const priority = (value: JevHealth) => value.state === "degraded" ? ACTION_REQUIRED.has(value.failureKind!) ? 2 : 1 : 0;
  return readJevHealths().sort((a, b) => priority(b) - priority(a) || b.checkedAt.localeCompare(a.checkedAt))[0] ?? null;
}

export function jevHealthMessage(health: JevHealth | null): string {
  if (!health) return "Jev has not been checked; account credit is unknown.";
  return health.state === "ready" ? "Jev's last request succeeded; account credit balance is unknown."
    : FAILURE_MESSAGES[health.failureKind!];
}

/** Provider errors remain visible even when every caller takes its ordinary fallback. */
export function recordJevHealth(evaluation: PredicateEvaluation, context: { scope: string; provider: string; legacyScope?: string }): void {
  // Disabled calls, local policy denials and malformed local questions say nothing
  // about provider availability. They must not clear a credit failure from another caller.
  if ((!evaluation.ok && !evaluation.failureKind) || evaluation.evaluator === "gemini") return;
  // A v1 record had no account identity. Only the configured default account
  // may adopt it; an arbitrary per-call key cannot silently mark it recovered.
  const legacy = context.scope === context.legacyScope ? readHealthFile(jevHealthPath()) : null;
  const previous = readJevHealth(context.scope) ?? legacy;
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
    scope: context.scope, provider: context.provider,
    since: same ? previous.since : evaluation.evaluatedAt,
    incidentId: same ? previous.incidentId : randomUUID(),
    ...(!evaluation.ok && failureKind ? { failureKind } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
  if (state === "degraded" && !same) console.warn(`[Jev] ${jevHealthMessage(next)}`);
  const path = jevHealthPath(context.scope);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, JSON.stringify(next) + "\n", { mode: 0o600 });
    renameSync(temporary, path);
    if (legacy) rmSync(jevHealthPath(), { force: true });
    // Successfully authenticating resolves a missing-key configuration warning
    // for this endpoint, but never a credit/authentication failure on another key.
    if (evaluation.ok) {
      for (const health of readJevHealths()) {
        if (health.scope && health.scope !== context.scope && health.provider === context.provider && health.failureKind === "not_configured") {
          rmSync(jevHealthPath(health.scope), { force: true });
        }
      }
    }
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
    contexts: readJevHealths(),
    message: jevHealthMessage(health),
  };
}

/** Reuse the existing notice column and island, without another alert owner or scheduler. */
export function jevHealthNotice(): { id: string; kind: "attention"; category: "provider_health"; text: string; at: string } | undefined {
  const health = readJevHealth();
  if (!health || health.state !== "degraded" || !ACTION_REQUIRED.has(health.failureKind!)) return undefined;
  return { id: `jev:${health.incidentId}`, kind: "attention", category: "provider_health", text: jevHealthMessage(health), at: health.since };
}

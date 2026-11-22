import { existsSync } from "node:fs";
import { join } from "node:path";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { validateEnvelope, type ContextEnvelope } from "../../intelligence/context-envelope.js";
import { readProjects, type Project } from "../../council/projects.js";
import { latestEdition, type Edition } from "../../council/scout.js";
import { openAdvisories, type Advisory } from "../../council/advisors.js";
import { activityRecordPath, recordActivity, type ActivityRecord } from "../../conversation-view/activity.js";
import { FLYD_DIR } from "../../lib/config.js";
import { deriveInitiatives, type InitiativeCandidate, type InitiativeSource } from "./candidates.js";
import { decideInitiative, inspectInitiative, safeInitiativePayload, type InitiativeDecision } from "./policy.js";

/**
 * One synchronous, local, side-effect-bounded run inside the EXISTING agenda
 * tick. No worker dispatch, notification, model, network or new clock.
 *
 * Shadow is the default; "on" permits only a single quiet, evidenced
 * Activity card per day. It never creates a Chief-of-Staff objective.
 */
export type InitiativeMode = "off" | "shadow" | "on";
export function initiativeMode(): InitiativeMode {
  const raw = process.env.FLYD_INITIATIVE?.toLowerCase();
  return raw === "0" || raw === "off" ? "off" : raw === "on" ? "on" : "shadow";
}
export interface InitiativeRunDeps {
  now?: () => Date;
  store?: IntelligenceEventStore;
  projects?: () => Project[];
  edition?: () => Edition | null;
  advisories?: (now: Date) => Advisory[];
  sourceAllowed?: (source: InitiativeSource) => boolean;
  /** For tests and explicit future scope approval. */
  mode?: InitiativeMode;
  record?: (card: ActivityRecord) => void;
  seen?: (key: string) => boolean;
  /** No model calls; this caps local candidates per tick. */
  maxInvestigations?: number;
}
export interface InitiativeRunResult {
  mode: InitiativeMode;
  generated: number;
  investigated: number;
  published: number;
  skipped: number;
  reasons: string[];
}

function envDate(now: Date): string { return now.toISOString().slice(0, 10); }
function permitted(source: InitiativeSource): boolean {
  return source.scope === "public"
    || (source.scope === "local_operational" && /^(?:project:|council:|cos:)/.test(source.id));
}
function envelope(now: Date, kind: ContextEnvelope["kind"], idempotencyKey: string, candidate: InitiativeCandidate, payload: Record<string, unknown>): ContextEnvelope {
  return {
    pathKind: "executive", kind, sourceId: "initiative.v10",
    consent: { grantedAt: now.toISOString(), scopes: ["local_curated_operational"] },
    retentionClass: "local_default", payloadClassification: "operational",
    provenance: "initiative.v1:local_only",
    idempotencyKey, correlationId: candidate.id, policyVersion: "initiative.v1",
    evidenceRefs: candidate.sources.map(s => s.evidenceRef),
    payload,
  };
}
export function initiativeActivity(candidate: InitiativeCandidate): ActivityRecord {
  const detail = [
    "Question: " + candidate.question,
    "What we know: " + inspectInitiative(candidate).whatIsKnown,
    "What we do not know: " + candidate.counterQuestion,
    "Worth checking: " + candidate.proposedTest,
    "Sources: " + candidate.sources.map(s => s.evidenceRef).join(", "),
  ].join("\n");
  return {
    key: "initiative:" + candidate.id + ":" + candidate.sources.map(s => s.revision).join("|").slice(0, 55),
    kind: "noted", state: "done", at: candidate.createdAt, expiresAt: candidate.expiresAt,
    title: candidate.origin === "cos_failure" ? "A possible recurring obstacle" : "A connection worth exploring",
    line: candidate.question.slice(0, 230),
    // The existing Activity shape only exposes title, line and verified story
    // links; never mislabel an untested hypothesis as a completed result.
    ...(candidate.origin === "scout" ? {
      stories: candidate.sources.filter(s => s.scope === "public" && s.evidenceRef.startsWith("https://"))
        .map(s => ({ title: candidate.question.slice(0, 100), url: s.evidenceRef, gist: "Unverified possible connection", source: "Scout", kind: "relevant" })),
    } : {}),
    // Source fingerprints must be rechecked by the reader before presenting
    // a record prepared while the source was still in scope.
    sourceRefs: candidate.sources.map(s => ({ id: s.id, revision: s.revision, scope: s.scope })),
    detail,
  } as ActivityRecord;
}

export async function runInitiativeCycle(deps: InitiativeRunDeps = {}): Promise<InitiativeRunResult> {
  const mode = deps.mode ?? initiativeMode();
  const result: InitiativeRunResult = { mode, generated: 0, investigated: 0, published: 0, skipped: 0, reasons: [] };
  if (mode === "off") return result;
  const now = deps.now?.() ?? new Date();
  const ownedStore = !deps.store;
  const store = deps.store ?? new IntelligenceEventStore();
  try {
    const valid = (s: InitiativeSource) => permitted(s) && (deps.sourceAllowed?.(s) ?? true);
    const candidates = deriveInitiatives({
      now, projects: (deps.projects ?? readProjects)(),
      edition: (deps.edition ?? latestEdition)(),
      advisories: (deps.advisories ?? openAdvisories)(now),
      reports: store.readSourcePage("cos.report", { limit: 100 }),
      sourceAllowed: valid,
    });
    result.generated = candidates.length;
    // Shared deterministic value-of-information budget, no model calls.
    const evaluated = candidates.map((candidate) => ({ candidate, decision: decideInitiative(candidate, { allowed: valid, mode }) }))
      .sort((a, b) => b.decision.score - a.decision.score)
      .slice(0, Math.max(0, Math.min(4, deps.maxInvestigations ?? 2)));
    for (const { candidate, decision } of evaluated) {
      const key = candidate.id + ":" + decision.revision;
      if (!valid(candidate.sources[0]!)) { result.skipped++; continue; }
      const created = store.transaction(() => {
        if (store.findByIdempotencyKey("initiative.v10", "decision:" + key)) return false;
        const decisionPayload: Record<string, unknown> = {
          candidate_id: candidate.id, revision: decision.revision,
          disposition: decision.disposition, attention: decision.attention,
          reason: decision.reason, score: decision.score,
          why_now: decision.whyNow, why_me: decision.whyMe,
          source_keys: candidate.sources.map(s => s.id),
          expires_at: candidate.expiresAt,
        };
        const chosen = envelope(now, "executive_decision", "decision:" + key, candidate, decisionPayload);
        if (!validateEnvelope(chosen).ok) return false;
        if (!store.append(chosen)) return false;
        if (decision.disposition === "investigate") {
          const found = inspectInitiative(candidate);
          const proposed = envelope(now, "proposed_action", "finding:" + key, candidate,
            safeInitiativePayload(candidate, found));
          if (!validateEnvelope(proposed).ok) return false;
          store.append(proposed);
        }
        return true;
      });
      if (created && decision.disposition === "investigate") result.investigated++;
      if (created && decision.disposition !== "investigate") result.reasons.push(decision.reason);
      if (!created) { result.skipped++; continue; }
    }
    // Presentation is separate from inference. Candidate decisions written in
    // shadow never imply a notification or that George saw the idea.
    if (mode === "on") {
      for (const { candidate, decision } of evaluated) {
        if (decision.attention !== "ambient" || result.published >= 1) continue;
        if (!candidate.sources.every(valid)) continue;
        const key = candidate.id + ":" + decision.revision;
        if (!store.findByIdempotencyKey("initiative.v10", "finding:" + key)) continue;
        const card = initiativeActivity(candidate);
        const previously = deps.seen
          ? deps.seen(card.key!)
          : (() => {
              try {
                if (!existsSync(activityRecordPath())) return false;
                // Only the existing record writer creates the card; see below.
                return false;
              } catch { return false; }
            })();
        if (previously) continue;
        (deps.record ?? recordActivity)(card);
        result.published++;
      }
    }
    return result;
  } finally {
    if (ownedStore) store.close();
  }
}

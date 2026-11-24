import { readFileSync } from "node:fs";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { INITIATIVE_CURATED_CONTRACT, INITIATIVE_PUBLIC_RESEARCH_CONTRACT, SourceContractRegistry } from "../../intelligence/sensors/source-contracts.js";
import { initiativeSourcesCurrent } from "./source-validity.js";
import { validateEnvelope, type ContextEnvelope } from "../../intelligence/context-envelope.js";
import { readProjects, type Project } from "../../council/projects.js";
import { latestEdition, type Edition } from "../../council/scout.js";
import { openAdvisories, type Advisory } from "../../council/advisors.js";
import { activityRecordPath, recordActivity, type ActivityRecord } from "../../conversation-view/activity.js";
import { deriveInitiatives, initiativeRevision, type InitiativeCandidate, type InitiativeSource } from "./candidates.js";
import { decideInitiative, inspectInitiative, safeInitiativePayload } from "./policy.js";

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
  return raw === "0" || raw === "off" ? "off" : raw === "shadow" ? "shadow" : "on";
}
export interface InitiativeRunDeps {
  now?: () => Date;
  store?: IntelligenceEventStore;
  projects?: () => Project[];
  edition?: () => Edition | null;
  advisories?: (now: Date) => Advisory[];
  sourceAllowed?: (source: InitiativeSource) => boolean;
  /** The actual LEARN consent gate; bypassable only in isolated tests. */
  consented?: () => boolean;
  /** Fixture hook; production separately checks the consented public research source. */
  publicResearchEnabled?: () => boolean;
  /** For tests and explicit future scope approval. */
  mode?: InitiativeMode;
  record?: (card: ActivityRecord) => void;
  seen?: (key: string) => boolean;
  countPublished?: (day: string) => number;
  /** No model calls; this caps local candidates per tick. */
  maxInvestigations?: number;
}
export interface InitiativeRunResult {
  mode: InitiativeMode;
  generated: number;
  /** A question was formulated and evaluated, not yet researched. */
  triaged: number;
  published: number;
  skipped: number;
  reasons: string[];
}

function dayOf(now: Date): string { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }

/** Reuse Activity’s own record file instead of creating a notification budget store. */
export function countInitiativeCards(day: string, path = activityRecordPath()): number {
  try {
    const seen = new Set<string>();
    for (const row of readFileSync(path, "utf8").split("\n").slice(-1200)) {
      try {
        const item = JSON.parse(row) as ActivityRecord;
        if (item.key?.startsWith("initiative:") && item.at && dayOf(new Date(item.at)) === day) seen.add(item.key);
      } catch { /* invalid/incomplete rows do not count */ }
    }
    return seen.size;
  } catch { return 0; }
}

export function initiativeCardRecorded(key: string, path = activityRecordPath()): boolean {
  try {
    return readFileSync(path, "utf8").split("\n").some(line => {
      try { return (JSON.parse(line) as ActivityRecord).key === key; } catch { return false; }
    });
  } catch { return false; }
}
function permitted(source: InitiativeSource): boolean {
  return source.scope === "public"
    || (source.scope === "local_operational" && /^(?:project:|council:|cos:)/.test(source.id));
}
function envelope(now: Date, kind: ContextEnvelope["kind"], idempotencyKey: string, candidate: InitiativeCandidate, payload: Record<string, unknown>): ContextEnvelope {
  return {
    pathKind: "executive", kind, sourceId: INITIATIVE_CURATED_CONTRACT.sourceId,
    consent: { grantedAt: now.toISOString(), scopes: [...INITIATIVE_CURATED_CONTRACT.scopes] },
    retentionClass: INITIATIVE_CURATED_CONTRACT.retentionClass, payloadClassification: "personal",
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
    key: "initiative:" + candidate.id + ":" + initiativeRevision(candidate.sources),
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
    sourceRefs: candidate.sources.map(s => ({ ...s })),
    detail,
  };
}

export async function runInitiativeCycle(deps: InitiativeRunDeps = {}): Promise<InitiativeRunResult> {
  const mode = deps.mode ?? initiativeMode();
  const result: InitiativeRunResult = { mode, generated: 0, triaged: 0, published: 0, skipped: 0, reasons: [] };
  if (mode === "off") return result;
  // The LEARN contract is disabled unless the user explicitly opts in. Do
  // not even read local projects or create a SQLite db when it is missing.
  const consented = deps.consented ?? (() => {
    const registry = new SourceContractRegistry();
    return registry.status(INITIATIVE_CURATED_CONTRACT.sourceId) === "enabled";
  });
  if (!consented()) return { ...result, mode: "off", reasons: ["source_consent_required"] };
  const now = deps.now?.() ?? new Date();
  const ownedStore = !deps.store;
  const store = deps.store ?? new IntelligenceEventStore();
  try {
    store.purgeSourceBefore(INITIATIVE_CURATED_CONTRACT.sourceId, new Date(now.getTime() - 30 * 86_400_000));
    const valid = (s: InitiativeSource) => permitted(s) && (deps.sourceAllowed?.(s) ?? true);
    const projects = (deps.projects ?? readProjects)();
    const edition = (deps.edition ?? latestEdition)();
    const advisories = (deps.advisories ?? openAdvisories)(now);
    const reports = store.readSourcePage("cos.report", { limit: 100 });
    const current = { projects, edition, advisories, reports };
    // Old decisions are not enough to justify a new action: drop all readable
    // content for any case whose parent evidence changed or disappeared.
    const stale = new Map<string, { candidateId: string; revision: string }>();
    for (const event of store.readSourcePage(INITIATIVE_CURATED_CONTRACT.sourceId, { limit: 1000 })) {
      const p = event.payload;
      if (!p || !Array.isArray(p.sources)) continue;
      const id = p.candidate_id;
      const rev = p.revision ?? p.source_revision;
      if (typeof id !== "string" || typeof rev !== "string") continue;
      const refs = p.sources as InitiativeSource[];
      if (!initiativeSourcesCurrent(refs, current)) stale.set(id + "@" + rev, { candidateId: id, revision: rev });
    }
    if (stale.size) store.retractInitiativeCases([...stale.values()]);
    const candidates = deriveInitiatives({ now, projects, edition, advisories, reports, sourceAllowed: valid });
    result.generated = candidates.length;
    // Shared deterministic value-of-information budget, no model calls.
    const ranked = candidates.map((candidate) => ({ candidate, decision: decideInitiative(candidate, { allowed: valid, mode }) }))
      .sort((a, b) => b.decision.score - a.decision.score);
    const budget = Math.max(0, Math.min(4, deps.maxInvestigations ?? 2));
    const evaluated = ranked.slice(0, budget);
    // High-priority operational concerns should not crowd out every possible
    // creative connection. Reserve one of the SAME bounded slots (not extra
    // calls or another queue) for a source-grounded Scout hypothesis.
    if (budget >= 2 && !evaluated.some(row => row.candidate.origin === "scout")) {
      const novel = ranked.find(row => row.candidate.origin === "scout"
        && row.decision.disposition === "investigate");
      if (novel) evaluated[evaluated.length - 1] = novel;
    }
    for (const { candidate, decision } of evaluated) {
      // A revoked/erased generation can later be explicitly renewed. Prior
      // erased rows keep their idempotency keys for audit, so the new consent
      // generation must have a distinct digest without restoring old content.
      const generation = store.latestTombstone(INITIATIVE_CURATED_CONTRACT.sourceId)?.erasedAt ?? "initial";
      const key = generation + ":" + candidate.id + ":" + decision.revision;
      if (!candidate.sources.every(valid)) { result.skipped++; continue; }
      const created = store.transaction(() => {
        if (store.findByIdempotencyKey(INITIATIVE_CURATED_CONTRACT.sourceId, "decision:" + key)) return false;
        const decisionPayload: Record<string, unknown> = {
          candidate_id: candidate.id, revision: decision.revision,
          disposition: decision.disposition, attention: decision.attention,
          reason: decision.reason, score: decision.score,
          why_now: decision.whyNow, why_me: decision.whyMe,
          source_keys: candidate.sources.map(s => s.id),
          sources: candidate.sources.map(s => ({ ...s })),
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
      if (created && decision.disposition === "investigate") result.triaged++;
      if (created && decision.disposition !== "investigate") result.reasons.push(decision.reason);
      if (!created) { result.skipped++; continue; }
    }
    // Presentation is separate from inference. Candidate decisions written in
    // shadow never imply a notification or that George saw the idea.
    if (mode === "on") {
      for (const { candidate, decision } of evaluated) {
        const publicResearchEnabled = deps.publicResearchEnabled?.()
          ?? new SourceContractRegistry().status(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId) === "enabled";
        if (candidate.origin === "scout" && publicResearchEnabled) continue;
        if (decision.attention !== "ambient" || result.published >= 1 || (deps.countPublished ?? countInitiativeCards)(dayOf(now)) >= 1) continue;
        if (!candidate.sources.every(valid)) continue;
        // A revoked/erased generation can later be explicitly renewed. Prior
      // erased rows keep their idempotency keys for audit, so the new consent
      // generation must have a distinct digest without restoring old content.
      const generation = store.latestTombstone(INITIATIVE_CURATED_CONTRACT.sourceId)?.erasedAt ?? "initial";
      const key = generation + ":" + candidate.id + ":" + decision.revision;
        if (!store.findByIdempotencyKey(INITIATIVE_CURATED_CONTRACT.sourceId, "finding:" + key)) continue;
        const card = initiativeActivity(candidate);
        const previously = (deps.seen ?? initiativeCardRecorded)(card.key!);
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

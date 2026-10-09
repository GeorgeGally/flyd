import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { CognitiveCurator } from "../cognition/curator/curator.js";
import { SourceContractRegistry } from "../intelligence/sensors/source-contracts.js";
import { preservesProtectedTokens, soundKey } from "./fidelity.js";
import type { ReplacementRule } from "./vocabulary.js";
import { loadVocabulary } from "./vocabulary.js";
import { createHash } from "node:crypto";

export function dictationScope(bundleId: string, windowTitle = ""): string {
  return createHash("sha256").update(bundleId + "\n" + windowTitle.trim().toLowerCase()).digest("hex");
}

export const CORRECTION_SOURCE = "dictation.corrections";
export const IMPORT_SOURCE = "conversation.import";
export function learningRegistry(): SourceContractRegistry {
  const registry = new SourceContractRegistry();
  for (const [sourceId, purpose] of [
    [CORRECTION_SOURCE, "Learn scoped vocabulary from edits to inserted dictation; retain changed terms and up to two neighbouring words per side. Three eligible independent corrections activate a contextual rule; recurrence reports remain local."],
    [IMPORT_SOURCE, "Learn project state from explicitly imported conversations; local history and derived claims share one erasable source."],
  ]) {
    const egressDestinations = sourceId === IMPORT_SOURCE
      ? ["configured-learning-model", "transcription-provider"]
      : ["transcription-provider"];
    const stored = registry.contract(sourceId);
    if (stored && stored.purpose === purpose && stored.egressDestinations?.join("\n") === egressDestinations.join("\n")) continue;
    registry.register({
      sourceId, displayName: sourceId, sensitivity: "medium", scopes: [sourceId],
      retentionClass: "local_default", egressDestinations, purpose,
    });
  }
  return registry;
}

export interface CorrectionCandidate extends ReplacementRule {
  sequence: number;
  invocationId: string;
  bundleId: string;
  approved: boolean;
  /** False until George approves or rejects it. */
  reviewed: boolean;
  scope: string;
  ruleId?: string;
  evidenceCount?: number;
  status?: "tentative" | "active" | "blocked" | "disabled";
  activation?: "manual" | "automatic";
  reason?: string;
  recurrences?: number;
  context?: { left: string[]; right: string[] };
  eligible?: boolean;
  capturedAt?: string;
  reviewSequence?: number;
}

export const CORRECTION_PROMOTION_THRESHOLD = 3;
const normalize = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const tokens = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];

/** Minimal neighbouring words, never the whole field, retained as application guards. */
function correctionContext(before: string, after: string): { left: string[]; right: string[] } {
  const a = before.trim().split(/\s+/), b = after.trim().split(/\s+/);
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return { left: tokens(a.slice(Math.max(0, start - 2), start).join(" ")).slice(-2), right: tokens(a.slice(endA, endA + 2).join(" ")).slice(0, 2) };
}

/** Repetition alone does not turn a changed intention into a spelling rule. */
function eligibleSpelling(pair: ReplacementRule): boolean {
  if (/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|dollars?|euros?|rupiah|meters?|metres?|kilograms?|hours?|minutes?|seconds?|yes|no|not|never|before|after|if|only)\b/i.test(pair.from + " " + pair.to)) return false;
  const a = normalize(pair.from).replace(/[ -]/g, ""), b = normalize(pair.to).replace(/[ -]/g, "");
  // Sound-alike verbs are not names. Only known vocabulary or distinctive
  // identifiers can become automatic rules; other pairs remain reviewable.
  if (!loadVocabulary().some(term => normalize(term) === normalize(pair.to)) &&
      !/[a-z][A-Z]/.test(pair.to) && !/^[A-Z]{2,5}$/.test(pair.to)) return false;
  if (a === b) return /[a-z][A-Z]|^[A-Z]{2,}$/.test(pair.to) || normalize(pair.from) !== normalize(pair.to);
  const key = soundKey(a);
  return key.length >= 3 && key === soundKey(b) && Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.6;
}

function identity(c: Pick<CorrectionCandidate, "from" | "to" | "scope" | "bundleId">): string {
  return createHash("sha256").update(JSON.stringify([c.bundleId, c.scope, normalize(c.from), normalize(c.to)])).digest("hex");
}

/** One small changed word/phrase. Larger rewrites and protected-slot changes aren't dictionary evidence. */
export function correctionPair(before: string, after: string): ReplacementRule | null {
  if (!before || !after || before.length > 4000 || after.length > 4000 || !preservesProtectedTokens(before, after)) return null;
  const a = before.trim().split(/\s+/), b = after.trim().split(/\s+/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const from = a.slice(start, endA).join(" ").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  const to = b.slice(start, endB).join(" ").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  if (!from || !to || from === to || endA - start > 2 || endB - start > 2) return null;
  if (!/^[\p{L}][\p{L} -]{0,47}$/u.test(from) || !/^[\p{L}][\p{L} -]{0,47}$/u.test(to)) return null;
  if (/\b(?:not|never|before|after|if|only|no|yes)\b/i.test(from + " " + to)) return null;
  return { from, to };
}

export function recordCorrection(input: { before: string; after: string; invocationId: string; bundleId: string; scope: string; observedAt?: string }): number | null {
  const registry = learningRegistry();
  if (registry.status(CORRECTION_SOURCE) !== "enabled") return null;
  if (input.observedAt !== undefined) {
    const observed = Date.parse(input.observedAt);
    const consent = registry.list().find(s => s.contract.sourceId === CORRECTION_SOURCE)?.state;
    if (!Number.isFinite(observed) || observed > Date.now() + 5000 || !consent || observed < Date.parse(consent.changedAt)) return null;
  }
  const pair = correctionPair(input.before, input.after);
  if (!pair || !input.invocationId || !input.bundleId || !/^[a-f0-9]{64}$/.test(input.scope)) return null;
  const store = new IntelligenceEventStore();
  const curator = new CognitiveCurator(store);
  try {
    return store.transaction(() => {
      const existing = correctionCandidates(store).find(c => c.bundleId === input.bundleId && c.invocationId === input.invocationId);
      if (existing) return existing.sequence;
      const context = correctionContext(input.before, input.after);
      return curator.recordObservation({ correction: pair, invocationId: input.invocationId, bundleId: input.bundleId, scope: input.scope,
        context, eligible: eligibleSpelling(pair), policyVersion: "voice-three-v1" },
        CORRECTION_SOURCE, { correlationId: input.invocationId });
    });
  } finally { store.close(); }
}

export function correctionCandidates(store: IntelligenceEventStore): CorrectionCandidate[] {
  const events = store.readSource(CORRECTION_SOURCE);
  const approvals = new Map<number, { approved: boolean; sequence: number }>();
  for (const event of events) if (event.payload?.review)
    approvals.set(Number(event.payload.review), { approved: event.payload.approved === true, sequence: event.sequence });
  const seenSessions = new Set<string>();
  const candidates: CorrectionCandidate[] = events.flatMap(event => {
    if (!event.payload?.correction || event.erased) return [];
    const p = event.payload, pair = p.correction as ReplacementRule;
    // A session can contribute one final correction only, regardless of transport retries.
    const sessionKey = String(p.bundleId) + "\u0000" + String(p.invocationId);
    if (seenSessions.has(sessionKey)) return [];
    seenSessions.add(sessionKey);
    return [{ ...pair, sequence: event.sequence, invocationId: String(p.invocationId), bundleId: String(p.bundleId),
      scope: String(p.scope), approved: approvals.get(event.sequence)?.approved === true, reviewed: approvals.has(event.sequence),
      reviewSequence: approvals.get(event.sequence)?.sequence,
      context: p.context as CorrectionCandidate["context"], eligible: p.eligible === true, capturedAt: event.capturedAt }];
  });
  const groups = new Map<string, CorrectionCandidate[]>();
  for (const c of candidates) {
    c.ruleId = identity(c);
    const group = groups.get(c.ruleId) ?? [];
    group.push(c); groups.set(c.ruleId, group);
  }
  const summaries = new Map<string, { manual: boolean; disabled: boolean; eligible: Set<number>; count: number; recurrences: number }>();
  const spellings = new Map<string, Set<string>>();
  const scopeKey = (c: CorrectionCandidate) => JSON.stringify([c.bundleId, c.scope, normalize(c.from)]);
  for (const [id, group] of groups) {
    const decision = group.reduce<CorrectionCandidate | undefined>((latest, e) =>
      e.reviewed && (e.reviewSequence ?? 0) > (latest?.reviewSequence ?? 0) ? e : latest, undefined);
    const manual = decision?.approved === true;
    const disabled = decision?.approved === false;
    const eligible = group.filter(e => e.eligible && e.context && e.context.left.length + e.context.right.length > 0);
    summaries.set(id, { manual, disabled, eligible: new Set(eligible.map(e => e.sequence)), count: eligible.length,
      recurrences: Math.max(0, eligible.length - CORRECTION_PROMOTION_THRESHOLD) });
    if (!disabled) {
      const key = scopeKey(group[0]), values = spellings.get(key) ?? new Set<string>();
      values.add(normalize(group[0].to)); spellings.set(key, values);
    }
  }
  return candidates.map(c => {
    const group = groups.get(c.ruleId!)!, summary = summaries.get(c.ruleId!)!;
    const { manual, disabled } = summary;
    const conflict = (spellings.get(scopeKey(c))?.size ?? 0) > 1;
    const safe = summary.eligible.has(c.sequence);
    const active = !disabled && !conflict && safe && summary.count >= CORRECTION_PROMOTION_THRESHOLD;
    return { ...c, approved: manual, reviewed: manual || disabled, evidenceCount: safe ? summary.count : group.length,
      status: manual ? "active" : disabled ? "disabled" : conflict || !safe ? "blocked" : active ? "active" : "tentative",
      activation: manual ? "manual" : active ? "automatic" : undefined,
      reason: manual ? "Explicit approval" : disabled ? "Rejected evidence; explicit approval required" :
        conflict ? "Conflicting spelling in this scope" : !safe ? "Needs review: spelling or context is ambiguous" :
        active ? "Three independent spelling corrections" : "Tentative spelling hint",
      recurrences: active ? summary.recurrences : 0,
    };
  });
}

export interface ReviewedVocabulary {
  /** Explicit replacements are app-wide; automatic replacements require window and context. */
  rules: ReplacementRule[];
  /** Approved terms globally, then eligible tentative/automatic terms in this window. */
  terms: string[];
}

/**
 * What George approved, for one dictation target. A spelling he approved is his
 * vocabulary everywhere, so its term biases every transcription; the replacement
 * itself stays in the app it was learned in, so "flight → Flyd" from a terminal
 * never rewrites a real flight in Mail. Conflicting spellings are withheld.
 */
export function reviewedVocabulary(store: IntelligenceEventStore, bundleId: string, windowTitle = ""): ReviewedVocabulary {
  if (learningRegistry().status(CORRECTION_SOURCE) !== "enabled") return { rules: [], terms: [] };
  const candidates = correctionCandidates(store);
  const approved = candidates.filter(c => c.approved);
  const scope = dictationScope(bundleId, windowTitle);
  // null marks a spelling withheld because its narrowest tier disagrees with itself.
  const rules = new Map<string, ReplacementRule | null>();
  for (const tier of [approved.filter(c => c.scope === scope), approved.filter(c => c.bundleId === bundleId)]) {
    const spellings = new Map<string, Set<string>>();
    for (const c of tier) spellings.set(c.from.toLowerCase(), (spellings.get(c.from.toLowerCase()) ?? new Set()).add(c.to));
    for (const c of tier) {
      const key = c.from.toLowerCase();
      if (!rules.has(key)) rules.set(key, spellings.get(key)!.size === 1 ? { from: c.from, to: c.to } : null);
    }
  }
  const automatic = candidates.filter(c => c.activation === "automatic" && c.status === "active" && c.scope === scope && c.bundleId === bundleId);
  const contextualGroups = new Map<string, CorrectionCandidate[]>();
  for (const c of automatic) {
    const group = contextualGroups.get(c.ruleId!) ?? [];
    group.push(c); contextualGroups.set(c.ruleId!, group);
  }
  for (const group of contextualGroups.values()) {
    const c = group[0];
    const key = c.from.toLowerCase();
    if (rules.has(key)) continue; // Explicit decisions, including conflicts, remain authoritative.
    const contexts = group.map(e => e.context!).filter(Boolean);
    rules.set(key, { from: c.from, to: c.to, contexts });
  }
  const hinted = candidates.filter(c => c.bundleId === bundleId && c.scope === scope &&
    (c.status === "tentative" || c.activation === "automatic" && c.status === "active"));
  return {
    rules: [...rules.values()].filter((rule): rule is ReplacementRule => rule !== null),
    terms: [...new Set([...approved.reverse(), ...hinted.reverse()].map(c => c.to))],
  };
}

export function reviewedRules(bundleId: string, windowTitle = ""): ReplacementRule[] {
  const store = new IntelligenceEventStore();
  try { return reviewedVocabulary(store, bundleId, windowTitle).rules; } finally { store.close(); }
}

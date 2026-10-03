import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { CognitiveCurator } from "../cognition/curator/curator.js";
import { SourceContractRegistry } from "../intelligence/sensors/source-contracts.js";
import { preservesProtectedTokens } from "./fidelity.js";
import type { ReplacementRule } from "./vocabulary.js";
import { createHash } from "node:crypto";

export function dictationScope(bundleId: string, windowTitle = ""): string {
  return createHash("sha256").update(bundleId + "\n" + windowTitle.trim().toLowerCase()).digest("hex");
}

export const CORRECTION_SOURCE = "dictation.corrections";
export const IMPORT_SOURCE = "conversation.import";
export function learningRegistry(): SourceContractRegistry {
  const registry = new SourceContractRegistry();
  for (const [sourceId, purpose] of [
    [CORRECTION_SOURCE, "Learn reviewed vocabulary corrections from edits to explicitly inserted dictation; only changed terms are retained."],
    [IMPORT_SOURCE, "Learn project state from explicitly imported conversations; local history and derived claims share one erasable source."],
  ]) if (!registry.contract(sourceId)) registry.register({
    sourceId, displayName: sourceId, sensitivity: "medium", scopes: [sourceId],
    retentionClass: "local_default", egressDestinations: sourceId === IMPORT_SOURCE ? ["configured-learning-model"] : [],
    purpose,
  });
  return registry;
}

export interface CorrectionCandidate extends ReplacementRule {
  sequence: number;
  invocationId: string;
  bundleId: string;
  approved: boolean;
  scope: string;
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
  if (!from || !to || from.toLowerCase() === to.toLowerCase() || endA - start > 2 || endB - start > 2) return null;
  if (!/^[\p{L}][\p{L} -]{0,47}$/u.test(from) || !/^[\p{L}][\p{L} -]{0,47}$/u.test(to)) return null;
  if (/\b(?:not|never|before|after|if|only|no|yes)\b/i.test(from + " " + to)) return null;
  return { from, to };
}

export function recordCorrection(input: { before: string; after: string; invocationId: string; bundleId: string; scope: string }): number | null {
  if (learningRegistry().status(CORRECTION_SOURCE) !== "enabled") return null;
  const pair = correctionPair(input.before, input.after);
  if (!pair || !input.invocationId || !input.bundleId || !/^[a-f0-9]{64}$/.test(input.scope)) return null;
  const curator = new CognitiveCurator();
  try {
    return curator.recordObservation({ correction: pair, invocationId: input.invocationId, bundleId: input.bundleId, scope: input.scope },
      CORRECTION_SOURCE, { correlationId: input.invocationId });
  } finally { curator.close(); }
}

export function correctionCandidates(store: IntelligenceEventStore): CorrectionCandidate[] {
  const events = [];
  for (let seq = 0;;) {
    const batch = store.readFrom(seq);
    if (!batch.length) break;
    events.push(...batch); seq = batch[batch.length - 1].sequence;
  }
  const approvals = new Map<number, boolean>();
  for (const event of events) if (event.sourceId === CORRECTION_SOURCE && event.payload?.review)
    approvals.set(Number(event.payload.review), event.payload.approved === true);
  return events.flatMap(event => {
    if (event.sourceId !== CORRECTION_SOURCE || !event.payload?.correction || event.erased) return [];
    const p = event.payload, pair = p.correction as ReplacementRule;
    return [{ ...pair, sequence: event.sequence, invocationId: String(p.invocationId), bundleId: String(p.bundleId),
      scope: String(p.scope), approved: approvals.get(event.sequence) === true }];
  });
}

export function reviewedRules(bundleId: string, windowTitle = ""): ReplacementRule[] {
  if (learningRegistry().status(CORRECTION_SOURCE) !== "enabled") return [];
  const store = new IntelligenceEventStore();
  try {
    const grouped = new Map<string, Set<string>>();
    const rules = correctionCandidates(store).filter(c => c.approved && c.bundleId === bundleId && c.scope === dictationScope(bundleId, windowTitle));
    for (const rule of rules) {
      const key = rule.from.toLowerCase(); const tos = grouped.get(key) ?? new Set<string>();
      tos.add(rule.to); grouped.set(key, tos);
    }
    return rules.filter(r => grouped.get(r.from.toLowerCase())?.size === 1).map(({ from, to }) => ({ from, to }));
  } finally { store.close(); }
}

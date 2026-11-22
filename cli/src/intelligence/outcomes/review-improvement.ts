import { createHash } from "node:crypto";
import type { IntelligenceEventStore } from "../event-store.js";
import { parseExecutiveDecision } from "../executive/decision-step.js";
import { outcomeReviews } from "./outcome-review.js";

/** Aggregate evidence only. Never a raw user quote or a numerical effect. */
export interface NegativeReviewPattern {
  id: string;
  kind: "review";
  at: string;
  text: string;
}

const MILESTONES = [3, 5, 10] as const;

/**
 * Explicit negatives on independently verified results, grouped by the
 * actual executive input source and policy version. Review corrections and
 * source erasure retract a cluster; one bad rating is never generalized.
 *
 * Caller MUST check the opt-in LEARN source before forwarding this aggregate
 * to the configured improvement model. This function does no provider I/O.
 */
export function negativeOutcomeReviewPatterns(
  store: IntelligenceEventStore,
  options: { since: string; now: Date },
): NegativeReviewPattern[] {
  const latestReviews = outcomeReviews(store, 1000);
  const groups = new Map<string, { ids: Set<string>; dates: string[] }>();
  const seen = new Set<string>();
  for (const event of store.readSourcePage("executive.cycle", { limit: 1000 })) {
    const decision = parseExecutiveDecision(event.payload?.decision);
    if (!decision || seen.has(decision.decisionId)) continue;
    seen.add(decision.decisionId);
    if (!decision.show || decision.disposition !== "handle_internally"
      || decision.verification.status !== "verified"
      || !decision.verification.evidenceRefs.length) continue;
    const review = latestReviews.get(decision.decisionId);
    if (!review || review.verdict !== "not_helpful"
      || review.at < options.since || Date.parse(review.at) > options.now.getTime()) continue;
    const groupKey = JSON.stringify([decision.sourceId, event.policyVersion ?? "unknown-policy"]);
    const group = groups.get(groupKey) ?? { ids: new Set<string>(), dates: [] };
    group.ids.add(decision.decisionId);
    group.dates.push(review.at);
    groups.set(groupKey, group);
  }

  const patterns: NegativeReviewPattern[] = [];
  for (const [groupKey, group] of groups) {
    const milestone = [...MILESTONES].reverse().find((n) => group.ids.size >= n);
    if (!milestone) continue;
    const signature = createHash("sha256").update(groupKey).digest("hex").slice(0, 16);
    patterns.push({
      id: "review-cluster:" + signature + ":" + milestone,
      kind: "review",
      at: group.dates.sort().at(-1)!,
      text: "At least " + milestone + " distinct, independently verified results from one executive source and policy were explicitly rated not helpful. These may be different tasks. This concerns usefulness, not proof that execution failed. Investigate whether the results served the user's goal; prefer a measurable test before any proposed change. An improvement remains human-gated; no policy may be activated from this evidence alone.",
    });
  }
  return patterns.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

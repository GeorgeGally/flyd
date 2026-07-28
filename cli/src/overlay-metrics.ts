/**
 * Per-tier success counters for the overlay resolution paths. Pure counts —
 * privacy invariant #9: telemetry carries no string fields, ever.
 *
 * Reading the scoreboard:
 * - deterministic hit rate falling → regex patterns eroding
 * - regex_fallback rising → classifier timing out or misbehaving
 * - route_divergence → misroutes the regex router was making (classifier
 *   and regex disagreed; classifier won)
 * - consequential rate spiking → over-gating
 * - completion rejections nonzero → runners claiming unverified work,
 *   caught exactly where the completion rule intends
 */

export interface OverlayMetricsSnapshot {
  deterministic_resolutions: number;
  llm_resolutions: number;
  route_source_classifier: number;
  route_source_regex_fallback: number;
  route_source_regex_unconfigured: number;
  route_divergence: number;
  consequential_flagged: number;
  delegation_completions_accepted: number;
  delegation_completions_rejected_validation: number;
  delegation_completions_rejected_reverification: number;
}

function zeroed(): OverlayMetricsSnapshot {
  return {
    deterministic_resolutions: 0,
    llm_resolutions: 0,
    route_source_classifier: 0,
    route_source_regex_fallback: 0,
    route_source_regex_unconfigured: 0,
    route_divergence: 0,
    consequential_flagged: 0,
    delegation_completions_accepted: 0,
    delegation_completions_rejected_validation: 0,
    delegation_completions_rejected_reverification: 0,
  };
}

let counters = zeroed();

export function recordDeterministicResolution(): void {
  counters.deterministic_resolutions += 1;
}

export function recordLlmResolution(): void {
  counters.llm_resolutions += 1;
}

export function recordRouteSource(source: "classifier" | "regex_fallback" | "regex_unconfigured"): void {
  if (source === "classifier") counters.route_source_classifier += 1;
  else if (source === "regex_fallback") counters.route_source_regex_fallback += 1;
  else counters.route_source_regex_unconfigured += 1;
}

export function recordRouteDivergence(): void {
  counters.route_divergence += 1;
}

export function recordConsequentialFlagged(): void {
  counters.consequential_flagged += 1;
}

export function recordDelegationCompletion(outcome: "accepted" | "rejected_validation" | "rejected_reverification"): void {
  if (outcome === "accepted") counters.delegation_completions_accepted += 1;
  else if (outcome === "rejected_validation") counters.delegation_completions_rejected_validation += 1;
  else counters.delegation_completions_rejected_reverification += 1;
}

export function overlayMetricsSnapshot(): OverlayMetricsSnapshot {
  return { ...counters };
}

export function resetOverlayMetrics(): void {
  counters = zeroed();
}

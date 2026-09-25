import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { evaluatePredicates } from "./jev.js";
import { systemOnePolicyFingerprint } from "./policy.js";
import { predicateDefinition, questionFor, questionFingerprint, type PredicateDefinition } from "./registry.js";
import type { JevOptions, JudgmentTrace, PredicateAnswer, RawJevAnswer } from "./types.js";

/**
 * System-1 replay harness.
 *
 * Replays a frozen suite of labelled, synthetic traces through registry
 * predicates and scores each one against its labels next to FLYD's current
 * non-Jev behaviour. Deterministic by default: Jev answers come from
 * recorded judgment traces and flow through the real client
 * (`evaluatePredicates`) via an injected fetch, so parsing, egress and
 * thresholds are exercised exactly as in production. Live mode calls Jev and
 * returns fresh traces that can be frozen as the next recordings.
 *
 * Decision rule per answer:
 * - Choice: the chosen option when confidence ≥ threshold (always when the
 *   threshold is null), otherwise abstain.
 * - Noul/Score: yes when probability ≥ threshold, no when probability ≤
 *   1 − threshold, abstain in between.
 * - Missing, stale or failed judgments abstain.
 * `hybrid` is what a gated switch-on would do: Jev when it decides, the
 * current behaviour when it abstains.
 */

export type ReplayLabel = boolean | string;
export type ReplayDecision = ReplayLabel | "abstain";

export interface ReplayCase {
  id: string;
  suite: string;
  /** Fixtures must be synthetic; personal traces never enter the suite. */
  synthetic: true;
  source?: string;
  inputs: Record<string, unknown>;
  /** Expected answer per predicate id. */
  labels: Record<string, ReplayLabel>;
}

/** Current non-Jev behaviour for a predicate; null means it cannot decide. */
export type BaselineFn = (inputs: Record<string, unknown>) => ReplayLabel | null;

export interface ReplayOptions {
  mode: "recorded" | "live";
  recordings?: readonly JudgmentTrace[];
  /** Live mode only: API key, pinned model, endpoint. */
  jev?: JevOptions;
  baselines?: Readonly<Record<string, BaselineFn>>;
}

export interface ArmStats {
  correct: number;
  wrong: number;
  abstained: number;
  accuracy: number;
  decidedAccuracy: number | null;
  abstainRate: number;
  latencyMs: { p50: number | null; p90: number | null };
}

export interface ReplayRow {
  caseId: string;
  label: ReplayLabel;
  jev: ReplayDecision;
  jevDetail?: string;
  baseline: ReplayDecision;
}

export interface PredicateReplayReport {
  predicateId: string;
  family: string;
  status: string;
  evaluatorVersion: string;
  threshold: number | null;
  cases: number;
  models: string[];
  jev: ArmStats;
  baseline: ArmStats & { available: boolean };
  hybrid: { correct: number; accuracy: number };
  unreplayable: { missing: string[]; stale: string[]; errors: string[] };
  rows: ReplayRow[];
}

export interface ReplayReport {
  mode: "recorded" | "live";
  policyFingerprint: string;
  predicates: PredicateReplayReport[];
  /** Fresh traces from live mode, ready to freeze as recordings. */
  traces: JudgmentTrace[];
}

export function parseJsonl<T>(text: string): T[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("//")).map((line) => JSON.parse(line) as T);
}

export function loadReplayCases(path: string): ReplayCase[] {
  const cases = parseJsonl<ReplayCase>(readFileSync(path, "utf8"));
  for (const c of cases) {
    if (c.synthetic !== true) throw new Error(`Replay case ${c.id} is not marked synthetic; personal traces never enter the suite`);
    if (!c.id || !c.labels || !c.inputs) throw new Error(`Replay case ${c.id ?? "(no id)"} is malformed`);
  }
  return cases;
}

export function loadJudgmentTraces(path: string): JudgmentTrace[] {
  return parseJsonl<JudgmentTrace>(readFileSync(path, "utf8"));
}

export function serializeJudgmentTraces(traces: readonly JudgmentTrace[]): string {
  return traces.map((trace) => JSON.stringify(trace)).join("\n") + "\n";
}

/** Only the fields the predicate declares may reach Jev. */
export function projectInputs(definition: PredicateDefinition, inputs: Record<string, unknown>, caseId: string): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const field of definition.projection) {
    if (!(field in inputs)) throw new Error(`Replay case ${caseId} lacks field "${field}" for predicate ${definition.id}`);
    state[field] = inputs[field];
  }
  return state;
}

export function decide(definition: PredicateDefinition, answer: PredicateAnswer | undefined): ReplayDecision {
  if (!answer) return "abstain";
  if (definition.type === "choice") {
    if (!answer.choice) return "abstain";
    return definition.threshold === null || answer.confidence >= definition.threshold ? answer.choice : "abstain";
  }
  const threshold = definition.threshold ?? 0.5;
  if (answer.probability >= threshold) return true;
  if (answer.probability <= 1 - threshold) return false;
  return "abstain";
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

function armStats(decisions: Array<{ decision: ReplayDecision; label: ReplayLabel }>, latencies: number[]): ArmStats {
  const correct = decisions.filter((d) => d.decision !== "abstain" && d.decision === d.label).length;
  const abstained = decisions.filter((d) => d.decision === "abstain").length;
  const wrong = decisions.length - correct - abstained;
  const decided = decisions.length - abstained;
  return {
    correct, wrong, abstained,
    accuracy: decisions.length ? correct / decisions.length : 0,
    decidedAccuracy: decided ? correct / decided : null,
    abstainRate: decisions.length ? abstained / decisions.length : 0,
    latencyMs: { p50: percentile(latencies, 50), p90: percentile(latencies, 90) },
  };
}

function recordedFetch(trace: JudgmentTrace): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: trace.model,
      answers: { [trace.predicateId]: trace.answer },
      ...(trace.usage ? { usage: { input_tokens: trace.usage.inputTokens, output_tokens: trace.usage.outputTokens } } : {}),
    }),
  })) as unknown as typeof fetch;
}

/** Wraps a real fetch so the raw API body can be frozen into a trace. */
function capturingFetch(base: typeof fetch, sink: { body?: { model?: string; answers?: Record<string, RawJevAnswer>; usage?: { input_tokens?: number; output_tokens?: number } } }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await base(input, init);
    if (!response.ok) return response;
    sink.body = await response.json();
    return { ok: true, status: response.status, json: async () => sink.body } as unknown as Response;
  }) as typeof fetch;
}

function describeAnswer(answer: PredicateAnswer | undefined): string | undefined {
  if (!answer) return undefined;
  if (answer.type === "choice") return `${answer.choice} c=${answer.confidence.toFixed(2)}`;
  return `p=${answer.probability.toFixed(2)}`;
}

export async function replayPredicates(cases: readonly ReplayCase[], options: ReplayOptions): Promise<ReplayReport> {
  const recordings = new Map((options.recordings ?? []).map((trace) => [`${trace.caseId}::${trace.predicateId}`, trace]));
  const predicateIds = [...new Set(cases.flatMap((c) => Object.keys(c.labels)))];
  const traces: JudgmentTrace[] = [];
  const models = new Set<string>();
  const reports: PredicateReplayReport[] = [];

  for (const predicateId of predicateIds) {
    const definition = predicateDefinition(predicateId);
    const fingerprint = questionFingerprint(predicateId);
    const question = questionFor(predicateId);
    const egress = { purpose: `replay.${definition.family}`, allowedFields: definition.projection };
    const baseline = options.baselines?.[predicateId];
    const rows: ReplayRow[] = [];
    const jevLatencies: number[] = [];
    const baselineLatencies: number[] = [];
    const unreplayable = { missing: [] as string[], stale: [] as string[], errors: [] as string[] };
    const predicateModels = new Set<string>();

    for (const c of cases) {
      if (!(predicateId in c.labels)) continue;
      const label = c.labels[predicateId];
      const state = projectInputs(definition, c.inputs, c.id);

      let answer: PredicateAnswer | undefined;
      if (options.mode === "recorded") {
        const trace = recordings.get(`${c.id}::${predicateId}`);
        if (!trace) unreplayable.missing.push(c.id);
        else if (trace.questionFingerprint !== fingerprint || trace.evaluatorVersion !== definition.evaluatorVersion) unreplayable.stale.push(c.id);
        else {
          const evaluation = await evaluatePredicates(state, [question], { apiKey: "replay", fetchFn: recordedFetch(trace) }, egress);
          if (!evaluation.ok) unreplayable.errors.push(`${c.id}: ${evaluation.error}`);
          answer = evaluation.answers[predicateId];
          jevLatencies.push(trace.latencyMs);
          predicateModels.add(trace.model);
        }
      } else {
        const sink: Parameters<typeof capturingFetch>[1] = {};
        const evaluation = await evaluatePredicates(
          state,
          [question],
          { ...options.jev, fetchFn: capturingFetch(options.jev?.fetchFn ?? fetch, sink) },
          egress,
        );
        if (!evaluation.ok || !sink.body?.answers?.[predicateId]) {
          unreplayable.errors.push(`${c.id}: ${evaluation.error ?? "no answer"}`);
        } else {
          answer = evaluation.answers[predicateId];
          jevLatencies.push(evaluation.latencyMs);
          const model = sink.body.model ?? evaluation.model ?? "unknown";
          predicateModels.add(model);
          traces.push({
            caseId: c.id,
            predicateId,
            evaluatorVersion: definition.evaluatorVersion,
            questionFingerprint: fingerprint,
            projectionHash: evaluation.projectionHash,
            model,
            answer: sink.body.answers[predicateId],
            latencyMs: evaluation.latencyMs,
            ...(evaluation.usage ? { usage: evaluation.usage } : {}),
            recordedAt: evaluation.evaluatedAt,
          });
        }
      }

      let baselineDecision: ReplayDecision = "abstain";
      if (baseline) {
        const started = performance.now();
        const value = baseline(c.inputs);
        baselineLatencies.push(performance.now() - started);
        baselineDecision = value === null ? "abstain" : value;
      }
      const jevDetail = describeAnswer(answer);
      rows.push({ caseId: c.id, label, jev: decide(definition, answer), ...(jevDetail ? { jevDetail } : {}), baseline: baselineDecision });
    }

    for (const model of predicateModels) models.add(model);
    const hybridCorrect = rows.filter((r) => (r.jev !== "abstain" ? r.jev : r.baseline) === r.label).length;
    reports.push({
      predicateId,
      family: definition.family,
      status: definition.status,
      evaluatorVersion: definition.evaluatorVersion,
      threshold: definition.threshold,
      cases: rows.length,
      models: [...predicateModels],
      jev: armStats(rows.map((r) => ({ decision: r.jev, label: r.label })), jevLatencies),
      baseline: { available: Boolean(baseline), ...armStats(rows.map((r) => ({ decision: r.baseline, label: r.label })), baselineLatencies) },
      hybrid: { correct: hybridCorrect, accuracy: rows.length ? hybridCorrect / rows.length : 0 },
      unreplayable,
      rows,
    });
  }

  const [model] = [...models];
  return {
    mode: options.mode,
    policyFingerprint: systemOnePolicyFingerprint(models.size === 1 ? model : [...models].sort().join("+") || "none"),
    predicates: reports,
    traces,
  };
}

function pct(value: number | null): string {
  return value === null ? "  –  " : `${(value * 100).toFixed(0).padStart(3)}%`;
}

function ms(value: number | null): string {
  return value === null ? "–" : `${value < 10 ? value.toFixed(2) : Math.round(value)}ms`;
}

/** Plain-text table for eval output. */
export function formatReplayReport(report: ReplayReport): string {
  const lines = [
    `System-1 replay (${report.mode}) · policy ${report.policyFingerprint}`,
    "predicate                    status      n  | jev acc  abstain  p50/p90          | current acc  abstain | jev+fallback",
  ];
  for (const p of report.predicates) {
    lines.push(
      `${p.predicateId.padEnd(28)} ${p.status.padEnd(10)} ${String(p.cases).padStart(3)} | ${pct(p.jev.accuracy)}    ${pct(p.jev.abstainRate)}   ${`${ms(p.jev.latencyMs.p50)}/${ms(p.jev.latencyMs.p90)}`.padEnd(16)} | ${p.baseline.available ? `${pct(p.baseline.accuracy)}         ${pct(p.baseline.abstainRate)}` : "n/a (no incumbent)  "} | ${pct(p.hybrid.accuracy)}`,
    );
    for (const row of p.rows) {
      if (row.jev === row.label && row.baseline === row.label) continue;
      lines.push(`    ${row.caseId.padEnd(26)} label=${String(row.label)} jev=${String(row.jev)}${row.jevDetail ? ` (${row.jevDetail})` : ""} current=${String(row.baseline)}`);
    }
    const { missing, stale, errors } = p.unreplayable;
    if (missing.length || stale.length || errors.length) {
      lines.push(`    unreplayable: missing=${missing.length} stale=${stale.length} errors=${errors.length}`);
    }
  }
  return lines.join("\n");
}

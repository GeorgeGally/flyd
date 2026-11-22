import { createHash } from "node:crypto";
import type { ContextEnvelope } from "../../intelligence/context-envelope.js";
import { EgressPolicyGateway } from "../../intelligence/egress-policy-gateway.js";
import { recordJevHealth } from "./health.js";
import type {
  JevFailureKind,
  JevOptions,
  PredicateAnswer,
  PredicateEgress,
  PredicateEvaluation,
  PredicateQuestion,
  PredicateQuestionType,
  RawJevAnswer,
} from "./types.js";

const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_TIMEOUT_MS = 1200;

/**
 * Exact Jev release the predicate thresholds and replay recordings were
 * measured against. Production keeps `jev-latest` unless `FLYD_JEV_MODEL`
 * (or `JevOptions.model`) pins a version; evals pin this one so thresholds
 * stay comparable across Jev releases.
 */
export const JEV_PINNED_MODEL = "jev-1.13.0";

/** Jev 1.13 pricing: input tokens only, output tokens are free (docs.typesafe.ai/models). */
export const JEV_INPUT_USD_PER_MILLION_TOKENS = 0.042;

const NOUL_DEFAULT_CRITERIA = { true: "The state satisfies this criterion.", false: "The state does not satisfy this criterion." };

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const MAX_STRING = 1200;
const MAX_ARRAY = 80;
const MAX_KEYS = 64;
const MAX_DEPTH = 6;
const MAX_EGRESS_BYTES = 64 * 1024;

function redactString(value: string): string {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED_SECRET]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .slice(0, MAX_STRING);
}

function boundValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((item) => boundValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_KEYS)
        .map(([key, child]) => [key, boundValue(child, depth + 1)]),
    );
  }
  return String(value).slice(0, MAX_STRING);
}

function boundedState(state: Record<string, unknown>): Record<string, unknown> {
  return boundValue(state) as Record<string, unknown>;
}

/** Expose exactly the redacted projection for private routing replay. */
export function projectJevState(state: Record<string, unknown>): Record<string, unknown> {
  return boundedState(state);
}

/** SHA-256 of the bounded, redacted state exactly as it would leave the machine. */
export function stateProjectionHash(state: Record<string, unknown>): string {
  return hash(boundedState(state));
}

/** The Jev release System-1 asks by default: FLYD_JEV_MODEL, else BEACON_JEV_MODEL, else jev-latest. */
export function jevModel(): string {
  return process.env.FLYD_JEV_MODEL ?? process.env.BEACON_JEV_MODEL ?? DEFAULT_MODEL;
}

function envOptions(options: JevOptions): Required<Pick<JevOptions, "endpoint" | "model" | "timeoutMs" | "rubricVersion">> & JevOptions {
  return {
    ...options,
    endpoint: options.endpoint ?? process.env.FLYD_JEV_ENDPOINT ?? process.env.BEACON_JEV_ENDPOINT ?? DEFAULT_ENDPOINT,
    apiKey: options.apiKey ?? process.env.TYPESAFE_API_KEY ?? process.env.FLYD_JEV_API_KEY ?? process.env.BEACON_JEV_API_KEY,
    model: options.model ?? jevModel(),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    rubricVersion: options.rubricVersion ?? "flyd.system-one.v1",
    fetchFn: options.fetchFn ?? fetch,
  };
}

/**
 * Request shape per docs.typesafe.ai/api: Noul criteria are optional
 * `{true,false}`, Choice criteria are an option→description map, and Score
 * criteria are an ordered array of at least two levels.
 */
export function wireQuestion(q: PredicateQuestion): { type: PredicateQuestionType; instructions: string; criteria: unknown } {
  const type = q.type ?? "noul";
  if (type === "score") {
    const levels = Array.isArray(q.criteria) ? [...q.criteria] : Object.values(q.criteria ?? {});
    if (levels.length < 2) throw new Error(`invalid_question:${q.id}:score_needs_levels`);
    return { type, instructions: q.instructions, criteria: levels };
  }
  if (type === "choice") {
    if (!q.criteria || Array.isArray(q.criteria) || Object.keys(q.criteria).length < 2) {
      throw new Error(`invalid_question:${q.id}:choice_needs_options`);
    }
    return { type, instructions: q.instructions, criteria: q.criteria };
  }
  if (Array.isArray(q.criteria)) throw new Error(`invalid_question:${q.id}:noul_criteria_must_be_map`);
  return { type, instructions: q.instructions, criteria: q.criteria ?? NOUL_DEFAULT_CRITERIA };
}

function clamp01(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/** Normalise one raw API answer into FLYD's predicate answer. */
export function normalizeAnswer(q: PredicateQuestion, raw: RawJevAnswer): PredicateAnswer {
  const type = q.type ?? (raw.type as PredicateQuestionType | undefined) ?? "noul";
  const confidence = clamp01(raw.confidence ?? 0);
  if (type === "choice") {
    const probabilities = raw.probabilities ?? {};
    const choice = raw.choice ?? Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      id: q.id, type, confidence,
      probability: clamp01(choice !== undefined ? probabilities[choice] ?? 0 : 0),
      ...(choice !== undefined ? { choice } : {}),
      probabilities,
    };
  }
  if (type === "score") {
    const levels = Array.isArray(q.criteria) ? q.criteria.length : Object.keys(q.criteria ?? raw.legend ?? {}).length;
    const score = Number(raw.score ?? 0);
    return {
      id: q.id, type, confidence,
      probability: levels > 1 ? clamp01(score / (levels - 1)) : 0,
      score,
      levels,
      ...(raw.probabilities ? { probabilities: raw.probabilities } : {}),
    };
  }
  return { id: q.id, type, confidence, probability: clamp01(raw.noul ?? raw.probability ?? 0) };
}

function jevEnvelope(purpose: string, idempotencyKey: string): ContextEnvelope {
  return {
    pathKind: "interface",
    kind: "inferred_belief",
    sourceId: `system-one.${purpose}`,
    consent: { grantedAt: new Date(0).toISOString(), scopes: [] },
    retentionClass: "ephemeral",
    payloadClassification: "personal",
    provenance: "flyd.system-one.jev",
    idempotencyKey,
  };
}

export async function evaluatePredicates(
  state: Record<string, unknown>,
  questions: PredicateQuestion[],
  options: JevOptions = {},
  egress?: PredicateEgress,
): Promise<PredicateEvaluation> {
  const evaluation = await evaluate(state, questions, options, egress);
  if (options.reportHealth !== false) recordJevHealth(evaluation);
  return evaluation;
}

async function httpFailureKind(response: Response): Promise<JevFailureKind> {
  // Error bodies are used only to distinguish billing/quota from a temporary
  // rate limit. Never persist or log them: providers can echo private input.
  const detail = (typeof response.text === "function"
    ? await response.text().catch(() => "")
    : JSON.stringify(await response.json().catch(() => null)) ?? "").slice(0, 4000);
  if ([400, 402, 403, 429].includes(response.status)
    && /insufficient[_ -]?(?:credits?|balance|funds|quota)|out of credits?|credit balance|(?:quota|credits?) (?:exceeded|exhausted)|(?:quota|credit)[_-]exceeded/i.test(detail)) return "credits_exhausted";
  if (response.status === 402) return "billing";
  if (response.status === 401 || response.status === 403) return "authentication";
  if (response.status === 429) return "rate_limited";
  return "provider_unavailable";
}

async function evaluate(
  state: Record<string, unknown>,
  questions: PredicateQuestion[],
  options: JevOptions = {},
  egress?: PredicateEgress,
): Promise<PredicateEvaluation> {
  const opts = envOptions(options);
  const started = Date.now();
  const projection = boundedState(state);
  const projectionHash = stateProjectionHash(state);
  const explicitlyEnabled = options.apiKey !== undefined || process.env.FLYD_JEV_ENABLED === "true";
  if (!explicitlyEnabled || !opts.apiKey || questions.length === 0) {
    return {
      ok: false, evaluator: "none", model: opts.model, rubricVersion: opts.rubricVersion,
      projectionHash, answers: {}, evaluatedAt: new Date().toISOString(), latencyMs: Date.now() - started,
      error: !explicitlyEnabled ? "jev_not_enabled" : !opts.apiKey ? "jev_not_configured" : "no_questions",
      ...(explicitlyEnabled && !opts.apiKey && questions.length ? { failureKind: "not_configured" as const } : {}),
    };
  }

  const failed = (error: string, extra: Partial<PredicateEvaluation> = {}): PredicateEvaluation => ({
    ok: false, evaluator: "jev", model: opts.model, rubricVersion: opts.rubricVersion,
    projectionHash, answers: {}, evaluatedAt: new Date().toISOString(), latencyMs: Date.now() - started,
    ...extra, error,
  });

  let questionMap: Record<string, ReturnType<typeof wireQuestion>>;
  try {
    questionMap = Object.fromEntries(questions.map((q) => [q.id, wireQuestion(q)]));
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }

  // Every Jev call crosses the egress gateway: undeclared top-level fields,
  // sensitive fields without consent scope, a revoked source, or an oversized
  // payload deny the whole call before anything leaves the machine.
  const purpose = egress?.purpose ?? "unspecified";
  const receipt = new EgressPolicyGateway(opts.consentLookup ?? { isRevoked: () => false }).check(
    jevEnvelope(purpose, projectionHash),
    {
      destination: opts.endpoint,
      purpose,
      fields: Object.keys(projection),
      payload: projection,
      schema: { allowedFields: [...(egress?.allowedFields ?? Object.keys(projection))], maxPayloadBytes: MAX_EGRESS_BYTES },
    },
  );
  if (!receipt.allowed || !receipt.outboundPayload) {
    return failed(`egress_denied: ${receipt.reason ?? "no outbound payload"}`, { egressReceiptId: receipt.receiptId });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let receivedResponse = false;
  try {
    const response = await opts.fetchFn!(opts.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({ model: opts.model, state: receipt.outboundPayload, questions: questionMap }),
      signal: controller.signal,
    });
    receivedResponse = true;
    if (!response.ok) return failed(`jev_http_${response.status}`, {
      egressReceiptId: receipt.receiptId,
      httpStatus: response.status,
      failureKind: await httpFailureKind(response),
    });
    const body = await response.json() as {
      model?: string;
      answers?: Record<string, RawJevAnswer>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const answers: Record<string, PredicateAnswer> = {};
    for (const q of questions) {
      const raw = body.answers?.[q.id];
      if (raw) answers[q.id] = normalizeAnswer(q, raw);
    }
    const inputTokens = Number(body.usage?.input_tokens);
    const usage = Number.isFinite(inputTokens)
      ? { inputTokens, outputTokens: Number(body.usage?.output_tokens) || 0 }
      : undefined;
    return {
      ok: Object.keys(answers).length > 0,
      evaluator: "jev",
      model: body.model ?? opts.model,
      rubricVersion: opts.rubricVersion,
      projectionHash,
      answers,
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      egressReceiptId: receipt.receiptId,
      ...(Object.keys(answers).length === 0 ? { error: "jev_missing_answers", failureKind: "invalid_response" as const } : {}),
      ...(usage ? { usage, costUSD: (usage.inputTokens * JEV_INPUT_USD_PER_MILLION_TOKENS) / 1_000_000 } : {}),
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), {
      egressReceiptId: receipt.receiptId,
      failureKind: controller.signal.aborted ? "timeout" : receivedResponse ? "invalid_response" : "network",
    });
  } finally {
    clearTimeout(timer);
  }
}

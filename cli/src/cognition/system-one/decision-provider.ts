import { createHash } from "node:crypto";
import type { ContextEnvelope } from "../../intelligence/context-envelope.js";
import { EgressPolicyGateway } from "../../intelligence/egress-policy-gateway.js";
import { evaluatePredicates, normalizeAnswer, projectJevState, stateProjectionHash, wireQuestion } from "./jev.js";
import type { JevOptions, PredicateEgress, PredicateEvaluation, PredicateQuestion, RawJevAnswer } from "./types.js";

/** The System-1 execution interface stays the same regardless of provider. */
export type ExecutiveDecisionProvider = "jev" | "gemini";
export interface DecisionModelOptions extends JevOptions {
  provider?: ExecutiveDecisionProvider;
}

/** Do not put a Gemini key into the Jev connection or vice versa. */
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/decisions";
const GEMINI_MODEL = "gemini-decision-1";
const GEMINI_INPUT_USD_PER_MILLION = 0.10;
const MAX_EGRESS_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 1500;

function egressEnvelope(purpose: string, key: string): ContextEnvelope {
  return {
    pathKind: "interface",
    kind: "inferred_belief",
    sourceId: "system-one." + purpose,
    consent: { grantedAt: new Date(0).toISOString(), scopes: [] },
    retentionClass: "ephemeral",
    payloadClassification: "personal",
    provenance: "flyd.system-one.gemini-decision",
    idempotencyKey: key,
  };
}

/** Gemini Noul criteria use different keys from Jev; never send Jev's {true,false} map. */
export function geminiQuestion(q: PredicateQuestion): Record<string, unknown> {
  const question = wireQuestion(q);
  if (question.type !== "noul") return question;
  const criteria = (q.criteria && !Array.isArray(q.criteria) ? q.criteria : {}) as Record<string, string>;
  const yes = criteria.true_description ?? criteria.true;
  const no = criteria.false_description ?? criteria.false;
  return {
    type: "noul",
    instructions: question.instructions,
    ...(yes && no ? { criteria: { true_description: yes, false_description: no } } : {}),
  };
}

export async function evaluateGeminiPredicates(
  state: Record<string, unknown>,
  questions: PredicateQuestion[],
  options: JevOptions = {},
  egress?: PredicateEgress,
): Promise<PredicateEvaluation> {
  const started = Date.now();
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const model = options.model ?? GEMINI_MODEL;
  const projection = projectJevState(state);
  const projectionHash = stateProjectionHash(state);
  const rubricVersion = options.rubricVersion ?? "flyd.system-one.v1";
  const base = { evaluator: "gemini" as const, model, rubricVersion, projectionHash };
  const failed = (error: string, extra: Partial<PredicateEvaluation> = {}): PredicateEvaluation => ({
    ...base, ok: false, answers: {}, evaluatedAt: new Date().toISOString(),
    latencyMs: Date.now() - started, ...extra, error,
  });

  if (!apiKey) return failed("gemini_not_configured");
  if (!questions.length) return failed("no_questions");
  if (questions.length > 1000) return failed("too_many_questions");

  let questionMap: Record<string, Record<string, unknown>>;
  try {
    if (questions.some((q) => !/^[a-zA-Z0-9_-]{1,64}$/.test(q.id)) ||
        new Set(questions.map((q) => q.id)).size !== questions.length) {
      throw new Error("invalid_question_id");
    }
    questionMap = Object.fromEntries(questions.map((q) => [q.id, geminiQuestion(q)]));
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }

  const purpose = egress?.purpose ?? "unspecified";
  const receipt = new EgressPolicyGateway(options.consentLookup ?? { isRevoked: () => false }).check(
    egressEnvelope(purpose, createHash("sha256").update(projectionHash + purpose).digest("hex")),
    {
      destination: GEMINI_ENDPOINT,
      purpose,
      fields: Object.keys(projection),
      payload: projection,
      schema: {
        allowedFields: [...(egress?.allowedFields ?? Object.keys(projection))],
        maxPayloadBytes: MAX_EGRESS_BYTES,
      },
    },
  );
  if (!receipt.allowed || !receipt.outboundPayload) {
    return failed("egress_denied: " + (receipt.reason ?? "no outbound payload"), { egressReceiptId: receipt.receiptId });
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchFn ?? fetch)(GEMINI_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model,
        // Gemini Decisions accepts a text input; use only the already-redacted,
        // egress-approved state, never the source data.
        input: JSON.stringify(receipt.outboundPayload),
        questions: questionMap,
      }),
      signal: abort.signal,
    });
    if (!response.ok) throw new Error("gemini_http_" + response.status);
    const body = await response.json() as {
      model?: string;
      answers?: Record<string, RawJevAnswer>;
      usage?: { total_input_tokens?: number; input_tokens?: number; total_output_tokens?: number };
    };
    const answers: PredicateEvaluation["answers"] = {};
    for (const question of questions) {
      const raw = body.answers?.[question.id];
      if (raw) answers[question.id] = normalizeAnswer(question, raw);
    }
    const inputTokens = Number(body.usage?.total_input_tokens ?? body.usage?.input_tokens);
    const usage = Number.isFinite(inputTokens)
      ? { inputTokens, outputTokens: Number(body.usage?.total_output_tokens) || 0 }
      : undefined;
    return {
      ...base,
      model: body.model ?? model,
      ok: Object.keys(answers).length > 0,
      answers,
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      egressReceiptId: receipt.receiptId,
      ...(usage ? { usage, costUSD: usage.inputTokens * GEMINI_INPUT_USD_PER_MILLION / 1_000_000 } : {}),
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), { egressReceiptId: receipt.receiptId });
  } finally {
    clearTimeout(timeout);
  }
}

/** Executive predicates share the registry and egress rules; only the provider varies. */
export async function evaluateExecutivePredicates(
  state: Record<string, unknown>,
  questions: PredicateQuestion[],
  options: DecisionModelOptions = {},
  egress?: PredicateEgress,
): Promise<PredicateEvaluation> {
  const { provider = process.env.FLYD_EXECUTIVE_DECISION_PROVIDER === "gemini" ? "gemini" : "jev", ...rest } = options;
  if (provider === "gemini") return evaluateGeminiPredicates(state, questions, rest, egress);
  return evaluatePredicates(state, questions, rest, egress);
}

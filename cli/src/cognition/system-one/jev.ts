import { createHash } from "node:crypto";
import type { JevOptions, PredicateAnswer, PredicateEvaluation, PredicateQuestion } from "./types.js";

const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_TIMEOUT_MS = 1200;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function envOptions(options: JevOptions): Required<Pick<JevOptions, "endpoint" | "model" | "timeoutMs" | "rubricVersion">> & JevOptions {
  return {
    endpoint: options.endpoint ?? process.env.FLYD_JEV_ENDPOINT ?? process.env.BEACON_JEV_ENDPOINT ?? DEFAULT_ENDPOINT,
    apiKey: options.apiKey ?? process.env.TYPESAFE_API_KEY ?? process.env.FLYD_JEV_API_KEY ?? process.env.BEACON_JEV_API_KEY,
    model: options.model ?? process.env.FLYD_JEV_MODEL ?? process.env.BEACON_JEV_MODEL ?? DEFAULT_MODEL,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    rubricVersion: options.rubricVersion ?? "flyd.system-one.v1",
    fetchFn: options.fetchFn ?? fetch,
  };
}

export async function evaluatePredicates(
  state: Record<string, unknown>,
  questions: PredicateQuestion[],
  options: JevOptions = {},
): Promise<PredicateEvaluation> {
  const opts = envOptions(options);
  const started = Date.now();
  const projectionHash = hash(state);
  if (!opts.apiKey || questions.length === 0) {
    return {
      ok: false, evaluator: "none", model: opts.model, rubricVersion: opts.rubricVersion,
      projectionHash, answers: {}, evaluatedAt: new Date().toISOString(), latencyMs: Date.now() - started,
      error: !opts.apiKey ? "jev_not_configured" : "no_questions",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const questionMap = Object.fromEntries(questions.map((q) => [q.id, {
    type: q.type ?? "noul",
    instructions: q.instructions,
    criteria: q.criteria ?? { true: "The state satisfies this criterion.", false: "The state does not satisfy this criterion." },
  }]));
  try {
    const response = await opts.fetchFn!(opts.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({ model: opts.model, state: { ...state, rubric_version: opts.rubricVersion }, questions: questionMap }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`jev_http_${response.status}`);
    const body = await response.json() as {
      model?: string;
      answers?: Record<string, { noul?: number; probability?: number; score?: number; confidence?: number; choice?: string; probabilities?: Record<string, number> }>;
      usage?: { cost_usd?: number };
    };
    const answers: Record<string, PredicateAnswer> = {};
    for (const q of questions) {
      const raw = body.answers?.[q.id];
      if (!raw) continue;
      const probability = Math.max(0, Math.min(1, Number(raw.noul ?? raw.probability ?? raw.score ?? 0)));
      answers[q.id] = {
        id: q.id,
        probability,
        confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0))),
        ...(raw.choice ? { choice: raw.choice } : {}),
        ...(raw.probabilities ? { probabilities: raw.probabilities } : {}),
      };
    }
    return {
      ok: Object.keys(answers).length > 0,
      evaluator: "jev",
      model: body.model ?? opts.model,
      rubricVersion: opts.rubricVersion,
      projectionHash,
      answers,
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      ...(body.usage?.cost_usd ? { costUSD: body.usage.cost_usd } : {}),
    };
  } catch (error) {
    return {
      ok: false, evaluator: "jev", model: opts.model, rubricVersion: opts.rubricVersion,
      projectionHash, answers: {}, evaluatedAt: new Date().toISOString(), latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

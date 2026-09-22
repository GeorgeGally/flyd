export interface PredicateQuestion {
  id: string;
  instructions: string;
  criteria?: Record<string, string>;
  type?: "noul" | "choice" | "score";
}

export interface PredicateAnswer {
  id: string;
  probability: number;
  confidence: number;
  choice?: string;
  probabilities?: Record<string, number>;
}

export interface PredicateEvaluation {
  ok: boolean;
  evaluator: "jev" | "none";
  model?: string;
  rubricVersion: string;
  projectionHash: string;
  answers: Record<string, PredicateAnswer>;
  evaluatedAt: string;
  latencyMs: number;
  costUSD?: number;
  error?: string;
}

export interface JevOptions {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  rubricVersion?: string;
  fetchFn?: typeof fetch;
}

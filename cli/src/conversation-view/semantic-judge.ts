import { evaluatePredicates, JEV_PINNED_MODEL, projectJevState } from "../cognition/system-one/jev.js";
import { familyEgress, predicateThreshold, questionFor } from "../cognition/system-one/registry.js";
import type { ShowItem } from "./show.js";
import type { SemanticKind } from "./semantic.js";

const KEEP = 100;

export interface SemanticJudgment {
  kind: SemanticKind;
  confidence: number;
}

/**
 * Jev's bounded presentation decision. It never designs layout; it only chooses
 * which canonical semantic primitive best describes an already-grounded item.
 * Until a judgment lands, deterministic semantics remain authoritative.
 */
export class SemanticJudge {
  private readonly judged = new Map<string, SemanticJudgment>();
  private readonly asking = new Set<string>();

  constructor(private readonly options: { apiKey: string; model?: string; fetchFn?: typeof fetch }) {}

  private key(item: ShowItem): string {
    return JSON.stringify([
      item.id, item.kind, item.headline, item.why, item.detail ?? "", item.status ?? "",
      Boolean(item.decision), Boolean(item.shots?.length), Boolean(item.open),
    ]);
  }

  cached(item: ShowItem): SemanticJudgment | undefined {
    return this.judged.get(this.key(item));
  }

  pending(item: ShowItem): boolean {
    return this.asking.has(this.key(item));
  }

  async request(item: ShowItem): Promise<void> {
    const key = this.key(item);
    if (this.judged.has(key) || this.asking.has(key)) return;
    this.asking.add(key);
    try {
      const question = questionFor("semantic_object_kind");
      const result = await evaluatePredicates(projectJevState({
        legacy_kind: item.kind,
        headline: item.headline,
        why: item.why,
        detail: item.detail ?? "",
        status: item.status ?? "",
        has_decision: Boolean(item.decision),
        has_media: Boolean(item.shots?.length),
        has_openable_work: Boolean(item.open),
      }), [question], {
        apiKey: this.options.apiKey,
        model: this.options.model ?? JEV_PINNED_MODEL,
        timeoutMs: 3_000,
        ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
      }, familyEgress("presentation"));
      const answer = result.answers[question.id];
      const choice = result.ok && answer && answer.confidence >= predicateThreshold("semantic_object_kind")
        ? answer.choice
        : undefined;
      if (
        choice === "conversation" || choice === "activity" || choice === "decision"
        || choice === "investigation" || choice === "action" || choice === "artifact"
        || choice === "monitor"
      ) this.judged.set(key, { kind: choice, confidence: answer!.confidence });
      for (const old of [...this.judged.keys()].slice(0, Math.max(0, this.judged.size - KEEP))) this.judged.delete(old);
    } finally {
      this.asking.delete(key);
    }
  }
}

/** Optional shadow semantic judge; deterministic semantics still render the UI. */
export function semanticJudgeFromEnv(): SemanticJudge | undefined {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || process.env.FLYD_SEMANTIC_JUDGE !== "1") return undefined;
  return new SemanticJudge({ apiKey, ...(process.env.FLYD_JEV_MODEL ? { model: process.env.FLYD_JEV_MODEL } : {}) });
}

import { evaluatePredicates, JEV_PINNED_MODEL, projectJevState } from "../cognition/system-one/jev.js";
import { familyEgress, predicateThreshold, questionFor } from "../cognition/system-one/registry.js";
import type { ShowItem } from "./show.js";

const KEEP = 200;

/**
 * Flyd's judgment on what reaches his screen: one Jev question
 * (`matters_to_george`) per item, with what he has said lately. An item judged
 * not his leaves the screen; until the answer lands, or when Jev is off or
 * fails, it stays, so nothing is ever hidden on a guess.
 */
export class ImportanceJudge {
  private readonly judged = new Map<string, boolean>();
  private readonly asking = new Set<string>();

  constructor(private readonly options: { apiKey: string; model?: string; fetchFn?: typeof fetch; now?: () => number }) {}

  private key(item: ShowItem): string {
    return JSON.stringify([item.id, item.kind, item.headline, item.detail ?? "", item.status ?? ""]);
  }

  /** False only when Jev said, confidently, that it is not his. */
  matters(item: ShowItem): boolean | undefined {
    return this.judged.get(this.key(item));
  }

  pending(item: ShowItem): boolean {
    return this.asking.has(this.key(item));
  }

  async request(item: ShowItem, recentWords: string[]): Promise<void> {
    const key = this.key(item);
    if (this.judged.has(key) || this.asking.has(key)) return;
    this.asking.add(key);
    try {
      const at = item.at ? Date.parse(item.at) : NaN;
      const now = this.options.now?.() ?? Date.now();
      const question = questionFor("matters_to_george");
      const result = await evaluatePredicates(projectJevState({
        kind: item.kind,
        headline: item.headline,
        detail: item.detail ?? "",
        project: item.project ?? "",
        status: item.status ?? "",
        age_hours: Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 3_600_000)) : -1,
        his_recent_words: recentWords.slice(-6).map((words) => words.slice(0, 280)).join("\n"),
      }), [question], {
        apiKey: this.options.apiKey,
        model: this.options.model ?? JEV_PINNED_MODEL,
        timeoutMs: 3_000,
        ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
      }, familyEgress("presentation"));
      const answer = result.answers[question.id];
      // Noul: P(it is his). Only a clear yes or a clear no settles it; in between it shows.
      const threshold = predicateThreshold("matters_to_george");
      if (result.ok && answer) {
        if (answer.probability >= threshold) this.judged.set(key, true);
        else if (answer.probability <= 1 - threshold) this.judged.set(key, false);
      }
      for (const old of [...this.judged.keys()].slice(0, Math.max(0, this.judged.size - KEEP))) this.judged.delete(old);
    } finally {
      this.asking.delete(key);
    }
  }
}

/** On whenever Flyd has a TypeSafe key; FLYD_IMPORTANCE_JUDGE=0 turns it off. */
export function importanceJudgeFromEnv(): ImportanceJudge | undefined {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || process.env.FLYD_IMPORTANCE_JUDGE === "0") return undefined;
  return new ImportanceJudge({ apiKey, ...(process.env.FLYD_JEV_MODEL ? { model: process.env.FLYD_JEV_MODEL } : {}) });
}

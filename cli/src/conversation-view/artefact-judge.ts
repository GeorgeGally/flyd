import { evaluatePredicates, JEV_PINNED_MODEL, projectJevState } from "../cognition/system-one/jev.js";
import { familyEgress, predicateThreshold, questionFor } from "../cognition/system-one/registry.js";

const KEEP = 50;

/** What a reply's numbered items are to him: steps to carry out, options to choose between, or text to read. */
export type ReplyKind = "steps" | "options" | "text";

/**
 * Flyd's call on a reply whose numbered items the rules leave unclear: steps
 * or options he works through as an artefact, or text he reads. One Jev
 * question (`reply_artefact_kind`, benched in the System-1 replay suite) per
 * reply text, remembered for the newest few. A failed or unsure call reads as text.
 */
export class ArtefactJudge {
  private readonly judged = new Map<string, ReplyKind>();
  private readonly asking = new Set<string>();

  constructor(private readonly options: { apiKey: string; model?: string; fetchFn?: typeof fetch }) {}

  cached(text: string): ReplyKind | undefined {
    return this.judged.get(text);
  }

  pending(text: string): boolean {
    return this.asking.has(text);
  }

  async request(text: string): Promise<void> {
    if (this.judged.has(text) || this.asking.has(text)) return;
    this.asking.add(text);
    try {
      const question = questionFor("reply_artefact_kind");
      const result = await evaluatePredicates(projectJevState({ reply: text }), [question], {
        apiKey: this.options.apiKey,
        model: this.options.model ?? JEV_PINNED_MODEL,
        timeoutMs: 3_000,
        ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
      }, familyEgress("presentation"));
      const answer = result.answers[question.id];
      const kind = result.ok && answer && answer.confidence >= predicateThreshold("reply_artefact_kind") ? answer.choice : undefined;
      this.judged.set(text, kind === "steps" || kind === "options" ? kind : "text");
      for (const old of [...this.judged.keys()].slice(0, Math.max(0, this.judged.size - KEEP))) this.judged.delete(old);
    } finally {
      this.asking.delete(text);
    }
  }
}

/** The judge when TypeSafe is configured; off with FLYD_ARTEFACT_JUDGE=0. */
export function artefactJudgeFromEnv(): ArtefactJudge | undefined {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || process.env.FLYD_ARTEFACT_JUDGE === "0") return undefined;
  return new ArtefactJudge({ apiKey, ...(process.env.FLYD_JEV_MODEL ? { model: process.env.FLYD_JEV_MODEL } : {}) });
}

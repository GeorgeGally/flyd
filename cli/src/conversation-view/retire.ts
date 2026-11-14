import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { labAwaitingReview } from "../command/design.js";
import { retireRun, runNames } from "../command/run-closure.js";
import type { DomainRun } from "../command/types.js";
import { questionIdentityOf, type ArtefactRow } from "./artefact.js";
import type { RetiredCards } from "./retired-cards.js";

// George says a card is old, moot or done ("This seems like an old note, the
// site moved on since then"). Flyd used to answer "I'll stop raising it" and
// nothing kept that promise (11 Nov: seven minutes later the same subject came
// back as a new card). Now saying it means doing it: the card is retired here,
// in state every surface reads, before Flyd tells him so.
//
// A firstmate call is kept off his screen for that question's lifecycle and the
// staff are told to close it with his words; one of Flyd's own runs (a question
// it handed on, or a lab waiting for his look) is settled with his words.

export interface RetireCandidate {
  kind: "call" | "run";
  /** The firstmate task, or the run's id. */
  id: string;
  /** What the card says. */
  label: string;
  /** For a call: its question's identity. */
  identity?: string;
  /** Other names the card goes by: a lab's folder, a run's short id or inbox note. */
  aliases: string[];
}

/** The calls on his screen now, from the list the view keeps (`~/.flyd/view/artefacts.json`). Never throws. */
export function shownCalls(file = join(process.env.FLYD_DIR || FLYD_DIR, "view", "artefacts.json")): RetireCandidate[] {
  try {
    const stored = JSON.parse(readFileSync(file, "utf8")) as { rows?: Array<{ field?: unknown; row?: ArtefactRow; ledgerOnly?: unknown }> };
    return (stored.rows ?? []).flatMap((entry) => {
      const row = entry.row;
      if (entry.field !== "calls" || entry.ledgerOnly === true || !row?.task || !row.label) return [];
      return [{ kind: "call" as const, id: row.task, label: row.question ?? row.label, identity: row.questionIdentity ?? questionIdentityOf(row), aliases: [row.task] }];
    });
  } catch {
    return [];
  }
}

/** Flyd's own runs that put something to him: a question waiting on his answer, or finished work waiting on his look. Pure. */
export function askingRuns(runs: readonly DomainRun[]): RetireCandidate[] {
  return runs.flatMap((run) => {
    if (run.closedBy) return [];
    const asking = run.status === "needs_decision" || (run.status === "completed" && (run.result?.workState === "ready" || labAwaitingReview(run, runs)));
    if (!asking) return [];
    const labs = [...(run.result?.artifacts ?? []), ...(run.result?.evidence ?? [])].flatMap((pointer) => pointer.match(/\blab-[0-9a-f]{8}(?:-[0-9a-f-]+)?/gi) ?? []);
    return [{ kind: "run" as const, id: run.id, label: run.result?.brief?.trim() || run.request.intendedOutcome, aliases: [...runNames(run), `lab:${run.id}`, ...labs] }];
  });
}

const STOP = new Set(["this", "that", "with", "from", "have", "your", "about", "card", "note", "call", "they", "them", "there", "their", "what", "when", "which", "will", "would", "should", "could", "been", "into", "than", "then", "were", "said", "says"]);
const words = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4 && !STOP.has(word)));

/**
 * The one card his words name: by an id or folder it goes by, else by the words it shares with what the card says.
 * Two that fit as well are both returned, so Flyd asks which. Pure.
 */
export function pickCard(candidates: readonly RetireCandidate[], said: string): { picked: RetireCandidate } | { ambiguous: RetireCandidate[] } | { none: true } {
  const text = said.toLowerCase();
  const named = candidates.filter((candidate) => [candidate.id, ...candidate.aliases].some((alias) => alias.length >= 6 && text.includes(alias.toLowerCase())));
  if (named.length === 1) return { picked: named[0]! };
  if (named.length > 1) return { ambiguous: named };
  const asked = words(said);
  const scored = candidates.map((candidate) => ({ candidate, score: [...words(candidate.label)].filter((word) => asked.has(word)).length }))
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { none: true };
  if (scored.length > 1 && scored[1]!.score === scored[0]!.score) return { ambiguous: scored.filter((item) => item.score === scored[0]!.score).map((item) => item.candidate) };
  return { picked: scored[0]!.candidate };
}

export interface RetireDependencies {
  candidates: () => RetireCandidate[];
  retired: RetiredCards;
  /** Settles one of Flyd's runs with his words (command/run-closure.ts). */
  retireRun?: typeof retireRun;
  /** Tells firstmate to close the call with his words; rejects when it did not take the note. */
  tellFirstmate?: (call: RetireCandidate, words: string, requestId: string) => Promise<unknown>;
  now?: () => Date;
}

/** The note that asks firstmate to close a call he called old, carrying his words. Pure. */
export function retireNote(call: Pick<RetireCandidate, "id" | "label">, words: string): string {
  return [
    `George says the call ${call.id} ("${call.label}") is old or moot. His words: "${words.trim()}"`,
    "It has left his screen and he will not be asked it again. Close the hold with his words; if it is still a real decision, reopen it with what changed.",
  ].join("\n\n");
}

/**
 * Retires the card his words name and says what became of it, for Flyd to tell him; when it cannot tell which card,
 * says what is on his screen so Flyd asks. Never promises what it did not do.
 */
export async function retireCard(input: { card: string; words: string }, deps: RetireDependencies): Promise<string> {
  const candidates = deps.candidates();
  const choice = pickCard(candidates, `${input.card} ${input.words}`.trim());
  const list = (items: readonly RetireCandidate[]) => items.slice(0, 6).map((item) => `- ${item.label} [${item.kind}:${item.id}]`).join("\n");
  if ("none" in choice) {
    return candidates.length
      ? `Nothing retired: no card on his screen matches "${input.card}". These are the cards that ask him something now; call retire_card again with the one he means:\n${list(candidates)}`
      : "Nothing retired: no card on his screen asks him anything right now. Do not tell him you will stop raising it; say it is already off his screen.";
  }
  if ("ambiguous" in choice) return `Nothing retired yet: more than one card fits. Ask him which he means, then call retire_card with its id:\n${list(choice.ambiguous)}`;
  const card = choice.picked;
  const at = (deps.now?.() ?? new Date()).toISOString();
  const words = input.words.trim() || input.card.trim();
  if (card.kind === "run") {
    const settled = (deps.retireRun ?? retireRun)(card.id, words, { now: new Date(at) });
    if ("refused" in settled) return `Not retired: ${settled.refused}`;
    return `Retired "${card.label}": it is off his screen for good and will not be raised again. Tell him so in one line.`;
  }
  deps.retired.retire({ task: card.id, identity: card.identity ?? "", label: card.label, words, at });
  let told = false;
  if (deps.tellFirstmate) {
    const requestId = `flyd-retire-${createHash("sha256").update(card.identity ?? card.id).digest("hex").slice(0, 12)}-${card.id}`.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 125);
    told = await deps.tellFirstmate(card, words, requestId).then(() => true, () => false);
  }
  return `Retired "${card.label}": it is off his screen and will not be raised again for this question${told ? "; the staff were told to close it with his words" : ""}. Tell him so in one line.`;
}

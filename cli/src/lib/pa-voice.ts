// How Flyd speaks to George: his PA, not a tech person. One spec every prompt
// that writes words he reads includes, and one deterministic pass for words
// that reach him from the staff (firstmate, workers, the Chief of Staff) or
// from a model that did not listen. The spec says what to write; the pass
// makes sure the worst of it never reaches him whatever was written.

import { toYou } from "./to-you.js";

/** The one voice spec. Short on purpose: small models lose the thread under long rule lists. */
export const PA_VOICE = [
  "How you speak to George: you are his PA talking to a busy CEO, not an engineer writing a report.",
  "- Speak as \"I\" and call him \"you\". Never his name, \"he\", \"his\", \"him\" or \"captain\".",
  "- Outcome first, in one to three short plain sentences. Then what it means for him, only if that is not obvious.",
  "- Plain words he would use: name things by what he sees (the Week page, the WhatsApp card, the CapFive homepage), never by how they are built (fragments, nodes, servers, endpoints, PRs, branches, checks, CI, ids, paths).",
  "- No labels or report sections (Changed, Means, Needed, Expected, Observed, Cause, Evidence, Next). No bullet lists for a short update.",
  "- Ask him only when he must decide: something destructive, costly, public, outward, or a real taste call. Then ask once, say what it is about and why it matters, and give your pick.",
  "- Never ask leave for the obvious next step or to tell him something (\"Want me to let you know…?\", \"Shall I pass that on?\"). Do it, and say in a few words that you are.",
  "- Never relay the staff's words or status lines verbatim; say what they mean for him.",
].join("\n");

/** Status lines the staff write for each other. "Checks green: PR ready for review (still monitoring for merge/close):…" */
const STATUS_LINE = /^\s*(?:(?:done|working|paused|blocked|needs-decision|ready)\s*(?:\[[^\]]*\]\s*)*:\s*)?(?:checks?|ci|tests?)\s+(?:are\s+)?(?:green|passed|passing)\b|\bPR\b[^.]*\bready for review\b|\b(?:still )?monitoring for merge\b/i;

/** What a raw staff status line means for him, about the named work; null when the line is not one. Pure. */
export function statusSaid(line: string, what: string): string | null {
  if (!STATUS_LINE.test(line)) return null;
  // "Flyd CoS 13c: explicit waits (audit #2)": the staff's own numbering in brackets is not the work's name.
  const name = what.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim().replace(/[.:…]+$/, "");
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} is finished and ready for you to land.` : "It is finished and ready for you to land.";
}

/**
 * A headline Flyd can stand behind when no better one was written: a short
 * complete phrase, never a cut copy with an ellipsis. "Pierre: hardware-style
 * redesign lab on a Liesel board (Codex): Choose the Pierre hardware …" reads
 * "Pierre: hardware-style redesign lab". Pure.
 */
export function shortHeadline(text: string, words = 10): string {
  const flat = text.replace(/\s+/g, " ").trim()
    .replace(/^earlier report:\s*/i, "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+on an? (?:Liesel|Lavish) board\b/gi, "")
    .replace(/https?:\/\/\S+/g, "");
  const kept: string[] = [];
  for (const part of flat.split(/:\s+/)) {
    const cut = /\s*(?:…|\.\.\.)/.exec(part);
    const whole = (cut ? part.slice(0, cut.index) : part).trim();
    // A segment cut short loses its last, partial word.
    const clean = cut ? whole.replace(/\s+\S*$/, "") || whole : whole;
    if (clean) kept.push(clean);
    if (cut || kept.length === 2) break;
  }
  const list = kept.join(": ").split(" ");
  const head = list.length > words ? list.slice(0, words).join(" ").replace(/\s+(?:the|a|an|of|to|and|or|for|with|on|in|at|by|from)$/i, "") : list.join(" ");
  return head.replace(/[\s,;:/–—-]+$/, "");
}

/** A worker's status line to its supervisor: ids, verification sizes, "applied in place". Never shown as what changed. */
export function staffStatusLine(text: string): boolean {
  return STATUS_LINE.test(text) || /\bverif(?:ied|y)\s+headless\b|\b\d{3,4}\/\d{3,4}\/\d{3,4}\b|\br=\d+\b|#[0-9a-f]{6}\b|\bapplied in place\b|\bnote applied\b/i.test(text);
}

/** Questions that only ask leave to tell him something: Flyd always tells him, so it never asks. */
const INFORM_ASK = /(?:^|(?<=[.!?]\s+))(?:do you want|would you like|want|shall|should)\s+(?:me|I)\s+(?:to\s+)?(?:pass (?:along|on)|let you know|tell you|update you|report back|ping you|keep you (?:posted|updated)|send you (?:the|a) (?:confirmation|update|note))\b([^?]*)\?/gim;

/** The leave-to-tell question said as what Flyd will do. "Do you want me to pass along the confirmation once the screenshot is in?" → "I'll let you know once the screenshot is in." Pure. */
export function withoutInformAsk(text: string): string {
  return text.replace(INFORM_ASK, (_found, rest: string) => {
    const when = /\b(?:once|when|as soon as|after)\b.*$/i.exec(rest)?.[0];
    return when ? `I'll let you know ${when.trim()}.` : "I'll let you know.";
  });
}

/** Report scaffolding at the start of a line: "Changed:", "**Needed**", "Means -". */
const LABEL = /^(\s*)(?:\*\*(?:changed|means|needed|expected|observed|cause|evidence|next)\s*:?\s*\*\*\s*:?|(?:changed|means|needed|expected|observed|cause|evidence|next)\s*:)[ \t]*(?=\S)/gim;

/** Fenced blocks and inline code: said exactly as written. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

/**
 * Any words that reach him from the staff or a model, as his PA would say
 * them: said to him, no report labels, no bracketed PR numbers or monitoring asides, and
 * no question asking leave to tell him. Code and links are left alone. Pure.
 */
export function forHim(text: string): string {
  if (!text) return text;
  const code: string[] = [];
  const prose = text.replace(CODE, (span) => `\uE000${code.push(span) - 1}\uE001`);
  const said = toYou(prose)
    .replace(LABEL, "$1")
    // "(still monitoring for merge/close)", "(PR #274)": the staff's bookkeeping.
    .replace(/\s*\((?:still )?monitoring[^)]*\)/gi, "")
    .replace(/\s*\((?:PR|pull request)?\s*#\d+\)/gi, "");
  return withoutInformAsk(said)
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .replace(/\uE000(\d+)\uE001/g, (_found, index: string) => code[Number(index)]!);
}

/** Phrases that must never reach him: third person, report labels, staff status lines, leave-to-tell questions. */
export const BANNED_FOR_HIM: RegExp[] = [
  /\bGeorge (?:needs|has|wants|must|is)\b/,
  /\bhis (?:picks?|calls?|answers?|decisions?|choices?)\b/i,
  /\bthe (?:[\w-]+ )*captain\b/i,
  /^\s*(?:\*\*)?(?:Changed|Means|Needed)(?:\*\*)?\b/m,
  /\bChecks green\b/i,
  /\bmonitoring for merge\b/i,
  /\b(?:do you want|would you like|want) me to (?:pass (?:along|on)|let you know|tell you)\b/i,
];

/** The first banned phrase in a line he would read, or null. */
export function bannedFor(text: string): string | null {
  for (const pattern of BANNED_FOR_HIM) {
    const found = pattern.exec(text);
    if (found) return found[0];
  }
  return null;
}

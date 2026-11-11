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
  const name = what.replace(/\s+/g, " ").trim().replace(/[.:…]+$/, "");
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} is finished and ready for you to land.` : "It is finished and ready for you to land.";
}

/** Questions that only ask leave to tell him something: Flyd always tells him, so it never asks. */
const INFORM_ASK = /(?:^|(?<=[.!?]\s))(?:do you want|would you like|want|shall|should)\s+(?:me|I)\s+(?:to\s+)?(?:pass (?:along|on)|let you know|tell you|update you|report back|ping you|keep you (?:posted|updated)|send you (?:the|a) (?:confirmation|update|note))\b([^?]*)\?/gi;

/** The leave-to-tell question said as what Flyd will do. "Do you want me to pass along the confirmation once the screenshot is in?" → "I'll let you know once the screenshot is in." Pure. */
export function withoutInformAsk(text: string): string {
  return text.replace(INFORM_ASK, (_found, rest: string) => {
    const when = /\b(?:once|when|as soon as|after)\b.*$/i.exec(rest)?.[0];
    return when ? `I'll let you know ${when.trim()}.` : "I'll let you know.";
  });
}

/** Report scaffolding at the start of a line: "Changed:", "**Needed**", "Means -". */
const LABEL = /^(\s*)(?:\*\*(?:changed|means|needed|expected|observed|cause|evidence|next)\s*:?\s*\*\*\s*:?|(?:changed|means|needed|expected|observed|cause|evidence|next)\s*:)[ \t]*(?=\S)/gim;

/**
 * Any words that reach him from the staff or a model, as his PA would say
 * them: said to him, no report labels, no bracketed PR numbers or monitoring asides, and
 * no question asking leave to tell him. Code and links are left alone. Pure.
 */
export function forHim(text: string): string {
  if (!text) return text;
  const said = toYou(text)
    .replace(LABEL, "$1")
    // "(still monitoring for merge/close)", "(PR #274)": the staff's bookkeeping.
    .replace(/\s*\((?:still )?monitoring[^)]*\)/gi, "")
    .replace(/\s*\((?:PR|pull request)?\s*#\d+\)/gi, "");
  return withoutInformAsk(said).replace(/[ \t]{2,}/g, " ").trim();
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

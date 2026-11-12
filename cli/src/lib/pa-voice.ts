// How Flyd speaks to George: his PA, not a tech person. One spec every prompt
// that writes words he reads includes, and one deterministic pass for words
// that reach him from the staff (firstmate, workers, the Chief of Staff) or
// from a model that did not listen. The spec says what to write; the pass
// makes sure the worst of it never reaches him whatever was written.

import { flydsOwnWords, toYou } from "./to-you.js";

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
const STATUS_LINE = /^\s*(?:(?:done|working|paused|blocked|needs-decision|ready)\s*(?:\[[^\]]*\]\s*)*:\s*)?(?:(?:checks?|ci|tests?)\s+(?:are\s+)?(?:green|passed|passing)\b|(?:the\s+)?PR\b[^.?]*\bready for review\b|(?:still )?monitoring for merge\b)/i;
/** The state word a status line opens with, when it has one. */
const STATUS_STATE = /^\s*(done|working|paused|blocked|needs-decision|ready)\s*(?:\[[^\]]*\]\s*)*:/i;
/** What says the work itself is finished: green checks or a pull request up for review. Passing tests alone are not. */
const FINISHED = /^\s*(?:(?:done|ready)\s*(?:\[[^\]]*\]\s*)*:\s*)?(?:(?:checks?|ci)\s+(?:are\s+)?(?:green|passed)\b|(?:the\s+)?PR\b[^.?]*\bready for review\b)/i;

/**
 * What a raw staff status line means for him; null when the line is not one.
 * Only finished work is said to be finished: a line that opens blocked, paused
 * or working says so, whatever it says about tests. The card's own title names
 * the work, so the line never repeats the staff's headline for it. Pure.
 */
export function statusSaid(line: string): string | null {
  if (line.includes("?") || !STATUS_LINE.test(line)) return null;
  const state = STATUS_STATE.exec(line)?.[1]?.toLowerCase();
  if (state === "blocked") return "This is held up. I'm working out what it needs and will tell you if it needs you.";
  if (state === "paused") return "This is paused for now.";
  if (state === "working") return "I'm still working on this.";
  if (state === "needs-decision") return null;
  return state === "done" || state === "ready" || FINISHED.test(line) ? "This is finished and ready for you to look over." : "I'm still working on this.";
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
  return !text.includes("?") && (STATUS_LINE.test(text) || /\bverif(?:ied|y)\s+headless\b|\b\d{3,4}\/\d{3,4}\/\d{3,4}\b|\br=\d+\b|\bapplied in place\b|\bnote applied\b/i.test(text));
}

/** Questions that only ask leave to tell him something: Flyd always tells him, so it never asks. */
const INFORM_ASK = /(?:^|(?<=[.!?]\s+))(?:do you want|would you like|want|shall|should)\s+(?:me|I)\s+(?:to\s+)?(pass (?:it |that |this |them )?(?:along|on)|let you know|tell you|update you|report back|ping you|keep you (?:posted|updated)|send you (?:the|a) (?:confirmation|update|note))\b([^?]*)\?/gim;

/** What Flyd says it will do in place of asking leave to: "I'll let you know." */
const WILL: Record<string, string> = { "let you know": "let you know", "update you": "keep you updated", "report back": "report back", "ping you": "let you know", "keep you posted": "keep you posted", "keep you updated": "keep you updated" };

/**
 * The leave-to-tell question said as what Flyd will do. "Do you want me to pass
 * along the confirmation once the screenshot is in?" → "I'll let you know once
 * the screenshot is in."; "Want me to let you know?" → "I'll let you know.";
 * "Shall I pass that on?" → "I'll pass that on.". An offer to tell him
 * something more ("Want me to tell you what changed?") is a real offer and is
 * left as asked. Pure.
 */
export function withoutInformAsk(text: string): string {
  return text.replace(INFORM_ASK, (found, act: string, rest: string) => {
    const when = /^\s*(?:(?:the|a|an)\s+)?(?:(?!(?:what|how|why|which|where|who|whether|more|about)\b)[\w-]+\s+)?((?:once|when|as soon as|after)\b.*)$/i.exec(rest)?.[1];
    if (when) return `I'll let you know ${when.trim()}.`;
    const action = act.toLowerCase();
    const what = rest.trim();
    if (action.startsWith("pass")) return /^(?:to you)?$/i.test(what) ? `I'll ${action === "pass on" || action === "pass along" ? "pass it on" : action}${what ? ` ${what}` : ""}.` : found;
    const will = WILL[action];
    return will && !what ? `I'll ${will}.` : found;
  });
}

/** Report scaffolding at the start of a line: "Changed:", "**Needed**", "Means -". */
const LABEL = /^(\s*)(?:\*\*(?:changed|means|needed|expected|observed|cause|evidence|next)\s*:?\s*\*\*\s*:?|(?:changed|means|needed|expected|observed|cause|evidence|next)\s*:)[ \t]*(?=\S)/gim;

/** Fenced blocks and inline code: said exactly as written. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

/** One sentence at a time; a dot inside "v2.1" or a link does not end one. */
const SENTENCE = /(?:[^.!?\n]|[.!?](?=\S))+[.!?]*/g;

/**
 * Any words that reach him from the staff or a model, as his PA would say
 * them: said to him, no report labels, no bracketed PR numbers or monitoring asides, and
 * no question asking leave to tell him. Code and links are left alone. Then
 * the banned phrases are checked on what he would read: a sentence that still
 * carries one is held back, and logged, whenever something else is left to say. Pure but for the log.
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
  const plain = withoutInformAsk(said);
  const held: string[] = [];
  const kept = plain.replace(SENTENCE, (sentence) => {
    const found = bannedFor(sentence);
    if (!found) return sentence;
    held.push(found);
    return "";
  });
  const shown = held.length && kept.trim() ? kept : plain;
  if (held.length) console.warn(`[pa-voice] ${shown === plain ? "shown with" : "held back"} a banned phrase: ${held.map((phrase) => JSON.stringify(phrase)).join(", ")}`);
  return shown
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
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
  /\bready for you to land\b/i,
  /\b(?:do you want|would you like|want|shall|should) (?:me|I) (?:to )?(?:pass (?:(?:it|that|this|them) )?(?:along|on)(?: to you)?|let you know|keep you (?:posted|updated))\s*\?/i,
];

/** The first banned phrase in Flyd's own words to him (someone else's quoted words aside), or null. */
export function bannedFor(text: string): string | null {
  const own = flydsOwnWords(text);
  for (const pattern of BANNED_FOR_HIM) {
    const found = pattern.exec(own);
    if (found) return found[0];
  }
  return null;
}

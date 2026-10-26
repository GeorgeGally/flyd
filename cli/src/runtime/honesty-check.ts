import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { Shortfall } from "../council/chief-of-staff.js";
import { CHAT_ANSWER_BACKSTAGE, firstBackstage, firstMatch, withoutLinkIds } from "../lib/backstage.js";
import { isPlaceholderStatus } from "../conversation-view/status-text.js";

// A last look before an answer reaches George: does it claim work that no
// tool did this turn, or point at files that are not there? Models complete
// the pattern — "I wrote the spec, it's in ~/Documents/Glasses" — and it reads
// as fact. This catches that class mechanically and sends the answer back once.

// Finished work ("I've drafted it") needs a tool that did it this turn.
const DONE_CLAIM = /\bI(?:'ve| have| just)?\s+(?:wrote|written|created|saved|drafted|built|set up|scheduled|added|sent|booked|put together|taken (?:them|it) off|cancelled|canceled)\b/i;
// Work under way ("I've started", "I'm drafting") may rest on a handed-off job.
const STARTED_CLAIM = /\bI(?:'ve| have| just)?\s+(?:started|kicked off|begun|queued)\b|\bI(?:'m| am) (?:now )?(?:already )?(?:drafting|building|going through|working (?:on|through)|writing|generating|putting together|pulling together)\b/i;
/** Tools that start work which finishes later: they back "I've started", never "I've drafted". */
const DELEGATIONS = new Set(["background_task", "start_coding_task", "start_knowledge_task", "start_design_task", "pass_on_question"]);
/**
 * After a hand-off, any first-person perfect ("I've left it on", "I've made
 * sure…") describes work nobody has done yet. Matched by grammar, not a verb
 * list: the list only ever catches last week's phrasing.
 */
const PERFECT_CLAIM = /\bI(?:'ve| have)\s+(?:also\s+|already\s+)?(?!started\b|kicked\b|begun\b|queued\b|handed\b|passed\b|asked\b|got\b)[a-z]+(?:ed|en|t|de|ne|ft|ht)\b/i;
const LOCAL_PATH = /(?:~|\/Users\/[^/\s]+)\/[^\s`'"),;:]+/g;
// Capitalised words that are not names: sentence starters, greetings,
// pronouns, days and months. No person or entity name belongs here — a name is grounded only when
// the supplied context actually contains it, so the list can never wave one
// through. "Today Bloom" is a candidate span; "Today" alone is not.
const GROUNDING_ALLOWLIST = new Set([
  "a", "actually", "afternoon", "after", "also", "an", "and", "are", "as", "at", "before", "because", "but", "can", "could", "did", "do", "does", "done", "evening", "for", "from",
  "he", "hello", "here", "hey", "hi", "how", "i", "if", "in", "is", "it", "let", "morning", "my", "night", "no", "not", "now", "of", "on", "or", "our",
  "okay", "one", "right", "rows", "she", "so", "some", "started", "sure", "sunny", "thanks", "that", "the", "their", "there", "these", "they", "this", "to", "two",
  "today", "tomorrow", "we", "well", "what", "when", "where", "which", "who", "why", "will", "with", "yes", "you", "your",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june", "jul", "july",
  "aug", "august", "sep", "sept", "september", "oct", "october", "nov", "november", "dec", "december",
]);
const WEEKDAY = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";
const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
const DAY = "(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?";
const YEAR = "(?:19|20)\\d{2}";
// Every written date an answer or a tool produces: "24 October 2026",
// "October 24", "Friday, October 24, 2026", "Friday 24th", "October 2026",
// "2026-10-24", "2026-10-24T09:00:00".
const DATE_TOKEN = new RegExp([
  `(?:${WEEKDAY},?\\s+)?${DAY}\\s+${MONTH}(?:,?\\s+${YEAR})?`,
  `(?:${WEEKDAY},?\\s+)?${MONTH}\\s+${DAY}(?:,?\\s+${YEAR})?`,
  `${MONTH}\\s+${YEAR}`,
  `${WEEKDAY},?\\s+${DAY}`,
  `\\d{4}-\\d{2}-\\d{2}(?:T[\\d:.]+(?:Z|[+-]\\d{2}:?\\d{2})?)?`,
].map((form) => `(?<![\\p{L}\\p{N}])${form}(?![\\p{L}\\p{N}])`).join("|"), "giu");
// Words that make a date the answer resolves itself ("tomorrow" → Tuesday
// 27 October) legitimate. Read with every written date and the clock line
// taken out, so "Monday" in "Monday, 26 October" is not one.
const RELATIVE_DATE = new RegExp(`\\b(?:today|tonight|tomorrow|yesterday|weekend|fortnight|${WEEKDAY}|(?:next|this|last|coming)\\s+(?:week|month)|in\\s+(?:\\d+|a|an|one|two|three|four|five|six|seven|eight)\\s+(?:days?|weeks?|months?)|(?:days?|weeks?)\\s+(?:ago|from now))\\b`, "i");
const CLOCK_LINE = /^Local time:[^\n]*/m;
const RELATIVE_WINDOW_DAYS = 60;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface CalendarDate { year?: number; month?: number; day?: number; weekday?: number }

function parseDate(span: string): CalendarDate {
  const iso = span.match(/(\d{4})-(\d{2})-(\d{2})/);
  const date: CalendarDate = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : {};
  if (!iso) {
    const words: string[] = span.toLowerCase().match(/[a-z]+/g) ?? [];
    const weekday = WEEKDAYS.findIndex((name) => words.includes(name));
    if (weekday >= 0) date.weekday = weekday;
    const month = words.find((word) => MONTHS.includes(word.slice(0, 3)));
    if (month) date.month = MONTHS.indexOf(month.slice(0, 3)) + 1;
    const year = span.match(/\b(?:19|20)\d{2}\b/);
    if (year) date.year = Number(year[0]);
    const day = span.replace(/\b(?:19|20)\d{2}\b/, "").match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (day) date.day = Number(day[1]);
  }
  if (date.year && date.month && date.day) date.weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return date;
}

/** Every day and month the span names is named the same in the other date; a year or weekday both name must agree. */
function sameDate(span: CalendarDate, other: CalendarDate): boolean {
  return (span.month === undefined || span.month === other.month)
    && (span.day === undefined || span.day === other.day)
    && (span.year === undefined || other.year === undefined || span.year === other.year)
    && (span.weekday === undefined || other.weekday === undefined || span.weekday === other.weekday);
}

function shiftedDays(from: CalendarDate, days: number): CalendarDate {
  const date = new Date(Date.UTC(from.year!, from.month! - 1, from.day! + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() };
}

/**
 * A date is grounded when the context names the same calendar date in any
 * written form (an ISO timestamp a tool returned counts), or when the context
 * asks for a relative date and this one is the clock's date shifted by at
 * most 60 days. Never by a bare day number or year found elsewhere.
 */
function isDateGrounded(groundingText: string, span: string): boolean {
  const date = parseDate(span);
  if ([...groundingText.matchAll(DATE_TOKEN)].some((match) => sameDate(date, parseDate(match[0])))) return true;
  const clockLine = groundingText.match(CLOCK_LINE)?.[0] ?? "";
  const clock = parseDate(clockLine.match(DATE_TOKEN)?.[0] ?? "");
  if (!clock.year || !clock.month || !clock.day) return false;
  if (!RELATIVE_DATE.test(groundingText.replace(CLOCK_LINE, "").replace(DATE_TOKEN, " "))) return false;
  for (let days = -RELATIVE_WINDOW_DAYS; days <= RELATIVE_WINDOW_DAYS; days += 1) {
    if (sameDate(date, shiftedDays(clock, days))) return true;
  }
  return false;
}
// A run of capitalised words on one line: a name, or a sentence start that
// leads into one. One span, never split at a word inside it.
const CAPITALISED_RUN = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{N}]*(?:[^\S\n]+\p{Lu}[\p{L}\p{N}]*)*(?![\p{L}\p{N}])/gu;

function groundingHas(groundingText: string, span: string): boolean {
  const escaped = span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(groundingText);
}

function isAllowlisted(word: string): boolean {
  return GROUNDING_ALLOWLIST.has(word.toLowerCase());
}

function withoutLeadingFunctionWords(words: string[]): string[] {
  let start = 0;
  while (start < words.length && isAllowlisted(words[start])) start += 1;
  return words.slice(start);
}

function withoutTrailingFunctionWords(words: string[]): string[] {
  let end = words.length;
  while (end > 0 && isAllowlisted(words[end - 1])) end -= 1;
  return words.slice(0, end);
}

/**
 * The span is in the context, or its name is. The sentence-function words a
 * run can start or end with ("Today Bloom said", "Morning George", "Capfive
 * Monday") are not part of a name, so "Bloom" in context grounds "Today
 * Bloom". Words inside a run are never dropped: "Capfive And Bloom" and
 * "Priya Patel" must appear as written.
 */
function isGrounded(groundingText: string, span: string): boolean {
  if (groundingHas(groundingText, span)) return true;
  const name = withoutTrailingFunctionWords(withoutLeadingFunctionWords(span.split(/\s+/))).join(" ");
  return name.length > 0 && name !== span && groundingHas(groundingText, name);
}

/**
 * Names and dates the answer uses that the supplied context does not contain,
 * in order of appearance. A capitalised run is one span: it is left out only
 * when every word in it is a sentence-function word, never cut at one.
 */
export function checkGrounding(answer: string, groundingText: string): string[] {
  const spans: Array<{ text: string; index: number; date: boolean }> = [];
  for (const match of answer.matchAll(CAPITALISED_RUN)) {
    if (match[0].split(/\s+/).every(isAllowlisted)) continue;
    spans.push({ text: match[0], index: match.index, date: false });
  }
  for (const match of answer.matchAll(DATE_TOKEN)) spans.push({ text: match[0], index: match.index, date: true });
  const seen = new Set<string>();
  return spans
    .sort((left, right) => left.index - right.index)
    .filter(({ text, date }) => {
      const key = text.toLowerCase();
      if (seen.has(key) || (date ? isDateGrounded(groundingText, text) : isGrounded(groundingText, text))) return false;
      seen.add(key);
      return true;
    })
    .map(({ text }) => text);
}

export interface ClaimToolCall { name: string; input: Record<string, unknown>; succeeded: boolean }

export interface ArtefactRequiredViolation { requirement: "artefact_required"; count: number }

export function artefactRequiredViolation(answer: string): ArtefactRequiredViolation | null {
  let fenced = false;
  let listCount = 0;
  let maxList = 0;
  let tableRows = 0;
  let maxTableRows = 0;
  for (const line of answer.split("\n")) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      fenced = !fenced;
      listCount = 0;
      tableRows = 0;
      continue;
    }
    if (fenced) continue;
    if (/^\|.*\|$/.test(trimmed)) {
      if (!/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/.test(trimmed)) tableRows += 1;
      maxTableRows = Math.max(maxTableRows, tableRows);
      continue;
    }
    tableRows = 0;
    if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) {
      listCount += 1;
      maxList = Math.max(maxList, listCount);
    } else if (trimmed && !/^\s/.test(line)) listCount = 0;
  }
  if (maxTableRows >= 4) return { requirement: "artefact_required", count: maxTableRows - 1 };
  if (maxList >= 6) return { requirement: "artefact_required", count: maxList };
  return null;
}

export function unsupportedClaims(
  answer: string,
  toolCalls: ClaimToolCall[],
  isMutating: (name: string, input: Record<string, unknown>) => boolean,
  exists: (path: string) => boolean = existsSync,
): string[] {
  const problems: string[] = [];
  const acted = toolCalls.filter((call) => call.succeeded && isMutating(call.name, call.input));
  const didItNow = acted.some((call) => !DELEGATIONS.has(call.name));
  const onlyHandedOff = acted.length > 0 && !didItNow && toolCalls.every((call) => !call.succeeded || DELEGATIONS.has(call.name));
  if ((DONE_CLAIM.test(answer) || (onlyHandedOff && PERFECT_CLAIM.test(answer))) && !didItNow) {
    problems.push(acted.length
      ? "It says the work is done, but you only started it in the background; nothing is finished or on disk yet. Say you've started it and that it will come back when done."
      : "It says you did or made something, but no action ran in this turn. Only claim what a tool did now; otherwise say what you will do or what you don't know.");
  } else if (STARTED_CLAIM.test(answer) && !acted.length) {
    problems.push("It says work is under way, but nothing was started in this turn. Start it with a tool, or offer to.");
  }
  const touched = JSON.stringify(toolCalls.map((call) => call.input));
  for (const raw of new Set(answer.match(LOCAL_PATH) ?? [])) {
    const path = raw.replace(/[.…]+$/, "");
    const full = path.startsWith("~") ? `${homedir()}${path.slice(1)}` : path;
    if (!exists(full) && !touched.includes(path) && !touched.includes(full)) {
      problems.push(`It mentions ${path}, which does not exist on his Mac.`);
    }
  }
  return problems;
}

export function honestyRewritePrompt(answer: string, problems: string[]): string {
  return [
    "Rewrite this reply to George. Problems found:",
    ...problems.map((problem) => `- ${problem}`),
    "",
    "Keep everything that is true and specific. Plain, direct words, like a sharp friend texting. Don't apologise at length or explain why. Reply with the rewritten text only.",
    "",
    `Reply:\n"""${answer}"""`,
  ].join("\n");
}

// Stock phrasing George has called "AI slop": greeting-card empathy and
// metaphors standing in for something specific. Checked mechanically so the
// voice holds even when the model drifts.
const SLOP = /\b(?:stings?|lonely|the silence|a verdict|in the room|into the (?:dark|void)|wears? on you|a lot to carry|carry(?:ing)? (?:that|this)|sit with|the part that|heavy lift|journey|resonates?|tapestry|testament|navigat(?:e|ing) (?:this|the)|at the end of the day|it's (?:okay|ok) to feel)\b/i;

// George only ever talks to Flyd (AGENTS.md "One voice"): the crew, jobs,
// worktrees and council are Flyd's own backstage.

export function styleProblems(answer: string): string[] {
  const problems: string[] = [];
  const backstage = firstMatch(answer, CHAT_ANSWER_BACKSTAGE);
  if (backstage) problems.push(`It names your own backstage ("${backstage}"). Speak as yourself: say what you're doing, not who inside you is doing it.`);
  const phrase = answer.match(SLOP);
  if (phrase) problems.push(`It uses stock phrasing ("${phrase[0]}"). Say the literal, specific thing instead, in plain words.`);
  if ((answer.match(/—/g) ?? []).length >= 2) problems.push("It leans on em dashes. Use full stops or commas.");
  const contrast = answer.match(/\b(?:isn'?t|is not|wasn'?t|aren'?t)\b[^.!?\n]{1,80}?(?:—|,|;)\s*(?:it'?s|it is|that'?s|they'?re)\b|\b(?:a|an|the)\s[\w-]+(?:\s[\w-]+)?,\s+not\s+(?:a|an|the)\s[\w-]+|—\s*not\s+(?:a|an|the|just)\b/i);
  if (contrast) problems.push(`It uses "not X, it's Y" contrast framing ("${contrast[0].slice(0, 60)}"). He dislikes it; state the point directly.`);
  return problems;
}

// Phrases George has ruled out of Flyd's voice (USER.md / SOUL.md, the
// "His voice" rule). One source of truth: the send-path check below and the
// His voice rule in council/chief-of-staff.ts both read this list, so what is
// enforced before an answer is spoken can never drift from what is reviewed
// after. "Captain" is here because he goes by "sir".
export const RETIRED_PHRASES = ["Captain", "one moment please sir", "passing this to Firstmate"] as const;

const RETIRED = RETIRED_PHRASES.map((phrase) => ({
  phrase,
  pattern: new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
}));

/** The ruled-out phrases this text uses, in list order. */
export function retiredPhrasesIn(answer: string): string[] {
  return RETIRED.filter(({ pattern }) => pattern.test(answer)).map(({ phrase }) => phrase);
}

/** Deterministic send-path check: the answer uses a phrase George has ruled out. */
export function retiredPhraseProblems(answer: string): string[] {
  return retiredPhrasesIn(answer).map((phrase) =>
    `It uses a phrase George has ruled out ("${phrase}"). Say the outcome in your own words.`);
}

/** Last resort before the answer is spoken: cut a ruled-out phrase a failed rewrite left behind. */
// ponytail: crude scrub ("captain's" → "sir's"); regeneration is the real fix, this only stops a leak.
export function stripRetiredPhrases(answer: string): string {
  let out = answer;
  for (const { phrase, pattern } of RETIRED) {
    out = out.replace(new RegExp(pattern.source, "gi"), phrase.toLowerCase() === "captain" ? "sir" : "");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").replace(/^[\s.,;:!?]+/gm, "").trim();
}

// George wants the outcome or nothing (AGENTS.md "One voice"): no "Passing
// this to Firstmate", no "One moment please sir", no "Let me check". A
// rewrite prompt can be ignored, so these sentences are cut mechanically from
// every answer before it reaches him.
// Each pattern must cover a whole sentence, or a whole opening clause before
// ":", ";", a dash or an ellipsis, so the outcome that follows always stays:
// advice ("I'd suggest handing it to your accountant"), outcomes ("I sent the
// fix to Firstmate this morning") and commitments ("Let me check with Sam
// tomorrow") are never cut.
// Handing something to George himself ("I'll pass it to you") is not routing.
const HANDOFF = /^(?:(?:I'?m |I am |now )?(?:passing|handing|routing)|I'?ll (?:pass|hand|route)|I will (?:pass|hand|route)) (?:this|it|that)(?: along| over| on)?(?: to (?!your\b)(?:the )?(?:[\w-]+ )?(?:firstmate|crew|boss|team|agent|worker)s?(?: now)?)?\s*[.!…]*$|^(?:this|that|it)(?: one)?(?:'s| is) for the crew\s*[.!…]*$/i;
const STALL = /^(?:(?:one moment|give me a (?:sec(?:ond)?|moment|minute)|let me check|just checking|checking now)(?:,? (?:please|sir|now|that|this|it|for you|on that|real quick))*|(?:still )?loading(?: now| it| that| up)?)\s*[.…!]*$/i;
const TOOL_NARRATION = /^(?:I'?m|I am) (?:calling|running|invoking|using) (?:the|my) (?:[\w-]+ ){0,3}tool(?: now)?\s*[.!…]*$|^(?:now )?(?:calling|running|invoking) (?:the|my) (?:[\w-]+ ){0,3}tool(?: now)?\s*[.!]+$|^I (?:ran|called|used|invoked) (?:the|my) (?:[\w-]+ ){0,3}tools?\s*[.!…]*$|^I(?:'ve)? (?:ran|run|checked|searched|looked)\b[^.!?]* (?:through|with|via) my tools\s*[.!…]*$/i;
// "Internally" alone is ordinary English ("I'd handle payroll internally");
// only Flyd's own checking or running describes its machinery.
const INTERNALLY = /^I(?:'ve|'m)? (?:checked|checking|ran|running|looked|looking|searched|searching|processed|processing|routed|routing)\b[^.!?]*\binternally(?: and found it)?\s*[.!…]*$/i;
const OPENING_CLAUSE = /^(.+?)(\s*(?:—|–|-|:|;|\.\.\.|…))\s+(\S.*)$/;

export function isNarration(sentence: string): boolean {
  // Quoting a phrase (no more "Let me check") talks about it; it does not narrate.
  const own = sentence.replace(/"[^"]*"|“[^”]*”/g, "\"\"");
  return HANDOFF.test(own) || STALL.test(own) || TOOL_NARRATION.test(own) || INTERNALLY.test(own);
}

/**
 * Cuts sentences that narrate Flyd's own routing, stalling or tools. Code
 * blocks are left alone. When nothing substantive would be left, the original
 * stands and nothing is reported removed.
 */
export function stripInternalNarration(answer: string): { cleaned: string; removed: string[] } {
  const removed: string[] = [];
  const parts = answer.split(/(```[\s\S]*?```)/);
  const cleanedParts = parts.map((part, index) => {
    if (index % 2 === 1) return part;
    return part.split("\n").flatMap((line) => {
      if (!line.trim()) return [line];
      const indent = line.match(/^\s*/)?.[0] ?? "";
      const kept: string[] = [];
      for (const sentence of line.trim().split(/(?<=[.!?…])\s+(?![a-z])/)) {
        let rest = sentence;
        for (let opening = rest.match(OPENING_CLAUSE); opening && isNarration(opening[1]); opening = rest.match(OPENING_CLAUSE)) {
          removed.push(opening[1] + opening[2]);
          rest = opening[3].charAt(0).toUpperCase() + opening[3].slice(1);
        }
        if (isNarration(rest)) removed.push(rest);
        else kept.push(rest);
      }
      return kept.length ? [indent + kept.join(" ")] : [];
    }).join("\n");
  });
  if (!removed.length) return { cleaned: answer, removed };
  const cleaned = cleanedParts.join("").replace(/\n{3,}/g, "\n\n").trim();
  if (!/[\p{L}\p{N}]{2,}/u.test(cleaned)) return { cleaned: answer, removed: [] };
  return { cleaned, removed };
}

// Everything else Flyd puts in front of George — a relayed update in the
// window, a notice for a finished run — crosses the same bar a chat answer
// does. The chat path already holds these out (conversation-responder.ts);
// the relay and notice paths did not, so machinery and placeholders leaked
// there. Same checks, one place.

/** A commit id is plumbing, not news: dropped with the word that points at it ("merged at a1b2c3d." → "merged."). An id joined to a name ("domain-cf340333") or a path is not a commit id and stays. Pure. */
export function stripCommitIds(text: string): string {
  return text.replace(/\s*\(?\b(?:(?:at|in|as|via|commit)\s+){0,2}(?<![\w/-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b\)?/gi, "");
}

/** Why text Flyd is about to relay to George may not be shown as written: backstage machinery (a commit id, also inside a link, is not), a ruled-out phrase, or a placeholder status. As chief-of-staff shortfalls, so a held text records against the standard. Pure. */
export function relayShortfalls(text: string): Shortfall[] {
  const said = text.replace(/\s+/g, " ").trim();
  if (!said) return [{ requirement: "real_status", reason: "It says nothing.", quote: "", by: "check" }];
  const shortfalls: Shortfall[] = [];
  const backstage = firstBackstage(withoutLinkIds(stripCommitIds(said)));
  if (backstage) shortfalls.push({ requirement: "backstage_hidden", reason: `It names your own backstage ("${backstage}").`, quote: said.slice(0, 240), by: "check" });
  const retired = retiredPhrasesIn(said)[0];
  if (retired) shortfalls.push({ requirement: "his_voice", reason: `It uses a phrase George has ruled out ("${retired}").`, quote: said.slice(0, 240), by: "check" });
  if (isPlaceholderStatus(said)) shortfalls.push({ requirement: "real_status", reason: "It only says work is happening, naming nothing concrete.", quote: said.slice(0, 240), by: "check" });
  return shortfalls;
}

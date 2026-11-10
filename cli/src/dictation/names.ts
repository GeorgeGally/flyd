import { applyRules, flydNameBackstop } from "./cleanup.js";
import { recordNameLesson, learnedNameRules } from "./corrections.js";
import { ordinaryWords, soundDistance, soundsLikeName, squashName as squash } from "./fidelity.js";
import { loadSpokenNames, loadVocabulary, type ReplacementRule } from "./vocabulary.js";

// Transcribers hear George's project and people names as the real words they
// sound like ("Kleenex" for CleanX, "Floyd" for Flyd), whatever the prompt says.
// Every voice path (dictation, conversation, LIVE) ends here: spellings George
// taught Flyd, then known sound-alikes, then his project and people names heard
// as two words ("clean x"). A word that is itself one of his names is never rewritten.

// Sound-alikes the transcriber is known to prefer, active while the name is his.
const KNOWN_SOUND_ALIKES: Array<{ to: string; from: string[] }> = [
  { to: "CleanX", from: ["Kleenex", "Kleenx", "Kleenexes", "Clean X", "Clean-X", "Kleen X", "Cleanex", "Cleenex"] },
];

/** Joins two heard words spelling exactly one of his project or people names: "clean x", "taste maker". */
export function joinSpacedNames(text: string, names: string[]): string {
  const joinable = names.filter(name => /^[\p{L}][\p{L}\p{N}]{3,}$/u.test(name));
  if (!joinable.length) return text;
  const words = [...text.matchAll(/[\p{L}][\p{L}\p{N}]*/gu)].map(m => ({ word: m[0], start: m.index!, end: m.index! + m[0].length }));
  const edits: Array<{ start: number; end: number; to: string }> = [];
  for (let i = 0; i + 1 < words.length; i++) {
    if (!/^[ -]$/.test(text.slice(words[i].end, words[i + 1].start))) continue;
    const name = joinable.find(term => squash(words[i].word + words[i + 1].word) === squash(term));
    if (!name) continue;
    edits.push({ start: words[i].start, end: words[i + 1].end, to: name });
    i++;
  }
  return edits.reduceRight((current, edit) => current.slice(0, edit.start) + edit.to + current.slice(edit.end), text);
}

/** The deterministic name pass, pure: learned spellings, known sound-alikes, the Floyd backstop, then spaced names. */
export function correctNames(text: string, terms: string[], learned: ReplacementRule[] = [], spoken: string[] = []): string {
  if (!text) return text;
  const known = new Set(terms.map(term => term.toLowerCase()));
  const has = (name: string) => known.has(name.toLowerCase());
  // A learned rule never rewrites one of his names, and lapses when its name is no longer his.
  let current = applyRules(text, learned.filter(rule => !has(rule.from) && has(rule.to)));
  const builtIn = KNOWN_SOUND_ALIKES.filter(entry => has(entry.to))
    .flatMap(entry => entry.from.filter(from => !has(from)).map(from => ({ from, to: entry.to })));
  current = applyRules(current, builtIn);
  if (!has("Floyd")) current = flydNameBackstop(current);
  return joinSpacedNames(current, spoken);
}

/**
 * Every voice path's last step. `transcript` is what George said; text a model
 * wrote (the LIVE intent) gets his spellings but no joining of spaced words.
 * Never throws: a failure leaves the text as heard, Floyd aside.
 */
export function correctVoiceNames(text: string, transcript = true): string {
  try {
    return correctNames(text, loadVocabulary(), learnedNameRules(), transcript ? loadSpokenNames() : []);
  } catch {
    return flydNameBackstop(text);
  }
}

/** The canonical spelling when `name` is one of his names, case and spacing aside. */
function knownName(name: string, terms: string[]): string | undefined {
  return terms.find(term => squash(term) === squash(name));
}

const NAME = String.raw`([\p{L}][\p{L}\p{N}.'’-]*(?:\s[\p{L}][\p{L}\p{N}.'’-]*)?)`;
const LEAD = String.raw`(?:i\s+meant|i\s+mean|i\s+said|meant|it'?s|its|it\s+is|that'?s|that\s+is|it\s+should\s+be|should\s+be|spelled|spelt|spell\s+it|the\s+name\s+is|call\s+it)`;
// "it's CleanX not Kleenex", "CleanX, not Kleenex", "not Kleenex, CleanX", "Kleenex should be CleanX".
const STATED: Array<{ pattern: RegExp; name: number; heard: number }> = [
  { pattern: new RegExp(String.raw`(?:^|[\s,.;:!-])(?:${LEAD}\s+)?${NAME}[,;]?\s+not\s+${NAME}(?=$|[\s,.;:!?])`, "iu"), name: 1, heard: 2 },
  { pattern: new RegExp(String.raw`(?:^|[\s,.;:!-])not\s+${NAME}[,;]?\s+(?:but\s+)?(?:${LEAD}\s+)?${NAME}(?=$|[\s,.;:!?])`, "iu"), name: 2, heard: 1 },
  { pattern: new RegExp(String.raw`(?:^|[\s,.;:!-])${NAME}\s+(?:should\s+be|is\s+meant\s+to\s+be|means|is\s+spelled|is\s+spelt|->|→|=)\s+${NAME}(?=$|[\s,.;:!?])`, "iu"), name: 2, heard: 1 },
];
const MEANT = String.raw`(?:i\s+meant|i\s+mean|i\s+said|meant)`;
// Only an explicit correction implies one: "I meant CleanX", "no, CleanX". "It's Logan" just names it.
const IMPLIED = new RegExp(String.raw`^\s*(?:(?:no|nope|sorry|oops)[,.!]?\s*(?:${LEAD}\s+)?|${MEANT}\s+)${NAME}[\s.!]*$`, "iu");

const trimWord = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/**
 * What George's correction teaches, if it is one: he names one of his names and
 * either says outright what was heard ("it's CleanX not Kleenex") or, as in
 * "I meant CleanX", the heard words are the sound-alike in what he said before.
 * Choosing one name over another ("Logan, not Pierre") teaches nothing.
 */
export function nameCorrection(message: string, previous: string | undefined, terms: string[]): { from: string; to: string } | null {
  const text = message.trim();
  if (!text || text.length > 200 || text.split(/\s+/).length > 14) return null;
  for (const { pattern, name, heard } of STATED) {
    const match = text.match(pattern);
    if (!match) continue;
    const to = knownName(trimWord(match[name]), terms);
    const from = trimWord(match[heard]);
    if (to && from && !knownName(from, terms) && soundsLikeName(from, to)) return { from, to };
  }
  const implied = text.match(IMPLIED);
  const to = implied ? knownName(trimWord(implied[1]), terms) : undefined;
  if (!to || !previous) return null;
  // Unstated, the heard words must pass the strict sound match and not be ordinary English; the closest wins.
  const said = [...previous.matchAll(/[\p{L}][\p{L}\p{N}]*/gu)].map(m => m[0]);
  const heard = said.flatMap((word, i) => i + 1 < said.length ? [word, `${word} ${said[i + 1]}`] : [word])
    .filter(candidate => !knownName(candidate, terms) && !ordinaryWords(candidate) && soundsLikeName(candidate, to))
    .sort((x, y) => soundDistance(x, to) - soundDistance(y, to))[0];
  return heard ? { from: heard, to } : null;
}

/**
 * Learns from one thing George said or typed, given what he said just before.
 * The first clear correction of one of his names is enough: it is his own
 * spelling of his own name. It is evidence of the dictation-corrections source,
 * so it is learned only while that source is on and `flyd learning` governs it.
 * Learning failures never reach the conversation.
 */
export function learnNameCorrection(message: string, previous: string | undefined, source: string, terms?: string[]): number | null {
  try {
    const correction = nameCorrection(message, previous, terms ?? loadVocabulary());
    return correction ? recordNameLesson(correction, source) : null;
  } catch {
    return null;
  }
}

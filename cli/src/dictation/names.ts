import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { applyRules, flydNameBackstop } from "./cleanup.js";
import { soundKey } from "./fidelity.js";
import { loadVocabulary, type ReplacementRule } from "./vocabulary.js";

// Transcribers hear George's project and people names as the real words they
// sound like ("Kleenex" for CleanX, "Floyd" for Flyd), whatever the prompt says.
// Every voice path (dictation, conversation, LIVE) ends here: spellings George
// taught Flyd, then known sound-alikes, then a sound-alike match against his
// names so a new project needs no hand-written rule. A word that is itself one
// of his names is never rewritten.

export interface NameRule extends ReplacementRule {
  learnedAt?: string;
  /** Where George taught it: "chat", "live" or "dictation". */
  source?: string;
}

// Sound-alikes the transcriber is known to prefer, active while the name is his.
const KNOWN_SOUND_ALIKES: Array<{ to: string; from: string[] }> = [
  { to: "CleanX", from: ["Kleenex", "Kleenx", "Kleenexes", "Clean X", "Clean-X", "Kleen X", "Cleanex", "Cleenex"] },
];

export function voiceNameRulesPath(): string {
  return process.env.FLYD_VOICE_NAME_RULES?.trim() ||
    join(process.env.FLYD_DIR?.trim() || join(homedir(), ".flyd"), "voice-name-rules.json");
}

/** Letters only, lowercased: "Clean X" and "CleanX" are the same spoken name. */
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** A spelling closer to how a word sounds, so edit distance compares sounds, not letters. */
function phonetic(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, "")
    .replace(/ph/g, "f").replace(/ck/g, "k").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/q/g, "k")
    .replace(/x/g, "ks").replace(/z/g, "s").replace(/(?:ee|ea|ie)/g, "Y").replace(/(?:oo|ou)/g, "U")
    .replace(/(.)\1+/g, "$1").replace(/(?<=.)e$/, "");
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/** How far apart two spellings sound, 0 (same) to 1. */
function soundDistance(a: string, b: string): number {
  const pa = phonetic(a), pb = phonetic(b);
  return editDistance(pa, pb) / Math.max(pa.length, pb.length, 1);
}

/**
 * Whether a heard word or phrase is a plausible mishearing of a name: same sound
 * key (at least three sounds), similar length, and close when spelled by sound.
 * `loose` widens the last bound for corrections George states outright.
 */
export function soundsLikeName(heard: string, name: string, loose = false): boolean {
  const a = squash(heard), b = squash(name);
  if (!a || !b || a === b || /\d/.test(a)) return false;
  const ratio = a.length / b.length;
  if (ratio < 0.6 || ratio > 1.6) return false;
  const key = soundKey(a);
  if (key.length >= 3 && key === soundKey(b) && soundDistance(a, b) <= 0.25) return true;
  return loose && soundDistance(a, b) <= 0.5 && soundKey(a).slice(0, 2) === soundKey(b).slice(0, 2);
}

/** Names worth matching by sound: one word, at least four letters. */
function matchableNames(terms: string[]): string[] {
  return terms.filter(term => /^[\p{L}][\p{L}\p{N}]{3,}$/u.test(term) && soundKey(term).length >= 3);
}

/** CamelCase or ALLCAPS-led names are never ordinary words, so a single heard word may stand for one. */
const distinctive = (term: string) => /[\p{Ll}][\p{Lu}]|^[\p{Lu}]{2,}\p{Ll}/u.test(term);

/** Replaces heard words and two-word phrases that sound like one of his names. */
export function soundAlikeNames(text: string, terms: string[]): string {
  const names = matchableNames(terms);
  if (!names.length) return text;
  const known = new Set(terms.map(term => term.toLowerCase()));
  const words = [...text.matchAll(/[\p{L}][\p{L}\p{N}]*/gu)].map(m => ({ word: m[0], start: m.index!, end: m.index! + m[0].length }));
  const edits: Array<{ start: number; end: number; to: string }> = [];
  for (let i = 0; i < words.length; i++) {
    const spans = [];
    // Two words joined only by a space or hyphen: "clean x", "taste maker".
    if (i + 1 < words.length && /^[ -]$/.test(text.slice(words[i].end, words[i + 1].start))) {
      spans.push({ heard: words[i].word + words[i + 1].word, start: words[i].start, end: words[i + 1].end, pair: true });
    }
    spans.push({ heard: words[i].word, start: words[i].start, end: words[i].end, pair: false });
    const match = spans.flatMap(span => {
      if (known.has(text.slice(span.start, span.end).toLowerCase())) return [];
      const eligible = names.filter(term => span.pair || distinctive(term));
      // Same letters, other spacing or case: "clean x", "taste maker", "cleanx".
      const name = eligible.find(term => squash(span.heard) === squash(term)) ??
        eligible.find(term => soundsLikeName(span.heard, term));
      return name ? [{ ...span, name }] : [];
    })[0];
    if (!match) continue;
    edits.push({ start: match.start, end: match.end, to: match.name });
    if (match.pair) i++;
  }
  return edits.reduceRight((current, edit) => current.slice(0, edit.start) + edit.to + current.slice(edit.end), text);
}

/** The deterministic name pass, pure: learned spellings, known sound-alikes, then sound matching. */
export function correctNames(text: string, terms: string[], learned: ReplacementRule[] = []): string {
  if (!text) return text;
  const known = new Set(terms.map(term => term.toLowerCase()));
  const has = (name: string) => known.has(name.toLowerCase());
  // A learned rule never rewrites one of his names into another.
  let current = applyRules(text, learned.filter(rule => !has(rule.from)));
  const builtIn = KNOWN_SOUND_ALIKES.filter(entry => has(entry.to))
    .flatMap(entry => entry.from.filter(from => !has(from)).map(from => ({ from, to: entry.to })));
  current = applyRules(current, builtIn);
  if (!has("Floyd")) current = flydNameBackstop(current);
  return soundAlikeNames(current, terms);
}

let cachedRules: { path: string; mtime: number; rules: NameRule[] } | null = null;

export function loadNameRules(): NameRule[] {
  const path = voiceNameRulesPath();
  let mtime = -1;
  try { mtime = statSync(path).mtimeMs; } catch { /* none yet */ }
  if (cachedRules?.path === path && cachedRules.mtime === mtime) return cachedRules.rules;
  let rules: NameRule[] = [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (Array.isArray(parsed)) rules = parsed.filter((rule): rule is NameRule =>
      typeof rule?.from === "string" && rule.from.trim() !== "" && typeof rule?.to === "string" && rule.to.trim() !== "");
  } catch { /* missing or unreadable: no learned names */ }
  cachedRules = { path, mtime, rules };
  return rules;
}

/** Every voice path's last step. Never throws: a broken names file leaves the transcript as heard. */
export function correctVoiceNames(text: string, terms?: string[]): string {
  try {
    return correctNames(text, terms ?? loadVocabulary(), loadNameRules());
  } catch {
    return flydNameBackstop(text);
  }
}

/** Saves a spelling George taught; a newer lesson for the same heard words replaces the older one. */
export function saveNameRule(rule: { from: string; to: string }, source: string): NameRule | null {
  // Tests never write George's real names file.
  if (process.env.VITEST && !process.env.FLYD_VOICE_NAME_RULES && !process.env.FLYD_DIR) return null;
  const learned: NameRule = { from: rule.from.trim(), to: rule.to.trim(), learnedAt: new Date().toISOString(), source };
  if (!learned.from || !learned.to || squash(learned.from) === squash(learned.to) && learned.from.toLowerCase() === learned.to.toLowerCase()) return null;
  const rules = loadNameRules().filter(existing => existing.from.toLowerCase() !== learned.from.toLowerCase());
  const path = voiceNameRulesPath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify([...rules, learned], null, 2) + "\n");
  renameSync(temp, path);
  cachedRules = null;
  return learned;
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
const IMPLIED = new RegExp(String.raw`^\s*(?:(?:no|nope|sorry|oops)[,.!]?\s*(?:${LEAD}\s+)?|${LEAD}\s+)${NAME}[\s.!]*$`, "iu");

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
    if (to && from && !knownName(from, terms) && soundsLikeName(from, to, true)) return { from, to };
  }
  const implied = text.match(IMPLIED);
  const to = implied ? knownName(trimWord(implied[1]), terms) : undefined;
  if (!to || !previous) return null;
  // Unstated, the heard words must pass the strict sound match; the closest wins.
  const words = [...previous.matchAll(/[\p{L}][\p{L}\p{N}]*/gu)].map(m => m[0]);
  const heard = words.flatMap((word, i) => i + 1 < words.length ? [word, `${word} ${words[i + 1]}`] : [word])
    .filter(candidate => !knownName(candidate, terms) && (squash(candidate) === squash(to) || soundsLikeName(candidate, to)))
    .sort((x, y) => soundDistance(x, to) - soundDistance(y, to))[0];
  return heard ? { from: heard, to } : null;
}

/**
 * Learns from one thing George said or typed, given what he said just before.
 * The first clear correction of one of his names is enough: it is his own
 * spelling of his own name. Learning failures never reach the conversation.
 */
export function learnNameCorrection(message: string, previous: string | undefined, source: string, terms?: string[]): NameRule | null {
  try {
    const correction = nameCorrection(message, previous, terms ?? loadVocabulary());
    return correction ? saveNameRule(correction, source) : null;
  } catch {
    return null;
  }
}

/** A dictation edit of one of his names teaches at once; other words keep the rule of three. */
export function learnNameEdit(pair: { from: string; to: string }, terms?: string[]): NameRule | null {
  try {
    const names = terms ?? loadVocabulary();
    const to = knownName(pair.to, names);
    if (!to || knownName(pair.from, names) || !soundsLikeName(pair.from, to, true)) return null;
    return saveNameRule({ from: pair.from, to }, "dictation");
  } catch {
    return null;
  }
}

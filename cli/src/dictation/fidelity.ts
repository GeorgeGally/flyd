import type { ReplacementRule } from "./vocabulary.js";

/** Lexical guard: reject altered protected slots, including number words.
 * Explicit self-corrections remain untouched when ambiguous; fidelity beats polish. */

// The spoken file extensions cleanup may rewrite: "config dot json" -> "config.json".
// Shared with the cleanup prompt so the sanctioned set and the guard cannot drift apart.
export const SPOKEN_EXTENSIONS = [
  "ts", "tsx", "js", "json", "swift", "rb", "md",
  "py", "go", "rs", "java", "kt", "c", "h", "cpp", "cs", "php", "sql",
  "sh", "zsh", "yml", "yaml", "toml", "ini", "env", "html", "css", "scss",
  "xml", "csv", "txt", "pdf", "png", "jpg", "svg", "mp4",
] as const;

const EXTENSION_PATTERN = [...SPOKEN_EXTENSIONS].sort((a, b) => b.length - a.length).join("|");

const SPOKEN_EXTENSION = new RegExp(String.raw`\b([\p{L}\p{N}_-]+)\s+dot\s+(${EXTENSION_PATTERN})\b`, "giu");
function writeSpokenExtensions(text: string): string {
  return text.replace(SPOKEN_EXTENSION, "$1.$2");
}

const PROTECTED_TOKEN = new RegExp(
  String.raw`\b(?:don't|can't|won't|isn't|wasn't|shouldn't|wouldn't|couldn't|mustn't|not|no|none|cannot|nor|neither|never|without|before|after|unless|only|if|maybe|approximately|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundred|thousand|million|billion)\b|\b\d+(?:[.,:/-]\d+)*%?\b|(?:--?[\w-]+)|(?:[~./][\w./-]+)|\b[\w-]+\.(?:${EXTENSION_PATTERN})\b`,
  "g",
);

export function protectedTokens(text: string): string[] {
  return (writeSpokenExtensions(text).toLowerCase().replace(/’/g, "'").match(PROTECTED_TOKEN) ?? []);
}

export function preservesProtectedTokens(input: string, output: string): boolean {
  return JSON.stringify(protectedTokens(input)) === JSON.stringify(protectedTokens(output));
}

function words(text: string): string[] {
  return writeSpokenExtensions(text).toLowerCase().replace(/’/g, "'")
    .replace(/\byou know\b/g, "")
    .match(/[\p{L}\p{N}_]+(?:'[\p{L}]+)?/gu)?.filter(word => !/^(?:um+|uh+|erm+|er)$/.test(word)) ?? [];
}

/** Same lexical normalization as the fidelity guard, retaining exact spelling. */
export function fidelityTokens(text: string): string[] {
  return writeSpokenExtensions(text).replace(/’/g, "'").replace(/\byou know\b/gi, "")
    .match(/[\p{L}\p{N}_]+(?:'[\p{L}]+)?/gu)?.filter(word => !/^(?:um+|uh+|erm+|er)$/i.test(word)) ?? [];
}

const VOWEL = /[aeiou]/;

/**
 * Metaphone-style sound key (a simplified Metaphone): two words sound alike only when
 * their keys are identical, e.g. "flight" and "Flyd" are both FLT, "sunday" (SNT) and
 * "Monday" (MNT) are not.
 */
export function soundKey(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, "")
    .replace(/^(?:kn|gn|pn|ae|wr)/, m => m[1]).replace(/^x/, "s").replace(/^wh/, "w");
  let key = "";
  for (let i = 0; i < w.length; i++) {
    const c = w[i], next = w[i + 1] ?? "", prev = w[i - 1] ?? "";
    if (c === prev) continue;
    switch (c) {
      case "a": case "e": case "i": case "o": case "u": if (i === 0) key += c; break;
      case "b": if (!(prev === "m" && !next)) key += "b"; break;
      case "c": if (next === "h") { key += "x"; i++; } else key += /[eiy]/.test(next) ? "s" : "k"; break;
      case "d": key += next === "g" && /[eiy]/.test(w[i + 2] ?? "") ? "j" : "t"; break;
      case "g":
        if (next === "h" && i > 0 && !VOWEL.test(w[i + 2] ?? "")) i++;
        else key += /[eiy]/.test(next) ? "j" : "k";
        break;
      case "h": if (VOWEL.test(next) && !"csptg".includes(prev)) key += "h"; break;
      case "k": if (prev !== "c") key += "k"; break;
      case "p": if (next === "h") { key += "f"; i++; } else key += "p"; break;
      case "q": key += "k"; break;
      case "s": if (next === "h") { key += "x"; i++; } else key += "s"; break;
      case "t": if (next === "h") { key += "0"; i++; } else key += "t"; break;
      case "v": key += "f"; break;
      case "w": case "y": if (VOWEL.test(next)) key += c; break;
      case "x": key += "ks"; break;
      case "z": key += "s"; break;
      default: key += c;
    }
  }
  return key;
}

/**
 * The second sanctioned rewrite: the output word is exactly a shortlist term and the
 * spoken word is a plausible mishearing of it, either an approved correction pair or
 * a word with the same sound key.
 */
function isSanctionedSpelling(source: string, target: string, terms: Set<string>, approved: Set<string>): boolean {
  if (!terms.has(target)) return false;
  if (approved.has(`${source}\u0000${target}`)) return true;
  // Sound-alike bound: the shared key needs at least 3 characters (shorter keys such as
  // "hr" or "tm" are shared by too many common words) and the two words must be within a
  // 0.6-1.6 length ratio. Shorter keys are swapped only by an approved correction pair.
  const key = soundKey(source);
  const ratio = source.length / target.length;
  return key.length >= 3 && key === soundKey(target) && ratio >= 0.6 && ratio <= 1.6;
}

/**
 * Cleanup may format and remove fillers. It may also apply exactly two sanctioned
 * rewrites: a spoken file extension into written form, and replacing a misheard word
 * with a term from the dictation spelling shortlist. Everything else must survive unchanged.
 */
export function preservesWords(input: string, output: string, spellings: string[] = [], rules: ReplacementRule[] = []): boolean {
  const before = words(input);
  const after = words(output);
  if (before.length !== after.length) return false;
  const terms = new Set(spellings.flatMap(words));
  const approved = new Set(rules.map(rule => `${rule.from.toLowerCase()}\u0000${rule.to.toLowerCase()}`));
  return before.every((word, index) => word === after[index] || isSanctionedSpelling(word, after[index], terms, approved));
}

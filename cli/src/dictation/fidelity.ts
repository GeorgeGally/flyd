/** Lexical guard: reject altered protected slots, including number words.
 * Explicit self-corrections remain untouched when ambiguous; fidelity beats polish. */

// The only spoken form cleanup may rewrite: "config dot json" -> "config.json".
const SPOKEN_EXTENSION = /\b([\p{L}\p{N}_-]+)\s+dot\s+(tsx|ts|js|json|swift|rb|md)\b/giu;
function writeSpokenExtensions(text: string): string {
  return text.replace(SPOKEN_EXTENSION, "$1.$2");
}

export function protectedTokens(text: string): string[] {
  return (writeSpokenExtensions(text).toLowerCase().replace(/’/g, "'").match(
    /\b(?:don't|can't|won't|isn't|wasn't|shouldn't|wouldn't|couldn't|mustn't|not|never|without|before|after|unless|only|if|maybe|approximately|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million|billion)\b|\b\d+(?:[.,:/-]\d+)*%?\b|(?:--?[\w-]+)|(?:[~./][\w./-]+)|\b[\w-]+\.(?:ts|tsx|js|json|swift|rb|md)\b/g,
  ) ?? []);
}

export function preservesProtectedTokens(input: string, output: string): boolean {
  return JSON.stringify(protectedTokens(input)) === JSON.stringify(protectedTokens(output));
}

function words(text: string): string[] {
  return writeSpokenExtensions(text).toLowerCase().replace(/’/g, "'")
    .replace(/\byou know\b/g, "")
    .match(/[\p{L}\p{N}_]+(?:'[\p{L}]+)?/gu)?.filter(word => !/^(?:um+|uh+|erm+|er)$/.test(word)) ?? [];
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** The second sanctioned rewrite: replacing a word with a spelling-hint term. */
function isListedSpelling(word: string, terms: Set<string>): boolean {
  if (terms.has(word)) return true;
  for (const term of terms) if (term.length >= 4 && editDistance(word, term) <= 2) return true;
  return false;
}

/**
 * Cleanup may format and remove fillers. It may also apply exactly two sanctioned
 * rewrites: a spoken file extension into written form, and replacing a word with a
 * term from the dictation spelling shortlist. Everything else must survive unchanged.
 */
export function preservesWords(input: string, output: string, spellings: string[] = []): boolean {
  const before = words(input);
  const after = words(output);
  if (before.length !== after.length) return false;
  const terms = new Set(spellings.flatMap(words));
  return before.every((word, index) => word === after[index] || isListedSpelling(after[index], terms));
}

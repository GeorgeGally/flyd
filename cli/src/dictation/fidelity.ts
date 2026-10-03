/** Lexical guard: reject altered protected slots, including number words.
 * Explicit self-corrections remain untouched when ambiguous; fidelity beats polish. */
export function protectedTokens(text: string): string[] {
  return (text.toLowerCase().replace(/’/g, "'").match(
    /\b(?:don't|can't|won't|isn't|wasn't|shouldn't|wouldn't|couldn't|mustn't|not|never|without|before|after|unless|only|if|maybe|approximately|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million|billion)\b|\b\d+(?:[.,:/-]\d+)*%?\b|(?:--?[\w-]+)|(?:[~./][\w./-]+)|\b[\w-]+\.(?:ts|tsx|js|json|swift|rb|md)\b/g,
  ) ?? []);
}

export function preservesProtectedTokens(input: string, output: string): boolean {
  return JSON.stringify(protectedTokens(input)) === JSON.stringify(protectedTokens(output));
}

/** Cleanup may format and remove fillers; semantic rewrites require explicit editing mode. */
export function preservesWords(input: string, output: string): boolean {
  const words = (text: string) => text.toLowerCase().replace(/’/g, "'")
    .replace(/\byou know\b/g, "")
    .match(/[\p{L}\p{N}_]+(?:'[\p{L}]+)?/gu)?.filter(word => !/^(?:um+|uh+|erm+|er)$/.test(word)) ?? [];
  return JSON.stringify(words(input)) === JSON.stringify(words(output));
}

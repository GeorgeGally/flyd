export const BACKSTAGE_DENYLIST: RegExp[] = [
  /\bfirstmates?\b/i,
  /\bcrew ?mates?\b|\bcrewmembers?\b/i,
  /\bsubagents?\b/i,
  /\b(?:task|run)\s+id\b/i,
  /\bbranch(?:es)?\b/i,
  /\bworktrees?\b/i,
  /\bpipelines?\b/i,
  /\bJev\b/,
  /\b(?:Librarian|Strategist|Critic|Muse|Scout)\b/,
  /\bthe (?:council|librarian|strategist|critic|muse|scout)\b/i,
];

export function firstBackstage(text: string): string | null {
  for (const re of BACKSTAGE_DENYLIST) {
    const match = text.match(re);
    if (match) return match[0];
  }
  return null;
}

export function hasBackstage(text: string): boolean {
  return firstBackstage(text) !== null;
}

const REWRITES: Array<[RegExp, string]> = [
  [/\bfirstmate has not read (\d+) notes? you (?:sent|left)\b/gi, "You have $1 notes still waiting"],
  [/\bfirstmate (?:asks|wants to know|is asking)\s*:?\s*/gi, ""],
  [/\bfirstmate'?s\s+/gi, "the "],
  [/\bfirstmate\b\s*/gi, ""],
  [/\bcrewmembers?\b/gi, "I"],
  [/\b(?:the\s+|a\s+|your\s+|our\s+)?crew ?mates?\b/gi, "I"],
  [/\bsubagents?\b/gi, "I"],
  [/\bJev\b/gi, "I"],
  [/\b(?:the\s+)?(?:librarian|strategist|critic|muse|scout)\b/gi, "I"],
  [/\b(?:the\s+)?council\b/gi, "I"],
  [/\b(?:task|run)\s+id\s*[:#]?\s*[^\s,;.)]+/gi, "the work"],
  [/\b(?:the\s+)?pipelines?\b/gi, "the checks"],
  [/\s+(?:on|onto|in|to|from|off|using|via)\s+(?:the\s+|a\s+|your\s+|our\s+|its\s+)?(?:[\w./-]+\s+)?(?:branch|worktree)s?\b/gi, ""],
  [/\b(?:the\s+|a\s+|your\s+|our\s+|its\s+)?(?:branch|worktree)s?\s+[A-Za-z0-9][\w./-]*/gi, ""],
  [/\b(?:the\s+|a\s+|your\s+|our\s+|its\s+)?(?:branch|worktree)s?\b/gi, ""],
];

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*([.!?])/g, "$2")
    .replace(/^[\s,;:—-]+/, "")
    .trim()
    .replace(/^([a-z])/, (c) => c.toUpperCase());
}

function neutralOutcome(text: string): string {
  const counts = text.match(/\d+(?:\s+[A-Za-z]+)?/g);
  return counts?.length ? `Update — ${counts.join(", ")}` : "There is an update on your work.";
}

export function scrubBackstage(text: string): string {
  const rewritten = REWRITES.reduce((t, [re, to]) => t.replace(re, to), text);
  if (hasBackstage(rewritten)) return neutralOutcome(text);
  return tidy(rewritten);
}

export const BACKSTAGE_DENYLIST: RegExp[] = [
  /\bfirstmates?\b/i,
  /\bcrew ?mates?\b|\bcrewmembers?\b/i,
  /\bsubagents?\b/i,
  /\b(?:task|run)\s+id\b/i,
  /\bbranch(?:es)?\b/i,
  /\bworktrees?\b/i,
  /\bpipelines?\b/i,
  /\bjev\b/i,
  /\b(?:Librarians?|Strategists?|Critics?|Muses?|Scouts?)\b/,
  /\bthe (?:council|librarian|strategist|critic|muse|scout)s?\b/i,
  /\bfm\/[\w.-]+/i,
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i,
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
  [/\bfirstmate has not read (\d+) notes you sent; the oldest has waited (\d[\dh\s]*?(?:min|h|days?))\.?/gi, "$1 notes you sent are still waiting; the oldest has waited $2."],
  [/\bfirstmate has not read 1 note you sent (\d[\dh\s]*?(?:min|h|days?))\s+ago\b\.?/gi, "You have 1 note still waiting — sent $1 ago."],
  [/\bfirstmate (?:asks|wants to know|is asking)\s*:?\s*/gi, ""],
  [/\bfirstmate'?s\s+/gi, "the "],
  [/\bfirstmate\b\s*/gi, ""],
  [/\bcrewmembers?\b/gi, "I"],
  [/\b(?:the\s+|a\s+|your\s+|our\s+)?crew ?mates?\b/gi, "I"],
  [/\bsubagents?\b/gi, "I"],
  [/\bjev\b/gi, "I"],
  [/\b(?:the\s+)?(?:librarian|strategist|critic|muse|scout)s?\b/gi, "I"],
  [/\b(?:the\s+)?council\b/gi, "I"],
  [/\b(?:task|run)\s+id\s*[:#]?\s*[^\s,;.)]+/gi, "the work"],
  [/\b(?:the\s+)?pipelines?\b/gi, "the checks"],
  [/\s+(?:on|onto|in|to|from|off|using|via)\s+(?:the\s+|a\s+|your\s+|our\s+|its\s+)?(?:[\w./-]+\s+)?(?:branch|worktree)s?\b/gi, ""],
  [/\b(?:the\s+|a\s+|your\s+|our\s+|its\s+)?(?:branch|worktree)s?\s+[A-Za-z0-9][\w./-]*/gi, ""],
  [/\b(?:the\s+|a\s+|your\s+|our\s+|its\s+)?(?:branch|worktree)s?\b/gi, ""],
  [/\s+\b(?:on|onto|in|to|from|off|using|via)\s+fm\/[\w.-]+/gi, ""],
  [/\bfm\/[\w.-]+/gi, ""],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi, ""],
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
  const counts = text.match(/\d+/g);
  return counts?.length ? `Update — ${counts.join(", ")}` : "There is an update on your work.";
}

export function scrubBackstage(text: string): string {
  const rewritten = REWRITES.reduce((t, [re, to]) => t.replace(re, to), text);
  if (hasBackstage(rewritten)) return neutralOutcome(text);
  return tidy(rewritten);
}

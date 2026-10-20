export const BACKSTAGE_DENYLIST: RegExp[] = [
  /\bfirstmates?\b/i,
  /\bcrews?\b|\bcrew ?mates?\b|\bcrewmembers?\b/i,
  /\bsubagents?\b/i,
  /\b(?:task|run)\s+id\b/i,
  /\bbranch(?:es)?\b/i,
  /\bworktrees?\b/i,
  /\bpipelines?\b/i,
  /\bjev\b/i,
  /\b(?:Librarians?|Strategists?|Critics?|Muses?|Scouts?)\b/,
  /\bCouncil\b/,
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

const COUNT_UNITS =
  "h|hrs?|hours?|mins?|minutes?|days?|weeks?|notes?|files?|items?|jobs?|tests?|checks?|requests?|memories|stories|plans?|ideas?|commits?|updates?|entries?|reports?|tasks?|fixes|points?|lines?|steps?|tickets?|issues?";

const COUNT_TOKEN = "\\d+(?:[\\/.\\-]\\d+)?";

const COUNT_PHRASE = new RegExp(
  `(?<!\\w)(?<!\\d[\\/.\\-])${COUNT_TOKEN}\\s+(?:${COUNT_UNITS})\\b(?:\\s+(?:${COUNT_TOKEN}(?=\\s+(?:${COUNT_UNITS})\\b)|(?:${COUNT_UNITS})\\b))*`,
  "gi",
);

function neutralOutcome(text: string): string {
  const amounts = (text.match(COUNT_PHRASE) ?? []).map((amount) => amount.replace(/\s+/g, " ").trim());
  return amounts.length ? `Update — ${amounts.join(", ")}.` : "There is an update on your work.";
}

export function scrubBackstage(text: string): string {
  return hasBackstage(text) ? neutralOutcome(text) : text;
}

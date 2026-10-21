export const BACKSTAGE_DENYLIST: RegExp[] = [
  /\bfirstmates?\b/i,
  /\bcrews?\b|\bcrew ?mates?\b|\bcrewmembers?\b/i,
  /\bsubagents?\b/i,
  /\b(?:run|task|job)[ -]?id\b/i,
  /\bbranch(?:es)?\b/i,
  /\bfm\/[\w.-]+/i,
  /\bPR\s*#?\d+\b/i,
  /\bworktrees?\b/i,
  /\bpipelines?\b/i,
  /\bjev\b/i,
  /\bsystem-1\b/i,
  /\bdomain-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i,
  // Proper names are matched as written so "a critic" or "my muse" stays ordinary speech.
  /\b(?:Librarians?|Strategists?|Critics?|Muses?|Scouts?)\b/,
  /\bCouncil\b/,
  /\bthe (?:council|librarian|strategist|critic|muse|scout)s?\b/i,
  /\bjob-[0-9a-f]{6,}\b/i,
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i,
];

/** A commit id inside a link is part of the address, not news: masked before the denylist reads the text. Pure. */
export function withoutLinkIds(text: string): string {
  return text.replace(/https?:\/\/\S+/g, (url) => url.replace(/[0-9a-f]{7,40}/gi, ""));
}

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
  if (!hasBackstage(withoutLinkIds(text))) return text;
  const safe = text.split(/(?<=[.!?])\s+/).filter((sentence) => !hasBackstage(withoutLinkIds(sentence))).join(" ").trim();
  return safe || neutralOutcome(text);
}

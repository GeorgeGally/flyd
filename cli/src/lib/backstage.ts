const HELPERS = /\b(?:firstmates?|first mate|crew ?mates?|crewmembers?|subagents?|no-mistakes|domain boss)\b/i;
const MACHINERY = /\b(?:worktrees?|system-1|jev)\b/i;
// Proper names are matched as written so "a critic" or "my muse" stays ordinary speech.
const COUNCIL_NAMED = /\b(?:the (?:Librarian|Critic|Strategist|Muse|Council)|Scouts?)\b/;

const COMMIT_ID = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i;
const FM_BRANCH = /\bfm\/[\w.-]+/i;
const RUN_ID = /\b(?:run|task)[ -]?id\b/i;
const JOB_ID = /\bjob[ -]?id\b|\bjob-[0-9a-f]{6,}\b/i;
const DOMAIN_RUN_ID = /\bdomain-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i;
const PR_NUMBER = /\bPR\s*#?\d+\b/i;

/** Git and run telemetry: commit hashes, fm/ branches, task, run, job and domain-run ids. */
export const BACKSTAGE_TELEMETRY: RegExp[] = [COMMIT_ID, FM_BRANCH, RUN_ID, JOB_ID, DOMAIN_RUN_ID];

/** The names chat review holds back: helpers, machinery and the council by name, words that are rarely ordinary speech in an answer. */
export const CHAT_BACKSTAGE: RegExp[] = [HELPERS, MACHINERY, COUNCIL_NAMED];

/** What a chat answer may not name. A PR number or a job or domain-run id George asked about may be named back to him. */
export const CHAT_ANSWER_BACKSTAGE: RegExp[] = [
  ...CHAT_BACKSTAGE,
  /\bcrews?\b/i,
  /\bbranch(?:es)?\b/i,
  /\bpipelines?\b/i,
  /\b(?:Librarians?|Strategists?|Critics?|Muses?)\b/,
  /\bCouncil\b/,
  /\bthe (?:council|librarian|strategist|critic|muse|scout)s?\b/i,
  COMMIT_ID,
  FM_BRANCH,
  RUN_ID,
];

/** Everything relays, notices, status cards and agenda lines may not show. */
export const BACKSTAGE_DENYLIST: RegExp[] = [...CHAT_ANSWER_BACKSTAGE, PR_NUMBER, JOB_ID, DOMAIN_RUN_ID];

/** A commit id inside a link is part of the address, not news: masked before the denylist reads the text. Pure. */
export function withoutLinkIds(text: string): string {
  return text.replace(/https?:\/\/\S+/g, (url) => url.replace(/[0-9a-f]{7,40}/gi, ""));
}

export function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const match = text.match(re);
    if (match) return match[0];
  }
  return null;
}

export function firstBackstage(text: string): string | null {
  return firstMatch(text, BACKSTAGE_DENYLIST);
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
  const lines = text.split("\n").flatMap((line) => {
    if (!line.trim()) return [line];
    const kept = line.split(/(?<=[.!?])[ \t]+/).filter((sentence) => !hasBackstage(withoutLinkIds(sentence)));
    return kept.length ? [kept.join(" ")] : [];
  });
  const safe = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return safe || neutralOutcome(text);
}

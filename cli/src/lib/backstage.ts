const HELPERS = /\b(?:firstmates?|first mate|crew ?mates?|crewmembers?|subagents?|no-mistakes|domain boss)\b/i;
const MACHINERY = /\b(?:worktrees?|system-1|jev)\b/i;
// Proper names are matched as written so "a critic" or "my muse" stays ordinary speech.
const COUNCIL_NAMED = /\b(?:the (?:Librarian|Critic|Strategist|Muse|Council)|Scouts?)\b/;
/** The command layer's bosses and specialists, by the names nobody else uses. */
const STAFF_UNMISTAKABLE = /\b(?:Design Mates?|Fact Checkers?|coding boss(?:es)?)\b/i;
/** Staff titles that are also ordinary job titles ("the creative director at the agency"): held back only as the staff's names, where Flyd reports its own work, not in chat. */
const STAFF_TITLES = /\bthe (?:Creative Directors?|Retrievers?|Researchers?)\b/;

const COMMIT_ID = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i;
const FM_BRANCH = /\bfm\/[\w.-]+/i;
const RUN_ID = /\b(?:run|task)[ -]?id\b/i;
const JOB_ID = /\bjob[ -]?id\b|\bjob-[0-9a-f]{6,}\b/i;
const DOMAIN_RUN_ID = /\bdomain-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i;
const PR_NUMBER = /\bPR\s*#?\d+\b/i;
const CREWS = /\bcrews?\b/i;
const COUNCIL_ROLES: RegExp[] = [
  /\b(?:Librarians?|Strategists?|Critics?|Muses?)\b/,
  /\bCouncil\b/,
  /\bthe (?:council|librarian|strategist|critic|muse|scout)s?\b/i,
];

/** Flyd's backstage roles and agents, as opposed to the mechanics of the work. */
export const BACKSTAGE_ROLES: RegExp[] = [HELPERS, STAFF_UNMISTAKABLE, STAFF_TITLES, CREWS, /\bjev\b/i, COUNCIL_NAMED, ...COUNCIL_ROLES];

/** Git and run telemetry: commit hashes, fm/ branches, task, run, job and domain-run ids. */
export const BACKSTAGE_TELEMETRY: RegExp[] = [COMMIT_ID, FM_BRANCH, RUN_ID, JOB_ID, DOMAIN_RUN_ID];

/** The names chat review holds back: helpers, machinery and the council by name, words that are rarely ordinary speech in an answer. */
export const CHAT_BACKSTAGE: RegExp[] = [HELPERS, STAFF_UNMISTAKABLE, MACHINERY, COUNCIL_NAMED];

/** What a chat answer may not name. A PR number or a job or domain-run id George asked about may be named back to him. */
export const CHAT_ANSWER_BACKSTAGE: RegExp[] = [
  ...CHAT_BACKSTAGE,
  CREWS,
  /\bbranch(?:es)?\b/i,
  /\bpipelines?\b/i,
  ...COUNCIL_ROLES,
  COMMIT_ID,
  FM_BRANCH,
  RUN_ID,
];

/** Everything relays, notices, status cards and agenda lines may not show. */
export const BACKSTAGE_DENYLIST: RegExp[] = [...CHAT_ANSWER_BACKSTAGE, STAFF_TITLES, PR_NUMBER, JOB_ID, DOMAIN_RUN_ID];

const STAFF_SAID: Array<[RegExp, string]> = [
  [/^(?:the |a )?(?:workers?|crew ?mates?|firstmate|team)\s+(?:has |have )?(?:finished|is done|are done|reports?|reported|says|said)\s*[:;,\u2014-]\s*/i, ""],
  [/\s*,?\s+(?:on|in) (?:the |a )?branch\s+`?[\w-]+(?:\/[\w-]+(?:\.[\w-]+)*)+`?/gi, ""],
  [/\b(?:[Tt]he |[Aa] )?(?:Fact Checkers?|Design Mates?|coding boss(?:es)?)\b/g, "the team"],
  [/\b[Tt]he (?:Creative Directors?|Retrievers?|Researchers?)\b(?!\s+(?:at|of|from|for|in|on)\b)/g, "the team"],
  [/\bthe worker\b(?=\s+(?:pushed|finished|added|opened|merged|fixed|reported|said|says|stalled|stopped|landed|wrote|made|ran|is done|was done|has finished|signed off)\b)/gi, "the team"],
  [/\bthe fleet\b(?=\s*(?:[.,;:!?]|$)|\s+(?:is|are|was|were|has|had|moved|stalled)\b)/gi, "the work"],
  [/\b(?:the|this|that) (?:last )?run\b(?=\s*(?:[.,;:!?]|$)|\s+(?:failed|passed|stalled|stopped|finished|was cancelled|did not finish)\b)/gi, "the work"],
  [/\bhand-?offs\b(?!\s+(?:spec|doc|document|notes?|file|template|meeting)s?\b)/gi, "steps"],
  [/\bhand-?off\b(?!\s+(?:spec|doc|document|notes?|file|template|meeting)s?\b)/gi, "step"],
  [/(?<=^|[.!?]\s+)PR\s*#?\d+\b(?=\s+(?:is|was|has|had|got)\b)/g, "it"],
  [/\bPR\s*#?\d+\b/gi, "the pull request"],
  [/\bPR branches\b/gi, "pull requests"],
  [/\bPR branch\b/gi, "pull request"],
];

/**
 * A line for his screen said without the machinery: how the staff ran the work
 * (who was on it, the branch, the run, a handoff) gives way to the work itself,
 * so "The worker finished: dark mode is merged." reads "Dark mode is merged." and "PR #412 is merged" reads "It is merged".
 * Ordinary uses ("a service worker", "the worker pool", "the fleet of trucks", "the handoff spec") stay. Pure.
 */
export function plainSaid(text: string): string {
  const said = STAFF_SAID.reduce((line, [pattern, plain]) => line.replace(pattern, (found: string, at: number, whole: string) => (/^[A-Z]/.test(found) && /(?:^|[.!?]\s+)$/.test(whole.slice(0, at)) ? plain.replace(/^[a-z]/, (first) => first.toUpperCase()) : plain)), text)
    .replace(/\bthe team and the team\b/gi, "the team")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
  return /^[A-Z]/.test(text) ? said.replace(/^[a-z]/, (first) => first.toUpperCase()) : said;
}

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

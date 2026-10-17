import { execFile } from "node:child_process";
import { callId, plainQuestion, type ArtefactRow, type BacklogEntry, type OvertakenCheck } from "./artefact.js";

// A decision waiting on George that the work has already moved past. Flyd is
// his chief of staff: before it shows him a pending call more than a day old,
// it reads the staff's own record (commits in that project since the call was
// raised, and work finished there) and, when that record shows the area the
// call is about has since been rebuilt and shipped, the call leaves Needs you
// and the staff are told to close it. George is never asked.
//
// "The same area" is read from the call's own words: the paths and names it
// gives ("vendor-apply", the step "What do you sell?") must appear in what a
// later commit changed, and that commit must be about the same thing (its
// message shares a word with the call, or a file it changed is named after
// what the call names). Work finished in the same
// repository counts when it shares two such words. Anything less and the call
// stays: a live decision kept from him is worse than a stale one shown. Pure,
// apart from reading the commits.

/** A call younger than this is shown as it is: the record is only read for older ones. */
export const OVERTAKEN_AFTER_MS = 24 * 60 * 60 * 1000;

export interface AreaCommit {
  /** ISO time of the commit. */
  at: string;
  subject: string;
  files: string[];
}

/** Words too common in a call or a commit to say what either is about. */
const GENERIC = new Set([
  "pick", "picks", "picking", "choose", "chooses", "decide", "decides", "decision", "option", "options", "george", "captain", "flyd",
  "step", "steps", "page", "pages", "site", "flow", "with", "from", "into", "that", "this", "these", "those", "what", "which", "your",
  "their", "them", "then", "than", "when", "where", "will", "would", "should", "could", "have", "were", "been", "make", "made", "more",
  "less", "only", "also", "over", "under", "after", "before", "about", "each", "every", "both", "some", "show", "shows", "keep", "drop",
  "change", "changes", "update", "updates", "fix", "fixes", "test", "tests", "html", "index", "main", "file", "files", "phone", "phones",
  "desktop", "mobile", "look", "looks", "design", "version", "copy", "text", "work", "done", "ready", "live", "still", "again", "lab",
]);

/** A word's stem: its first four letters, so "apply" and "application" meet. */
function stem(word: string): string {
  return word.slice(0, 4);
}

/** The words that say what a text is about, as stems. */
export function topics(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return new Set(words.filter((word) => !GENERIC.has(word)).map(stem));
}

/** The call's words: its title and its question, without the options or the firstmate paths in brackets. */
function callWords(row: ArtefactRow): string {
  return `${row.label} ${plainQuestion(row.detail ?? "")}`;
}

/**
 * The places a call names: hyphenated or slashed names it gives
 * ("vendor-apply", "css/apply-flow") and every quoted phrase as a file name
 * would spell it ("What do you sell?" → "what-do-you-sell"). Pure.
 */
export function callArea(row: ArtefactRow): string[] {
  const words = callWords(row);
  const names = words.toLowerCase().match(/[a-z0-9]+(?:[-_/][a-z0-9]+)+/g) ?? [];
  const quoted = [...words.matchAll(/["“'‘]([^"”'’]{4,60})["”'’]/g)]
    .map((match) => match[1]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter((slug) => slug.includes("-"));
  return [...new Set([...names, ...quoted])].filter((name) => !/^(?:data|state|https?)\b/.test(name));
}

function shares(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const word of a) if (b.has(word)) count += 1;
  return count;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** When a call was raised: the backlog's date, which a status line never moves, else its row time. */
function raisedAt(row: ArtefactRow): number {
  const at = row.raised ?? row.at;
  return at ? Date.parse(at) : Number.NaN;
}

/**
 * What overtook a pending call, in a few words, or undefined while it may
 * still be live: too young, no time to read its age by, or nothing in the
 * record shows its area moved on since it was raised. Pure.
 */
export function overtakenBy(
  row: ArtefactRow,
  record: { commits?: AreaCommit[]; finished?: BacklogEntry[] },
  now: number,
): string | undefined {
  const raised = raisedAt(row);
  if (Number.isNaN(raised) || now - raised < OVERTAKEN_AFTER_MS) return undefined;
  const about = topics(callWords(row));
  if (about.size === 0) return undefined;
  const area = callArea(row);
  const after = (iso: string | undefined) => (iso ? Date.parse(iso) > raised : false);
  if (area.length) {
    // A file named after the very thing the call names ("what-do-you-sell.html") is about it; otherwise the commit's message must be.
    const things = area.filter((place) => !place.includes("/"));
    // The commit most plainly about it is the one named.
    const [best] = (record.commits ?? [])
      .filter((candidate) => after(candidate.at) && candidate.files.some((file) => area.some((place) => file.toLowerCase().includes(place))))
      .map((candidate) => ({
        candidate,
        score: shares(about, topics(candidate.subject))
          + (candidate.files.some((file) => things.some((thing) => (file.split("/").pop() ?? "").toLowerCase().startsWith(thing))) ? 2 : 0),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    if (best) return `"${best.candidate.subject}" shipped ${day(best.candidate.at)}`;
  }
  // Finished dates are days: work finished the day the call was raised may predate it.
  const finished = (record.finished ?? []).find((entry) => entry.finished && entry.finished > day(new Date(raised).toISOString())
    && (!row.repo || entry.repo === row.repo)
    && shares(about, topics(entry.title)) >= 2);
  if (finished) return `"${finished.title}" finished ${finished.finished}`;
  return undefined;
}

/** The note that tells the staff a call was overtaken and asks them to close it. Pure. */
export function closeNote(row: ArtefactRow, why: string): string {
  return [
    `Flyd's own note, not George's: the pending decision ${row.task ?? ""} ("${row.label}") looks overtaken: ${why}.`,
    "It has left his Needs you and he will not be asked. If the work it was about has shipped or been superseded, close the hold; if it is still a real decision, reopen it with what changed.",
  ].join("\n\n");
}

/** Commits in a repository since a time, with the files each changed. Bounded; never throws. */
export function commitsSince(repo: string, since: string, options: { limit?: number; timeoutMs?: number } = {}): Promise<AreaCommit[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repo, "log", `--since=${since}`, "-n", String(options.limit ?? 60), "--name-only", "--format=%x1e%cI%x1f%s"],
      { timeout: options.timeoutMs ?? 5_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        resolve(String(stdout).split("\x1e").map((chunk) => chunk.trim()).filter(Boolean).flatMap((chunk) => {
          const [head = "", ...files] = chunk.split("\n");
          const [at = "", subject = ""] = head.split("\x1f");
          return at ? [{ at, subject, files: files.map((file) => file.trim()).filter(Boolean) }] : [];
        }));
      },
    );
  });
}

/**
 * Flyd's check of old calls against the staff's record: commits in the
 * call's repository since it was raised, and work finished there. Each
 * repository's log is read at most once per refresh window.
 */
export class OvertakenCalls implements OvertakenCheck {
  private readonly logs = new Map<string, { at: number; commits: Promise<AreaCommit[]> }>();

  constructor(private readonly options: {
    /** The repository's folder on this machine, by the name the backlog gives it. */
    repoPath: (repo: string) => string | undefined;
    /** Tells the staff to close an overtaken call, as Flyd's own note. */
    send: (note: string, requestId: string) => Promise<unknown>;
    readCommits?: typeof commitsSince;
    /** How long one read of a repository's log is reused. */
    reuseMs?: number;
  }) {}

  async check(row: ArtefactRow, finished: BacklogEntry[], now: number): Promise<string | undefined> {
    const raised = raisedAt(row);
    if (Number.isNaN(raised) || now - raised < OVERTAKEN_AFTER_MS) return undefined;
    const path = row.repo ? this.options.repoPath(row.repo) : undefined;
    const commits = path ? await this.commits(path, new Date(raised).toISOString(), now) : [];
    return overtakenBy(row, { commits, finished }, now);
  }

  async close(row: ArtefactRow, why: string): Promise<void> {
    if (!row.task) return;
    // The request id makes the note idempotent: a restart that finds the same call again sends nothing new;
    // the call reopened under the same task is raised again, and gets its own.
    await this.options.send(closeNote(row, why), `flyd-close-${callId(row)}`.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 125));
  }

  private commits(path: string, since: string, now: number): Promise<AreaCommit[]> {
    const key = `${path}\0${since}`;
    const cached = this.logs.get(key);
    if (cached && now - cached.at < (this.options.reuseMs ?? 10 * 60_000)) return cached.commits;
    const commits = (this.options.readCommits ?? commitsSince)(path, since);
    this.logs.set(key, { at: now, commits });
    return commits;
  }
}

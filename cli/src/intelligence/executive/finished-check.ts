import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { relayShortfalls } from "../../runtime/honesty-check.js";
import { plainWords } from "./decision-step.js";
import { readProjects, type Project } from "../../council/projects.js";
import { plainTitle, verifyStaffOutcome } from "./verify-outcome.js";

// Finished work, checked by Flyd itself before it tells George.
//
// A task that reports done is staff evidence, never proof. Flyd looks for
// itself: a named pull request is read from GitHub (merged or not), a named
// commit is checked against the repository's default branch, and the task's own
// report is what remains when neither is named. Whatever it finds, it says one
// line: what changed, plus the link. When nothing could be checked it still
// says the work is finished, honestly, and never says nothing.

/** The states a finished task or run reports. */
export const FINISHED_STATES: ReadonlySet<string> = new Set(["done", "completed"]);

export interface PullState {
  merged: boolean;
  /** "open" | "closed", as GitHub says it. */
  state?: string;
  title?: string;
  mergeCommit?: string;
}

export interface FinishedReaders {
  /** A pull request's state, or null when it could not be read. */
  pull(url: string): Promise<PullState | null>;
  /** Whether a commit is on its repository's default branch, or null when that could not be read. */
  commitOnDefault(repo: string, sha: string): Promise<boolean | null>;
}

export interface FinishedCheck {
  /** Flyd read the outcome for itself (a pull request or commit), rather than taking the report's word. */
  checked: boolean;
  /** The change is on the default branch. */
  landed: boolean;
  /** The one line George is told: what changed, plus the link. */
  line: string;
  url?: string;
  evidenceRefs: string[];
}

const PULL_URL = /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)\b/g;
const COMMIT_URL = /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/commit\/([0-9a-f]{7,40})\b/gi;
const GH_CANDIDATES = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"];
const READ_TIMEOUT_MS = 10_000;

/** gh by absolute path first: a GUI-launched Core inherits a minimal PATH. */
function ghBinary(): string {
  return GH_CANDIDATES.find((path) => existsSync(path)) ?? "gh";
}

function ghApi(path: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    execFile(ghBinary(), ["api", path], { timeout: READ_TIMEOUT_MS, maxBuffer: 2_000_000 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const parsed: unknown = JSON.parse(stdout);
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** Reads GitHub through gh (George's own login), falling back to the REST reader for a merged pull request. */
export const githubReaders: FinishedReaders = {
  async pull(url) {
    const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
    if (!match) return null;
    const data = await ghApi(`repos/${match[1]}/pulls/${match[2]}`);
    if (data) {
      const commit = typeof data.merge_commit_sha === "string" ? data.merge_commit_sha : undefined;
      return {
        merged: data.merged === true,
        ...(typeof data.state === "string" ? { state: data.state } : {}),
        ...(typeof data.title === "string" ? { title: data.title } : {}),
        ...(data.merged === true && commit ? { mergeCommit: commit } : {}),
      };
    }
    const rest = await verifyStaffOutcome([url]).catch(() => null);
    if (rest?.status !== "verified") return null;
    const sha = rest.evidenceRefs.find((ref) => ref.startsWith("github-merge:"))?.slice("github-merge:".length);
    return { merged: true, ...(rest.summary?.startsWith("Merged: ") ? { title: rest.summary.slice("Merged: ".length) } : {}), ...(sha ? { mergeCommit: sha } : {}) };
  },
  async commitOnDefault(repo, sha) {
    const meta = await ghApi(`repos/${repo}`);
    const base = typeof meta?.default_branch === "string" ? meta.default_branch : "";
    if (!base) return null;
    const compare = await ghApi(`repos/${repo}/compare/${encodeURIComponent(base)}...${sha}`);
    const status = compare?.status;
    return status === "identical" || status === "behind" ? true : status === "ahead" || status === "diverged" ? false : null;
  },
};

/** Readers that read nothing: tests and evals never reach GitHub unless they pass their own. */
export const offlineReaders: FinishedReaders = { pull: async () => null, commitOnDefault: async () => null };

/** A task id as words under its project's own name: "gnm-hero-height" is "GNM: hero height"; an unknown project's id is left as it is. */
export function plainLabel(label: string, projects: ReadonlyArray<Pick<Project, "id" | "name">> = readProjects()): string {
  const said = label.replace(/\s+/g, " ").trim();
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(said)) return said;
  const [prefix, ...rest] = said.split(/[-_]/);
  const project = projects.find((known) => known.id.toLowerCase() === prefix!.toLowerCase());
  return project ? `${project.name}: ${rest.join(" ")}` : said;
}

function sayable(line: string): boolean {
  return relayShortfalls(line).length === 0;
}

/**
 * One line George may be told, in the order: as written, in plain words, then the bare fact. Never empty. Pure.
 * A title read from the change itself says what changed; without one, his request is only named, never said to be done.
 */
export function finishedLine(what: { title: string } | { request: string }, outcome: "landed" | "waiting" | "closed" | "unchecked", url?: string): string {
  const titled = "title" in what;
  const lines = (subject: string) => {
    const said = subject.replace(/[.\s]+$/, "");
    const named = titled ? said : `The work on “${said}”`;
    const body = outcome === "landed" ? titled ? `Done: ${/^[A-Z][a-z]/.test(said) ? `${said.charAt(0).toLowerCase()}${said.slice(1)}` : said}.` : `${named} is done.`
      : outcome === "waiting" ? `${named} is finished and waiting to go in.`
        : outcome === "closed" ? `${named} is finished, but its change was closed without going in.`
          : `${named} is finished; I haven't checked it yet.`;
    return url ? `${body} ${url}` : body;
  };
  const subject = ("title" in what ? what.title : what.request).trim();
  for (const candidate of [subject, plainWords(subject)]) {
    if (!candidate) continue;
    const line = lines(candidate);
    if (sayable(line)) return line;
  }
  const bare = outcome === "unchecked" ? "A piece of your work is finished; I haven't checked it yet." : "A piece of your work is finished.";
  return url && sayable(`${bare} ${url}`) ? `${bare} ${url}` : bare;
}

/**
 * Checks a finished task's outcome for itself and says it in one line.
 * Reads at most two pull requests and one commit; a read that fails is simply not a check.
 */
export async function checkFinished(
  input: { label: string; detail: string; evidenceRefs?: string[] },
  readers: FinishedReaders = githubReaders,
): Promise<FinishedCheck> {
  const text = [input.detail, ...(input.evidenceRefs ?? [])].join("\n");
  const what = { request: plainLabel(input.label) };
  const pulls = [...new Set([...text.matchAll(PULL_URL)].map((match) => match[0]))].slice(0, 2);
  let open: { url: string; title?: string } | undefined;
  let closed: { url: string; title?: string } | undefined;
  for (const url of pulls) {
    const pull = await readers.pull(url).catch(() => null);
    if (!pull) continue;
    const title = pull.title ? plainTitle(pull.title) : undefined;
    if (pull.merged) {
      return {
        checked: true, landed: true, url,
        line: finishedLine(title ? { title } : what, "landed", url),
        evidenceRefs: [url, ...(pull.mergeCommit ? [`github-merge:${pull.mergeCommit}`] : [])],
      };
    }
    if (pull.state === "closed") closed ??= { url, ...(title ? { title } : {}) };
    else open ??= { url, ...(title ? { title } : {}) };
  }
  if (open) return { checked: true, landed: false, url: open.url, line: finishedLine(open.title ? { title: open.title } : what, "waiting", open.url), evidenceRefs: [open.url] };
  const commit = [...text.matchAll(COMMIT_URL)][0];
  if (commit) {
    const onDefault = await readers.commitOnDefault(commit[1]!, commit[2]!).catch(() => null);
    if (onDefault) return { checked: true, landed: true, url: commit[0], line: finishedLine(what, "landed", commit[0]), evidenceRefs: [commit[0], `github-commit-on-default:${commit[2]}`] };
  }
  if (closed) return { checked: true, landed: false, url: closed.url, line: finishedLine(closed.title ? { title: closed.title } : what, "closed", closed.url), evidenceRefs: [closed.url] };
  const url = pulls[0] ?? commit?.[0];
  return { checked: false, landed: false, ...(url ? { url } : {}), line: finishedLine(what, "unchecked", url), evidenceRefs: [] };
}

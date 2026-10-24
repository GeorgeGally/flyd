import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { FLYD_DIR } from "../lib/config.js";
import { firstmateHome } from "../lib/firstmate-home.js";
import { readProjects, type Project } from "../council/projects.js";
import { callId, holdReason, type ArtefactRow, type BacklogEntry } from "./artefact.js";

// A call the staff never closed, though George's own work has moved past it.
// George, 2026-10-24, after a three-week-old "land the Truchet lab?" rang his
// notch again and again while the site it was for was already live: "flyd needs
// to be smarter. its seen ive done work on getting the site up etc. and it can
// check the code to see whats happened."
//
// Before an old call reaches Needs you, Flyd reads what happened since it was
// first raised: the project's main branch, what the call's branch still adds,
// and where George's project list says the project stands. Flyd's model weighs
// that; only a confident "overtaken", with its reason in plain words, settles
// the call (and the staff are told to close it). Anything less keeps it in front
// of him. A call younger than a few days is never judged.

const run = promisify(execFile);

/** Calls first raised fewer days ago than this are never judged: fresh asks are real asks. */
export const STALE_MIN_AGE_DAYS = 3;
/** How sure the model must be before an old call leaves Needs you. */
export const STALE_MIN_CONFIDENCE = 0.8;
/** How long a verdict stands before the call is judged again. */
const VERDICT_TTL_MS = 24 * 60 * 60 * 1000;
const GIT_TIMEOUT_MS = 10_000;

export interface StaleEvidence {
  task: string;
  ask: string;
  /** The day the work behind the call first began, following "Supersedes" back. */
  origin: string;
  ageDays: number;
  repo?: string;
  branch?: string;
  /** Main's commits since the origin, newest first: "YYYY-MM-DD author: subject". */
  mainSince: string[];
  /** What the call's branch adds over main, from `git diff --stat`. */
  branchAdds?: string;
  /** Files the branch changes that main already has. */
  onMain: string[];
  /** Files the branch changes that main lacks. */
  notOnMain: string[];
  project?: Pick<Project, "name" | "status" | "now">;
}

/** The task ids an entry says it supersedes. Pure. */
export function supersedes(entry: BacklogEntry | undefined): string[] {
  return [...(entry?.notes ?? "").matchAll(/\bSupersedes\s+([\w.-]+)/g)].map((match) => match[1]!);
}

/** The earliest `since` along the supersedes chain: when this work really began. Pure. */
export function originOf(task: string, entries: Map<string, BacklogEntry>): string | undefined {
  const seen = new Set<string>();
  let earliest: string | undefined;
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const entry = entries.get(id);
    if (entry?.since && (!earliest || entry.since < earliest)) earliest = entry.since;
    for (const older of supersedes(entry)) visit(older);
  };
  visit(task);
  return earliest;
}

/** A task's `key=value` meta file in the staff's state dir. Never throws. */
function readMeta(home: string, task: string): Record<string, string> {
  try {
    return Object.fromEntries(readFileSync(join(home, "state", `${task}.meta`), "utf8").split("\n")
      .map((line) => /^([\w-]+)=(.*)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => [match[1]!, match[2]!]));
  } catch {
    return {};
  }
}

async function git(repo: string, args: string[]): Promise<string | undefined> {
  try {
    return (await run("git", ["-C", repo, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 1 << 20 })).stdout.trim();
  } catch {
    return undefined;
  }
}

/** The project George's list keeps for this repo, by its path or its name. Pure. */
export function projectFor(repo: string | undefined, name: string | undefined, projects: Project[]): Project | undefined {
  const path = repo ? resolve(repo) : undefined;
  return projects.find((project) => path && project.repos.some((root) => resolve(root) === path))
    ?? projects.find((project) => name && [project.id, project.name].some((alias) => alias.toLowerCase() === name.toLowerCase()));
}

/** Everything Flyd can see about what happened since the call's work began. Never throws. */
export async function gatherStaleEvidence(
  row: ArtefactRow,
  entry: BacklogEntry | undefined,
  entries: Map<string, BacklogEntry>,
  options: { home?: string; now?: number; projects?: Project[] } = {},
): Promise<StaleEvidence | undefined> {
  const task = row.task;
  if (!task) return undefined;
  const origin = originOf(task, entries);
  if (!origin) return undefined;
  const ageDays = Math.floor(((options.now ?? Date.now()) - Date.parse(`${origin}T00:00:00Z`)) / 86_400_000);
  const home = options.home ?? firstmateHome();
  const metas = [task, ...supersedes(entry)].map((id) => readMeta(home, id));
  const repo = metas.map((meta) => meta.project).find((path) => path && existsSync(path));
  const branch = metas.map((meta) => meta.branch).find(Boolean);
  const project = projectFor(repo, entry?.repo ?? row.repo, options.projects ?? readProjects());
  const ask = [row.detail ?? row.label, entry?.hold ? holdReason(entry.hold) : ""].filter(Boolean).join(" — ");
  const evidence: StaleEvidence = {
    task, ask, origin, ageDays, mainSince: [], onMain: [], notOnMain: [],
    ...(repo ? { repo } : {}),
    ...(branch ? { branch } : {}),
    ...(project ? { project: { name: project.name, status: project.status, now: project.now } } : {}),
  };
  if (!repo) return evidence;
  const main = (await git(repo, ["rev-parse", "--verify", "--quiet", "main"])) ? "main" : "master";
  evidence.mainSince = (await git(repo, ["log", main, `--since=${origin}`, "--format=%cs %an: %s", "-n", "40"]))?.split("\n").filter(Boolean) ?? [];
  if (branch && await git(repo, ["rev-parse", "--verify", "--quiet", branch])) {
    const stat = await git(repo, ["diff", "--stat", `${main}...${branch}`]);
    if (stat) evidence.branchAdds = stat.split("\n").at(-1)!.trim();
    const files = (await git(repo, ["diff", "--name-only", `${main}...${branch}`]))?.split("\n").filter(Boolean) ?? [];
    for (const file of files.slice(0, 30)) {
      ((await git(repo, ["cat-file", "-e", `${main}:${file}`])) !== undefined ? evidence.onMain : evidence.notOnMain).push(file);
    }
  }
  return evidence;
}

/** The question Flyd's model answers about one old call. Pure. */
export function stalePrompt(evidence: StaleEvidence): string {
  return [
    "You are Flyd, George's chief of staff. His engineering staff left a decision waiting on him. Before it interrupts him,",
    "decide whether his own work has already moved past it, so asking would waste his time.",
    "",
    `The ask (task ${evidence.task}): ${evidence.ask}`,
    `The work behind it began ${evidence.origin}, ${evidence.ageDays} days ago.`,
    evidence.project ? `His project list says ${evidence.project.name} is "${evidence.project.status}": ${evidence.project.now}` : "No project on his list matches it.",
    evidence.repo ? `Repo: ${basename(evidence.repo)}` : "No repo found for it.",
    evidence.branch ? `The ask's branch ${evidence.branch} still adds: ${evidence.branchAdds ?? "nothing"}.` : "",
    evidence.onMain.length ? `Files that branch changes which main already has: ${evidence.onMain.join(", ")}` : "",
    evidence.notOnMain.length ? `Files that branch adds which main lacks: ${evidence.notOnMain.join(", ")}` : "",
    evidence.mainSince.length ? `Main since then (newest first):\n${evidence.mainSince.map((line) => `- ${line}`).join("\n")}` : "No commits on main since then.",
    "",
    "Overtaken means: the thing it was for has shipped or moved on without it (the site went live, the feature landed another way,",
    "the work was replaced), or it only concerns throwaway lab or sandbox pages for something now finished.",
    "It is NOT overtaken when it is still a live choice that would change what ships, or when the evidence is thin. When unsure, it is not.",
    "The why must say only what the evidence above shows (its age, what main or the project list says, what the branch holds); never claim one piece of work replaced another unless the evidence says so.",
    'Reply with JSON only: {"overtaken": true|false, "confidence": 0..1, "why": "one plain sentence George would recognise, naming what moved past it"}',
  ].filter((line) => line !== "").join("\n");
}

/** The model's reason when it is confident the call is overtaken; undefined otherwise. Pure. */
export function staleVerdict(text: string): string | undefined {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as { overtaken?: unknown; confidence?: unknown; why?: unknown };
    const why = typeof parsed.why === "string" ? parsed.why.trim() : "";
    return parsed.overtaken === true && typeof parsed.confidence === "number" && parsed.confidence >= STALE_MIN_CONFIDENCE && why ? why : undefined;
  } catch {
    return undefined;
  }
}

interface Verdict { why?: string; at: number }

/** Flyd's judgment of old calls against what has happened since. Bounded; never throws. */
export class StaleCallJudge {
  private verdicts?: Map<string, Verdict>;

  constructor(private readonly options: {
    complete: (prompt: string) => Promise<string>;
    home?: string;
    /** Verdicts kept across restarts; under vitest memory only unless a test passes one. */
    file?: string | null;
    now?: () => number;
    projects?: () => Project[];
  }) {}

  private file(): string | null {
    if (this.options.file !== undefined) return this.options.file;
    return process.env.VITEST ? null : join(process.env.FLYD_DIR || FLYD_DIR, "view", "stale-calls.json");
  }

  private load(): Map<string, Verdict> {
    if (this.verdicts) return this.verdicts;
    const file = this.file();
    try {
      this.verdicts = new Map(file ? Object.entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, Verdict>) : []);
    } catch {
      this.verdicts = new Map();
    }
    return this.verdicts;
  }

  private save(): void {
    const file = this.file();
    if (!file || !this.verdicts) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(Object.fromEntries([...this.verdicts].slice(-300)), null, 2));
    } catch { /* memory still holds it */ }
  }

  /** Why the call is overtaken, or undefined while it may still be live. */
  async judge(row: ArtefactRow, entry: BacklogEntry | undefined, entries: Map<string, BacklogEntry>): Promise<string | undefined> {
    const now = this.options.now?.() ?? Date.now();
    const key = callId(row);
    const known = this.load().get(key);
    if (known && now - known.at < VERDICT_TTL_MS) return known.why;
    const evidence = await gatherStaleEvidence(row, entry, entries, {
      now, ...(this.options.home ? { home: this.options.home } : {}), ...(this.options.projects ? { projects: this.options.projects() } : {}),
    });
    if (!evidence || evidence.ageDays < STALE_MIN_AGE_DAYS) return undefined;
    let why: string | undefined;
    try {
      why = staleVerdict(await this.options.complete(stalePrompt(evidence)));
    } catch {
      return undefined; // no verdict is not a verdict: judge again next time
    }
    this.load().set(key, { ...(why ? { why } : {}), at: now });
    this.save();
    return why;
  }
}

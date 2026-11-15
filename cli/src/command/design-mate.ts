import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, uptime } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { HEADLESS_CHROME_ARGS } from "../lib/headless-chrome.js";
import { readTaste } from "../council/taste.js";
import { BoardWatcher, putLabOnBoard, type BoardFeedback, type BoardInput, type BoardWatch, type LabBoard } from "./design-board.js";
import { completeWithClaude, DesignModelError, makeWithClaude } from "./design-claude.js";
import { DESIGN_LAB_DONE_WHEN, designLabSkill, designTeamSkills } from "./design.js";
import { dueReport } from "./report.js";
import { createDomainRun, isDomainRunId, listDomainRuns, mutateDomainRun, readDomainRun } from "./store.js";
import { cameBack, isSettled } from "./run-state.js";
import type { DomainRequest, DomainResult, DomainRun } from "./types.js";
import { decisionsLines } from "./types.js";

// The design team beside FirstMate. The Creative Director is its voice: it
// takes Flyd's brief, sets genuinely different directions, judges the work
// from screenshots alone and presents it back to Flyd. Design Mate is the
// producer: it runs the schedule, the files and the staff, and never draws.
// A lab ends with the Creative Director presenting the versions for George
// to pick from, on a Liesel board (command/design-board.ts) where he pins
// notes or marks one final. A build (a picked version, or a design change to
// a real project) has a Designer edit the project itself, in George's own
// copy; the Creative Director reviews it and Design Mate commits what it made.
// Every model call is Claude on George's subscription (command/design-claude.ts),
// and a lab that stops reaches him in plain words (command/scheduler.ts).

export const DESIGN_MATE = "Design Mate";
export const CREATIVE_DIRECTOR = "Creative Director";
/** The score a version must reach before the lab stops rebuilding it. */
export const TARGET_SCORE = 9;
/** Creative Director rounds per lab or build, then George sees what fell short. */
export const MAX_ROUNDS = 3;
const MIN_VERSIONS = 3;
const MAX_VERSIONS = 5;
const MAX_IMAGES = 8;
/** Room for one designer's page; a content-heavy dashboard ran past 16k and came back cut off. */
const PAGE_TOKENS = 32_000;
/** Tries per model call or version before a direction is given up on; one dropped connection never sinks a lab. */
const ATTEMPTS = 3;

export const DESKTOP = { width: 1440, height: 900, scale: 1 };
export const PHONE = { width: 390, height: 844, scale: 2 };

export function labsDir(): string {
  return process.env.FLYD_LABS_DIR?.trim() || join(FLYD_DIR, "labs");
}

export function labDir(runId: string, root = labsDir()): string {
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(runId)) throw new Error("Invalid lab id");
  return join(root, runId);
}

export interface LabVersion {
  n: number;
  name: string;
  idea: string;
  /** Drawn from a random seed: palette, grid and type scale come from it, never the page. */
  seed: string;
  score?: number;
  critique?: string;
  /** Built and shot for the current round. */
  built?: boolean;
  /** Critiqued for the current round. */
  judged?: boolean;
  /** The best score so far; its page and shots are kept beside the current ones. */
  best?: number;
  bestCritique?: string;
}

/** The three questions every design job answers before it begins. */
export interface Audience {
  /** Who is viewing the design? */
  who: string;
  /** Where will they see it? */
  where: string;
  /** What do they need to understand or do? */
  what: string;
}

/** The answers as plain lines, for every prompt and George's board. */
export function audienceLines(audience?: Audience): string[] {
  return audience ? [
    `Who is viewing it: ${audience.who}`,
    `Where they will see it: ${audience.where}`,
    `What they need to understand or do: ${audience.what}`,
  ] : [];
}

const AUDIENCE_QUESTIONS: Record<keyof Audience, string> = {
  who: "Who is viewing the design?",
  where: "Where will they see it?",
  what: "What do they need to understand or do?",
};

function audienceOf(value: unknown): Audience | undefined {
  const item = (value ?? {}) as Record<string, unknown>;
  const [who, where, what] = [item.who, item.where, item.what].map((part) => typeof part === "string" ? part.trim() : "");
  return who && where && what ? { who, where, what } : undefined;
}

function unansweredQuestions(value: unknown): string[] {
  const item = (value ?? {}) as Record<string, unknown>;
  return (Object.keys(AUDIENCE_QUESTIONS) as Array<keyof Audience>)
    .filter((key) => typeof item[key] !== "string" || !(item[key] as string).trim())
    .map((key) => AUDIENCE_QUESTIONS[key]);
}

export interface Lab {
  brief: string;
  /** Who views it, where, and what they must understand or do: set first, it steers every designer and the critic. */
  audience?: Audience;
  versions: LabVersion[];
  round: number;
  images: string[];
  log: string[];
  /** The Creative Director's words to Flyd when it presents the lab. */
  presentation?: string;
  /** The version the Creative Director would take forward. */
  pick?: number;
  /** Flyd's notes each time it sent the work back to the Creative Director. */
  flydNotes?: string[];
  /** The real content of what is being redesigned, for every designer. */
  content?: string;
  /** How many times Flyd has sent it back. */
  sendbacks?: number;
  /** Directions left out after they would not build or be judged, with why. */
  dropped?: string[];
  /** The Liesel board George reviews it on. */
  board?: LabBoard;
  /** The version George marked final on the board, when there was no project to build it into. */
  picked?: number;
}

/** Times Flyd may send work back before it goes to George with the gap named. */
export const MAX_SENDBACKS = 2;

/** A build: the Designer makes a design real inside the project, in George's own copy. */
export interface Build {
  /** The project folder the Designer edits. */
  root: string;
  /** The page it builds from, when it comes from a lab version. */
  reference?: { page: string; shot?: string; name: string; audience?: Audience };
  /** Files already changed before the build started; Design Mate never commits them. */
  dirtyBefore: string[];
  round: number;
  score?: number;
  critique?: string;
  /** What the Designer said it did, last round. */
  report?: string;
  /** The Creative Director's words to Flyd when it presents the build. */
  presentation?: string;
  flydNotes?: string[];
  sendbacks?: number;
  /** The files this build changed, which Design Mate commits. */
  files?: string[];
  log: string[];
}

/** One call to the team's model. */
export interface DesignCallOptions {
  json?: boolean;
  /** Screenshots to look at, as data URLs. */
  images?: string[];
  maxTokens?: number;
  source?: string;
  /** Called once the model starts answering. */
  onStarted?: () => void;
}

export interface DesignMateDeps {
  complete(prompt: string, options?: DesignCallOptions): Promise<string>;
  shoot(page: string, png: string, viewport: { width: number; height: number; scale: number }): Promise<void>;
  /** Runs a Designer that edits files in `cwd` and returns what it says it did. */
  make?(cwd: string, prompt: string): Promise<string>;
  /** Runs git in the project; injectable for tests. */
  git?(cwd: string, args: string[]): Promise<string>;
  /** Puts a finished lab on a Liesel board; injectable for tests. */
  board?(input: BoardInput): Promise<LabBoard>;
  now?: () => Date;
  root?: string;
}

/** A model failure no retry will fix (a plan limit, a missing login): the lab stops on it at once. */
function fatal(error: unknown): error is DesignModelError {
  return error instanceof DesignModelError && !error.retryable;
}

function bestPaths(runId: string, version: LabVersion, root: string): Array<[string, string]> {
  const dir = labDir(runId, root);
  const shots = shotPaths(runId, version, root);
  return [join(dir, `v${version.n}.html`), shots.desktop, shots.phone].map((path) => [path, path.replace(/(\.[a-z]+)$/, ".best$1")]);
}

function keepBest(runId: string, version: LabVersion, root: string): void {
  for (const [path, best] of bestPaths(runId, version, root)) if (existsSync(path)) copyFileSync(path, best);
}

function restoreBest(runId: string, version: LabVersion, root: string): void {
  for (const [path, best] of bestPaths(runId, version, root)) if (existsSync(best)) copyFileSync(best, path);
}

/** Calls a model, retrying a thrown error (a dropped connection, a timeout) before giving up; a plan limit is never retried. */
async function ask(deps: DesignMateDeps, prompt: string, options: DesignCallOptions): Promise<string> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try { return await deps.complete(prompt, options); } catch (error) { if (fatal(error)) throw error; last = error; }
  }
  throw last;
}

function messageOf(error: unknown): string {
  return error instanceof DesignModelError ? error.plain : error instanceof Error ? error.message : String(error);
}

/** What George reads when a lab or build stops: that it stopped, and why, in plain words. */
export function stoppedLine(cause: string, build = false): string {
  const why = cause.trim().replace(/\.$/, "");
  return `The design ${build ? "build" : "lab"} stopped before it was ready: ${why}.`;
}

/** A rebuild that cannot be made keeps the version's best build so far, already judged; true when there was one. */
function keepLastBuild(run: DomainRun, lab: Lab, version: LabVersion, root: string): boolean {
  if (version.best === undefined) return false;
  restoreBest(run.id, version, root);
  version.score = version.best;
  version.critique = version.bestCritique;
  version.built = true;
  version.judged = true;
  lab.log.push(`V${version.n} kept its ${version.best}/10 build.`);
  return true;
}

/** One designer builds one version and the camera shoots it, with a few tries; returns why it failed, or nothing. */
async function buildVersion(run: DomainRun, lab: Lab, version: LabVersion, taste: string, deps: DesignMateDeps, root: string): Promise<string | undefined> {
  const page = join(labDir(run.id, root), `v${version.n}.html`);
  const previous = existsSync(page) ? readFileSync(page, "utf8") : undefined;
  const shots = shotPaths(run.id, version, root);
  let problem = `V${version.n} · ${version.name} could not be built.`;
  let cutOff = false;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const note = cutOff ? "\n\nYour last reply was cut off before </html>. Build the same direction as a shorter page: fewer repeated rows, no inline data blobs, and always finish the document." : "";
      const html = pageOf(await deps.complete(buildPrompt(run, lab, version, taste, previous) + note, { source: "design", maxTokens: PAGE_TOKENS }));
      if (!html) {
        cutOff = true;
        problem = `V${version.n} · ${version.name} came back without a whole page.`;
        lab.log.push(`${problem} (try ${attempt})`);
        continue;
      }
      writeFileSync(page, html, { encoding: "utf8", mode: 0o600 });
      await deps.shoot(page, shots.desktop, DESKTOP);
      await deps.shoot(page, shots.phone, PHONE);
      if (existsSync(shots.desktop) && existsSync(shots.phone)) {
        version.built = true;
        version.judged = false;
        return undefined;
      }
      problem = `No screenshots of V${version.n} · ${version.name}, so the critic could not see it.`;
    } catch (error) {
      if (fatal(error)) throw error;
      problem = `V${version.n} · ${version.name} could not be built: ${messageOf(error)}`;
    }
    lab.log.push(`${problem} (try ${attempt})`);
  }
  return keepLastBuild(run, lab, version, root) ? undefined : problem;
}

/** The Creative Director judges one version from its screenshots; returns why it could not, or nothing. */
async function judgeVersion(run: DomainRun, lab: Lab, version: LabVersion, taste: string, deps: DesignMateDeps, root: string): Promise<string | undefined> {
  const shots = shotPaths(run.id, version, root);
  let reply: { score?: number; critique?: string } | null;
  try {
    reply = jsonOf<{ score?: number; critique?: string }>(await ask(deps, critiquePrompt(run, lab, version, taste), {
      json: true, source: "design", images: [asImage(shots.desktop), asImage(shots.phone)],
    }));
  } catch (error) {
    if (fatal(error)) throw error;
    const problem = `V${version.n} · ${version.name} could not be judged: ${messageOf(error)}`;
    lab.log.push(problem);
    return keepLastBuild(run, lab, version, root) ? undefined : problem;
  }
  version.score = Math.max(0, Math.min(10, Number(reply?.score ?? 0)));
  version.critique = String(reply?.critique ?? "").trim();
  version.judged = true;
  lab.log.push(`Round ${lab.round}: V${version.n} scored ${version.score}/10.`);
  if (version.best === undefined || version.score >= version.best) {
    version.best = version.score;
    version.bestCritique = version.critique;
    keepBest(run.id, version, root);
  } else {
    // A rebuild that scored lower is undone: the better page and its shots come back.
    restoreBest(run.id, version, root);
    lab.log.push(`V${version.n} went back to its ${version.best}/10 build.`);
    version.score = version.best;
    version.critique = version.bestCritique;
  }
  return undefined;
}

/** Leaves out the directions that would not build or be judged, while enough remain; otherwise says why the lab stops. */
function dropBroken(lab: Lab, results: Array<{ version: LabVersion; problem?: string }>): string | undefined {
  const broken = results.filter((result) => result.problem);
  if (!broken.length) return undefined;
  if (lab.versions.length - broken.length < MIN_VERSIONS) return broken.map((result) => result.problem).join(" ");
  lab.versions = lab.versions.filter((version) => !broken.some((result) => result.version === version));
  const left = broken.map((result) => `V${result.version.n} · ${result.version.name} (${result.problem})`);
  lab.dropped = [...(lab.dropped ?? []), ...left];
  lab.log.push(`Carried on without ${left.join("; ")}.`);
  return undefined;
}

export interface DesignMateDispatchInput {
  originalMessage: string;
  intendedOutcome: string;
  doneWhen: string[];
  source?: DomainRequest["source"];
  parentRequestId?: string;
  contextRefs?: string[];
  project?: { name?: string; root?: string };
  background?: boolean;
  /** A stable id for this request: dispatching it again returns its run instead of making a second lab. */
  requestId?: string;
  objectiveId?: string;
  decisions?: DomainRequest["decisions"];
  now?: Date;
  /** Make it for real in the project instead of a lab; `reference` is the picked lab version, if any. */
  build?: { reference?: Build["reference"] };
  /** What exists today: screenshots of the current screen and its real content, so the team redesigns it rather than guessing. */
  context?: LabContext;
}

export interface LabContext {
  shots?: string[];
  content?: string;
}

/** A design request becomes Design Mate's own run, with its own folder. Refuses without done_when. */
export function dispatchDesignMate(input: DesignMateDispatchInput, root = labsDir()): DomainRun {
  if (!input.doneWhen.length) throw new Error("A lab needs done_when before it starts");
  if (input.build && !input.project?.root) throw new Error("A build needs the project folder it changes");
  // Replayed by request id, as FirstMate's inbox replays a note: the run on record, no second lab folder or team.
  if (input.requestId !== undefined && !isDomainRunId(input.requestId)) throw new Error("Invalid request id");
  const replayed = input.requestId ? readDomainRun(input.requestId) : null;
  if (replayed) return replayed;
  const now = input.now ?? new Date();
  const skill = designLabSkill();
  const request: DomainRequest = {
    id: input.requestId ?? `lab-${randomUUID()}`,
    domain: "creative",
    originalMessage: input.originalMessage.trim() || input.intendedOutcome,
    intendedOutcome: input.intendedOutcome.trim(),
    doneWhen: input.doneWhen,
    createdAt: now.toISOString(),
    ...(input.source ? { source: input.source } : {}),
    ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
    ...(input.contextRefs?.length ? { contextRefs: input.contextRefs } : {}),
    ...(input.project ? { project: input.project } : {}),
    ...(skill ? { skill } : {}),
    ...(input.background ? { background: true } : {}),
    ...(input.objectiveId ? { objectiveId: input.objectiveId } : {}),
    ...(input.decisions ? { decisions: input.decisions } : {}),
  };
  labDir(request.id, root);
  const run: DomainRun = {
    id: request.id,
    request,
    owner: DESIGN_MATE,
    status: "working",
    phase: input.build ? "making" : "briefing",
    createdAt: request.createdAt,
    updatedAt: request.createdAt,
    transport: { kind: "native", requestId: request.id },
  };
  // On record first: from here the request cannot vanish. A folder that cannot be made fails the run, and George hears why.
  const created = createDomainRun(run).run;
  try {
    mkdirSync(join(labDir(request.id, root), "review"), { recursive: true, mode: 0o700 });
    if (input.context && (input.context.shots?.length || input.context.content)) {
      writeFileSync(join(labDir(request.id, root), "context.json"), `${JSON.stringify(input.context, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
    if (input.build) {
      const build: Build = { root: input.project!.root!, ...(input.build.reference ? { reference: input.build.reference } : {}), dirtyBefore: [], round: 1, log: [] };
      writeFileSync(buildPath(request.id, root), `${JSON.stringify(build, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
  } catch (error) {
    return save(created, { status: "failed", phase: "done", failure: stoppedLine(`its folder could not be made (${messageOf(error)})`, Boolean(input.build)) });
  }
  return created;
}

function labPath(runId: string, root: string): string {
  return join(labDir(runId, root), "lab.json");
}

export function readLab(runId: string, root = labsDir()): Lab | null {
  try {
    return JSON.parse(readFileSync(labPath(runId, root), "utf8")) as Lab;
  } catch {
    return null;
  }
}

export function writeLab(runId: string, lab: Lab, root: string): void {
  writeFileSync(labPath(runId, root), `${JSON.stringify(lab, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function readContext(runId: string, root = labsDir()): LabContext {
  try {
    return JSON.parse(readFileSync(join(labDir(runId, root), "context.json"), "utf8")) as LabContext;
  } catch {
    return {};
  }
}

function buildPath(runId: string, root: string): string {
  return join(labDir(runId, root), "build.json");
}

export function readBuild(runId: string, root = labsDir()): Build | null {
  try {
    return JSON.parse(readFileSync(buildPath(runId, root), "utf8")) as Build;
  } catch {
    return null;
  }
}

function writeBuild(runId: string, build: Build, root: string): void {
  writeFileSync(buildPath(runId, root), `${JSON.stringify(build, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "version";
}

export function shotPaths(runId: string, version: Pick<LabVersion, "n" | "name">, root = labsDir()): { desktop: string; phone: string } {
  const base = join(labDir(runId, root), "review", `v${version.n}-${slug(version.name)}`);
  return { desktop: `${base}-desktop.png`, phone: `${base}-phone.png` };
}

function tasteLines(): string {
  try {
    return readTaste().rules.slice(0, 40).map((rule) => `- ${rule.text}`).join("\n") || "(none yet)";
  } catch {
    return "(none yet)";
  }
}

const IMAGE = /\.(?:png|jpe?g|webp)$/i;
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", "legacy", "coverage"]);

/** Real imagery from the project for the lab to use: a few pictures, copied into the lab's own folder. */
export function projectImages(projectRoot: string | undefined, dest: string, limit = MAX_IMAGES): string[] {
  if (!projectRoot || !existsSync(projectRoot)) return [];
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (found.length >= limit * 4 || depth > 5) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name.startsWith(".") || SKIP.has(name)) continue;
      const path = join(dir, name);
      let size = 0;
      let isDir = false;
      try { const stat = statSync(path); size = stat.size; isDir = stat.isDirectory(); } catch { continue; }
      if (isDir) walk(path, depth + 1);
      else if (IMAGE.test(name) && size > 20_000 && size < 2_000_000) found.push(path);
    }
  };
  walk(projectRoot, 0);
  // The biggest pictures are the likeliest to be real work rather than icons.
  const picked = found.sort((a, b) => statSync(b).size - statSync(a).size).slice(0, limit);
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  return picked.map((path, index) => {
    const name = `${index + 1}-${slug(basename(path, extname(path)))}${extname(path).toLowerCase()}`;
    copyFileSync(path, join(dest, name));
    return `img/${name}`;
  });
}

function jsonOf<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

/** The page out of a designer's reply: the HTML document, with any fence or prose around it dropped. */
export function pageOf(text: string): string | null {
  const start = text.search(/<!doctype html|<html/i);
  const end = text.toLowerCase().lastIndexOf("</html>");
  if (start < 0 || end < start) return null;
  return text.slice(start, end + "</html>".length);
}

/**
 * The board does the presenting: it shows each version's name, puts them side by side, and lets George mark one
 * final or pin notes. Without saying so, Flyd's review asked designers for those, and they put fake "Mark as final"
 * buttons and captions into the pages.
 */
const REVIEW_SURFACE_FOR_DESIGNERS = "Build the page itself only. George reviews the versions on a board that already shows each version's name side by side and lets him mark one final or pin notes, so never add a version label, a lab caption, a 'Mark as final' control or any other review control to the page.";
const REVIEW_SURFACE_FOR_FLYD = "Once you accept, the team puts the versions on George's review board: side by side, each named, with a way to mark one final or pin notes, and the files listed for him. Judge each version as the page it is. Never ask the designers for those board features, for captions or controls about the lab, or for file lists. The screenshots show each whole page down to a readable height.";

const TASTE_HEADER = "George's standing taste: TV-style clean type; Cursor-style framed imagery with padding; letter-spacing never wider than .04em; generous space above buttons; buttons never oversized; readable body copy; copy that says what a thing is (no slogans, never opens with \"Not…\"); every claim literally true; motion is TV-style fades only. All animation uses GSAP: never CSS keyframes or transitions alone, and no other animation library.";

function teamSkills(use: "apply" | "judge"): string[] {
  const skills = designTeamSkills();
  if (!skills.length) return [];
  return [
    "",
    use === "apply"
      ? "The team works by these skills. Follow every one of them in this work:"
      : "The team works by these skills. Judge the work against every one of them, their checklists and guardrails included; a guardrail broken (a dark pattern, a false claim) costs points:",
    ...skills.flatMap((skill) => [`SKILL: ${skill.name}`, skill.body]),
  ];
}

export function briefPrompt(run: DomainRun, images: string[], taste: string, seeds: string[], flydNotes: string[] = [], context: LabContext = {}): string {
  return [
    "You are the Creative Director of George's design team. Flyd, his assistant, has brought you his brief. You turn it into a creative brief and directions for Design Mate, the producer, whose designers build them; later you judge the work and present it to Flyd. You never build anything yourself.",
    `George asked: "${run.request.originalMessage}"`,
    `Outcome: ${run.request.intendedOutcome}`,
    `Done when: ${run.request.doneWhen.join("; ")}`,
    ...decisionsLines(run.request.decisions),
    ...((run.messages ?? []).length ? ["Later from George:", ...(run.messages ?? []).map((message) => `- ${message.body}`)] : []),
    ...(run.request.project?.name ? [`Project: ${run.request.project.name}`] : []),
    ...(context.shots?.length ? ["The attached screenshots show what exists today. Redesign it; do not describe it back."] : []),
    ...(context.content ? ["", `What is on it today, the real content every version works from:\n${context.content}`] : []),
    ...(flydNotes.length ? ["", "Flyd rejected your last set of directions. Start again from these notes, with directions that answer them:", ...flydNotes.map((note) => `- ${note}`)] : []),
    ...teamSkills("apply"),
    "",
    TASTE_HEADER,
    `His learned taste rules:\n${taste}`,
    `Real images the designers can use: ${images.join(", ") || "(none; use real content and typography, never stock shapes)"}`,
    "",
    `Before anything else, answer three questions from his request, the project and what you see of it; never ask George unless it truly cannot be known: ${Object.values(AUDIENCE_QUESTIONS).join(" ")} Every direction must serve those answers.`,
    `Set ${MIN_VERSIONS}-${MAX_VERSIONS} directions that differ in composition and in what they leave out, not just palette. Give each a bold named inspiration (a TV title card, a museum wall label, a departure board, radical asymmetry…) and say how it shapes the layout. At least two must sound risky. Derive each one's palette, grid and type scale from its seed string below; the seed never appears on the page.`,
    `Seeds, one per direction in order: ${seeds.join(", ")}`,
    "Set a content budget from what he asked: real content, not all of it; what is not needed sits one click away.",
    "Content must be real: only what George wrote, what the request carries, or his own name and Flyd's. Never invent people, companies, quotes, numbers or dates. Write into the brief the exact real content every version shows.",
    'Reply with JSON only: {"audience":{"who":"who is viewing it","where":"where they will see it: device, setting, moment","what":"what they need to understand or do"},"brief":"the shared brief: the content budget and what every version must show","versions":[{"name":"2-3 words","idea":"one plain sentence on the idea and how the inspiration shapes the layout"}]}',
  ].join("\n");
}

export function buildPrompt(run: DomainRun, lab: Lab, version: LabVersion, taste: string, previous?: string): string {
  return [
    "You are a designer on George's design team. Build one version of a lab as one complete HTML file.",
    `George asked: "${run.request.originalMessage}"`,
    ...audienceLines(lab.audience),
    `Brief: ${lab.brief}`,
    `Your version: V${version.n} · ${version.name}. ${version.idea}`,
    ...((run.messages ?? []).length ? ["Later from George, newer than the brief; the page must answer it:", ...(run.messages ?? []).map((message) => `- ${message.body}`)] : []),
    `Your seed (derive palette, grid and type scale from its digits and patterns; never show it): ${version.seed}`,
    ...(lab.content ? [`The real content to design with (use it, not invented copy):\n${lab.content}`] : []),
    ...teamSkills("apply"),
    "",
    TASTE_HEADER,
    `His learned taste rules:\n${taste}`,
    `Images you may use, by these exact relative paths: ${lab.images.join(", ") || "(none)"}`,
    "",
    "Use only the real content in the brief and his request. Never invent people, companies, quotes, numbers or dates; where something is unknown, leave it out.",
    "Rules: one self-contained file; inline CSS and JS; fonts only from Google Fonts; GSAP only from cdnjs.cloudflare.com; no other network files. Real content, never lorem ipsum. Colours as tokens on :root with an explicit body background. It must work at 1440×900 and at 390 wide phone with a 16px gutter and no sideways scroll. No gradients, glows, pill clutter, icon-in-circle grids, emoji or wide letter-spacing.",
    REVIEW_SURFACE_FOR_DESIGNERS,
    ...(lab.flydNotes?.length ? ["", "Flyd sent this lab back with these notes; your build must answer them:", ...lab.flydNotes.map((note) => `- ${note}`)] : []),
    ...(previous && version.critique ? [
      "",
      `The Creative Director scored your last build ${version.score}/10. Fix it by removing before adding: end with no more elements than you started with, and never answer a critique with a new label, caption, frame or control.`,
      `Critique:\n${version.critique}`,
      `Your last build:\n${previous}`,
    ] : []),
    "",
    "Reply with the HTML document only, from <!doctype html> to </html>.",
  ].join("\n");
}

export function critiquePrompt(run: DomainRun, lab: Lab, version: LabVersion, taste: string): string {
  return [
    "You are the Creative Director of George's design team, judging one of the versions you directed, held to the standard of a top studio. You see only the two screenshots attached: the desktop (1440 wide) and the phone (390 wide) of one version, each the whole page down to a readable height.",
    `George asked for: "${run.request.originalMessage}"`,
    `${TASTE_HEADER}\nHis learned taste rules:\n${taste}`,
    `The version is "${version.name}": ${version.idea}`,
    ...(lab.audience ? ["Score it first on whether these people, there, can understand or do what they need:", ...audienceLines(lab.audience)] : []),
    ...teamSkills("judge"),
    "Any invented person, company, quote or figure that is not in his request costs at least 3 points: claims must be literally true.",
    "1) Say how well it delivers what he asked for and how the best studio would execute exactly that brief. 2) List what to delete first, then the biggest remaining gaps, structural first, then fine detail. Penalise overdone or obviously AI-generated patterns (generic gradients, glows, pill clutter, icon-in-circle grids, centred-everything hero, emoji, wide letter-spacing) and clutter. Be specific, tight and opinionated. 3) Score it out of 10. Rank against concrete references (Cursor, micro1), not against average work.",
    'Reply with JSON only: {"score":0,"critique":"delete first, then gaps, in short lines"}',
  ].join("\n");
}

/** The Creative Director presents the finished lab to Flyd: which one, and why, in its own voice. */
export function presentPrompt(run: DomainRun, lab: Lab): string {
  return [
    "You are the Creative Director of George's design team. The lab is finished; present it to Flyd, his assistant, who decides whether it is ready to show George.",
    `George asked: "${run.request.originalMessage}"`,
    `Creative brief: ${lab.brief}`,
    "The attached images are the desktop screenshots, in this order:",
    ...lab.versions.map((version) => `V${version.n} · ${version.name} (${version.score}/10): ${version.idea}`),
    ...teamSkills("judge"),
    "Say which version you would take forward and why, what each of the others is good for, and what you would still change. Plain sentences, no slogans, no design jargon George would not use.",
    'Reply with JSON only: {"pick":1,"presentation":"3-6 short lines to Flyd"}',
  ].join("\n");
}

/** Flyd, holding George's intent, accepts the work, asks for changes, or rejects it. */
export function flydReviewPrompt(run: DomainRun, presentation: string, taste: string, what: string): string {
  return [
    "You are Flyd, George's personal assistant. George's design team has presented work to you. You know what he asked for and how he judges design; decide whether it is ready to show him. Be the demanding client he would be: accept only work you would be proud to put in front of him.",
    `George asked: "${run.request.originalMessage}"`,
    `Outcome he wants: ${run.request.intendedOutcome}`,
    `Done when: ${run.request.doneWhen.filter((point) => !DESIGN_LAB_DONE_WHEN.includes(point)).join("; ")}`,
    `${TASTE_HEADER}\nHis learned taste rules:\n${taste}`,
    REVIEW_SURFACE_FOR_FLYD,
    ...((run.messages ?? []).length ? ["He has since added (the work must answer this too):", ...(run.messages ?? []).map((message) => `- ${message.body}`)] : []),
    `What was made: ${what}`,
    `The Creative Director's presentation:\n${presentation}`,
    "The attached images are the work itself.",
    'Choose one: "accept" (ready for George), "changes" (close; name exactly what to change), or "reject" (the direction is wrong; say what it should be instead).',
    'Reply with JSON only: {"verdict":"accept|changes|reject","notes":["each note one concrete instruction"],"versions":[numbers of the versions the changes are for, if any]}',
  ].join("\n");
}

/** The Designer makes the design real, editing the project's own files. */
export function makePrompt(run: DomainRun, build: Build, taste: string): string {
  return [
    "You are a designer on George's design team, working directly in the project folder you are in: George's own copy, the one he runs and looks at. Make the design change real by editing the project's files.",
    `George asked: "${run.request.originalMessage}"`,
    `Outcome: ${run.request.intendedOutcome}`,
    `Done when: ${run.request.doneWhen.join("; ")}`,
    ...audienceLines(build.reference?.audience),
    ...(build.reference ? [`Build it from the lab version George's team picked, "${build.reference.name}": its page is ${build.reference.page}${build.reference.shot ? ` and its screenshot is ${build.reference.shot}` : ""}. Match its composition, type and spacing in the project's own components, styles and real content; do not paste the lab page in.`] : []),
    ...teamSkills("apply"),
    "",
    TASTE_HEADER,
    `His learned taste rules:\n${taste}`,
    "",
    "Rules: read the project's AGENTS.md first and follow it. Change only what the design needs. Keep the project's tests and checks passing. Work on the branch that is checked out; never create a branch, never push, never commit, never stash or discard changes that were already there. It must work on desktop and on a 390 wide phone.",
    ...(build.flydNotes?.length ? ["", "Flyd sent the last build back with these notes; answer them:", ...build.flydNotes.map((note) => `- ${note}`)] : []),
    ...(build.critique ? ["", `The Creative Director scored your last build ${build.score}/10. Fix it by removing before adding:`, build.critique] : []),
    "",
    "When you are done, reply with a few plain lines: what you changed, which files, and where George can see it (a URL or the screen).",
  ].join("\n");
}

/** The Creative Director reviews a build from what changed, against the picked version. */
export function buildReviewPrompt(run: DomainRun, build: Build, diff: string, taste: string): string {
  return [
    "You are the Creative Director of George's design team, reviewing a designer's change to the real project, held to the standard of a top studio.",
    `George asked: "${run.request.originalMessage}"`,
    `Done when: ${run.request.doneWhen.join("; ")}`,
    `${TASTE_HEADER}\nHis learned taste rules:\n${taste}`,
    ...audienceLines(build.reference?.audience),
    ...(build.reference ? [`It should realise the picked version "${build.reference.name}"${build.reference.shot ? ", whose screenshot is attached" : ""}.`] : []),
    `The designer says: ${build.report ?? "(nothing)"}`,
    `What changed:\n${diff.slice(0, 40_000) || "(nothing changed)"}`,
    ...teamSkills("judge"),
    "Judge whether this delivers the design faithfully and cleanly: what to delete, what is missing, what is off. Then present it to Flyd in 2-4 plain lines. Score out of 10; nothing changed scores 0.",
    'Reply with JSON only: {"score":0,"critique":"short lines","presentation":"2-4 lines to Flyd"}',
  ].join("\n");
}

function asImage(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);

/**
 * The presentation George opens, made the way a studio presents to a client:
 * the recommended version first and full size, the reasoning beside it in
 * plain words, then the alternatives, each one a click from its live page.
 */
export function labIndex(run: DomainRun, lab: Lab): string {
  const ranked = [...lab.versions].sort((a, b) => (a.n === lab.pick ? -1 : b.n === lab.pick ? 1 : (b.score ?? 0) - (a.score ?? 0)));
  const [lead, ...rest] = ranked;
  const paragraphs = (text: string) => text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  const frame = (version: LabVersion) => `<a class="frame" href="v${version.n}.html"><iframe src="v${version.n}.html" loading="lazy" title="${escapeHtml(version.name)}" tabindex="-1"></iframe></a>`;
  const others = rest.map((version) => `<section class="alt"><div class="note"><h3>${escapeHtml(version.name)}</h3><p>${escapeHtml(version.idea)}</p><p class="score">${version.score ?? "–"}/10</p></div>${frame(version)}</section>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(run.request.intendedOutcome.slice(0, 60))}</title>
<style>
:root { --paper: #F1EFEA; --ink: #141413; --mute: #5A5853; --rule: #D6D2CA; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 17px/1.55 -apple-system, "Helvetica Neue", sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1520px; margin: 0 auto; padding: 0 40px 120px; }
.cover { min-height: 62vh; display: flex; flex-direction: column; justify-content: flex-end; padding: 96px 0 64px; border-bottom: 1px solid var(--rule); }
h1 { margin: 0; font-size: clamp(40px, 6vw, 88px); line-height: 1.02; letter-spacing: -0.03em; font-weight: 600; max-width: 16ch; }
.cover p { margin: 28px 0 0; max-width: 60ch; color: var(--mute); font-size: 19px; }
.lead { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 48px; padding: 72px 0; border-bottom: 1px solid var(--rule); }
h2 { margin: 0 0 20px; font-size: 34px; line-height: 1.1; letter-spacing: -0.02em; font-weight: 600; }
h3 { margin: 0 0 10px; font-size: 22px; letter-spacing: -0.01em; font-weight: 600; }
.why p { margin: 0 0 14px; }
.score { color: var(--mute); }
.alt { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 48px; padding: 56px 0; border-bottom: 1px solid var(--rule); }
.note p { margin: 0 0 12px; color: var(--mute); }
.frame { display: block; border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 0 0 1px var(--rule); }
iframe { display: block; width: 100%; aspect-ratio: 1440 / 900; border: 0; pointer-events: none; }
@media (max-width: 900px) {
  main { padding: 0 16px 80px; }
  .lead, .alt { grid-template-columns: 1fr; gap: 24px; }
  .cover { min-height: 48vh; padding-top: 64px; }
}
</style></head>
<body><main>
<header class="cover"><h1>${escapeHtml(run.request.intendedOutcome)}</h1>${paragraphs(lab.brief)}</header>
${lead ? `<section class="lead">${frame(lead)}<div class="why"><h2>${escapeHtml(lead.name)}</h2>${paragraphs(lab.presentation || lead.idea)}<p class="score">${lead.score ?? "–"}/10</p></div></section>` : ""}
${others}
</main></body></html>
`;
}

function save(run: DomainRun, update: Partial<DomainRun>): DomainRun {
  const at = new Date().toISOString();
  // A lab that settles carries its report, due, in the same write (command/report.ts).
  const report = update.status && cameBack(update.status) ? { report: dueReport(update.status, at) } : {};
  return mutateDomainRun(run.id, (current) => ({ ...(current ?? run), ...update, ...report, updatedAt: at })) ?? run;
}

/** One step of a lab: brief, build, critique or hand over. Every step is saved, so a restart picks up where it stopped. */
export async function advanceDesignRun(run: DomainRun, deps: DesignMateDeps): Promise<DomainRun> {
  const root = deps.root ?? labsDir();
  const dir = labDir(run.id, root);
  const taste = tasteLines();

  if (["making", "build-review", "build-flyd"].includes(run.phase ?? "")) return advanceBuild(run, deps, root, taste);

  if (run.phase === "briefing") {
    // A lab Flyd rejected starts again from its notes.
    const rejected = readLab(run.id, root);
    if (rejected) clearPages(dir);
    const context = readContext(run.id, root);
    const images = rejected?.images ?? projectImages(run.request.project?.root, join(dir, "img"));
    const seeds = Array.from({ length: MAX_VERSIONS }, () => randomBytes(12).toString("hex"));
    type BriefReply = { audience?: unknown; brief?: string; versions?: Array<{ name?: string; idea?: string }> };
    const prompt = briefPrompt(run, images, taste, seeds, rejected?.flydNotes, context);
    const options: DesignCallOptions = { json: true, source: "design", images: (context.shots ?? []).filter((path) => existsSync(path)).map(asImage) };
    let reply = jsonOf<BriefReply>(await ask(deps, prompt, options));
    const unanswered = reply ? unansweredQuestions(reply.audience) : [];
    if (unanswered.length) {
      reply = jsonOf<BriefReply>(await ask(deps, [prompt, "", `Your last reply left these unanswered; answer every one in "audience" and send the whole reply again: ${unanswered.join(" ")}`].join("\n"), options));
    }
    const versions = (reply?.versions ?? []).filter((item) => item.name && item.idea).slice(0, MAX_VERSIONS)
      .map((item, index): LabVersion => ({ n: index + 1, name: String(item.name).trim(), idea: String(item.idea).trim(), seed: seeds[index]! }));
    if (!reply?.brief || versions.length < MIN_VERSIONS) {
      return save(run, { status: "failed", phase: "done", failure: stoppedLine("the brief came back without enough directions to build") });
    }
    const audience = audienceOf(reply.audience);
    if (!audience) {
      return save(run, { status: "failed", phase: "done", failure: stoppedLine("the brief never said who views it, where, and what they must do") });
    }
    writeLab(run.id, {
      brief: reply.brief.trim(), audience, versions, round: 1, images,
      ...(context.content ? { content: context.content } : {}),
      log: [...(rejected?.log ?? []), `Brief set with ${versions.length} directions.`],
      ...(rejected?.flydNotes ? { flydNotes: rejected.flydNotes } : {}),
      ...(rejected?.sendbacks ? { sendbacks: rejected.sendbacks } : {}),
    }, root);
    return save(run, { phase: "building" });
  }

  const lab = readLab(run.id, root);
  if (!lab) return save(run, { status: "failed", phase: "done", failure: stoppedLine("its record is missing") });

  if (run.phase === "building") {
    // The designers work side by side; each writes only its own page.
    const pending = lab.versions.filter((item) => !item.built);
    if (!pending.length) return save(run, { phase: "critiquing" });
    const results = await Promise.all(pending.map(async (version) => ({ version, problem: await buildVersion(run, lab, version, taste, deps, root) })));
    const failure = dropBroken(lab, results);
    writeLab(run.id, lab, root);
    if (failure) return save(run, { status: "failed", phase: "done", failure: stoppedLine(failure) });
    return save(run, { phase: "critiquing" });
  }

  if (run.phase === "critiquing") {
    const pending = lab.versions.filter((item) => !item.judged);
    const results = await Promise.all(pending.map(async (version) => ({ version, problem: await judgeVersion(run, lab, version, taste, deps, root) })));
    const failure = dropBroken(lab, results);
    if (failure) {
      writeLab(run.id, lab, root);
      return save(run, { status: "failed", phase: "done", failure: stoppedLine(failure) });
    }
    writeLab(run.id, lab, root);
    const short = lab.versions.filter((item) => (item.score ?? 0) < TARGET_SCORE);
    if (short.length && lab.round < MAX_ROUNDS) {
      lab.round += 1;
      for (const item of short) item.built = false;
      lab.log.push(`Round ${lab.round}: rebuilding ${short.map((item) => `V${item.n}`).join(", ")}.`);
      writeLab(run.id, lab, root);
      return save(run, { phase: "building" });
    }
    return save(run, { phase: "presenting" });
  }

  if (run.phase === "presenting") {
    const desktops = lab.versions.map((version) => shotPaths(run.id, version, root).desktop);
    const reply = jsonOf<{ pick?: number; presentation?: string }>(await ask(deps, presentPrompt(run, lab), {
      json: true, source: "design", images: desktops.map(asImage),
    }));
    const best = [...lab.versions].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]!;
    lab.pick = lab.versions.some((version) => version.n === Number(reply?.pick)) ? Number(reply!.pick) : best.n;
    lab.presentation = String(reply?.presentation ?? "").trim();
    lab.log.push(`${CREATIVE_DIRECTOR} presented V${lab.pick} to Flyd.`);
    writeLab(run.id, lab, root);
    return save(run, { phase: "flyd-review" });
  }

  if (run.phase === "flyd-review") {
    const picked = lab.versions.find((version) => version.n === lab.pick) ?? lab.versions[0]!;
    const order = [picked, ...lab.versions.filter((version) => version !== picked)];
    const what = `A lab of ${lab.versions.length} versions; images in this order: ${order.map((version) => `V${version.n} · ${version.name} (${version.score}/10)`).join(", ")}.`;
    const review = await flydReview(run, deps, lab.presentation ?? "", taste, what, order.map((version) => shotPaths(run.id, version, root).desktop));
    if (review.verdict === "accept" || (lab.sendbacks ?? 0) >= MAX_SENDBACKS) {
      if (review.verdict !== "accept") lab.log.push(`Flyd still had notes after ${MAX_SENDBACKS} send-backs: ${review.notes.join(" ")}`);
      writeLab(run.id, lab, root);
      return handOver(run, lab, root, deps);
    }
    lab.sendbacks = (lab.sendbacks ?? 0) + 1;
    lab.flydNotes = [...(lab.flydNotes ?? []), ...review.notes];
    if (review.verdict === "reject") {
      lab.log.push(`Flyd rejected the directions: ${review.notes.join(" ")}`);
      writeLab(run.id, lab, root);
      return save(run, { phase: "briefing" });
    }
    const named = lab.versions.filter((version) => review.versions.includes(version.n));
    for (const version of named.length ? named : [picked]) version.built = false;
    lab.round += 1;
    lab.log.push(`Flyd asked for changes to ${(named.length ? named : [picked]).map((version) => `V${version.n}`).join(", ")}: ${review.notes.join(" ")}`);
    writeLab(run.id, lab, root);
    return save(run, { phase: "building" });
  }
  return run;
}

/** A rejected lab's pages and screenshots go before the new directions are built. */
function clearPages(dir: string): void {
  for (const name of readdirSync(dir)) if (/^v\d+\.html$/.test(name)) rmSync(join(dir, name), { force: true });
  const review = join(dir, "review");
  if (existsSync(review)) for (const name of readdirSync(review)) rmSync(join(review, name), { force: true });
}

interface FlydVerdict { verdict: "accept" | "changes" | "reject"; notes: string[]; versions: number[] }

/** Flyd looks at the work and the Creative Director's presentation, as the client George would be. */
async function flydReview(run: DomainRun, deps: DesignMateDeps, presentation: string, taste: string, what: string, shots: string[]): Promise<FlydVerdict> {
  const reply = jsonOf<{ verdict?: string; notes?: unknown; versions?: unknown }>(await ask(deps, flydReviewPrompt(run, presentation, taste, what), {
    json: true, source: "design", images: shots.filter((path) => existsSync(path)).map(asImage),
  }));
  const verdict = reply?.verdict === "changes" || reply?.verdict === "reject" ? reply.verdict : "accept";
  const notes = Array.isArray(reply?.notes) ? reply!.notes.map(String).map((note) => note.trim()).filter(Boolean) : [];
  const versions = Array.isArray(reply?.versions) ? reply!.versions.map(Number).filter(Number.isFinite) : [];
  // A send-back with nothing to act on is no send-back.
  return notes.length ? { verdict, notes, versions } : { verdict: "accept", notes, versions };
}

/** Files changed in the project since the build began, leaving out what was already changed before. */
async function changedFiles(git: NonNullable<DesignMateDeps["git"]>, cwd: string, before: string[]): Promise<string[]> {
  const status = await git(cwd, ["status", "--porcelain", "--untracked-files=all"]);
  return status.split("\n").filter(Boolean).map((line) => line.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, "")).filter((path) => !before.includes(path));
}

/** One step of a build: the Designer edits the project, the Creative Director reviews, Flyd accepts, Design Mate commits. */
async function advanceBuild(run: DomainRun, deps: DesignMateDeps, root: string, taste: string): Promise<DomainRun> {
  const build = readBuild(run.id, root);
  if (!build) return save(run, { status: "failed", phase: "done", failure: stoppedLine("its record is missing", true) });
  const git = deps.git ?? runGit;
  const make = deps.make ?? makeWithClaude;

  if (run.phase === "making") {
    if (build.round === 1 && !build.report) build.dirtyBefore = await changedFiles(git, build.root, []);
    build.report = (await make(build.root, makePrompt(run, build, taste))).trim().slice(-4000);
    build.files = await changedFiles(git, build.root, build.dirtyBefore);
    build.log.push(`Round ${build.round}: the designer changed ${build.files.length} file(s).`);
    writeBuild(run.id, build, root);
    return save(run, { phase: "build-review" });
  }

  if (run.phase === "build-review") {
    const files = build.files ?? [];
    const tracked = files.length ? await git(build.root, ["diff", "--", ...files]) : "";
    const untracked = files.filter((path) => !tracked.includes(`b/${path}`)).map((path) => {
      try { return `New file ${path}:\n${readFileSync(join(build.root, path), "utf8").slice(0, 4000)}`; } catch { return `New file ${path}`; }
    }).join("\n\n");
    const shot = build.reference?.shot && existsSync(build.reference.shot) ? [asImage(build.reference.shot)] : [];
    const reply = jsonOf<{ score?: number; critique?: string; presentation?: string }>(await ask(deps, buildReviewPrompt(run, build, [tracked, untracked].filter(Boolean).join("\n\n"), taste), {
      json: true, source: "design", images: shot,
    }));
    build.score = files.length ? Math.max(0, Math.min(10, Number(reply?.score ?? 0))) : 0;
    build.critique = String(reply?.critique ?? "").trim();
    build.presentation = String(reply?.presentation ?? "").trim();
    build.log.push(`Round ${build.round}: ${CREATIVE_DIRECTOR} scored it ${build.score}/10.`);
    if (build.score < TARGET_SCORE && build.round < MAX_ROUNDS) {
      build.round += 1;
      writeBuild(run.id, build, root);
      return save(run, { phase: "making" });
    }
    writeBuild(run.id, build, root);
    if (!files.length) return save(run, { status: "failed", phase: "done", failure: stoppedLine("the designer changed nothing in the project", true) });
    return save(run, { phase: "build-flyd" });
  }

  // build-flyd: Flyd decides whether it goes to George.
  const files = build.files ?? [];
  const review = await flydReview(run, deps, build.presentation ?? "", taste,
    `A change to the project at ${build.root}: ${files.join(", ")}. The designer says: ${build.report ?? ""}`,
    build.reference?.shot ? [build.reference.shot] : []);
  if (review.verdict !== "accept" && (build.sendbacks ?? 0) < MAX_SENDBACKS) {
    build.sendbacks = (build.sendbacks ?? 0) + 1;
    build.flydNotes = [...(build.flydNotes ?? []), ...review.notes];
    build.round += 1;
    build.log.push(`Flyd sent it back: ${review.notes.join(" ")}`);
    writeBuild(run.id, build, root);
    return save(run, { phase: "making" });
  }
  if (review.verdict !== "accept") build.log.push(`Flyd still had notes after ${MAX_SENDBACKS} send-backs: ${review.notes.join(" ")}`);
  await git(build.root, ["add", "--", ...files]);
  await git(build.root, ["commit", "-m", `Design: ${run.request.intendedOutcome.split("\n")[0]!.slice(0, 68)}`, "--", ...files]);
  const head = (await git(build.root, ["rev-parse", "--short", "HEAD"])).trim();
  build.log.push(`Committed ${files.length} file(s) as ${head}.`);
  writeBuild(run.id, build, root);
  const result: DomainResult = {
    format: "structured",
    brief: build.presentation || `Built in ${build.root}: ${files.join(", ")}.`,
    recommendation: { action: "Look at it in the project.", reasoning: build.report ?? "", confidence: (build.score ?? 0) / 10 },
    detailedReport: [build.report ?? "", "", build.critique ?? "", "", ...build.log].join("\n"),
    decisionsMade: [`Committed ${head} in ${build.root}.`],
    unresolvedQuestions: [],
    risks: [
      ...((build.score ?? 0) < TARGET_SCORE ? [`${CREATIVE_DIRECTOR} scored it ${build.score}/10.`] : []),
      ...(review.verdict !== "accept" ? [`Flyd's open notes: ${review.notes.join(" ")}`] : []),
      ...(build.dirtyBefore.length ? [`Not committed, because they already had unsaved changes before the build: ${build.dirtyBefore.join(", ")}.`] : []),
    ],
    evidence: [`commit ${head}`],
    artifacts: files.map((path) => join(build.root, path)),
    specialistOutputs: [{ specialist: CREATIVE_DIRECTOR, outcome: `${build.score}/10`, ...(build.critique ? { raw: build.critique } : {}) }],
    raw: [],
    informationLossRisk: "low",
  };
  return save(run, { status: "completed", phase: "done", result });
}

/**
 * What George reads beside the frames: the pick, what each version is, and what he can do there. Never the
 * Creative Director's presentation, which is written to Flyd and talks about him in the third person.
 */
export function boardNote(run: DomainRun, lab: Lab, best: LabVersion): string {
  const short = (text: string) => text.length > 160 ? `${text.slice(0, 160).replace(/\s+\S*$/, "")}…` : text;
  const versions = [...lab.versions].sort((a, b) => a.n - b.n).map((version) => `- V${version.n} · ${version.name}: ${short(version.idea.split(/(?<=\.)\s/)[0]!)}`);
  const act = run.request.project?.root ? "Mark one as final to have it built, or pin notes for another round." : "Pin notes for another round, or mark one as final to settle on it.";
  return [...audienceLines(lab.audience), `I'd take V${best.n} · ${best.name} forward.`, ...versions, act].join("\n");
}

/** Ready for George only when every page and screenshot is really on disk, and on the board he reviews from. */
async function handOver(run: DomainRun, lab: Lab, root: string, deps: DesignMateDeps): Promise<DomainRun> {
  const dir = labDir(run.id, root);
  const index = join(dir, "index.html");
  writeFileSync(index, labIndex(run, lab), { encoding: "utf8", mode: 0o600 });
  const ranked = [...lab.versions].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const shots = ranked.flatMap((version) => { const paths = shotPaths(run.id, version, root); return [paths.desktop, paths.phone]; });
  const missing = [index, ...lab.versions.map((version) => join(dir, `v${version.n}.html`)), ...shots].filter((path) => !existsSync(path));
  if (missing.length) {
    return save(run, { status: "failed", phase: "done", failure: stoppedLine(`${missing.length} of its file(s) are missing: ${missing.map((path) => basename(path)).join(", ")}`) });
  }
  const best = ranked.find((version) => version.n === lab.pick) ?? ranked[0]!;
  // His review surface: every version as a desktop, iPad and phone frame he can pin notes on or mark final.
  let boardProblem: string | undefined;
  if (!lab.board) {
    try {
      lab.board = await (deps.board ?? putLabOnBoard)({
        labDir: dir,
        name: run.request.intendedOutcome.split(/[.\n]/)[0]!.trim().slice(0, 80) || "Design lab",
        versions: [...lab.versions].sort((a, b) => a.n - b.n),
        note: boardNote(run, lab, best),
      });
      lab.log.push(`On the board: ${lab.board.url}`);
    } catch (error) {
      boardProblem = messageOf(error);
      lab.log.push(`Could not put it on a board: ${boardProblem}`);
    }
    writeLab(run.id, lab, root);
  }
  const board = lab.board;
  const short = ranked.filter((version) => (version.score ?? 0) < TARGET_SCORE);
  const lines = ranked.map((version) => `V${version.n} · ${version.name}: ${version.score}/10. ${version.idea}`);
  const result: DomainResult = {
    format: "structured",
    brief: [
      lab.presentation || `${ranked.length} versions after ${lab.round} round${lab.round === 1 ? "" : "s"}.`,
      `${CREATIVE_DIRECTOR}'s pick: V${best.n} · ${best.name} at ${best.score}/10.`,
      ...(board ? [`On the board: ${board.url}`] : []),
      ...lines,
    ].join("\n"),
    recommendation: { action: `Look at V${best.n} · ${best.name} first.`, reasoning: best.critique ?? "", confidence: (best.score ?? 0) / 10 },
    detailedReport: [lab.brief, "", ...ranked.map((version) => `V${version.n} · ${version.name} (${version.score}/10)\n${version.critique ?? ""}`), "", ...lab.log].join("\n"),
    decisionsMade: [],
    unresolvedQuestions: [board ? "Which version to build for real (mark it final on the board), or what to change for another round (pin notes)?" : "Which version to build for real, or what to change for another round?"],
    risks: [
      ...(short.length ? [`Still under ${TARGET_SCORE}/10: ${short.map((version) => `V${version.n} (${version.score})`).join(", ")}.`] : []),
      ...(lab.dropped?.length ? [`Left out: ${lab.dropped.join("; ")}.`] : []),
      ...(boardProblem ? [`It could not be put on a board: ${boardProblem}.`] : []),
    ],
    evidence: board ? [`board ${board.url}`] : [],
    artifacts: [...(board ? [board.url] : []), index, ...shots],
    specialistOutputs: ranked.map((version) => ({ specialist: `${CREATIVE_DIRECTOR} on V${version.n}`, outcome: `${version.score}/10`, ...(version.critique ? { raw: version.critique } : {}) })),
    raw: [],
    informationLossRisk: "low",
  };
  return save(run, { status: "completed", phase: "done", result });
}

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

/**
 * The tallest a review shot is taken, in CSS pixels. A shot of only the first screen hid everything below it
 * from the critic and from Flyd's review, which then kept asking for "uncropped" shots no designer could give.
 * Past these heights the copy the model sees is shrunk too far to read.
 */
const MAX_SHOT_HEIGHT = { desktop: 2700, phone: 1600 };

/** How tall a page is at a viewport, from a headless pass that reads it once it has settled; the viewport's own height when it can't be read. */
function pageHeight(binary: string, page: string, viewport: { width: number; height: number }): Promise<number> {
  const profile = mkdtempSync(join(tmpdir(), "flyd-lab-"));
  const measure = join(dirname(page), `.measure-${viewport.width}-${basename(page)}`);
  writeFileSync(measure, `<!doctype html><html><head><title>0</title></head><body style="margin:0"><iframe id="f" src="${encodeURI(basename(page))}" style="display:block;border:0;width:${viewport.width}px;height:${viewport.height}px"></iframe><script>
document.getElementById("f").addEventListener("load", function () { setTimeout(function () { try { var d = document.getElementById("f").contentDocument; document.title = "h" + Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0); } catch (e) { document.title = "x"; } }, 2500); });
</script></body></html>`);
  return new Promise<number>((resolve) => {
    const child = spawn(binary, [
      ...HEADLESS_CHROME_ARGS, "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
      `--user-data-dir=${profile}`, `--window-size=${Math.max(viewport.width, 500)},${viewport.height}`, "--virtual-time-budget=6000",
      "--dump-dom", `file://${measure}`,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let dom = "";
    child.stdout.on("data", (chunk: Buffer) => { dom += chunk.toString("utf8"); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    const done = () => {
      clearTimeout(timer);
      rmSync(profile, { recursive: true, force: true });
      rmSync(measure, { force: true });
      const height = Number(/<title>h(\d+)<\/title>/.exec(dom)?.[1]);
      resolve(Number.isFinite(height) && height > 0 ? height : viewport.height);
    };
    child.on("error", done);
    child.on("exit", done);
  });
}

/** A screenshot from a headless browser with its own throwaway profile; George's browser is never touched. The whole page, up to a readable height. */
export async function shootWithChrome(page: string, png: string, viewport: { width: number; height: number; scale: number }): Promise<void> {
  const binary = CHROME.find((path) => existsSync(path));
  if (!binary) throw new Error("No Chrome or Chromium to take the lab's screenshots");
  const cap = viewport.width < 500 ? MAX_SHOT_HEIGHT.phone : MAX_SHOT_HEIGHT.desktop;
  const height = Math.min(Math.max(viewport.height, await pageHeight(binary, page, viewport)), cap);
  return shootAt(binary, page, png, { ...viewport, height });
}

/**
 * Designers animate with GSAP, and the camera's virtual clock caught its entrance tweens part-way, so the critic
 * judged half-faded pages. Once the page has loaded (and again a moment later, for tweens started just after),
 * every GSAP animation is jumped to its end so the shot shows the finished page.
 */
const SETTLE_GSAP = `<script>(function(){function settle(){var g=window.gsap;if(!g||!g.globalTimeline)return;g.ticker.lagSmoothing(0);g.globalTimeline.getChildren(false,true,true).forEach(function(t){t.progress(1);});}addEventListener("load",function(){settle();setTimeout(settle,1500);});})();</script>`;

function shootAt(binary: string, page: string, png: string, viewport: { width: number; height: number; scale: number }): Promise<void> {
  const profile = mkdtempSync(join(tmpdir(), "flyd-lab-"));
  // The page is shot from a copy beside it (so its relative assets still load) that settles GSAP before the shot.
  const settled = join(dirname(page), `.shot-${viewport.width}-${basename(page)}`);
  writeFileSync(settled, readFileSync(page, "utf8") + SETTLE_GSAP);
  // Headless Chrome will not lay a window out narrower than about 500px, so a phone
  // width is framed at exactly that width; the page inside sees a true phone viewport.
  // One frame file per page: the versions are shot side by side, and a shared one let a version's phone shot show another.
  const framed = viewport.width < 500 ? join(dirname(page), `.frame-${viewport.width}-${basename(page)}`) : null;
  if (framed) writeFileSync(framed, `<!doctype html><html><body style="margin:0"><iframe src="${encodeURI(basename(settled))}" style="display:block;border:0;width:${viewport.width}px;height:${viewport.height}px"></iframe></body></html>`);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, [
      ...HEADLESS_CHROME_ARGS, "--disable-gpu", "--hide-scrollbars",
      `--user-data-dir=${profile}`, `--window-size=${viewport.width},${viewport.height}`,
      // Every compositor stage runs before the shot, so an entrance fade is caught finished, not halfway.
      `--force-device-scale-factor=${viewport.scale}`, "--run-all-compositor-stages-before-draw", "--virtual-time-budget=4000",
      `--screenshot=${png}`, `file://${framed ?? settled}`,
    ], { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("error", reject);
    child.on("exit", () => {
      clearTimeout(timer);
      rmSync(profile, { recursive: true, force: true });
      rmSync(settled, { force: true });
      if (framed) rmSync(framed, { force: true });
      if (!existsSync(png)) { reject(new Error(`No screenshot of ${basename(page)}`)); return; }
      if (framed) cropTo(png, viewport).then(resolve, reject);
      else resolve();
    });
  });
}

/** Trims a framed phone shot to the phone itself, with macOS's own image tool. */
function cropTo(png: string, viewport: { width: number; height: number; scale: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/sips", ["-c", String(viewport.height * viewport.scale), String(viewport.width * viewport.scale), "--cropOffset", "0", "0", png], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Could not trim ${basename(png)}`)));
  });
}

/** git in the project, for a build's diff and commit. */
function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(out) : reject(new Error(`git ${args[0]} failed: ${err.trim() || code}`)));
  });
}

const working = new Set<string>();

function terminal(run: DomainRun): boolean {
  // A decision pauses the runner until George answers.
  return isSettled(run.status) || run.status === "needs_decision";
}

/** Whether a process is still running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * One runner per lab across every Flyd process (Core's scheduler, a chat that started it): the lab's
 * runner.lock names the process stepping it. A lock whose process has gone is taken over.
 */
function claimRunner(runId: string, root: string): boolean {
  const path = join(labDir(runId, root), "runner.lock");
  try { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); } catch { return false; }
  // When this Mac last started, to the minute: a lock from before a restart names a pid some other process may now have.
  const boot = Math.round((Date.now() - uptime() * 1000) / 60_000);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, boot, at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
      return true;
    } catch {
      let holder: { pid?: unknown; boot?: unknown } = {};
      try { holder = JSON.parse(readFileSync(path, "utf8")) as typeof holder; } catch { /* Unreadable: taken over. */ }
      const pid = Number(holder.pid);
      const sameBoot = Math.abs(Number(holder.boot) - boot) <= 2;
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && sameBoot && alive(pid)) return false;
      rmSync(path, { force: true });
    }
  }
  return false;
}

function releaseRunner(runId: string, root: string): void {
  const path = join(labDir(runId, root), "runner.lock");
  try {
    if (Number((JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown }).pid) === process.pid) rmSync(path, { force: true });
  } catch { /* Already gone. */ }
}

/** The first time the team's model answers, the run is really under way: recorded once, for whoever said it started. */
function markStarted(runId: string): void {
  mutateDomainRun(runId, (current) => current && !current.startedAt ? { ...current, startedAt: new Date().toISOString() } : null);
}

/** Steps one lab to its end in the background, at most one runner per lab. */
async function drive(run: DomainRun, deps: DesignMateDeps, onChanged?: (run: DomainRun) => Promise<void> | void): Promise<void> {
  if (working.has(run.id)) return;
  const root = deps.root ?? labsDir();
  working.add(run.id);
  if (!claimRunner(run.id, root)) { working.delete(run.id); return; }
  let started = Boolean(run.startedAt);
  const begin = () => { if (!started) { started = true; markStarted(run.id); } };
  const watched: DesignMateDeps = {
    ...deps,
    complete: async (prompt, options) => {
      const reply = await deps.complete(prompt, { ...options, onStarted: () => { options?.onStarted?.(); begin(); } });
      begin();
      return reply;
    },
  };
  try {
    let current = readDomainRun(run.id) ?? run;
    while (!terminal(current)) {
      try {
        current = await advanceDesignRun(current, watched);
      } catch (error) {
        current = save(current, { status: "failed", phase: "done", failure: stoppedLine(messageOf(error), current.phase === "making" || current.phase?.startsWith("build-")) });
      }
      if ((readDomainRun(current.id) ?? current).status === "cancelled") return;
    }
    await onChanged?.(current);
  } finally {
    releaseRunner(run.id, root);
    working.delete(run.id);
  }
}

export const liveDesignDeps: DesignMateDeps = {
  complete: (prompt, options = {}) => completeWithClaude(prompt, {
    ...(options.images?.length ? { images: options.images } : {}),
    ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
    ...(options.onStarted ? { onStarted: options.onStarted } : {}),
  }),
  shoot: shootWithChrome,
  make: (cwd, prompt) => makeWithClaude(cwd, prompt),
  board: (input) => putLabOnBoard(input),
};

/** The scheduler's tick: start (or, after a restart, resume) every unfinished lab. Never waits on one. */
export async function syncDesignMateRuns(options: { onChanged?: (run: DomainRun) => Promise<void> | void; deps?: DesignMateDeps } = {}): Promise<DomainRun[]> {
  if (process.env.VITEST && !options.deps) return [];
  const open = listDomainRuns().filter((run) => run.owner === DESIGN_MATE && !terminal(run));
  for (const run of open) void drive(run, options.deps ?? liveDesignDeps, options.onChanged);
  return open;
}

/** What starting a lab came to: really under way, stopped already (with why), or still waiting for its first answer. */
export type DesignStart =
  | { state: "started"; run: DomainRun }
  | { state: "failed"; run: DomainRun; failure: string }
  | { state: "waiting"; run: DomainRun };

/**
 * Starts a lab now rather than on the scheduler's next tick, and waits (briefly) to see it really
 * start: the model answering, or the run stopping. Flyd says it started only on "started"; a lab
 * that failed at once (a plan limit, no login) is said plainly, and one still waiting is said to be
 * queued. Under tests nothing runs unless staff are given.
 */
export async function startDesignRun(run: DomainRun, options: { deps?: DesignMateDeps; waitMs?: number; pollMs?: number } = {}): Promise<DesignStart> {
  if (process.env.VITEST && !options.deps) return { state: "waiting", run };
  void drive(run, options.deps ?? liveDesignDeps);
  const deadline = Date.now() + (options.waitMs ?? 45_000);
  for (;;) {
    const current = readDomainRun(run.id) ?? run;
    if (current.status === "failed") return { state: "failed", run: current, failure: current.failure ?? stoppedLine("it stopped without saying why") };
    if (current.startedAt || current.status === "completed" || current.status === "needs_decision") return { state: "started", run: current };
    if (current.status === "cancelled" || Date.now() >= deadline) return { state: "waiting", run: current };
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 500));
  }
}

/** A lab that failed as it started was told to George in the chat that started it, so no notification says it again. */
export function toldInChat(runId: string): void {
  mutateDomainRun(runId, (current) => current?.status === "failed" && current.report?.state === "due"
    ? { ...current, report: { ...current.report, state: "quiet", at: new Date().toISOString() } } : null);
}

const boards = new BoardWatcher();
/** Boards are listened to this long after their lab finished; older ones are left. */
const BOARD_WATCH_DAYS = 21;

/**
 * George's answer on a lab's board: a version marked final is built (with any notes he sent with it),
 * notes alone go to another round. Both go through the lab's follow-up path, once per board message.
 */
export async function answerFromBoard(run: DomainRun, feedback: BoardFeedback): Promise<string> {
  const lab = readLab(run.id);
  const version = feedback.final !== undefined ? lab?.versions.find((item) => item.n === feedback.final) : undefined;
  if (!version && !feedback.notes.length) return "Nothing to act on in that.";
  // No project to build into: the pick is kept on the lab, and only notes start another round.
  if (version && !run.request.project?.root && !feedback.notes.length) {
    if (lab) { lab.picked = version.n; writeLab(run.id, lab, labsDir()); }
    return `Marked V${version.n} · ${version.name} as the one. This lab has no project to build it into yet, so it waits here until you say where.`;
  }
  const { designFollowup } = await import("./followup.js");
  const words = [
    ...(version ? [`Build V${version.n} · ${version.name}.`] : []),
    ...(feedback.notes.length ? ["His notes on the board:", ...feedback.notes.map((note) => `- ${note}`)] : []),
  ].join("\n");
  const id = feedback.ids.length ? `lab-${createHash("sha256").update(`${run.id}\0${feedback.ids.join(",")}`).digest("hex").slice(0, 32)}` : undefined;
  const next = await designFollowup(run, words, { pick: version?.n ?? null, ...(id ? { requestId: id } : {}) });
  void syncDesignMateRuns();
  if (next.status === "failed") return `I couldn't start that: ${next.failure ?? "it stopped at once"}`;
  if (next.request.project?.root && version && readBuild(next.id)) return `Building V${version.n} · ${version.name} into the project now. You'll hear when it's in.`;
  return "Taking your notes into another round now. It comes back on a new board.";
}

/** The scheduler's tick: listens to the board of every recent finished lab that George has not ended. */
export function syncDesignBoards(options: { watcher?: BoardWatcher; now?: Date } = {}): string[] {
  if (process.env.VITEST && !options.watcher) return [];
  const watcher = options.watcher ?? boards;
  const since = (options.now ?? new Date()).getTime() - BOARD_WATCH_DAYS * 86_400_000;
  const watches: BoardWatch[] = [];
  for (const run of listDomainRuns()) {
    if (run.owner !== DESIGN_MATE || run.status !== "completed" || Date.parse(run.updatedAt) < since) continue;
    const lab = readLab(run.id);
    if (!lab?.board || lab.board.ended) continue;
    watches.push({
      runId: run.id,
      board: lab.board,
      labDir: labDir(run.id),
      onFeedback: (feedback) => answerFromBoard(readDomainRun(run.id) ?? run, feedback),
      onEnded: () => {
        const current = readLab(run.id);
        if (current?.board) { current.board.ended = true; writeLab(run.id, current, labsDir()); }
      },
    });
  }
  watcher.sync(watches);
  return watches.map((watch) => watch.runId);
}

/** For tests: wait for a lab to finish. */
export async function driveDesignRun(run: DomainRun, deps: DesignMateDeps): Promise<DomainRun> {
  await drive(run, deps);
  return readDomainRun(run.id) ?? run;
}

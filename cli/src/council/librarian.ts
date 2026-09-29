import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { FLYD_DIR, RAW_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { addUserProfileFact, PROFILE_SECTIONS, readUserProfile } from "../lib/user-profile.js";
import { readJournalSince, type JournalTurn } from "./journal.js";
import { applyProjectOps, describeProject, PROJECT_KINDS, PROJECT_STATUSES, readProjects, type Project, type ProjectApplyReceipt, type ProjectOp } from "./projects.js";
import {
  applyMemoryOps, localDay, MEMORY_SECTIONS, memoryPaths, readMemoryEntries, staleEntries,
  type ApplyReceipt, type MemoryOp, type MemoryPaths,
} from "./memory-store.js";

// The Librarian: Flyd's curator. It reads what George said (the journal) and
// wrote (captures) since its last pass, and keeps the memory he relies on
// current — recording corrections first, then preferences, facts,
// contradictions — citing sources and archiving rather than deleting.
// It proposes; memory-store.ts applies. (Letta's reflection subagent,
// Honcho's deductive dreamer, firstmate's /stow.)
//
// It also sees work that finished since its last pass (commits in his repos,
// crew work landed, background jobs and agenda runs that succeeded), so a
// commitment that got done — in a chat or anywhere else — is closed instead
// of lingering as an open task every prompt keeps chasing.

export interface LibrarianState {
  journalCursor: string | null;
  captureCursorMs: number;
  lastRunAt: string | null;
  runs: number;
  /** Local day the Librarian last tried to build an empty project list; once a day at most. */
  projectsSeededOn?: string;
}

export function librarianStatePath(): string {
  return process.env.FLYD_LIBRARIAN_STATE?.trim() || join(FLYD_DIR, "council", "librarian-state.json");
}

export function readLibrarianState(path = librarianStatePath()): LibrarianState {
  try {
    return { journalCursor: null, captureCursorMs: 0, lastRunAt: null, runs: 0, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { journalCursor: null, captureCursorMs: 0, lastRunAt: null, runs: 0 };
  }
}

function writeLibrarianState(state: LibrarianState, path = librarianStatePath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export interface CaptureNote {
  id: string;
  mtimeMs: number;
  text: string;
}

/** Captures George wrote since the cursor, oldest first (runtime events and conversation indexes excluded). */
export function collectNewCaptures(sinceMs: number, rawDir = RAW_DIR, limit = 40): CaptureNote[] {
  if (!existsSync(rawDir)) return [];
  const notes: CaptureNote[] = [];
  for (const name of readdirSync(rawDir)) {
    if (!name.endsWith(".md") || name.startsWith("runtime-event") || name.startsWith("conversation-")) continue;
    const path = join(rawDir, name);
    const mtimeMs = statSync(path).mtimeMs;
    if (mtimeMs <= sinceMs) continue;
    try {
      const body = parse(readFileSync(path, "utf8")).body.trim();
      if (body.length >= 20) notes.push({ id: `cap:${name.replace(/\.md$/, "")}`, mtimeMs, text: body.slice(0, 2_000) });
    } catch {
      // Unparseable capture: skip, never fatal.
    }
  }
  return notes.sort((a, b) => a.mtimeMs - b.mtimeMs).slice(0, limit);
}

export interface FinishedWork {
  id: string;
  at: string;
  source: "commit" | "crew" | "job" | "agenda";
  text: string;
}

const execFileAsync = promisify(execFile);
const MAX_FINISHED = 40;

async function recentCommits(since: Date): Promise<FinishedWork[]> {
  const { refreshRepoRegistry } = await import("../runtime/repo-registry.js");
  const repos = await refreshRepoRegistry().catch(() => []);
  const perRepo = await Promise.all(repos.map(async (repo) => {
    try {
      const { stdout } = await execFileAsync("git", ["-C", repo.root, "log", `--since=${since.toISOString()}`, "--no-merges", "-n", "15", "--format=%h%x09%cI%x09%s"], { timeout: 10_000 });
      return stdout.split("\n").filter(Boolean).map((line) => {
        const [hash, at, subject] = line.split("\t");
        return { id: `done:${repo.name}@${hash}`, at, source: "commit" as const, text: `${repo.name}: ${subject}` };
      });
    } catch {
      return [];
    }
  }));
  return perRepo.flat();
}

/** What got done since `since`, newest first, bounded. Each source is best-effort. */
export async function collectFinishedWork(since: Date): Promise<FinishedWork[]> {
  const after = (at: string | undefined) => Boolean(at) && Date.parse(at!) >= since.getTime();
  const found: FinishedWork[] = [];
  try {
    const crew = await import("../crew/crew.js");
    for (const task of crew.listTasks()) {
      if (task.status === "landed" && after(task.finishedAt ?? task.createdAt)) {
        found.push({ id: `done:crew-${task.id}`, at: task.finishedAt ?? task.createdAt, source: "crew", text: `Built and landed: ${crew.plainOutcome(task)}` });
      }
    }
  } catch { /* no crew store */ }
  try {
    const { listJobs } = await import("../runtime/background-jobs.js");
    for (const job of listJobs()) {
      if (job.status === "ok" && after(job.updatedAt)) found.push({ id: `done:job-${job.id}`, at: job.updatedAt, source: "job", text: `Background work done: ${job.contract.task.slice(0, 200)}. It found: ${(job.result ?? "").replace(/\s+/g, " ").slice(0, 1_500)}` });
    }
  } catch { /* no job store */ }
  try {
    const { readInbox } = await import("../runtime/agenda.js");
    for (const entry of readInbox()) {
      if (entry.status === "ok" && after(entry.at)) found.push({ id: `done:agenda-${entry.id}`, at: entry.at, source: "agenda", text: `${entry.task.slice(0, 120)}: ${entry.result.split("\n")[0].slice(0, 160)}` });
    }
  } catch { /* no inbox */ }
  found.push(...await recentCommits(since).catch(() => []));
  return found.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_FINISHED);
}

export interface LibrarianInput {
  turns: JournalTurn[];
  captures: CaptureNote[];
  memory: ReturnType<typeof readMemoryEntries>;
  stale: ReturnType<typeof staleEntries>;
  profile: string | null;
  today: string;
  finished?: FinishedWork[];
  projects?: Project[];
  /** Code repos on his Mac a project can point at. */
  repos?: Array<{ name: string; root: string }>;
  /** Re-reading old material (CV, past notes, other assistants' memories) rather than what's new. */
  backfill?: boolean;
}

export function librarianPrompt(input: LibrarianInput): string {
  const turns = input.turns.map((turn) =>
    // A turn that used tools usually found something out; its answer carries the findings.
    `[j:${turn.id}] ${turn.at.slice(0, 16)}\nGeorge: ${turn.user.slice(0, 1_500)}\nFlyd: ${turn.assistant.slice(0, turn.tools?.length ? 2_500 : 800)}${turn.tools?.length ? `\n(tools: ${turn.tools.join("; ").slice(0, 300)})` : ""}`).join("\n\n");
  const captures = input.captures.map((note) => `[${note.id}] ${note.text}`).join("\n\n");
  const memory = input.memory.map((entry) => `[${entry.id}] (${entry.section}, ${entry.tier}, confirmed ${entry.date}) ${entry.text}`).join("\n");
  const stale = input.stale.map((entry) => `[${entry.id}] ${entry.text}`).join("\n");
  const finished = (input.finished ?? []).map((work) => `[${work.id}] ${work.at.slice(0, 10)} ${work.text}`).join("\n");
  const projects = (input.projects ?? []).map((project) => `[${project.id}] ${describeProject(project)} (updated ${project.updated})`).join("\n");
  const repos = (input.repos ?? []).map((repo) => `${repo.name}: ${repo.root}`).join("\n");
  return [
    "You are Flyd's Librarian: the curator of George's memory. George is the only person you serve.",
    `Today is ${input.today}.`,
    input.backfill
      ? [
        "This pass re-reads OLD material about George (his CV, past notes and captures, other assistants' memories of him), not new conversation. Build what Flyd should know about him from it:",
        "- Who he is, his background, how he works and what he's known for: profile ops, a few crisp lines, the headline career and wins in 'Work'. Not the whole CV: his profile is read on every turn.",
        "- The detail behind it (roles and dates, clients, awards, exhibitions, testimonials, past projects): daily_note ops, one fact each, so they can be recalled when needed without riding in every prompt.",
        "- His current projects, with their facts: project_ops. Past projects that are over: status done.",
        "- People who matter to him, standing decisions, open commitments: memory_ops.",
        "- Old material can be out of date. When it conflicts with the current profile, memory or projects, the current ones win. Skip anything already known, one-off chatter, and code or product specs.",
      ].join("\n")
      : "Read what happened since your last pass and keep his memory accurate, small, and current.",
    "",
    "Priorities, in order:",
    "1. Corrections and mistakes — George correcting Flyd or himself. Fix the stored fact at its source.",
    "2. Commitments and decisions — promises, deadlines, choices he made and why.",
    "3. Facts about his world — projects, people, places, standing arrangements.",
    "4. Contradictions — new evidence that conflicts with memory: update the old entry, never keep both.",
    "5. How to be with him — how George reacted to Flyd: what landed, what grated, how he wants to be spoken to or supported. Profile section 'How to be with me'.",
    "6. How he's been lately — mood, energy, what's weighing on him or lifting him this week. Memory section 'Lately', tier perishable, gently worded.",
    "",
    "Rules:",
    "- Durable only, except 'Lately'. Skip one-off requests, chit-chat, transient errors, and anything already stored.",
    "- One short sentence per entry (under ~25 words), in plain language a friend would use. No class, service, or file names — code details belong in the project's own docs, not George's memory.",
    "- Never record claims that a tool or feature 'does not work' — those harden into false refusals.",
    "- Convert relative dates to absolute ones.",
    "- Who George is (identity, preferences, people, routines, goals, constraints) goes to his profile via profile ops; everything else to memory.",
    "- Commitments with a date are perishable; standing facts and decisions are aging.",
    "- Cite sources with the [j:…] / [cap:…] ids you were shown. Do not invent ids.",
    "- For each STALE entry: reinforce it if today's evidence confirms it, archive it if superseded or done, otherwise leave it.",
    "- Keep his projects current. A project is anything he is making, running, or owed, with or without code (a product launch, a client job, an artwork, money owed, the glasses venture). Add one when it first comes up; update its now/next/due/status/people from what he said or what got done; mark it done when it is finished. Keep its facts: the specifics Flyd found or he said that he'd otherwise have to dig for again (amounts, invoice numbers, dates, who pays, contacts, decisions and why, links). Send the project's whole current facts list, newest first, at most 8, dropping ones that are no longer true. Link code only from the repo list below, and only when that repo is the project's code. Projects stay out of memory_ops: they live here.",
    input.projects?.length ? "" : "- He has no project list yet: build it now from his profile, memory, the repos, and the conversation. Only real, current projects; skip one-off tasks.",
    "- For every Commitments entry, stale or not: if the finished work below shows that exact thing done, archive it with reason \"done: [done:…]\" citing the id. A related piece of work is not proof; leave the entry when unsure.",
    "- Fewer, better entries. When nothing qualifies, return empty lists.",
    "",
    `Memory sections: ${MEMORY_SECTIONS.join(", ")}. Profile sections: ${PROFILE_SECTIONS.join(", ")}.`,
    "",
    "Reply with JSON only:",
    '{"memory_ops": [ {"op":"add","section":"...","text":"...","tier":"aging|perishable","sources":["j:..."]} | {"op":"update","id":"...","text":"...","sources":[...]} | {"op":"reinforce","id":"...","sources":[...]} | {"op":"archive","id":"...","reason":"..."} | {"op":"daily_note","text":"...","sources":[...]} ],',
    ' "profile_ops": [ {"section":"...","fact":"..."} ],',
    ` "project_ops": [ {"op":"upsert","id":"existing id, or omit for a new one","name":"...","what":"one line","kind":"${PROJECT_KINDS.join("|")}","status":"${PROJECT_STATUSES.join("|")}","now":"where it stands","next":"next step","due":"YYYY-MM-DD","people":["..."],"repos":["root path from the list"],"facts":["..."]} | {"op":"archive","id":"...","reason":"..."} ],`,
    ' "observations": ["<up to 5 short notes for George\'s advisors about what stands out: risks, patterns, momentum, loose ends>"] }',
    "",
    `--- George's profile ---\n${input.profile ?? "(empty)"}`,
    `--- Current memory ---\n${memory || "(empty)"}`,
    `--- Stale entries needing a decision ---\n${stale || "(none)"}`,
    `--- Conversation since last pass ---\n${turns || "(none)"}`,
    `--- New captures ---\n${captures || "(none)"}`,
    `--- Work finished since your last pass ---\n${finished || "(none)"}`,
    `--- His projects ---\n${projects || "(none yet)"}`,
    `--- Code repos on his Mac ---\n${repos || "(none found)"}`,
  ].join("\n");
}

export interface LibrarianProposal {
  projectOps: ProjectOp[];
  memoryOps: MemoryOp[];
  profileOps: Array<{ section: string; fact: string }>;
  observations: string[];
}

export function parseLibrarianProposal(text: string): LibrarianProposal {
  const empty: LibrarianProposal = { memoryOps: [], profileOps: [], observations: [], projectOps: [] };
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return empty;
  try {
    const parsed = JSON.parse(match[0]) as { memory_ops?: unknown[]; profile_ops?: unknown[]; observations?: unknown[]; project_ops?: unknown[] };
    return {
      projectOps: (parsed.project_ops ?? []).filter((op): op is ProjectOp => {
        const record = op as { op?: unknown; name?: unknown; id?: unknown };
        return (record?.op === "upsert" && typeof record.name === "string") || (record?.op === "archive" && typeof record.id === "string");
      }).slice(0, 30),
      memoryOps: (parsed.memory_ops ?? []).filter((op): op is MemoryOp => typeof op === "object" && op !== null && typeof (op as { op?: unknown }).op === "string").slice(0, 30),
      profileOps: (parsed.profile_ops ?? []).flatMap((op) => {
        const record = op as { section?: unknown; fact?: unknown };
        return typeof record?.fact === "string" && record.fact.trim() ? [{ section: String(record.section ?? ""), fact: record.fact.trim() }] : [];
      }).slice(0, 10),
      observations: (parsed.observations ?? []).map(String).map((note) => note.trim()).filter(Boolean).slice(0, 5),
    };
  } catch {
    return empty;
  }
}

export interface LibrarianRunResult {
  skipped?: "nothing_new";
  turns: number;
  captures: number;
  memory?: ApplyReceipt;
  projects?: ProjectApplyReceipt;
  profileAdded: number;
  observations: string[];
}

export interface LibrarianDependencies {
  complete(prompt: string): Promise<string>;
  now?: () => Date;
  memoryPaths?: MemoryPaths;
  statePath?: string;
  journalDir?: string;
  rawDir?: string;
  addProfileFact?: (fact: string, section: string) => boolean;
  readProfile?: () => string | null;
  /** What got done since the last pass; defaults to commits, crew, jobs and agenda outside tests. */
  finishedWork?: (since: Date) => Promise<FinishedWork[]>;
  /** His code repos; defaults to the repo registry outside tests. */
  repos?: () => Promise<Array<{ name: string; root: string }>>;
  projectsPath?: string;
}

const FIRST_PASS_LOOKBACK_MS = 7 * 86_400_000;

async function defaultRepos(): Promise<Array<{ name: string; root: string }>> {
  const { refreshRepoRegistry } = await import("../runtime/repo-registry.js");
  return (await refreshRepoRegistry()).map((repo) => ({ name: repo.name, root: repo.root }));
}

/** Apply a proposal: memory, projects and profile, each through its own validation. */
function applyProposal(
  proposal: LibrarianProposal,
  options: { now: Date; paths: MemoryPaths; repos: Array<{ root: string }>; deps: Pick<LibrarianDependencies, "addProfileFact" | "projectsPath"> },
): { memory: ApplyReceipt; projects: ProjectApplyReceipt; profileAdded: number } {
  const memory = applyMemoryOps(proposal.memoryOps, { now: options.now, paths: options.paths });
  const projects = applyProjectOps(proposal.projectOps, {
    knownRepos: options.repos.map((repo) => repo.root), now: options.now,
    ...(options.deps.projectsPath ? { path: options.deps.projectsPath } : {}),
  });
  const addProfile = options.deps.addProfileFact
    ?? ((fact: string, section: string) => addUserProfileFact(fact, {
      section: PROFILE_SECTIONS.find((name) => name.toLowerCase() === section.toLowerCase()) ?? "Learned in conversation",
    }));
  const profileAdded = proposal.profileOps.filter(({ fact, section }) => addProfile(fact, section)).length;
  return { memory, projects, profileAdded };
}

/** One curation pass over everything new since the last one. */
export async function runLibrarian(deps: LibrarianDependencies): Promise<LibrarianRunResult> {
  const now = (deps.now ?? (() => new Date()))();
  const state = readLibrarianState(deps.statePath);
  const turns = readJournalSince(state.journalCursor, deps.journalDir, 120);
  const captures = collectNewCaptures(state.captureCursorMs, deps.rawDir);
  const paths = deps.memoryPaths ?? memoryPaths();
  const memory = readMemoryEntries(paths);
  const stale = staleEntries(memory, now);
  const since = state.lastRunAt ? new Date(state.lastRunAt) : new Date(now.getTime() - FIRST_PASS_LOOKBACK_MS);
  const projects = readProjects(deps.projectsPath);
  const seedProjects = projects.length === 0 && state.projectsSeededOn !== localDay(now);
  const commitments = memory.some((entry) => entry.section === "Commitments");
  const finished = commitments
    ? await (deps.finishedWork ?? (process.env.VITEST ? async () => [] : collectFinishedWork))(since).catch(() => [])
    : [];
  if (turns.length === 0 && captures.length === 0 && stale.length === 0 && finished.length === 0 && !seedProjects) {
    return { skipped: "nothing_new", turns: 0, captures: 0, profileAdded: 0, observations: [] };
  }
  const profile = (deps.readProfile ?? readUserProfile)();
  const repos = await (deps.repos ?? (process.env.VITEST ? async () => [] : defaultRepos))().catch(() => []);
  const reply = await deps.complete(librarianPrompt({
    turns, captures, memory, stale, profile, today: localDay(now), finished, projects, repos,
  }));
  // An unparseable reply must not consume the slice: keep the cursors and retry next pass.
  if (!/\{[\s\S]*\}/.test(reply)) throw new Error("Librarian returned no JSON proposal; cursors kept for retry");
  const proposal = parseLibrarianProposal(reply);
  const { memory: receipt, projects: projectReceipt, profileAdded } = applyProposal(proposal, { now, paths, repos, deps });
  // Advance cursors only after a successful pass so a failed one is retried.
  writeLibrarianState({
    journalCursor: turns.at(-1)?.at ?? state.journalCursor,
    captureCursorMs: captures.at(-1)?.mtimeMs ?? state.captureCursorMs,
    lastRunAt: now.toISOString(),
    runs: state.runs + 1,
    ...(seedProjects ? { projectsSeededOn: localDay(now) } : state.projectsSeededOn ? { projectsSeededOn: state.projectsSeededOn } : {}),
  }, deps.statePath);
  return { turns: turns.length, captures: captures.length, memory: receipt, projects: projectReceipt, profileAdded, observations: proposal.observations };
}

export interface BackfillSource { id: string; text: string }

/** The proposal, or null when the reply isn't parseable JSON (as opposed to an empty proposal). */
function strictProposal(reply: string): LibrarianProposal | null {
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { JSON.parse(match[0]); } catch { return null; }
  return parseLibrarianProposal(reply);
}

/** Memory sections that belong in every prompt; anything else from old material is detail. */
const STANDING_SECTIONS = new Set(["People", "Commitments", "Decisions"]);

/**
 * Old material is mostly detail (past roles, clients, artworks). MEMORY.md
 * rides in every prompt, so during a backfill only people, commitments and
 * decisions go there; every other fact becomes a daily note that recall
 * finds when it's needed.
 */
function toBackfillOps(proposal: LibrarianProposal, today: string): LibrarianProposal {
  return {
    ...proposal,
    memoryOps: proposal.memoryOps.map((op) => (op.op === "add" && !STANDING_SECTIONS.has(op.section)
      ? { op: "daily_note" as const, text: op.text, ...(op.sources ? { sources: op.sources } : {}) }
      : op)),
  };
}

export interface ReprocessResult {
  batches: number;
  sources: number;
  memory: { added: number; updated: number; archived: number; notes: number };
  projects: { upserted: number; archived: number };
  profileAdded: number;
}

/** Pack sources into batches of about `size` characters; a long source is split into parts. */
export function batchSources(sources: BackfillSource[], size = 14_000): BackfillSource[][] {
  const parts = sources.flatMap((source) => {
    if (source.text.length <= size) return [source];
    const count = Math.ceil(source.text.length / size);
    return Array.from({ length: count }, (_, index) => ({ id: `${source.id}#${index + 1}`, text: source.text.slice(index * size, (index + 1) * size) }));
  });
  const batches: BackfillSource[][] = [];
  let current: BackfillSource[] = [];
  let chars = 0;
  for (const part of parts) {
    if (current.length && chars + part.text.length > size) { batches.push(current); current = []; chars = 0; }
    current.push(part);
    chars += part.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * Run old material through the Librarian again, batch by batch, with the
 * same prompt, validation and stores as a normal pass. Progress is saved after
 * every batch, so an interrupted run picks up where it stopped.
 */
export async function reprocessSources(
  sources: BackfillSource[],
  deps: LibrarianDependencies & {
    progressPath: string;
    onBatch?: (done: number, total: number, result: ReturnType<typeof applyProposal>) => void;
    onSkip?: (ids: string[]) => void;
  },
): Promise<ReprocessResult> {
  const done = new Set<string>(existsSync(deps.progressPath) ? (JSON.parse(readFileSync(deps.progressPath, "utf8")) as { done: string[] }).done : []);
  const batches = batchSources(sources).filter((batch) => batch.some((part) => !done.has(part.id)));
  const total: ReprocessResult = { batches: 0, sources: sources.length, memory: { added: 0, updated: 0, archived: 0, notes: 0 }, projects: { upserted: 0, archived: 0 }, profileAdded: 0 };
  const paths = deps.memoryPaths ?? memoryPaths();
  const repos = await (deps.repos ?? (process.env.VITEST ? async () => [] : defaultRepos))().catch(() => []);
  for (const batch of batches) {
    const now = (deps.now ?? (() => new Date()))();
    const memory = readMemoryEntries(paths);
    const prompt = librarianPrompt({
      turns: [],
      captures: batch.map((part) => ({ id: part.id, mtimeMs: 0, text: part.text })),
      memory, stale: [], profile: (deps.readProfile ?? readUserProfile)(), today: localDay(now),
      projects: readProjects(deps.projectsPath), repos, backfill: true,
    });
    const reply = await deps.complete(prompt);
    // A reply that isn't valid JSON gets one more try; it never counts as "nothing to add".
    let proposal = strictProposal(reply);
    if (!proposal) proposal = strictProposal(await deps.complete(prompt));
    if (!proposal) { deps.onSkip?.(batch.map((part) => part.id)); continue; }
    const result = applyProposal(toBackfillOps(proposal, localDay(now)), { now, paths, repos, deps });
    for (const part of batch) done.add(part.id);
    mkdirSync(dirname(deps.progressPath), { recursive: true, mode: 0o700 });
    writeFileSync(deps.progressPath, JSON.stringify({ done: [...done] }), { encoding: "utf8", mode: 0o600 });
    total.batches += 1;
    total.memory.added += result.memory.added;
    total.memory.updated += result.memory.updated;
    total.memory.archived += result.memory.archived;
    total.memory.notes += result.memory.notes;
    total.projects.upserted += result.projects.upserted;
    total.projects.archived += result.projects.archived;
    total.profileAdded += result.profileAdded;
    deps.onBatch?.(total.batches, batches.length, result);
  }
  return total;
}

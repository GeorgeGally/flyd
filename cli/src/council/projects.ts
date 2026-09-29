import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { localDay } from "./memory-store.js";

// George's projects: the things he is making, running, or owes, whether or
// not they have code. A project is what he talks about ("the CleanX launch",
// "GNM still owes me", "DIR feels dead"); a repo is one thing a project may
// have. Without this, Flyd's only picture of his work was git repos, so any
// talk about a project turned into reading its code. The Librarian keeps the
// list current from what he says and what gets done; chat answers from it.

export const PROJECT_KINDS = ["product", "client", "creative", "venture", "personal", "admin"] as const;
export const PROJECT_STATUSES = ["active", "launching", "waiting", "paused", "done"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface Project {
  id: string;
  name: string;
  /** What it is, in a line. */
  what: string;
  kind: ProjectKind;
  status: ProjectStatus;
  /** Where it stands now. */
  now: string;
  next?: string;
  /** YYYY-MM-DD. */
  due?: string;
  people: string[];
  /** Code roots on this Mac; empty when the project has no code. */
  repos: string[];
  /** Last local day the Librarian touched it. */
  updated: string;
}

export type ProjectOp =
  | { op: "upsert"; id?: string; name: string; what?: string; kind?: string; status?: string; now?: string; next?: string | null; due?: string | null; people?: string[]; repos?: string[] }
  | { op: "archive"; id: string; reason: string };

export function projectsPath(): string {
  return process.env.FLYD_PROJECTS_PATH?.trim() || join(FLYD_DIR, "projects.json");
}

export function projectId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

export function readProjects(path = projectsPath()): Project[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { projects?: Project[] };
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

function writeProjects(projects: Project[], path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ projects }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

const oneLine = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? value as T : fallback;

export interface ProjectApplyReceipt { upserted: number; archived: number; rejected: string[] }

/**
 * Apply the Librarian's proposals. Repos must be ones Flyd actually knows
 * (`knownRepos`), so a project never points at a path that isn't there;
 * archiving marks it done rather than deleting what he did.
 */
export function applyProjectOps(ops: ProjectOp[], options: { knownRepos: string[]; now?: Date; path?: string }): ProjectApplyReceipt {
  const path = options.path ?? projectsPath();
  const today = localDay(options.now ?? new Date());
  const known = new Set(options.knownRepos);
  const projects = readProjects(path);
  const receipt: ProjectApplyReceipt = { upserted: 0, archived: 0, rejected: [] };
  for (const op of ops) {
    if (op.op === "archive") {
      const project = projects.find((item) => item.id === op.id);
      if (!project) { receipt.rejected.push(`archive: unknown project ${op.id}`); continue; }
      Object.assign(project, { status: "done", now: oneLine(op.reason, 200) || project.now, updated: today });
      receipt.archived += 1;
      continue;
    }
    const name = oneLine(op.name, 60);
    if (!name) { receipt.rejected.push("upsert: a project needs a name"); continue; }
    const id = op.id && projects.some((item) => item.id === op.id) ? op.id : projectId(name);
    const existing = projects.find((item) => item.id === id);
    const repos = (op.repos ?? existing?.repos ?? []).filter((root) => {
      if (known.has(root)) return true;
      receipt.rejected.push(`${name}: unknown repo ${root}`);
      return false;
    });
    const due = op.due === null ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(String(op.due ?? "")) ? String(op.due) : existing?.due;
    const next = op.next === null ? undefined : op.next !== undefined ? oneLine(op.next, 200) || undefined : existing?.next;
    const project: Project = {
      id,
      name,
      what: oneLine(op.what, 200) || existing?.what || "",
      kind: pick(op.kind, PROJECT_KINDS, existing?.kind ?? "product"),
      status: pick(op.status, PROJECT_STATUSES, existing?.status ?? "active"),
      now: oneLine(op.now, 240) || existing?.now || "",
      ...(next ? { next } : {}),
      ...(due ? { due } : {}),
      people: (op.people ?? existing?.people ?? []).map((person) => oneLine(person, 60)).filter(Boolean).slice(0, 8),
      repos: [...new Set(repos)],
      updated: today,
    };
    if (existing) Object.assign(existing, project); else projects.push(project);
    receipt.upserted += 1;
  }
  if (receipt.upserted || receipt.archived) writeProjects(projects, path);
  return receipt;
}

/** One line per live project, for the Librarian and the chat prompt. */
export function describeProject(project: Project): string {
  const code = project.repos.length ? `code: ${project.repos.join(", ")}` : "no code";
  return [
    `${project.name} (${project.kind}, ${project.status}; ${code}) — ${project.what}`,
    project.now ? ` Now: ${project.now}` : "",
    project.next ? ` Next: ${project.next}` : "",
    project.due ? ` Due ${project.due}.` : "",
    project.people.length ? ` With: ${project.people.join(", ")}.` : "",
  ].join("");
}

export function liveProjects(path = projectsPath()): Project[] {
  return readProjects(path).filter((project) => project.status !== "done");
}

/** For the chat prompt: what Flyd knows about his projects, so naming one doesn't mean reading its code. */
export function projectsPromptBlock(path = projectsPath()): string {
  const live = liveProjects(path);
  if (!live.length) return "";
  return [
    "## His projects (what you know; answer project talk from this)",
    ...live.map((project) => `- [${project.id}] ${describeProject(project)}`),
    "Open a project's code only when he asks about the code itself (what changed, where something is, fixing or building it).",
  ].join("\n");
}

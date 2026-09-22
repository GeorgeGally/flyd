import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PresentState } from "./types.js";

export function defaultPresentPath(): string {
  const root = process.env.FLYD_DIR?.trim() || join(homedir(), ".flyd");
  return join(root, "state", "present.json");
}

export function emptyPresent(now = new Date()): PresentState {
  return {
    generatedAt: now.toISOString(), activeProjects: [], dirtyRepos: [], recentRepoMovement: [],
    unfinishedTasks: [], openDecisions: [], waitingOn: [], upcoming: [], recentlyCompleted: [],
    activeWorkers: [], sourceRefs: [], gaps: [],
  };
}

export function readPresentState(path = defaultPresentPath()): PresentState {
  try {
    if (!existsSync(path)) return emptyPresent();
    return { ...emptyPresent(), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<PresentState>) };
  } catch {
    return { ...emptyPresent(), gaps: ["present_state_unreadable"] };
  }
}

export function writePresentState(state: PresentState, path = defaultPresentPath()): PresentState {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const next = { ...state, generatedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  return next;
}

export function updatePresentState(patch: Partial<PresentState>, path = defaultPresentPath()): PresentState {
  const current = readPresentState(path);
  return writePresentState({ ...current, ...patch, generatedAt: new Date().toISOString() }, path);
}

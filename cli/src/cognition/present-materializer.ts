import { readPresentModel } from "../work/work-hypothesis/index.js";
import type { WorkHypothesis } from "../work/work-hypothesis/types.js";
import type { RuntimeAwarePresent } from "../work/runtime-present-types.js";
import { readPresentState, writePresentState } from "./present-store.js";
import type { PresentState } from "./types.js";

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v)))];
}

export function presentFromWorkHypothesis(work: WorkHypothesis | RuntimeAwarePresent | null, prior = readPresentState()): PresentState {
  if (!work) return prior;
  const threads = [...work.primaryThreads, ...work.secondaryThreads].filter((thread) => !thread.demoted);
  const activeProjects = unique([
    ...threads.map((thread) => `project:${thread.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
    ...prior.activeProjects,
  ]);
  const dirtyRepos = threads
    .filter((thread) => thread.isDirty)
    .map((thread) => ({ root: thread.root, changed: [], ...(thread.name ? { branch: undefined } : {}) }));
  const recentRepoMovement = [
    ...(work.insights?.latestMoves ?? []).map((move) => ({
      project: `project:${move.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      subject: move.subject,
      ...(move.at ? { at: move.at } : {}),
    })),
    ...prior.recentRepoMovement,
  ].slice(0, 20);
  const unfinishedTasks = unique([
    ...(work.insights?.nextTodo ? [work.insights.nextTodo] : []),
    ...(work.activeRuntimeTasks ?? []).map((task) => `${task.projectName}: ${task.intendedOutcome} [${task.status}]`),
    ...prior.unfinishedTasks,
  ]);
  const openDecisions = unique([
    ...(work.openDecisions ?? []).map((decision) => `${decision.projectName ?? "Work"}: ${decision.question} — ${decision.context}`),
    ...prior.openDecisions,
  ]);
  const activeWorkers = unique([
    ...(work.workerObservations ?? []).map((worker) => `${worker.projectRoot}: ${worker.action} [${worker.state}] ${worker.reason}`),
    ...prior.activeWorkers,
  ]);
  const waitingOn = unique([
    ...(work.workerObservations ?? []).filter((worker) => worker.state === "blocked").map((worker) => worker.reason),
    ...prior.waitingOn,
  ]);
  const upcoming = unique([
    ...(work.insights?.nextDueAt ? [`${work.insights.nextTodo ?? "Next item"} due ${work.insights.nextDueAt}`] : []),
    ...prior.upcoming,
  ]);
  const recentlyCompleted = unique([
    ...(work.insights?.finishedProjects ?? []).map((name) => `${name} completed`),
    ...prior.recentlyCompleted,
  ]);
  const sourceRefs = unique([...work.evidenceRefs, ...prior.sourceRefs]);
  const gaps = unique([...work.uncertainty.map((u) => `${u.field}: ${u.reason}`), ...prior.gaps]);

  return {
    ...prior,
    generatedAt: new Date().toISOString(),
    foregroundProject: threads.find((thread) => thread.isForeground)
      ? `project:${threads.find((thread) => thread.isForeground)!.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
      : prior.foregroundProject ?? activeProjects[0],
    activeProjects,
    dirtyRepos: [...dirtyRepos, ...prior.dirtyRepos.filter((repo) => !dirtyRepos.some((x) => x.root === repo.root))],
    recentRepoMovement,
    unfinishedTasks,
    openDecisions,
    waitingOn,
    upcoming,
    recentlyCompleted,
    activeWorkers,
    sourceRefs,
    gaps,
  };
}

export function materializePresentFromWork(): PresentState {
  const work = readPresentModel();
  const state = presentFromWorkHypothesis(work);
  return writePresentState(state);
}

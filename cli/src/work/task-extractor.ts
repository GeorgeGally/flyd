import { readProjectState } from "./project-state.js";
import { syncProjectTasks, listOpenTasks } from "./task-store.js";
import { listRepositories } from "./repository-registry.js";

export interface TaskExtraction {
  projectId: string;
  projectName: string;
  extracted: string[];
  previouslyOpen: string[];
  nowDone: string[];
}

export function extractTasksFromProject(projectId: string, root: string): TaskExtraction {
  const state = readProjectState(root);
  const descriptions: string[] = [];

  for (const loop of state.openLoops) {
    if (loop.trim()) descriptions.push(loop.trim());
  }
  for (const blocker of state.blockers) {
    if (blocker.trim()) descriptions.push(`[blocker] ${blocker.trim()}`);
  }
  for (const action of state.nextLikelyActions) {
    if (action.trim()) descriptions.push(action.trim());
  }

  const previouslyOpen = listOpenTasks(projectId).map((t) => t.description);
  syncProjectTasks(projectId, descriptions);

  const nowOpen = listOpenTasks(projectId).map((t) => t.description);
  const nowDone = previouslyOpen.filter((d) => !nowOpen.includes(d));

  return {
    projectId,
    projectName: getProjectName(projectId),
    extracted: descriptions,
    previouslyOpen,
    nowDone,
  };
}

export function extractTasksFromAllProjects(): TaskExtraction[] {
  const repos = listRepositories();
  return repos
    .filter((r) => r.enabled && r.projectFileExists)
    .map((r) => extractTasksFromProject(r.id, r.root));
}

function getProjectName(projectId: string): string {
  const repos = listRepositories();
  return repos.find((r) => r.id === projectId)?.name ?? projectId;
}

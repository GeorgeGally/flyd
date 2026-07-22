import type { AgentTask, ContextPackage, MemoryEvidence, Orientation, RepositorySnapshot, WorkerSession } from "./types.js";
import { redactSensitiveText } from "./context-redactor.js";

interface OrientationInput {
  task: AgentTask | null;
  repository: RepositorySnapshot;
  worker: WorkerSession | null;
  memory: MemoryEvidence;
}

interface ContextInput extends OrientationInput {
  task: AgentTask;
  maxCharacters?: number;
}

const WORKER_HEALTH_BLOCKER = /^No healthy worker satisfies:/;
const REPOSITORY_INVALIDATED_ASSIGNMENT = "Current repository evidence invalidated the assignment base";
const REPEATED_INTERVENTION_BLOCKER = "Flyd already intervened on this exact evidence";

export function actionableTaskNextAction(task: AgentTask): string {
  const nextAction = task.recommendedNextAction?.trim();
  if (!nextAction) return "Continue the unfinished task";
  if (WORKER_HEALTH_BLOCKER.test(nextAction)) return task.intendedOutcome;
  if (nextAction === REPOSITORY_INVALIDATED_ASSIGNMENT) return "Re-check the current repository before continuing the task";
  if (nextAction === REPEATED_INTERVENTION_BLOCKER) return "Review the current state before intervening again";
  return nextAction;
}

export function buildOrientation({ task, repository, worker, memory }: OrientationInput): Orientation {
  const evidenceRefs = memory.matches.map((match) => match.id);
  if (!task) {
    return {
      kind: "new",
      headline: `Start focused work in ${repository.name}`,
      detail: repository.dirty ? `There are ${repository.statusLines.length} uncommitted repository changes.` : "The repository is clean.",
      nextAction: "State the outcome you want Flyd to accomplish",
      evidenceRefs,
    };
  }

  const previousHead = String(task.repositorySnapshot.head ?? "");
  const previousDigest = String(task.repositorySnapshot.status_digest ?? "");
  const changed = previousHead !== repository.head || previousDigest !== repository.statusDigest;
  const interrupted = worker?.status === "interrupted";
  const kind = changed ? "resume_changed" : interrupted ? "resume_interrupted" : "resume";
  const detail = changed
    ? `The repository changed since Flyd last recorded this task.${interrupted ? ` The last ${worker.adapter} worker was also interrupted.` : ""} Current Git state takes precedence over memory.`
    : interrupted
      ? `The last ${worker.adapter} worker was interrupted. Flyd will inspect current repository truth before resuming.`
      : "The repository matches Flyd's last recorded task state.";

  return {
    kind,
    headline: `Resume: ${task.intendedOutcome}`,
    detail,
    nextAction: actionableTaskNextAction(task),
    evidenceRefs,
  };
}

export function buildContextPackage({ task, repository, worker, memory, maxCharacters = 12_000 }: ContextInput): ContextPackage {
  const memoryLines = memory.matches.length
    ? memory.matches.map((match) => `- [${match.stale ? "stale" : "retrieved"}] ${match.path} (${match.id}): ${match.excerpt}`).join("\n")
    : "- No relevant memory evidence was retrieved.";
  const status = repository.statusLines.length ? repository.statusLines.map((line) => `    ${line}`).join("\n") : "    clean";
  const workerState = worker
    ? `${worker.adapter} ${worker.status}${worker.externalSessionId ? `, session ${worker.externalSessionId}` : ""}`
    : "No previous worker session";
  const markdown = `# Flyd task context

## Current repository observation

- Project: ${repository.name}
- Root: ${repository.root}
- Branch: ${repository.branch}
- HEAD: ${repository.head}
- Working tree:
${status}

## Confirmed task state

- Intended outcome: ${task.intendedOutcome}
- Status: ${task.status}
- Recorded next action: ${task.recommendedNextAction ?? "none"}
- Last worker: ${workerState}

## Retrieved memory evidence

Memory sufficiency: ${memory.verdict}

${memoryLines}

Memory is supporting evidence. Current repository state and the user's latest instruction are authoritative.
`;

  return {
    markdown: redactSensitiveText(markdown).slice(0, maxCharacters),
    evidenceRefs: memory.matches.map((match) => match.id),
  };
}

import { readProjectState, writeProjectState } from "./project-state.js";
import type { ProjectState, AgentHandoff } from "./project-state.js";
import type { WorkActivity } from "./repository-registry.js";

export interface ReconciliationResult {
  updated: boolean;
  changes: string[];
  warnings: string[];
  rejectedChanges: string[];
}

export function reconcileProject(
  root: string,
  activities: WorkActivity[],
  handoff?: AgentHandoff,
): ReconciliationResult {
  const state = readProjectState(root);
  const result: ReconciliationResult = {
    updated: false,
    changes: [],
    warnings: [],
    rejectedChanges: [],
  };

  const today = new Date().toISOString().slice(0, 10);

  // Mechanical: update timestamp if any activity exists
  if (activities.length > 0) {
    const oldDate = state.lastMeaningfulUpdate;
    state.lastMeaningfulUpdate = today;
    if (oldDate !== today) {
      result.changes.push(`last meaningful update: ${oldDate || "none"} → ${today}`);
      result.updated = true;
    }
  }

  // Resolve open loops that match completed activity summaries
  const activitySummaries = activities.map((a) => a.summary.toLowerCase());
  const resolvedLoops = state.openLoops.filter((loop) =>
    activitySummaries.some((summary) => summary.includes(loop.toLowerCase()))
  );
  if (resolvedLoops.length > 0) {
    state.openLoops = state.openLoops.filter((l) => !resolvedLoops.includes(l));
    for (const loop of resolvedLoops) {
      result.changes.push(`resolved open loop: "${loop}"`);
    }
    result.updated = true;
  }

  // Merge agent handoff data (higher priority)
  if (handoff) {
    if (handoff.objective && handoff.objective !== state.currentObjective) {
      const old = state.currentObjective;
      state.currentObjective = handoff.objective;
      result.changes.push(`objective updated from handoff: "${old}" → "${handoff.objective}"`);
      result.updated = true;
    }

    for (const decision of handoff.decisions) {
      if (!state.importantRecentDecisions.includes(decision)) {
        state.importantRecentDecisions.push(decision);
        result.changes.push(`decision recorded: "${decision}"`);
        result.updated = true;
      }
    }

    for (const loop of handoff.openLoops) {
      if (!state.openLoops.includes(loop)) {
        state.openLoops.push(loop);
        result.changes.push(`open loop added from handoff: "${loop}"`);
        result.updated = true;
      }
    }

    for (const action of handoff.suggestedNextActions) {
      if (!state.nextLikelyActions.includes(action)) {
        state.nextLikelyActions.push(action);
        result.changes.push(`next action added from handoff: "${action}"`);
        result.updated = true;
      }
    }

    for (const completed of handoff.completed) {
      // Remove from open loops if it matches
      const matching = state.openLoops.filter((l) =>
        l.toLowerCase().includes(completed.toLowerCase())
      );
      state.openLoops = state.openLoops.filter((l) => !matching.includes(l));
      if (matching.length > 0) {
        result.changes.push(`completed from handoff: "${completed}"`);
        result.updated = true;
      }
    }
  }

  // Update active threads from activity type
  if (activities.length > 0) {
    const valid = activities
      .map((a) => ({ a, t: new Date(a.occurredAt).getTime() }))
      .filter((x) => !Number.isNaN(x.t));
    const newest = valid.length > 0 ? valid.reduce((best, cur) => (cur.t > best.t ? cur : best)) : undefined;
    if (newest) {
      const thread = typeToThread(newest.a);
      if (thread && !state.activeThreads.includes(thread)) {
        state.activeThreads.unshift(thread);
        if (state.activeThreads.length > 10) state.activeThreads = state.activeThreads.slice(0, 10);
        result.changes.push(`active thread added: "${thread}"`);
        result.updated = true;
      }
    }
  }

  // Update current state from activities
  if (activities.length > 0 && state.currentState === "unknown") {
    state.currentState = "active";
    result.changes.push("current state: unknown → active");
    result.updated = true;
  }

  // ponytail: only mechanical facts auto-update. Subjective fields (purpose, objective)
  // are only updated via explicit handoff — not from git mining alone.

  if (result.updated) {
    writeProjectState(root, state);
  }

  return result;
}

function typeToThread(activity: WorkActivity): string | null {
  switch (activity.type) {
    case "implementation": return `Implementing: ${activity.summary.slice(0, 60)}`;
    case "fix": return `Fixing: ${activity.summary.slice(0, 60)}`;
    case "refactor": return `Refactoring: ${activity.summary.slice(0, 60)}`;
    case "release": return `Releasing: ${activity.summary.slice(0, 60)}`;
    case "documentation": return `Documenting: ${activity.summary.slice(0, 60)}`;
    case "research": return `Researching: ${activity.summary.slice(0, 60)}`;
    default: return null;
  }
}

export function detectProjectMdDrift(root: string): string[] {
  const state = readProjectState(root);
  const issues: string[] = [];

  if (!state.purpose) issues.push("purpose is empty");
  if (!state.currentObjective) issues.push("current objective is missing");
  if (state.currentState === "unknown") issues.push("current state is unknown");
  if (state.lastMeaningfulUpdate) {
    const daysSince = Math.floor(
      (Date.now() - new Date(state.lastMeaningfulUpdate).getTime()) / 86400000
    );
    if (daysSince > 7) issues.push(`last update was ${daysSince}d ago`);
  }

  return issues;
}

import { buildGlobalPresentModel, listRepositories, listActivities } from "./repository-registry.js";
import type { GlobalPresentModel, ProjectSnapshot, WorkActivity } from "./repository-registry.js";
import { listOpenTasks, listTasks } from "./task-store.js";
import type { Task } from "./task-store.js";
import { listReposWithGitHub } from "./github-supplement.js";
import { execSync } from "child_process";

export type RecallIntent =
  | "active_projects"
  | "open_tasks"
  | "project_status"
  | "recent_work"
  | "recent_changes"
  | "what_happened"
  | "general";

export interface RecallResult {
  intent: RecallIntent;
  answer: string;
  data: {
    projects?: ProjectSnapshot[];
    tasks?: Task[];
    activities?: WorkActivity[];
    model?: GlobalPresentModel;
  };
  confidence: "high" | "medium" | "low";
  freshness: string;
}

// ponytail: keyword-based classification, no model needed for 90% of work-state queries
const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: RecallIntent }> = [
  { pattern: /what (am i|are you) (working on|doing)/i, intent: "active_projects" },
  { pattern: /(active|current) projects/i, intent: "active_projects" },
  { pattern: /(my )?(todo|task) list/i, intent: "open_tasks" },
  { pattern: /open (tasks|loops|items)/i, intent: "open_tasks" },
  { pattern: /what('s| is) (open|pending|outstanding)/i, intent: "open_tasks" },
  { pattern: /what (happened|changed) (with|in|on) (\w+)/i, intent: "what_happened" },
  { pattern: /(status|state) of (\w+)/i, intent: "project_status" },
  { pattern: /recent (work|activity|changes)/i, intent: "recent_work" },
  { pattern: /what (changed|did i do) (yesterday|today|recently)/i, intent: "recent_work" },
  { pattern: /what else/i, intent: "active_projects" },
  { pattern: /resume (work|where i was)/i, intent: "active_projects" },
];

export function classifyIntent(query: string): RecallIntent {
  for (const { pattern, intent } of INTENT_PATTERNS) {
    if (pattern.test(query)) return intent;
  }
  return "general";
}

export function recall(intent: RecallIntent, foregroundRoot?: string, projectFilter?: string): RecallResult {
  const model = buildGlobalPresentModel(foregroundRoot);

  switch (intent) {
    case "active_projects": {
      const projects = model.activeProjects
        .filter((p) => !projectFilter || p.repositoryId === projectFilter)
        .slice(0, 10);

      const ghRepos = new Set(listReposWithGitHub().map((r) => r.repoId));

      const lines = projects.map((p) => {
        const dirty = p.dirty ? " [dirty]" : "";
        const taskCount = listOpenTasks(p.repositoryId).length;
        const taskInfo = taskCount > 0 ? ` (${taskCount} open tasks)` : "";
        const ghInfo = ghRepos.has(p.repositoryId) ? " [github]" : "";
        return `${p.name}${dirty}${taskInfo}${ghInfo} — ${p.root}`;
      });

      return {
        intent,
        answer: projects.length > 0
          ? `Active projects:\n${lines.join("\n")}`
          : "No active projects found.",
        data: { projects, model },
        confidence: "high",
        freshness: model.activeProjects[0]?.lastActivityAt ?? "unknown",
      };
    }

    case "open_tasks": {
      const tasks: Task[] = [];
      if (projectFilter) {
        tasks.push(...listOpenTasks(projectFilter));
      } else {
        for (const p of model.activeProjects.slice(0, 10)) {
          tasks.push(...listOpenTasks(p.repositoryId));
        }
      }

      const lines = tasks.map((t) => {
        const priority = t.priority === "high" ? "‼" : t.priority === "low" ? "·" : " ";
        const status = t.status === "blocked" ? "[BLOCKED]" : t.status === "in_progress" ? "[IN PROGRESS]" : "";
        const project = t.projectId ? `(${t.projectId})` : "";
        return `${priority} ${t.description} ${status} ${project}`;
      });

      return {
        intent,
        answer: lines.length > 0
          ? `Open tasks:\n${lines.join("\n")}`
          : "No open tasks.",
        data: { tasks, model },
        confidence: "high",
        freshness: new Date().toISOString(),
      };
    }

    case "project_status": {
      const targetId = projectFilter ?? model.activeProjects[0]?.repositoryId;
      if (!targetId) {
        return { intent, answer: "No project specified or found.", data: { model }, confidence: "low", freshness: "unknown" };
      }

      const project = model.activeProjects.find((p) => p.repositoryId === targetId);
      const activities = listActivities(targetId, 10);
      const tasks = listOpenTasks(targetId);

      const lines: string[] = [];
      if (project) {
        lines.push(`Project: ${project.name} (${project.root})`);
        lines.push(`Branch: ${project.branch ?? "unknown"}`);
        lines.push(`HEAD: ${(project.head ?? "").slice(0, 8)}`);
        lines.push(`Dirty: ${project.dirty ? "yes" : "no"}`);
      }

      if (activities.length > 0) {
        lines.push("\nRecent changes:");
        for (const a of activities.slice(0, 5)) {
          lines.push(`  ${a.type}: ${a.summary.slice(0, 80)}`);
        }
      }

      if (tasks.length > 0) {
        lines.push("\nOpen tasks:");
        for (const t of tasks.slice(0, 10)) {
          lines.push(`  ${t.status}: ${t.description}`);
        }
      }

      return {
        intent,
        answer: lines.join("\n"),
        data: { projects: project ? [project] : [], tasks, activities, model },
        confidence: "high",
        freshness: project?.lastActivityAt ?? "unknown",
      };
    }

    case "recent_work": {
      const activities = listActivities(projectFilter, 15);
      const byProject = new Map<string, WorkActivity[]>();
      for (const a of activities) {
        const list = byProject.get(a.projectId) ?? [];
        list.push(a);
        byProject.set(a.projectId, list);
      }

      const lines: string[] = [];
      for (const [projectId, acts] of byProject) {
        const name = model.activeProjects.find((p) => p.repositoryId === projectId)?.name ?? projectId;
        lines.push(`\n${name}`);
        for (const a of acts.slice(0, 5)) {
          lines.push(`  ${a.type}: ${a.summary.slice(0, 80)}`);
        }
      }

      return {
        intent,
        answer: lines.length > 0 ? `Recent work:${lines.join("\n")}` : "No recent activity.",
        data: { activities, model },
        confidence: "high",
        freshness: activities[0]?.occurredAt ?? "unknown",
      };
    }

    case "what_happened":
    case "recent_changes": {
      const targetId = projectFilter ?? model.activeProjects[0]?.repositoryId;
      const activities = listActivities(targetId, 10);
      const tasks = listOpenTasks(targetId);

      return {
        intent,
        answer: activities.length > 0
          ? `Recent activity: ${activities.map((a) => `${a.type}: ${a.summary}`).join("; ")}`
          : "No recent activity.",
        data: { activities, tasks, model },
        confidence: "high",
        freshness: activities[0]?.occurredAt ?? "unknown",
      };
    }

    default:
      return {
        intent,
        answer: "Work index: use specific queries for projects, tasks, or recent activity.",
        data: { model },
        confidence: "low",
        freshness: "unknown",
      };
  }
}

export function answerQuestion(query: string, foregroundRoot?: string): RecallResult {
  const intent = classifyIntent(query);
  const projectFilter = extractProjectName(query);
  return recall(intent, foregroundRoot, projectFilter);
}

export function deepen(result: RecallResult): string | null {
  if (!result.data.activities || result.data.activities.length === 0) return null;

  const lines: string[] = [];
  for (const activity of result.data.activities.slice(0, 5)) {
    lines.push(`\n--- ${activity.type} | ${activity.occurredAt} ---`);
    lines.push(activity.summary);

    if (activity.commitRefs.length > 0) {
      lines.push(`  commits: ${activity.commitRefs.join(", ")}`);
    }
    if (activity.fileRefs.length > 0) {
      lines.push(`  files: ${activity.fileRefs.slice(0, 10).join(", ")}`);
    }

    // ponytail: fetch actual commit diffs for deep drill-down
    if (activity.commitRefs.length > 0 && result.data.projects?.[0]) {
      const root = result.data.projects[0].root;
      const commitSpec = activity.commitRefs
        .map((r) => r.split(":").pop())
        .filter(Boolean)
        .join("..");

      if (commitSpec) {
        try {
          const diff = execSync(
            `git diff --stat ${commitSpec}`,
            { cwd: root, encoding: "utf8", timeout: 5000 },
          ).trim();
          if (diff) lines.push(`  diff:\n${diff.split("\n").map((l) => `    ${l}`).join("\n")}`);
        } catch { /* git not available */ }
      }
    }
  }

  return lines.join("\n");
}

function extractProjectName(query: string): string | undefined {
  const repos = listRepositories();
  for (const repo of repos) {
    if (query.toLowerCase().includes(repo.name.toLowerCase())) {
      return repo.id;
    }
  }
  return undefined;
}

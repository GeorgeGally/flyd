import { listOpenTasks, addTask, updateTaskStatus, deleteTask, listTasks } from "../work/task-store.js";
import { extractTasksFromAllProjects } from "../work/task-extractor.js";
import { listRepositories, getRepository } from "../work/repository-registry.js";
import { answerQuestion } from "../work/recall-router.js";

export async function runTasksList(): Promise<void> {
  const tasks = listOpenTasks();
  if (tasks.length === 0) {
    console.log("No open tasks.");
    return;
  }

  const byProject = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const key = t.projectId ?? "no-project";
    const list = byProject.get(key) ?? [];
    list.push(t);
    byProject.set(key, list);
  }

  for (const [projectId, projectTasks] of byProject) {
    const repo = projectId !== "no-project" ? getRepository(projectId) : undefined;
    const name = repo?.name ?? projectId;
    console.log(`\n${name}`);
    for (const t of projectTasks) {
      const priority = t.priority === "high" ? "‼" : t.priority === "low" ? "·" : " ";
      const status = t.status === "blocked" ? "[BLOCKED]" : t.status === "in_progress" ? "[→]" : "";
      console.log(`  ${priority} ${t.description} ${status} [${t.id}]`);
    }
  }
}

export async function runTasksAdd(description: string, opts: { project?: string; priority?: string }): Promise<void> {
  let projectId: string | undefined = opts.project;

  if (!projectId) {
    const repos = listRepositories();
    if (repos.length === 1) projectId = repos[0].id;
    else if (repos.length > 0) {
      console.log("Specify --project for multi-repo environments. Available projects:");
      for (const r of repos) console.log(`  ${r.id} — ${r.name}`);
      process.exitCode = 1;
      return;
    }
  }

  const task = addTask({
    projectId,
    description,
    priority: (opts.priority as "high" | "medium" | "low") ?? "medium",
    sourceType: "manual",
  });

  console.log(`Added: ${task.description} (${task.priority})`);
}

export async function runTasksDone(id: string): Promise<void> {
  const ok = updateTaskStatus(id, "done");
  if (ok) {
    console.log(`Task ${id} marked done.`);
  } else {
    console.error(`Task not found: ${id}`);
    process.exitCode = 1;
  }
}

export async function runTasksBlock(id: string): Promise<void> {
  const ok = updateTaskStatus(id, "blocked");
  if (ok) {
    console.log(`Task ${id} marked blocked.`);
  } else {
    console.error(`Task not found: ${id}`);
    process.exitCode = 1;
  }
}

export async function runTasksCancel(id: string): Promise<void> {
  const ok = updateTaskStatus(id, "cancelled");
  if (ok) {
    console.log(`Task ${id} cancelled.`);
  } else {
    console.error(`Task not found: ${id}`);
    process.exitCode = 1;
  }
}

export async function runTasksDelete(id: string): Promise<void> {
  const ok = deleteTask(id);
  if (ok) {
    console.log(`Task ${id} deleted.`);
  } else {
    console.error(`Task not found: ${id}`);
    process.exitCode = 1;
  }
}

export async function runTasksSync(): Promise<void> {
  const results = extractTasksFromAllProjects();
  for (const r of results) {
    console.log(`${r.projectName}: ${r.extracted.length} tasks synced`);
    if (r.nowDone.length > 0) {
      console.log(`  resolved: ${r.nowDone.join(", ")}`);
    }
    if (r.extracted.length === 0) {
      console.log("  no tasks found in PROJECT.md");
    }
  }
}

export async function runWorkStatus(query?: string): Promise<void> {
  const foregroundRoot = process.cwd();
  const result = query
    ? answerQuestion(query, foregroundRoot)
    : answerQuestion("what am I working on", foregroundRoot);

  console.log(result.answer);
}

export async function runTasksAll(): Promise<void> {
  const tasks = listTasks();
  if (tasks.length === 0) {
    console.log("No tasks.");
    return;
  }

  for (const t of tasks) {
    const statusIcon = t.status === "done" ? "✓" : t.status === "blocked" ? "✗" : "○";
    const project = t.projectId ? `[${t.projectId}]` : "";
    console.log(`  ${statusIcon} ${t.description} ${project} (${t.priority}) [${t.id}]`);
  }
}

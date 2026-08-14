import { getDb } from "./database.js";
import { randomUUID } from "crypto";

export interface Task {
  id: string;
  projectId: string | null;
  description: string;
  status: "open" | "in_progress" | "blocked" | "waiting" | "done" | "cancelled";
  priority: "high" | "medium" | "low";
  sourceType: string;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export function listTasks(opts?: {
  projectId?: string;
  status?: Task["status"];
  priority?: Task["priority"];
  limit?: number;
}): Task[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts?.projectId) {
    clauses.push("project_id = ?");
    params.push(opts.projectId);
  }
  if (opts?.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  if (opts?.priority) {
    clauses.push("priority = ?");
    params.push(opts.priority);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = opts?.limit ?? 50;

  const rows = db
    .prepare(
      `SELECT * FROM tasks ${where} ORDER BY priority = 'high' DESC, created_at ASC LIMIT ?`,
    )
    .all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map(mapTaskRow);
}

export function listOpenTasks(projectId?: string): Task[] {
  return listTasks({
    projectId,
    status: "open",
  }).concat(listTasks({ projectId, status: "in_progress" }))
    .concat(listTasks({ projectId, status: "blocked" }));
}

export function addTask(task: {
  projectId?: string;
  description: string;
  priority?: Task["priority"];
  sourceType?: string;
  sourceRef?: string;
}): Task {
  const db = getDb();
  const id = `task-${randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO tasks (id, project_id, description, status, priority, source_type, source_ref, created_at, updated_at)
     VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    task.projectId ?? null,
    task.description,
    task.priority ?? "medium",
    task.sourceType ?? "manual",
    task.sourceRef ?? null,
    now,
    now,
  );

  return {
    id,
    projectId: task.projectId ?? null,
    description: task.description,
    status: "open" as const,
    priority: task.priority ?? "medium",
    sourceType: task.sourceType ?? "manual",
    sourceRef: task.sourceRef ?? null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

export function updateTaskStatus(id: string, status: Task["status"]): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
    )
    .run(status, now, status === "done" ? now : null, id);
  return result.changes > 0;
}

export function upsertTaskByDescription(
  projectId: string,
  description: string,
  sourceType: string,
  sourceRef?: string,
): Task {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM tasks WHERE project_id = ? AND description = ? AND status != 'done'")
    .get(projectId, description) as Record<string, unknown> | undefined;

  if (existing) {
    db.prepare("UPDATE tasks SET updated_at = ?, source_ref = ? WHERE id = ?").run(
      new Date().toISOString(),
      sourceRef ?? existing.source_ref,
      existing.id,
    );
    return mapTaskRow(existing);
  }

  return addTask({ projectId, description, sourceType, sourceRef });
}

export function syncProjectTasks(projectId: string, descriptions: string[]): { nowDone: string[] } {
  const db = getDb();
  
  const result = db.transaction(() => {
    const existing = db
      .prepare("SELECT id, description, source_type FROM tasks WHERE project_id = ? AND status != 'done'")
      .all(projectId) as Array<{ id: string; description: string; source_type: string }>;
    
    const existingDescs = new Set(existing.map((r) => r.description));
    const newDescs = new Set(descriptions);
    const nowDone: string[] = [];
    const now = new Date().toISOString();

    for (const desc of descriptions) {
      if (!existingDescs.has(desc)) {
        const id = `task-${randomUUID()}`;
        db.prepare(
          `INSERT INTO tasks (id, project_id, description, status, priority, source_type, created_at, updated_at)
           VALUES (?, ?, ?, 'open', 'medium', 'project_md', ?, ?)`
        ).run(id, projectId, desc, now, now);
      }
    }

    for (const task of existing) {
      if (task.source_type === "project_md" && !newDescs.has(task.description)) {
        db.prepare(
          "UPDATE tasks SET status = 'done', updated_at = ?, completed_at = ? WHERE id = ?"
        ).run(now, now, task.id);
        nowDone.push(task.description);
      }
    }

    return { nowDone };
  })();

  return result;
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes > 0;
}

function mapTaskRow(r: Record<string, unknown>): Task {
  return {
    id: r.id as string,
    projectId: (r.project_id as string) ?? null,
    description: r.description as string,
    status: r.status as Task["status"],
    priority: (r.priority as Task["priority"]) ?? "medium",
    sourceType: (r.source_type as string) ?? "manual",
    sourceRef: (r.source_ref as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    completedAt: (r.completed_at as string) ?? null,
  };
}

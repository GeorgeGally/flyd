import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { withTransaction } from "./database.js";
import {
  openOperationalDecisions,
  projectOperationalDecisions,
  type OperationalDecision,
  type OperationalDecisionEvent,
} from "./operational-decision.js";

const DECISION_EVENT_TYPES = [
  "decision.opened",
  "decision.resolved",
  "decision.superseded",
  "decision.cancelled",
] as const;

function decisionEvent(row: QueryResultRow): OperationalDecisionEvent {
  return {
    eventType: row.event_type,
    taskId: String(row.agent_task_id),
    occurredAt: new Date(row.occurred_at).toISOString(),
    payload: row.payload ?? {},
  } as OperationalDecisionEvent;
}

export class OperationalDecisionStore {
  constructor(private readonly pool: Pool) {}

  async openDecision(taskKey: string, input: {
    question: string;
    context?: string;
    decisionId?: string;
    idempotencyKey: string;
  }): Promise<OperationalDecision> {
    const question = input.question.trim();
    if (!question) throw new Error("Decision question is required");
    const decisionId = input.decisionId ?? randomUUID();

    await this.append(taskKey, "decision.opened", {
      decision_id: decisionId,
      question,
      context: input.context?.trim() ?? "",
    }, input.idempotencyKey);

    const decision = (await this.listDecisions(taskKey)).find((item) => item.decisionId === decisionId);
    if (!decision) throw new Error(`Decision ${decisionId} was not persisted`);
    return decision;
  }

  async resolveDecision(taskKey: string, decisionId: string, resolution: string, idempotencyKey: string): Promise<OperationalDecision> {
    const value = resolution.trim();
    if (!value) throw new Error("Decision resolution is required");
    await this.requireOpen(taskKey, decisionId);
    await this.append(taskKey, "decision.resolved", { decision_id: decisionId, resolution: value }, idempotencyKey);
    return this.requireDecision(taskKey, decisionId);
  }

  async supersedeDecision(taskKey: string, decisionId: string, supersededBy: string, idempotencyKey: string): Promise<OperationalDecision> {
    if (!supersededBy.trim()) throw new Error("Superseding decision id is required");
    await this.requireOpen(taskKey, decisionId);
    await this.append(taskKey, "decision.superseded", {
      decision_id: decisionId,
      superseded_by: supersededBy.trim(),
    }, idempotencyKey);
    return this.requireDecision(taskKey, decisionId);
  }

  async cancelDecision(taskKey: string, decisionId: string, reason: string | undefined, idempotencyKey: string): Promise<OperationalDecision> {
    await this.requireOpen(taskKey, decisionId);
    await this.append(taskKey, "decision.cancelled", {
      decision_id: decisionId,
      reason: reason?.trim() || undefined,
    }, idempotencyKey);
    return this.requireDecision(taskKey, decisionId);
  }

  async listDecisions(taskKey: string): Promise<OperationalDecision[]> {
    const events = await this.eventsForTask(taskKey);
    return projectOperationalDecisions(events);
  }

  async listOpenDecisions(taskKey?: string): Promise<OperationalDecision[]> {
    const events = taskKey ? await this.eventsForTask(taskKey) : await this.allDecisionEvents();
    return openOperationalDecisions(events);
  }

  private async requireOpen(taskKey: string, decisionId: string): Promise<OperationalDecision> {
    const decision = await this.requireDecision(taskKey, decisionId);
    if (decision.status !== "open") throw new Error(`Decision ${decisionId} is already ${decision.status}`);
    return decision;
  }

  private async requireDecision(taskKey: string, decisionId: string): Promise<OperationalDecision> {
    const decision = (await this.listDecisions(taskKey)).find((item) => item.decisionId === decisionId);
    if (!decision) throw new Error(`Unknown decision ${decisionId}`);
    return decision;
  }

  private async eventsForTask(taskKey: string): Promise<OperationalDecisionEvent[]> {
    const result = await this.pool.query(`SELECT e.* FROM runtime_events e
      JOIN agent_tasks t ON t.id = e.agent_task_id
      WHERE t.task_key = $1 AND e.event_type = ANY($2::varchar[])
      ORDER BY e.occurred_at, e.id`, [taskKey, DECISION_EVENT_TYPES]);
    return result.rows.map(decisionEvent);
  }

  private async allDecisionEvents(): Promise<OperationalDecisionEvent[]> {
    const result = await this.pool.query(`SELECT * FROM runtime_events
      WHERE event_type = ANY($1::varchar[])
      ORDER BY occurred_at, id`, [DECISION_EVENT_TYPES]);
    return result.rows.map(decisionEvent);
  }

  private async append(
    taskKey: string,
    eventType: OperationalDecisionEvent["eventType"],
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [idempotencyKey]);
      const existing = await client.query("SELECT 1 FROM runtime_events WHERE idempotency_key = $1", [idempotencyKey]);
      if (existing.rows[0]) return;

      const task = await this.lockTask(client, taskKey);
      const revision = Number(task.revision) + 1;
      await client.query("UPDATE agent_tasks SET revision = $1, updated_at = NOW() WHERE id = $2", [revision, task.id]);
      await client.query(`INSERT INTO runtime_events
        (agent_task_id, event_key, event_type, idempotency_key, task_revision, payload, occurred_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW(), NOW())`, [
        task.id,
        randomUUID(),
        eventType,
        idempotencyKey,
        revision,
        JSON.stringify(payload),
      ]);
    });
  }

  private async lockTask(client: PoolClient, taskKey: string): Promise<QueryResultRow> {
    const result = await client.query("SELECT * FROM agent_tasks WHERE task_key = $1 FOR UPDATE", [taskKey]);
    if (!result.rows[0]) throw new Error(`Unknown task ${taskKey}`);
    return result.rows[0];
  }
}

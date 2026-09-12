import { getDb } from "../work/database.js";
import type {
  PlanningTrace,
  PredictionOutcome,
  TrajectoryEvent,
  WorldStateSnapshot,
} from "./world-model.js";

function ensureSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS world_state_snapshots (
      id TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      project_id TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_world_state_snapshots_captured ON world_state_snapshots(captured_at);
    CREATE INDEX IF NOT EXISTS idx_world_state_snapshots_project ON world_state_snapshots(project_id);

    CREATE TABLE IF NOT EXISTS trajectory_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      project_id TEXT,
      repository_root TEXT,
      task_id TEXT,
      thread_id TEXT,
      state_before_id TEXT NOT NULL REFERENCES world_state_snapshots(id),
      state_after_id TEXT REFERENCES world_state_snapshots(id),
      outcome TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trajectory_events_occurred ON trajectory_events(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_trajectory_events_project ON trajectory_events(project_id);

    CREATE TABLE IF NOT EXISTS planning_traces (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      snapshot_id TEXT NOT NULL REFERENCES world_state_snapshots(id),
      chosen_action_id TEXT,
      outcome_id TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_planning_traces_created ON planning_traces(created_at);

    CREATE TABLE IF NOT EXISTS prediction_outcomes (
      id TEXT PRIMARY KEY,
      prediction_id TEXT NOT NULL,
      observed_snapshot_id TEXT NOT NULL REFERENCES world_state_snapshots(id),
      category TEXT NOT NULL,
      reconciled_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_prediction ON prediction_outcomes(prediction_id);
  `);
}

export class PlanningStore {
  constructor() { ensureSchema(); }

  saveSnapshot(snapshot: WorldStateSnapshot): void {
    getDb().prepare(`
      INSERT OR REPLACE INTO world_state_snapshots (id, captured_at, project_id, payload)
      VALUES (?, ?, ?, ?)
    `).run(snapshot.id, snapshot.capturedAt, snapshot.projectId ?? null, JSON.stringify(snapshot));
  }

  getSnapshot(id: string): WorldStateSnapshot | null {
    const row = getDb().prepare("SELECT payload FROM world_state_snapshots WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as WorldStateSnapshot : null;
  }

  saveTrajectory(event: TrajectoryEvent): void {
    getDb().prepare(`
      INSERT OR REPLACE INTO trajectory_events
      (id, occurred_at, project_id, repository_root, task_id, thread_id, state_before_id, state_after_id, outcome, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.occurredAt, event.projectId ?? null, event.repositoryRoot ?? null,
      event.taskId ?? null, event.threadId ?? null, event.stateBeforeId, event.stateAfterId ?? null,
      event.outcome, JSON.stringify(event),
    );
  }

  trajectoriesForProject(projectId: string, limit = 100): TrajectoryEvent[] {
    const rows = getDb().prepare(`
      SELECT payload FROM trajectory_events WHERE project_id = ? ORDER BY occurred_at DESC LIMIT ?
    `).all(projectId, limit) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as TrajectoryEvent).reverse();
  }

  saveTrace(trace: PlanningTrace): void {
    getDb().prepare(`
      INSERT OR REPLACE INTO planning_traces (id, created_at, snapshot_id, chosen_action_id, outcome_id, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(trace.id, trace.createdAt, trace.snapshotId, trace.chosenActionId ?? null, trace.outcomeId ?? null, JSON.stringify(trace));
  }

  getTrace(id: string): PlanningTrace | null {
    const row = getDb().prepare("SELECT payload FROM planning_traces WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as PlanningTrace : null;
  }

  savePredictionOutcome(outcome: PredictionOutcome): void {
    getDb().prepare(`
      INSERT OR REPLACE INTO prediction_outcomes
      (id, prediction_id, observed_snapshot_id, category, reconciled_at, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      outcome.id, outcome.predictionId, outcome.observedSnapshotId,
      outcome.category, outcome.reconciledAt, JSON.stringify(outcome),
    );
  }

  calibrationReport(): Array<{ confidence: string; total: number; correct: number; correctRate: number }> {
    const rows = getDb().prepare("SELECT payload FROM prediction_outcomes").all() as Array<{ payload: string }>;
    const buckets = new Map<string, { total: number; correct: number }>();
    for (const row of rows) {
      const outcome = JSON.parse(row.payload) as PredictionOutcome;
      const key = outcome.confidenceAtPrediction.level;
      const bucket = buckets.get(key) ?? { total: 0, correct: 0 };
      bucket.total += 1;
      if (outcome.category === "correct") bucket.correct += 1;
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].map(([confidence, bucket]) => ({
      confidence,
      total: bucket.total,
      correct: bucket.correct,
      correctRate: bucket.total ? bucket.correct / bucket.total : 0,
    }));
  }
}

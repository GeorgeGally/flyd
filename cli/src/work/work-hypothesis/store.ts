import { randomUUID } from "crypto";
import { getDb } from "../database.js";
import type { HypothesisCorrection, WorkHypothesis, WorkThread } from "./types.js";

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapHypothesis(row: Record<string, unknown>): WorkHypothesis {
  return {
    id: row.id as string,
    hypothesisText: row.hypothesis_text as string,
    primaryThreads: parseJson(row.primary_threads as string, []),
    secondaryThreads: parseJson(row.secondary_threads as string, []),
    objective: row.objective ? parseJson(row.objective as string, undefined) : undefined,
    confidence: row.confidence as WorkHypothesis["confidence"],
    uncertainty: parseJson(row.uncertainty as string, []),
    evidenceRefs: parseJson(row.evidence_refs as string, []),
    demotions: parseJson(row.demotions as string, []),
    revisedAt: row.revised_at as string,
    generatedAt: row.generated_at as string,
    fromCache: Boolean(row.from_cache),
  };
}

export function readPresentModel(): WorkHypothesis | null {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM work_hypotheses ORDER BY revised_at DESC LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    return row ? mapHypothesis(row) : null;
  } catch {
    return null;
  }
}

export function writePresentModel(
  hypothesis: Omit<WorkHypothesis, "id"> & { id?: string },
): WorkHypothesis {
  const db = getDb();
  const id = hypothesis.id ?? `wh-${randomUUID().slice(0, 8)}`;
  const record: WorkHypothesis = { ...hypothesis, id };

  db.prepare(
    `INSERT INTO work_hypotheses (
      id, hypothesis_text, primary_threads, secondary_threads, objective,
      confidence, uncertainty, evidence_refs, demotions, revised_at, generated_at, from_cache
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      hypothesis_text = excluded.hypothesis_text,
      primary_threads = excluded.primary_threads,
      secondary_threads = excluded.secondary_threads,
      objective = excluded.objective,
      confidence = excluded.confidence,
      uncertainty = excluded.uncertainty,
      evidence_refs = excluded.evidence_refs,
      demotions = excluded.demotions,
      revised_at = excluded.revised_at,
      generated_at = excluded.generated_at,
      from_cache = excluded.from_cache`,
  ).run(
    id,
    record.hypothesisText,
    JSON.stringify(record.primaryThreads),
    JSON.stringify(record.secondaryThreads),
    record.objective ? JSON.stringify(record.objective) : null,
    record.confidence,
    JSON.stringify(record.uncertainty),
    JSON.stringify(record.evidenceRefs),
    JSON.stringify(record.demotions),
    record.revisedAt,
    record.generatedAt,
    record.fromCache ? 1 : 0,
  );

  return record;
}

export function appendCorrection(correction: Omit<HypothesisCorrection, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
}): HypothesisCorrection {
  const db = getDb();
  const id = correction.id ?? `whc-${randomUUID().slice(0, 8)}`;
  const createdAt = correction.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO work_hypothesis_corrections (id, hypothesis_id, kind, project_name, project_root, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    correction.hypothesisId ?? null,
    correction.kind,
    correction.projectName ?? null,
    correction.projectRoot ?? null,
    correction.text,
    createdAt,
  );
  return {
    id,
    hypothesisId: correction.hypothesisId,
    kind: correction.kind,
    projectName: correction.projectName,
    projectRoot: correction.projectRoot,
    text: correction.text,
    createdAt,
  };
}

export function listCorrections(limit = 50): HypothesisCorrection[] {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM work_hypothesis_corrections ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      hypothesisId: (r.hypothesis_id as string) || undefined,
      kind: r.kind as HypothesisCorrection["kind"],
      projectName: (r.project_name as string) || undefined,
      projectRoot: (r.project_root as string) || undefined,
      text: r.text as string,
      createdAt: r.created_at as string,
    }));
  } catch {
    return [];
  }
}

export function activeDemotions(): string[] {
  const corrections = listCorrections(100);
  const demoted = new Set<string>();
  // Latest correction per project wins (list is newest-first)
  const seen = new Set<string>();
  for (const c of corrections) {
    const key = (c.projectName ?? c.projectRoot ?? "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (c.kind === "demote" || c.kind === "exclude") demoted.add(c.projectName ?? key);
    if (c.kind === "reaffirm" || c.kind === "promote") demoted.delete(c.projectName ?? key);
  }
  return [...demoted];
}

export function projectHypothesisLine(h: WorkHypothesis | null): string {
  if (!h) return "  Current work: unknown — no integrity evidence yet.";
  if (!h.primaryThreads.length && !h.secondaryThreads.length) {
    return `  ${h.hypothesisText || "Current work: gap — no admitted activity threads."}`;
  }
  return `  ${h.hypothesisText}`;
}

export function evidenceFingerprint(threads: WorkThread[], demotions: string[]): string {
  const parts = [
    ...threads.map((t) => `${t.name}:${t.lastCommitAt ?? ""}:${t.demoted ? "d" : ""}`),
    ...demotions.map((d) => `demote:${d}`),
  ];
  return parts.join("|");
}

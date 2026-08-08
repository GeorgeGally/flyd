import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  Commitment,
  CommitmentKind,
  CommitmentStatus,
  EvidenceRef,
  EntityRef,
} from "./types.js";

const ATTENTION_DIR = join(homedir(), ".flyd", "attention");
const COMMITMENTS_DIR = join(ATTENTION_DIR, "commitments");

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function filePath(id: string): string {
  return join(COMMITMENTS_DIR, `${id}.json`);
}

function writeCommitment(commitment: Commitment): void {
  ensureDir(COMMITMENTS_DIR);
  writeFileSync(filePath(commitment.id), JSON.stringify(commitment, null, 2), "utf8");
}

export class CommitmentStore {
  private cache: Map<string, Commitment> = new Map();
  private loaded = false;

  private loadAll(): void {
    if (this.loaded) return;
    this.loaded = true;
    ensureDir(COMMITMENTS_DIR);
    for (const entry of readdirSync(COMMITMENTS_DIR)) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = readFileSync(join(COMMITMENTS_DIR, entry), "utf8");
        const c = JSON.parse(raw) as Commitment;
        this.cache.set(c.id, c);
      } catch {
        // corrupt file — skip
      }
    }
  }

  create(params: {
    kind: CommitmentKind;
    title: string;
    owner?: EntityRef;
    beneficiary?: EntityRef;
    project?: EntityRef;
    dueAt?: string;
    status?: CommitmentStatus;
    consequence?: string;
    confidence?: number;
    sourceEvidence?: EvidenceRef[];
    nextCheckAt?: string;
  }): Commitment {
    this.loadAll();
    const now = new Date().toISOString();
    const commitment: Commitment = {
      id: randomUUID(),
      kind: params.kind,
      title: params.title,
      owner: params.owner ?? { id: "user", kind: "person", label: "George" },
      beneficiary: params.beneficiary,
      project: params.project,
      createdAt: now,
      dueAt: params.dueAt,
      status: params.status ?? "open",
      consequence: params.consequence,
      confidence: params.confidence ?? 0.5,
      sourceEvidence: params.sourceEvidence ?? [],
      lastVerifiedAt: now,
      nextCheckAt: params.nextCheckAt,
    };
    this.cache.set(commitment.id, commitment);
    writeCommitment(commitment);
    return commitment;
  }

  get(id: string): Commitment | undefined {
    this.loadAll();
    return this.cache.get(id);
  }

  update(id: string, patch: Partial<Pick<Commitment, "status" | "title" | "dueAt" | "consequence" | "confidence" | "nextCheckAt" | "lastVerifiedAt" | "completionEvidence" | "beneficiary" | "project">>): Commitment | undefined {
    this.loadAll();
    const existing = this.cache.get(id);
    if (!existing) return undefined;
    const updated: Commitment = {
      ...existing,
      ...patch,
      lastVerifiedAt: new Date().toISOString(),
    };
    if (updated.status === "done" || updated.status === "cancelled") {
      updated.nextCheckAt = undefined;
    }
    this.cache.set(id, updated);
    writeCommitment(updated);
    return updated;
  }

  addEvidence(id: string, evidence: EvidenceRef): Commitment | undefined {
    this.loadAll();
    const existing = this.cache.get(id);
    if (!existing) return undefined;
    const updated: Commitment = {
      ...existing,
      sourceEvidence: [...existing.sourceEvidence, evidence],
      lastVerifiedAt: new Date().toISOString(),
    };
    this.cache.set(id, updated);
    writeCommitment(updated);
    return updated;
  }

  addCompletionEvidence(id: string, evidence: EvidenceRef): Commitment | undefined {
    this.loadAll();
    const existing = this.cache.get(id);
    if (!existing) return undefined;
    const updated: Commitment = {
      ...existing,
      completionEvidence: [...(existing.completionEvidence ?? []), evidence],
      lastVerifiedAt: new Date().toISOString(),
    };
    this.cache.set(id, updated);
    writeCommitment(updated);
    return updated;
  }

  delete(id: string): boolean {
    this.loadAll();
    const existed = this.cache.delete(id);
    if (existed) {
      try { unlinkSync(filePath(id)); } catch { /* ok */ }
    }
    return existed;
  }

  list(filter?: { status?: CommitmentStatus[]; kind?: CommitmentKind[]; projectId?: string; ownerId?: string }): Commitment[] {
    this.loadAll();
    let results = [...this.cache.values()];
    if (filter?.status) {
      const statuses = new Set(filter.status);
      results = results.filter((c) => statuses.has(c.status));
    }
    if (filter?.kind) {
      const kinds = new Set(filter.kind);
      results = results.filter((c) => kinds.has(c.kind));
    }
    if (filter?.projectId) {
      results = results.filter((c) => c.project?.id === filter.projectId);
    }
    if (filter?.ownerId) {
      results = results.filter((c) => c.owner.id === filter.ownerId);
    }
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  findOverdue(): Commitment[] {
    this.loadAll();
    const now = Date.now();
    return [...this.cache.values()].filter((c) => {
      if (!c.dueAt || c.status === "done" || c.status === "cancelled" || c.status === "expired") return false;
      return new Date(c.dueAt).getTime() < now;
    });
  }

  findLowConfidence(threshold = 0.5): Commitment[] {
    this.loadAll();
    return [...this.cache.values()].filter((c) => c.confidence < threshold && c.status === "proposed");
  }

  findBlocked(): Commitment[] {
    this.loadAll();
    return [...this.cache.values()].filter((c) => c.status === "blocked");
  }

  findDueSoon(withinHours = 24): Commitment[] {
    this.loadAll();
    const now = Date.now();
    const deadline = now + withinHours * 60 * 60 * 1000;
    return [...this.cache.values()].filter((c) => {
      if (!c.dueAt || c.status === "done" || c.status === "cancelled" || c.status === "expired") return false;
      const due = new Date(c.dueAt).getTime();
      return due > now && due <= deadline;
    });
  }

  findByIds(ids: string[]): Commitment[] {
    this.loadAll();
    return ids.map((id) => this.cache.get(id)).filter((c): c is Commitment => c !== undefined);
  }

  merge(primaryId: string, duplicateId: string): Commitment | undefined {
    this.loadAll();
    const primary = this.cache.get(primaryId);
    const duplicate = this.cache.get(duplicateId);
    if (!primary || !duplicate) return undefined;
    const merged: Commitment = {
      ...primary,
      sourceEvidence: [
        ...primary.sourceEvidence,
        ...duplicate.sourceEvidence,
      ],
      completionEvidence: [
        ...(primary.completionEvidence ?? []),
        ...(duplicate.completionEvidence ?? []),
      ],
      confidence: Math.min(1, (primary.confidence + duplicate.confidence) / 2 + 0.1),
      lastVerifiedAt: new Date().toISOString(),
    };
    this.cache.set(primaryId, merged);
    writeCommitment(merged);
    this.delete(duplicateId);
    return merged;
  }

  get all(): Commitment[] {
    this.loadAll();
    return [...this.cache.values()];
  }

  clear(): void {
    this.cache.clear();
    this.loaded = true;
  }
}

export const commitmentStore = new CommitmentStore();

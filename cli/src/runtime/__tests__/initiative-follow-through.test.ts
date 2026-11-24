import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Project } from "../../council/projects.js";
import type { Edition } from "../../council/scout.js";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import {
  INITIATIVE_CURATED_CONTRACT, INITIATIVE_PUBLIC_RESEARCH_CONTRACT,
  INITIATIVE_MANDATE_CONTRACT, SourceContractRegistry,
} from "../../intelligence/sensors/source-contracts.js";
import { deriveInitiatives, initiativeRevision } from "../initiative/candidates.js";
import { acceptReadOnlyInitiativeMandate, currentReadOnlyMandate } from "../initiative/mandate.js";
import { runInitiativeFollowThrough, reconcileInitiativeObjectives } from "../initiative/follow-through.js";
import { listObjectives } from "../../command/cos/objectives.js";

const now = new Date("2026-11-23T12:00:00Z");
const project: Project = {
  id: "flyd-tech", name: "Visual Graph Rendering Lab", what: "Graph engine with visual types",
  kind: "product", status: "active", now: "Evaluating graph renderers",
  people: [], repos: [], updated: "2026-11-23",
};
const edition: Edition = {
  date: "2026-11-23", generatedAt: now.toISOString(), topics: ["graphics"],
  items: [
    { n: 1, title: "Graph shader particles for visual type rendering",
      url: "https://example.org/graph-shader", source: "Public Engine",
      why: "Graph shader particles support visual type rendering",
      topic: "graphics", kind: "relevant" },
  ],
};
const dirs: string[] = [];
afterEach(() => { dirs.forEach(x => rmSync(x, { recursive: true, force: true })); dirs.length = 0; });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "flyd-cos-init-")); dirs.push(dir);
  const db = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
  const registry = new SourceContractRegistry({ path: join(dir, "source-consents.json") });
  for (const contract of [
    INITIATIVE_CURATED_CONTRACT, INITIATIVE_PUBLIC_RESEARCH_CONTRACT, INITIATIVE_MANDATE_CONTRACT,
  ]) { registry.register(contract); registry.setStatus(contract.sourceId, "enabled"); }
  const candidate = deriveInitiatives({ now, projects: [project], edition }).find(c => c.origin === "scout");
  if (!candidate) throw new Error("Creative fixture must form one grounded idea");
  const receipt = db.append({
    pathKind: "executive", kind: "inferred_belief", sourceId: INITIATIVE_CURATED_CONTRACT.sourceId,
    consent: { grantedAt: now.toISOString(), scopes: ["initiative.curated"] },
    retentionClass: "local_default", payloadClassification: "personal",
    provenance: "test:sourced-public-research", idempotencyKey: "research:1",
    payload: {
      type: "investigation", candidate_id: candidate.id,
      source_revision: initiativeRevision(candidate.sources),
      epistemic_status: "source_confirmed", verified: false,
      sources: candidate.sources.map(s => ({ ...s })),
      evidence: [
        { url: "https://example.org/a", host: "example.org" },
        { url: "https://reference.example.net/b", host: "reference.example.net" },
      ],
    },
  })!;
  const current = () => ({ projects: [project], edition, advisories: [], reports: [] });
  return { dir, db, registry, candidate, receipt, current };
}

describe("v10 accepted CoS research follow-through", () => {
  it("rejects fabricated mandates and does not accept requests inferred from an idea", () => {
    const { db, registry } = fixture();
    try {
      expect(() => acceptReadOnlyInitiativeMandate(db, project,
        { explicitUserAction: false as true, now, registry })).toThrow(/infer authorization/);
      expect(currentReadOnlyMandate(db, project, now)).toBeNull();
    } finally { db.close(); }
  });

  it("holds an interesting finding unless a specific project was explicitly authorized", async () => {
    const { db, registry, dir, current } = fixture();
    try {
      const result = await runInitiativeFollowThrough({
        store: db, registry, now: () => now, objectiveDir: dir,
        projects: () => [project], current, cosEnabled: () => true,
      });
      expect(result).toMatchObject({ reviewed: 1, accepted: 0, reported: 0 });
      expect(listObjectives(dir)).toEqual([]);
    } finally { db.close(); }
  });

  it("can report one genuine accepted read-only result through durable CoS, without launching workers", async () => {
    const { db, registry, dir, candidate, current } = fixture();
    try {
      const mandate = acceptReadOnlyInitiativeMandate(db, project, { explicitUserAction: true, now, registry });
      expect(currentReadOnlyMandate(db, project, now)?.mandateId).toBe(mandate.mandateId);
      const reportCard = vi.fn();
      const deps = { store: db, registry, now: () => now,
        objectiveDir: dir, projects: () => [project], current,
        cosEnabled: () => true, on: true, countPublished: () => 0,
        record: reportCard, seen: () => false };
      const result = await runInitiativeFollowThrough(deps);
      expect(result).toMatchObject({ reviewed: 1, accepted: 1, reported: 1, published: 1 });
      const objectives = listObjectives(dir);
      expect(objectives).toHaveLength(1);
      expect(objectives[0]?.origin.surface).toBe("initiative");
      expect(objectives[0]?.status).toBe("done");
      expect(objectives[0]?.initiative?.candidateId).toBe(candidate.id);
      expect(objectives[0]?.initiative?.mandateEventId).toBe(mandate.sourceEventId);
      expect(objectives[0]?.runs).toEqual([]);
      const reports = db.readSourcePage("cos.report", { limit: 10 });
      expect(reports).toHaveLength(1);
      expect(JSON.stringify(reports[0]?.payload)).toContain("not proof of improvement");
      expect(reportCard).toHaveBeenCalledTimes(1);
      const again = await runInitiativeFollowThrough({ ...deps, on: false });
      expect(again.accepted).toBe(0);
      expect(again.reported).toBe(0);
      expect(listObjectives(dir)).toHaveLength(1);
      expect(db.readSourcePage("cos.report", { limit: 10 })).toHaveLength(1);
    } finally { db.close(); }
  });

  it("scrubs separately stored CoS objective text after evidence or mandate disappears", async () => {
    const { db, registry, dir, current } = fixture();
    try {
      acceptReadOnlyInitiativeMandate(db, project, { explicitUserAction: true, now, registry });
      const deps = { store: db, registry, now: () => now,
        objectiveDir: dir, projects: () => [project], current, cosEnabled: () => true,
        on: false };
      expect((await runInitiativeFollowThrough(deps)).reported).toBe(1);
      expect(listObjectives(dir)[0]?.initiative).toBeTruthy();
      expect(reconcileInitiativeObjectives(deps)).toBe(0);
      registry.setStatus(INITIATIVE_MANDATE_CONTRACT.sourceId, "revoked");
      expect(reconcileInitiativeObjectives(deps)).toBe(1);
      const scrubbed = listObjectives(dir)[0]!;
      expect(scrubbed.status).toBe("cancelled");
      expect(scrubbed.initiative).toBeUndefined();
      expect(scrubbed.words).toBe("(revoked)");
      expect(scrubbed.contextRefs).toEqual([]);
      expect(scrubbed.project).toBeUndefined();
      expect(reconcileInitiativeObjectives(deps)).toBe(0);
    } finally { db.close(); }
  });

  it("an expired, withdrawn or changed-target mandate cannot become a CoS objective", async () => {
    const { db, registry, dir, current } = fixture();
    try {
      acceptReadOnlyInitiativeMandate(db, project,
        { explicitUserAction: true, now, ttlMs: 1_000, registry });
      const late = await runInitiativeFollowThrough({
        store: db, registry, now: () => new Date(now.getTime() + 2_000),
        objectiveDir: dir, projects: () => [project], current, cosEnabled: () => true,
      });
      expect(late.accepted).toBe(0);
      acceptReadOnlyInitiativeMandate(db, project, { explicitUserAction: true, now, registry });
      const changed = await runInitiativeFollowThrough({
        store: db, registry, now: () => now, objectiveDir: dir,
        projects: () => [{ ...project, now: "changed goal" }],
        current: () => ({ ...current(), projects: [{ ...project, now: "changed goal" }] }),
        cosEnabled: () => true,
      });
      expect(changed.accepted).toBe(0);
      registry.setStatus(INITIATIVE_MANDATE_CONTRACT.sourceId, "revoked");
      const revoked = await runInitiativeFollowThrough({
        store: db, registry, now: () => now, objectiveDir: dir,
        projects: () => [project], current, cosEnabled: () => true,
      });
      expect(revoked.accepted).toBe(0);
      expect(listObjectives(dir)).toEqual([]);
    } finally { db.close(); }
  });
});

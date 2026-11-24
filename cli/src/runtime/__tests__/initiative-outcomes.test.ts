import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { INITIATIVE_CURATED_CONTRACT, SourceContractRegistry } from "../../intelligence/sensors/source-contracts.js";
import {
  initiativeReviews, initiativeOutcomeProjection, recordInitiativeReview,
  summarizeInitiativeOutcomes, projectInitiativeQuietUntil,
} from "../initiative/outcomes.js";

const baseNow = new Date("2026-11-23T12:00:00Z");
const candidateId = "c".repeat(24);
const dirs: string[] = [];
afterEach(() => { dirs.forEach(p => rmSync(p, { recursive: true, force: true })); dirs.length = 0; });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "flyd-outcomes-")); dirs.push(dir);
  const store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
  const registry = new SourceContractRegistry({ path: join(dir, "consents.json") });
  registry.register(INITIATIVE_CURATED_CONTRACT);
  registry.setStatus(INITIATIVE_CURATED_CONTRACT.sourceId, "enabled");
  const activityPath = join(dir, "activity", "records.jsonl");
  mkdirSync(dirname(activityPath), { recursive: true });
  const evidence = store.append({
    pathKind: "executive", kind: "inferred_belief", sourceId: INITIATIVE_CURATED_CONTRACT.sourceId,
    consent: { grantedAt: baseNow.toISOString(), scopes: [INITIATIVE_CURATED_CONTRACT.sourceId] },
    retentionClass: "local_default", payloadClassification: "personal",
    provenance: "test:research", idempotencyKey: "test:research:" + candidateId,
    payload: {
      type: "investigation", candidate_id: candidateId, epistemic_status: "source_confirmed",
      research_calls: 1, sources: [{ id: "project:visual", scope: "local_operational",
        revision: "current", evidenceRef: "project:visual" }],
    },
  })!;
  const card = { key: "initiative:research:" + candidateId + ":current",
    kind: "noted", state: "done", title: "Public research", at: baseNow.toISOString() };
  appendFileSync(activityPath, JSON.stringify(card) + "\n");
  return { dir, store, registry, activityPath, evidence };
}

describe("initiative learning truth", () => {
  it("a prepared source-backed insight can receive explicit reviews, but this is never verified impact", () => {
    const { store, registry, activityPath } = fixture();
    try {
      const common = { store, registry, candidateId, now: baseNow, activityPath,
        currentSources: () => true };
      expect(recordInitiativeReview({ ...common, verdict: "helpful" })).toBe("recorded");
      expect(recordInitiativeReview({ ...common, verdict: "helpful" })).toBe("already_recorded");
      const projection = summarizeInitiativeOutcomes(store.readSourcePage("initiative.curated", { limit: 100 }));
      expect(projection).toMatchObject({
        candidatesWithResearch: 1, independentlyCorroboratedPublicTopics: 1,
        explicitHelpfulReviews: 1, verifiedExternalImpact: 0, unknownExternalImpact: 1,
      });
      expect(recordInitiativeReview({ ...common, verdict: "not_helpful" })).toBe("recorded");
      const events = store.readSourcePage("initiative.curated", { limit: 100 });
      expect(initiativeReviews(events).get(candidateId)?.verdict).toBe("not_helpful");
      const items = initiativeOutcomeProjection(events);
      expect(items[0]).toMatchObject({ reviewed: "not_helpful", verifiedExternalImpact: false, delivery: "unknown" });
    } finally { store.close(); }
  });

  it("no consent, missing artifact or revoked parent denies review, rather than fabricating a vote", () => {
    const { store, registry, activityPath } = fixture();
    try {
      const data = { store, registry, candidateId, verdict: "helpful" as const,
        now: baseNow, activityPath, currentSources: () => true };
      expect(recordInitiativeReview({ ...data, currentSources: () => false })).toBe("not_eligible");
      expect(recordInitiativeReview({ ...data, activityPath: join(dirname(activityPath), "missing.jsonl") })).toBe("not_eligible");
      registry.setStatus(INITIATIVE_CURATED_CONTRACT.sourceId, "revoked");
      expect(recordInitiativeReview(data)).toBe("not_eligible");
    } finally { store.close(); }
  });

  it("three separate explicitly negative project reviews quiet only that project for seven days", () => {
    const { store } = fixture();
    try {
      for (let i = 0; i < 3; i++) store.append({
        pathKind: "interface", kind: "observation", sourceId: "initiative.curated",
        consent: { grantedAt: new Date().toISOString(), scopes: ["initiative.curated"] },
        retentionClass: "local_default", payloadClassification: "operational",
        provenance: "test:explicit-user-review", idempotencyKey: "manual-negative:" + i,
        payload: {
          type: "initiative_review", candidate_id: String(i).repeat(24),
          verdict: "not_helpful", effect: "unknown",
          source_keys: ["project:visual"],
          sources: [{ id: "project:visual", scope: "local_operational",
            revision: "current", evidenceRef: "project:visual" }],
        },
      });
      const events = store.readSource("initiative.curated");
      const tomorrow = new Date(Date.now() + 1_000);
      expect(projectInitiativeQuietUntil(events, "visual", tomorrow)).not.toBeNull();
      expect(projectInitiativeQuietUntil(events, "another", tomorrow)).toBeNull();
      expect(projectInitiativeQuietUntil(events, "visual", new Date(Date.now() + 8 * 86_400_000))).toBeNull();
      expect(summarizeInitiativeOutcomes(events).verifiedExternalImpact).toBe(0);
    } finally { store.close(); }
  });

  it("user feedback is erased with the initiative source, and a newly consented generation does not revive it", () => {
    const { store, registry, activityPath } = fixture();
    try {
      const data = { store, registry, candidateId, verdict: "helpful" as const,
        now: baseNow, activityPath, currentSources: () => true };
      expect(recordInitiativeReview(data)).toBe("recorded");
      store.eraseSource("initiative.curated");
      expect(initiativeReviews(store.readSource("initiative.curated")).size).toBe(0);
      expect(JSON.stringify(store.readSource("initiative.curated"))).not.toContain('"helpful"');
      store.renewSource("initiative.curated");
      registry.setStatus("initiative.curated", "enabled");
      // The required source-backed result is gone, so an old card cannot
      // trigger a second review or resurrect feedback.
      expect(recordInitiativeReview(data)).toBe("not_eligible");
    } finally { store.close(); }
  });
});

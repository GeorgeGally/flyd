import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvidenceBundle } from "../../evidence/types.js";
import type { Project } from "../../council/projects.js";
import type { Edition } from "../../council/scout.js";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { INITIATIVE_CURATED_CONTRACT, INITIATIVE_PUBLIC_RESEARCH_CONTRACT, SourceContractRegistry } from "../../intelligence/sensors/source-contracts.js";
import { deriveInitiatives, type InitiativeCandidate } from "../initiative/candidates.js";
import { localDay } from "../../council/memory-store.js";
import { publicResearchInput, researchInitiative, safePublicLocator, type InitiativeResearchReceipt } from "../initiative/research.js";
import { runInitiativeResearchCycle } from "../initiative/research-cycle.js";

const now = new Date();
const project: Project = {
  id: "visual-work", name: "Interactive Typography Studio", what: "Creative code for interactive typography",
  kind: "creative", status: "active", now: "Testing interactive animation",
  people: [], repos: [], updated: localDay(now),
};
const edition: Edition = {
  date: localDay(now), generatedAt: now.toISOString(), topics: ["creative tools"],
  items: [
    { n: 1, title: "Particle arrays for interactive typography and rendering",
      why: "Uses particle simulation in interactive type design",
      url: "https://example.org/particle-typography", source: "Open Tools",
      topic: "creative code", kind: "relevant" },
  ],
};
const dirs: string[] = [];
afterEach(() => { for (const path of dirs) rmSync(path, { recursive: true, force: true }); dirs.length = 0; });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "flyd-initiative-research-")); dirs.push(dir);
  const db = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
  const registry = new SourceContractRegistry({ path: join(dir, "source-consents.json") });
  registry.register(INITIATIVE_CURATED_CONTRACT);
  registry.register(INITIATIVE_PUBLIC_RESEARCH_CONTRACT);
  registry.setStatus(INITIATIVE_CURATED_CONTRACT.sourceId, "enabled");
  registry.setStatus(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId, "enabled");
  return { dir, db, registry };
}
function candidate(): InitiativeCandidate {
  const result = deriveInitiatives({ now, projects: [project], edition });
  const found = result.find(row => row.origin === "scout");
  if (!found) throw new Error("fixture did not produce an initiative candidate");
  return found;
}
function bundle(n: number): EvidenceBundle {
  return {
    query: edition.items[0]!.title,
    plan: { query: edition.items[0]!.title, depth: "quick", intent: "factual",
      sourceWeights: {}, subqueries: [], maxResults: 3, maxPerStream: 3 },
    generatedAt: now.toISOString(), intent: "factual", clusters: [], conflicts: [], gaps: [],
    capabilityHealth: [],
    evidence: Array.from({ length: n }, (_, i) => ({
      id: "public-" + i, capability: "web", backend: "test", kind: "reference",
      title: "Particle arrays for interactive typography and rendering",
      content: i === 0
        ? "Particle arrays for interactive typography and rendering work in a documented shader pipeline."
        : "Particle arrays for interactive typography and rendering are also explained in independent tutorials.",
      locator: i === 0 ? "https://example.org/particle-typography" : "https://docs.example.net/particles",
      sourceItemId: "s" + i, retrievedAt: now.toISOString(), queryLabel: "main",
      nativeRank: i, localRelevance: 1, freshness: 1, sourceQuality: 1,
      provenance: [{ capability: "web", backend: "test", queryLabel: "main",
        nativeRank: i, sourceItemId: "s" + i, locator: i === 0
          ? "https://example.org/particle-typography" : "https://docs.example.net/particles" }],
    })),
  } as unknown as EvidenceBundle;
}
function researchReceipt(c: InitiativeCandidate): InitiativeResearchReceipt {
  return {
    candidateId: c.id, sourceRevision: "fixture",
    policyVersion: "initiative.research.v1", status: "source_confirmed",
    checkedClaim: "What does the public article document?",
    finding: "The public technique is independently described; benefits for the private project remain unverified.",
    citedEvidence: [
      { id: "public-1", url: "https://example.org/a", title: "Particles", host: "example.org" },
      { id: "public-2", url: "https://example.net/b", title: "Particles", host: "example.net" },
    ],
    counterEvidence: [], gaps: [], searchedAt: now.toISOString(),
    researchCalls: 1, elapsedMs: 5, stopReason: "public_topic_correlated",
    privateComparisonNeeded: true,
  };
}

describe("v10 independently checked public research", () => {
  it("rejects internal URLs, credentials, localhost, plain HTTP and unsafe public titles", () => {
    expect(safePublicLocator("http://example.org")).toBeNull();
    expect(safePublicLocator("https://127.0.0.1/test")).toBeNull();
    expect(safePublicLocator("https://user:pass@example.org")).toBeNull();
    expect(safePublicLocator("https://example.org/?api_key=private")).toBeNull();
    expect(safePublicLocator("https://example.org/?page=2")).toBeTruthy();
    expect(safePublicLocator("https://intranet.local/a")).toBeNull();
    expect(safePublicLocator("https://example.org/x")).toBeTruthy();
    expect(publicResearchInput({ ...candidate(), subject: "Particle arrays" }, edition)).toBeNull();
  });

  it("never puts private project details into the public EvidenceEngine query", async () => {
    const { db, registry } = fixture();
    try {
      const e = vi.fn(async (_query: string, _depth: unknown, _opts: unknown) => bundle(2));
      const item = candidate();
      const result = await researchInitiative(item, edition, {
        registry, now: () => now, engine: { research: e } as never,
      });
      expect(result.status).toBe("source_confirmed");
      expect(result.citedEvidence).toHaveLength(2);
      expect(result.privateComparisonNeeded).toBe(true);
      expect(e).toHaveBeenCalledTimes(1);
      const [query, depth, options] = e.mock.calls[0]!;
      expect(query).toBe(edition.items[0]!.title);
      expect(query).not.toContain(project.name);
      expect(JSON.stringify(options)).not.toContain(project.what);
      expect(depth).toBe("quick");
      expect(result.finding).toContain("NOT been demonstrated");
    } finally { db.close(); }
  });

  it("does not call syndicated copies on two hosts independent corroboration", async () => {
    const { db, registry } = fixture();
    try {
      const repeated = bundle(2);
      repeated.evidence[1]!.title = repeated.evidence[0]!.title;
      repeated.evidence[1]!.content = repeated.evidence[0]!.content;
      const receipt = await researchInitiative(candidate(), edition, {
        registry, now: () => now, engine: { research: vi.fn(async () => repeated) } as never,
      });
      expect(receipt.status).toBe("inconclusive");
      expect(receipt.citedEvidence).toHaveLength(1);
    } finally { db.close(); }
  });

  it("checks contradictory public evidence even in the quick research depth", async () => {
    const { db, registry } = fixture();
    try {
      const conflicting = bundle(2);
      conflicting.evidence[0]!.content =
        "Particle arrays for interactive typography and rendering support shader animation.";
      conflicting.evidence[1]!.content =
        "Particle arrays for interactive typography and rendering do not support shader animation.";
      const receipt = await researchInitiative(candidate(), edition, {
        registry, now: () => now, engine: { research: vi.fn(async () => conflicting) } as never,
      });
      expect(receipt.status).toBe("contradictory");
      expect(receipt.counterEvidence.length).toBeGreaterThan(0);
    } finally { db.close(); }
  });

  it("does not fetch a single byte without the separate public research grant", async () => {
    const { db, registry } = fixture();
    try {
      registry.setStatus(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId, "disabled");
      const e = vi.fn(async () => bundle(2));
      const result = await researchInitiative(candidate(), edition, {
        registry, now: () => now, engine: { research: e } as never,
      });
      expect(result).toMatchObject({ status: "not_permitted", researchCalls: 0 });
      expect(e).not.toHaveBeenCalled();
    } finally { db.close(); }
  });

  it("discards evidence after consent is revoked during the public fetch", async () => {
    const { db, registry } = fixture();
    try {
      const e = vi.fn(async () => {
        registry.setStatus(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId, "revoked");
        return bundle(2);
      });
      const result = await researchInitiative(candidate(), edition, {
        registry, now: () => now, engine: { research: e } as never,
      });
      expect(result.status).toBe("not_permitted");
      expect(result.citedEvidence).toHaveLength(0);
    } finally { db.close(); }
  });


  it("observes a revocation by another registry while public retrieval is in flight", async () => {
    const { db, registry, dir } = fixture();
    try {
      const otherProcess = new SourceContractRegistry({ path: join(dir, "source-consents.json") });
      const engine = vi.fn(async () => {
        otherProcess.setStatus(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId, "revoked");
        return bundle(2);
      });
      const result = await researchInitiative(candidate(), edition, {
        registry, now: () => now, engine: { research: engine } as never,
      });
      expect(engine).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("not_permitted");
      expect(result.citedEvidence).toEqual([]);
    } finally { db.close(); }
  });

  it("returns inconclusive rather than fabricated verification for one source", async () => {
    const { db, registry } = fixture();
    try {
      const result = await researchInitiative(candidate(), edition, {
        registry, now: () => now,
        engine: { research: vi.fn(async () => bundle(1)) } as never,
      });
      expect(result.status).toBe("inconclusive");
      expect(result.finding).toContain("insufficient");
    } finally { db.close(); }
  });

  it("one public investigation survives repeated ticks and two live store handles without duplicate network calls", async () => {
    const { dir, db, registry } = fixture();
    const other = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
    const calls = vi.fn(async (item: InitiativeCandidate) => researchReceipt(item));
    const deps = {
      now: () => now, registry,
      projects: () => [project], edition: () => edition, advisories: () => [],
      perform: calls, on: true, countPublished: () => 0,
      record: vi.fn(), seen: () => false,
    };
    try {
      const first = await runInitiativeResearchCycle({ ...deps, store: db });
      expect(first.attempted).toBe(1);
      expect(first.confirmed).toBe(1);
      expect(first.published).toBe(1);
      const second = await runInitiativeResearchCycle({ ...deps, store: other });
      expect(second.attempted).toBe(0);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(db.readSource("initiative.curated").filter(e => e.payload?.type === "research_claim")).toHaveLength(1);
      expect(db.readSource("initiative.curated").filter(e => e.kind === "inferred_belief")).toHaveLength(1);
    } finally { other.close(); db.close(); }
  });

  it("a changed private project prevents publishing the stale fetched research", async () => {
    const { db, registry } = fixture();
    let live: Project = project;
    const cards = vi.fn();
    const perform = vi.fn(async (item: InitiativeCandidate) => {
      live = { ...project, now: "Completely different and newly verified state" };
      return researchReceipt(item);
    });
    try {
      const result = await runInitiativeResearchCycle({
        store: db, now: () => now, registry,
        projects: () => [live], edition: () => edition, advisories: () => [],
        perform, record: cards, on: true,
      });
      expect(result.attempted).toBe(1);
      expect(result.held).toContain("source_changed_or_revoked");
      expect(cards).not.toHaveBeenCalled();
      expect(db.readSource("initiative.curated").some(e => e.kind === "inferred_belief")).toBe(false);
    } finally { db.close(); }
  });

  it("two eligible cases share a fixed daily cost budget", async () => {
    const { db, registry } = fixture();
    try {
      const secondProject = { ...project, id: "another", name: "Another Typography Tool" };
      const calls = vi.fn(async (c: InitiativeCandidate) => researchReceipt(c));
      const result = await runInitiativeResearchCycle({
        store: db, now: () => now, registry,
        projects: () => [project, secondProject], edition: () => edition,
        advisories: () => [], perform: calls, maxDaily: 1, on: false,
      });
      expect(result.attempted).toBe(1);
      expect(calls).toHaveBeenCalledTimes(1);
    } finally { db.close(); }
  });
});

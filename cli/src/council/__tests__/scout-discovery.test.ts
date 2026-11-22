import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Last30daysContractError, last30daysHealth, parseLast30daysAgent, parseLast30daysDiscovery } from "../scout-last30days.js";
import { discoveryCandidates, readDiscoveryCache, refreshDiscovery, discoverNative } from "../scout-discovery.js";
import { adjudicateScoutEvidence, evidenceMatches, sourceFamily } from "../scout-evidence.js";
import { prepareScoutCandidates, scoutPreferenceSignal } from "../scout-editorial.js";
import { noteworthyUpdate } from "../scout-stories.js";
import type { EvidenceBundle, RankedEvidence } from "../../evidence/types.js";
import { groupScoutStories, previouslyCovered, sameStory } from "../scout-stories.js";
import { recordScoutMetrics, readScoutMetrics } from "../scout-metrics.js";
import { editorialEvaluationSummary, editorialShadowBrief, recordEditorialJudgment } from "../scout-eval.js";
import type { ScoutCandidate } from "../scout.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env.FLYD_SCOUT_DISCOVERY;
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "scout-discover-"));
  dirs.push(dir);
  return dir;
}
function candidate(title: string, url: string, sourceId = "rss:example"): ScoutCandidate {
  return { id: url, title, url, topic: "creative tools", source: "Example", sourceId, summary: title };
}

describe("versioned last30days contracts", () => {
  it("preserves structured relevance, counters, clusters and coverage", () => {
    const result = parseLast30daysAgent(JSON.stringify({
      schema_version: "1.4", query: "generative audio", generated_at: "2026-11-17T00:00:00Z",
      source_status: { reddit: "ok", x: "skipped-unconfigured", youtube: "no-results" },
      clusters: [{ title: "Wave synth", summary: "New synth", sources: ["reddit"], engagement_total: 55 }],
      freshness_verdicts: [{ candidate_id: "id1", verdict: "current" }],
      usage: { calls: 1, promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      results: [{ candidate_id: "id1", title: "Wave synth", source: "reddit",
        url: "https://www.reddit.com/r/synth/a?utm_source=feed", engagement: { score: 50, num_comments: 5 },
        relevance_score: 0.93, cluster: 0, published_at: "2026-11-16" }],
    }));
    expect(result.observations[0]).toMatchObject({
      candidateId: "id1", relevanceScore: 0.93, engagement: { score: 50, num_comments: 5 }, cluster: 0,
    });
    expect(result.observations[0]?.url).not.toContain("utm_source");
    expect(result.sourceStatus.x).toBe("skipped-unconfigured");
    expect(result.usage?.totalTokens).toBe(120);
    expect(result.freshnessVerdicts).toEqual([{ candidateId: "id1", verdict: "current" }]);
  });

  it("rejects legacy/raw/incorrect schema and dangerous URLs", () => {
    expect(() => parseLast30daysAgent(JSON.stringify({ results: [] }))).toThrow(Last30daysContractError);
    expect(() => parseLast30daysAgent(JSON.stringify({ schema_version: "2.0", results: [], clusters: [], source_status: {} }))).toThrow();
    const result = parseLast30daysAgent(JSON.stringify({
      schema_version: "1.5", results: [
        { title: "private", url: "http://127.0.0.1/admin" },
        { title: "safe", url: "https://example.com/safe" },
      ], clusters: [], source_status: { github: "partial" },
    }));
    expect(result.observations.map((o) => o.title)).toEqual(["safe"]);
  });

  it("keeps nothing-solid as a genuine discovery result, not a failure", () => {
    expect(parseLast30daysDiscovery(JSON.stringify({
      schema_version: "1.1", kind: "discovery", outcome: "nothing-solid", domain: "creative tools",
      source_status: { reddit: "rate-limited" }, results: [], weak_signal: "small tool rumour",
    }))).toMatchObject({ outcome: "nothing-solid", weakSignal: "small tool rumour", nominations: [] });
  });

  it("diagnoses the current interpreter before subprocess research", async () => {
    const missing = await last30daysHealth("/no-such-last30days.py");
    expect(missing.ok).toBe(false);
  });
});

describe("discovery and event curation", () => {
  it("caches one domain without blocking on a failed or weak source", async () => {
    const dir = temp();
    process.env.FLYD_SCOUT_DISCOVERY = "on";
    const now = new Date(2026, 10, 17, 15, 0, 0);
    const discover = vi.fn(async (domain: string) => ({
      schemaVersion: "1.1", domain, generatedAt: now.toISOString(), outcome: "ok" as const,
      sourceStatus: { reddit: "ok" as const },
      nominations: [
        { topic: "New experimental image language", whySpiking: "Creators are adopting it", velocityScore: 90,
          sources: ["reddit", "hackernews"], evidenceUrls: ["https://example.com/story"], corroborationCount: 2,
          previouslySurfacedCount: 0 },
        { topic: "Viral beginner question", whySpiking: "Somebody asked for help", velocityScore: 20,
          sources: ["reddit"], evidenceUrls: ["https://example.com/help"], corroborationCount: 1,
          previouslySurfacedCount: 0 },
      ],
    }));
    const verify = vi.fn(async (nomination: { topic: string }) => ({
      evidence: nomination.topic.includes("experimental")
        ? [
          { url: "https://primary.example/story", title: nomination.topic, snippet: "Project release", source: "web", kind: "release", isPrimary: true },
          { url: "https://independent.example/story", title: nomination.topic, snippet: "Independent confirmation", source: "web", kind: "news", isPrimary: false },
        ] : [],
      evidenceStatus: (nomination.topic.includes("experimental") ? "corroborated" : "unverified") as "corroborated" | "unverified",
      independentSources: nomination.topic.includes("experimental") ? 2 : 0, gaps: [], generatedAt: now.toISOString(),
    }));
    expect(await refreshDiscovery(dir, now, discover, { verify })).toMatchObject({ outcome: "ok" });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(readDiscoveryCache(dir).runs).toHaveLength(1);
    expect(discoveryCandidates(dir, now).map((item) => item.title)).toEqual(["New experimental image language"]);
    expect(await refreshDiscovery(dir, now, discover)).toBeNull();
  });

  it("groups independently worded coverage, not distinct numbered releases", () => {
    const a = candidate("Open source generative audio tool launches", "https://press.test/launch", "rss:press");
    const b = candidate("Generative audio tool launches open source", "https://reddit.test/discussion", "reddit:music");
    const c = candidate("Open source generative audio tool v2 launches", "https://blog.test/v2");
    expect(sameStory(a, b)).toBe(true);
    const grouped = groupScoutStories([a, b]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.evidenceUrls).toHaveLength(2);
    expect(grouped[0]?.independentSources).toBe(2);
    expect(previouslyCovered(b, [{ title: a.title, url: a.url }])).toBe(true);
    expect(sameStory(a, c)).toBe(false);
  });

  it("blinds and records comparisons without publishing shadow stories", () => {
    const dir = temp();
    writeFileSync(join(dir, "editorial-shadow.json"), JSON.stringify({
      date: "2026-11-17",
      baseline: [{ title: "Old story", url: "https://example.com/old" }],
      candidate: [{ title: "Interesting discovery", url: "https://example.com/new" }],
    }));
    const brief = editorialShadowBrief(dir);
    expect(brief).toContain("Blind edition 2026-11-17");
    expect(brief).toContain("Interesting discovery");
    expect(brief).toContain("Old story");
    expect(recordEditorialJudgment(dir, "tie")).toContain("recorded");
    expect(editorialEvaluationSummary(dir)).toContain("1 days");
  });

  it("does not treat two posts from one outlet as independent corroboration", () => {
    const toEvidence = (url: string): RankedEvidence => ({
      id: url, sourceItemId: url, capability: "web", backend: "jina", kind: "news",
      title: "Generative sound tool launches", content: "A generative sound tool launches today",
      locator: url, publishedAt: "2026-11-17T02:00:00Z",
      retrievedAt: "2026-11-17T04:00:00Z", nativeRank: 1, localRelevance: 1,
      freshness: 1, sourceQuality: 1, queryLabel: "research", provenance: [],
      rrfScore: 1, capabilities: ["web"],
    });
    const bundle: EvidenceBundle = {
      query: "Generative sound tool launches", intent: "factual", generatedAt: "2026-11-17T04:00:00Z",
      plan: { query: "x", intent: "factual", depth: "quick", sourceWeights: {}, subqueries: [], maxResults: 10, maxPerStream: 5 },
      evidence: [
        toEvidence("https://same.example/article-a"),
        toEvidence("https://same.example/article-b"),
      ], conflicts: [], gaps: [], capabilityHealth: [],
    };
    expect(adjudicateScoutEvidence("Generative sound tool launches", bundle)).toMatchObject({
      evidenceStatus: "single-source", independentSources: 1,
    });
    bundle.evidence.push(toEvidence("https://other.example/independent"));
    expect(adjudicateScoutEvidence("Generative sound tool launches", bundle)).toMatchObject({
      evidenceStatus: "corroborated", independentSources: 2,
    });
    bundle.conflicts.push({ left: "1", right: "2", topic: "release", reason: "disagree", confidence: 0.9 });
    expect(adjudicateScoutEvidence("Generative sound tool launches", bundle).evidenceStatus).toBe("contradicted");
    expect(evidenceMatches("Generative sound tool launches", toEvidence("https://other.example/independent"))).toBe(true);
    expect(sourceFamily("https://github.com/acme/tool/releases/1")).toBe("github:acme");
  });

  it("uses a public native fallback without inventing momentum or confirmation", async () => {
    const now = new Date("2026-11-17T18:00:00Z");
    const report = await discoverNative(now, async () => [
      { title: "Open-source visual programming engine released", locator: "https://example.org/release", publishedAt: "2026-11-17T15:00:00Z" },
      { title: "Ask HN: help me choose a keyboard", locator: "https://example.org/help", publishedAt: "2026-11-17T15:00:00Z" },
    ]);
    expect(report.nominations).toHaveLength(1);
    expect(report.nominations[0]).toMatchObject({ velocityScore: 0, corroborationCount: 1 });
    const dir = temp();
    process.env.FLYD_SCOUT_DISCOVERY = "on";
    const run = await refreshDiscovery(dir, new Date(2026, 10, 17, 15), async () => { throw Error("Python 3.12 not installed"); }, {
      fallback: async () => report,
      verify: async () => ({ evidence: [], evidenceStatus: "unverified", independentSources: 0, gaps: [], generatedAt: now.toISOString() }),
    });
    expect(run).toMatchObject({ engine: "native", errorKind: "missing", outcome: "ok" });
    expect(discoveryCandidates(dir, now)).toHaveLength(0);
  });

  it("learns from explicit negative feedback while reserving discovered finds", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const weak = candidate("Common AI design update", "https://common.example/1");
    const newFind = { ...candidate("Unexpected creative invention", "https://interesting.example/1"), source: "Discovery",
      evidenceStatus: "corroborated" as const, published: now.toISOString(), evidenceUrls: ["https://interesting.example/1"] };
    const feedback = [{ at: now.toISOString(), verdict: "less" as const,
      title: weak.title, topic: weak.topic, source: weak.source, why: "", reason: "wrong-topic" as const }];
    expect(scoutPreferenceSignal(weak, feedback)).toBeLessThan(0);
    const ranked = prepareScoutCandidates([weak, newFind], feedback, now, 2);
    expect(ranked).toContainEqual(newFind);
    expect(prepareScoutCandidates([{ ...newFind, evidenceStatus: "unverified" }], [], now)).toEqual([]);
  });

  it("distinguishes a corroborated new version from a repeated headline", () => {
    const earlier = { title: "The Acme visual engine v2 launches", url: "https://a.example/v2" };
    expect(noteworthyUpdate({
      ...candidate("The Acme visual engine v3 launches", "https://b.example/v3"),
      evidenceStatus: "corroborated",
    }, earlier)).toBe(true);
    expect(noteworthyUpdate({
      ...candidate("The Acme visual engine v3 launches", "https://b.example/v3"),
      evidenceStatus: "unverified",
    }, earlier)).toBe(false);
  });

  it("records only bounded summary counters", () => {
    const dir = temp();
    for (let i = 0; i < 35; i++) recordScoutMetrics(dir, { at: new Date().toISOString(), mode: "on", fetched: i,
      grouped: i, shortlisted: i, selected: 3, editionItems: 3, failedSources: 0 });
    expect(readScoutMetrics(dir)).toHaveLength(30);
    expect(readScoutMetrics(dir)[29]?.fetched).toBe(34);
  });
});

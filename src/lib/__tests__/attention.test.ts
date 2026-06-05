import { describe, it, expect } from "vitest";
import { computeAttention, generateNudges, formatAttentionReport, type AttentionSignal } from "../attention.js";

function makeDoc(opts: {
  path?: string;
  body?: string;
  date?: string;
  topics?: string[];
  eventType?: string;
  outcome?: string | null;
  signal?: string | null;
}) {
  return {
    path: opts.path ?? "test.md",
    body: opts.body ?? "test body",
    metadata: {
      timestamp: opts.date ?? new Date().toISOString().replace("T", " ").slice(0, 19),
      event_type: opts.eventType ?? "observation",
      outcome: opts.outcome ?? null,
      signal: opts.signal ?? null,
      topics: opts.topics ?? [],
    },
    date: opts.date ?? new Date().toISOString().replace("T", " ").slice(0, 19),
    topics: opts.topics ?? (opts.body ? [] : []),
    eventType: opts.eventType ?? "observation",
    outcome: opts.outcome ?? null,
    signal: opts.signal ?? null,
  };
}

describe("computeAttention", () => {
  it("returns empty for no docs", () => {
    const result = computeAttention([]);
    expect(result).toEqual([]);
  });

  it("computes attention for a single topic with recent activity", () => {
    const docs = Array.from({ length: 8 }, (_, i) =>
      makeDoc({ path: `doc${i}.md`, date: new Date().toISOString().replace("T", " ").slice(0, 19), topics: ["flyd"] }),
    );

    const result = computeAttention(docs);
    expect(result.length).toBeGreaterThan(0);

    const flyd = result.find((s) => s.topic === "flyd")!;
    expect(flyd.velocity).toBeGreaterThan(0.5);
    expect(flyd.recency).toBeGreaterThan(0.9);
    expect(flyd.details.recentCaptures).toBe(8);
  });

  it("computes low attention for inactive topic", () => {
    const docs = [
      makeDoc({ path: "old.md", date: "2025-01-01 00:00:00", topics: ["koko"] }),
    ];

    const result = computeAttention(docs);
    const koko = result.find((s) => s.topic === "koko")!;
    expect(koko.composite).toBeLessThan(0.3);
    expect(koko.recency).toBeLessThan(0.1);
  });

  it("detects unresolved events", () => {
    const docs = [
      makeDoc({
        path: "pending.md",
        date: new Date().toISOString().replace("T", " ").slice(0, 19),
        topics: ["sponsorship"],
        outcome: "pending",
      }),
      makeDoc({
        path: "blocked.md",
        date: new Date().toISOString().replace("T", " ").slice(0, 19),
        topics: ["sponsorship"],
        signal: "blocked",
      }),
    ];

    const result = computeAttention(docs);
    const sponsorship = result.find((s) => s.topic === "sponsorship")!;
    expect(sponsorship.unresolved).toBeGreaterThan(0);
    expect(sponsorship.details.unresolvedCount).toBeGreaterThan(0);
  });

  it("detects surprise/contradictions", () => {
    const docs = [
      makeDoc({
        path: "pivoted.md",
        date: new Date().toISOString().replace("T", " ").slice(0, 19),
        topics: ["koko"],
        signal: "pivoted",
      }),
    ];

    const result = computeAttention(docs);
    const koko = result.find((s) => s.topic === "koko")!;
    expect(koko.surprise).toBeGreaterThan(0);
    expect(koko.details.contradictions.length).toBeGreaterThan(0);
  });

  it("sorts by composite score descending", () => {
    const docs = [
      makeDoc({ path: "hot.md", date: new Date().toISOString().replace("T", " ").slice(0, 19), topics: ["flyd"] }),
      makeDoc({ path: "hot2.md", date: new Date().toISOString().replace("T", " ").slice(0, 19), topics: ["flyd"] }),
      makeDoc({ path: "hot3.md", date: new Date().toISOString().replace("T", " ").slice(0, 19), topics: ["flyd"] }),
      makeDoc({ path: "hot4.md", date: new Date().toISOString().replace("T", " ").slice(0, 19), topics: ["flyd"] }),
      makeDoc({ path: "cold.md", date: "2024-01-01 00:00:00", topics: ["art"] }),
    ];

    const result = computeAttention(docs);
    expect(result[0].composite).toBeGreaterThanOrEqual(result[result.length - 1].composite);
    expect(result[0].topic).toBe("flyd"); // flyd has more recent high-velocity activity
  });
});

describe("generateNudges", () => {
  it("generates nudges for high-attention topics", () => {
    const signals: AttentionSignal[] = [
      {
        topic: "flyd",
        recency: 0.9,
        velocity: 0.8,
        unresolved: 0.5,
        surprise: 0.3,
        importance: 0.8,
        tension: 0,
        composite: 0.75,
        details: { eventCount: 10, unresolvedCount: 3, totalCount: 10, lastActivity: "2026-06-01", recentCaptures: 8, contradictions: ["test.md: pivoted"] },
      },
    ];

    const nudges = generateNudges(signals, 0.5);
    expect(nudges.length).toBeGreaterThan(0);
    expect(nudges[0]).toContain("flyd");
    expect(nudges[0]).toContain("unresolved");
  });

  it("returns empty for low-attention topics", () => {
    const signals: AttentionSignal[] = [
      {
        topic: "koko",
        recency: 0.1,
        velocity: 0.0,
        unresolved: 0.0,
        surprise: 0.0,
        importance: 0.3,
        tension: 0,
        composite: 0.1,
        details: { eventCount: 1, unresolvedCount: 0, totalCount: 1, lastActivity: "2025-01-01", recentCaptures: 0, contradictions: [] },
      },
    ];

    const nudges = generateNudges(signals, 0.5);
    expect(nudges.length).toBe(0);
  });
});

describe("formatAttentionReport", () => {
  it("generates markdown report", () => {
    const signals: AttentionSignal[] = [
      {
        topic: "flyd",
        recency: 0.9,
        velocity: 0.8,
        unresolved: 0.2,
        surprise: 0.1,
        importance: 0.8,
        tension: 0,
        composite: 0.55,
        details: { eventCount: 10, unresolvedCount: 1, totalCount: 10, lastActivity: "2026-06-01", recentCaptures: 8, contradictions: [] },
      },
      {
        topic: "koko",
        recency: 0.1,
        velocity: 0.0,
        unresolved: 0.0,
        surprise: 0.0,
        importance: 0.3,
        tension: 0,
        composite: 0.1,
        details: { eventCount: 1, unresolvedCount: 0, totalCount: 1, lastActivity: "2025-01-01", recentCaptures: 0, contradictions: [] },
      },
    ];

    const report = formatAttentionReport(signals);
    expect(report).toContain("Attention Report");
    expect(report).toContain("flyd");
    expect(report).toContain("koko");
    expect(report).toContain("⚠");
  });

  it("handles empty signals", () => {
    const report = formatAttentionReport([]);
    expect(report).toContain("No topics detected");
  });
});

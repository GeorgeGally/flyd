import { describe, expect, it, vi } from "vitest";
import { retrieveSharedMemoryEvidence } from "../shared-memory-retrieval.js";

describe("retrieveSharedMemoryEvidence", () => {
  it("does not query shared storage for low-information chat", async () => {
    const query = vi.fn();

    const result = await retrieveSharedMemoryEvidence(
      "let's just chat",
      { query, now: () => new Date("2026-07-20T04:00:00.000Z") },
    );

    expect(result).toEqual({ verdict: "insufficient", matches: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it("retrieves decisions and beliefs from Rails memory by topic", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          memory_type: "belief",
          memory_id: "12",
          scope: "Personal",
          content: "George wants artwork releases to feel like art rather than product pages.",
          confidence: 0.9,
          updated_at: "2026-07-20T03:00:00.000Z",
        },
        {
          memory_type: "decision",
          memory_id: "15",
          scope: "Artwork",
          content: "Release the numbered collection with provenance.",
          confidence: 0.8,
          updated_at: "2026-07-20T02:00:00.000Z",
        },
        {
          memory_type: "provider_snapshot",
          memory_id: "99",
          scope: "web-discovery",
          content: "A news feed happens to mention artwork and a software release.",
          confidence: 0.9,
          updated_at: "2026-07-20T03:30:00.000Z",
        },
      ],
    }));

    const result = await retrieveSharedMemoryEvidence(
      "What do you remember about my artwork release?",
      { query, now: () => new Date("2026-07-20T04:00:00.000Z") },
    );

    expect(query).toHaveBeenCalledOnce();
    expect(result.matches.map((match) => match.path)).toEqual([
      "rails/belief/12",
      "rails/decision/15",
    ]);
    expect(result.matches[0]?.excerpt).toContain("rather than product pages");
  });

  it("uses the latest Rails conversation for a cross-surface continuity question", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          memory_type: "conversation",
          memory_id: "22",
          scope: "Personal",
          content: "George: I am planning the artwork release.\nFlyd: Start with the collecting premise.",
          confidence: 1,
          updated_at: "2026-07-20T03:59:00.000Z",
        },
        {
          memory_type: "belief",
          memory_id: "12",
          scope: "Personal",
          content: "An older belief.",
          confidence: 0.8,
          updated_at: "2026-07-19T03:00:00.000Z",
        },
      ],
    }));

    const result = await retrieveSharedMemoryEvidence(
      "Where did we leave off?",
      { query, now: () => new Date("2026-07-20T04:00:00.000Z") },
    );

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      kind: "conversation",
      path: "rails/conversation/22",
    });
    expect(result.matches[0].excerpt).toContain("planning the artwork release");
  });
});

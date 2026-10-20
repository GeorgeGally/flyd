import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateEnvelope, type ContextEnvelope } from "../context-envelope.js";
import { IntelligenceEventStore } from "../event-store.js";
import { episodeCoverRanges, selectEpisodeCover } from "../episodes/cover.js";
import { EpisodicMemory } from "../episodes/service.js";
import { buildEpisodeTree } from "../episodes/tree.js";

const dir = mkdtempSync(join(tmpdir(), "flyd-episodes-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function observation(key: string, text: string): ContextEnvelope {
  return {
    pathKind: "sensor",
    kind: "observation",
    sourceId: "episodes.test",
    consent: { grantedAt: "2026-10-01T00:00:00.000Z", scopes: ["episodes.test"] },
    retentionClass: "local_default",
    payloadClassification: "personal",
    provenance: "test",
    idempotencyKey: key,
    payload: { text },
  };
}

describe("episodic memory", () => {
  it("builds a deterministic aligned binary forest with recursive summaries", () => {
    const path = join(dir, `tree-${randomUUID()}.sqlite`);
    const store = new IntelligenceEventStore({ path });
    for (let i = 0; i < 40; i += 1) {
      const envelope = observation(`k-${i}`, `memory ${i}`);
      expect(validateEnvelope(envelope).ok).toBe(true);
      store.append(envelope);
    }
    const events = store.readFrom(0);
    const a = buildEpisodeTree(events, { leafSize: 8, now: new Date("2026-10-20T00:00:00Z") });
    const b = buildEpisodeTree(events, { leafSize: 8, now: new Date("2026-10-20T00:00:00Z") });
    expect(a.leafCount).toBe(5);
    expect(a.nodes).toHaveLength(8);
    expect(a.nodes.map((n) => [n.id, n.sourceHash, n.summary])).toEqual(b.nodes.map((n) => [n.id, n.sourceHash, n.summary]));
    expect(a.nodes.find((n) => n.leafStart === 0 && n.leafEnd === 4)?.summary).toContain("memory");
    store.close();
  });

  it("uses a bounded temporal cover with finer resolution near the present", () => {
    const ranges = episodeCoverRanges(64, 8);
    expect(ranges.length).toBeLessThanOrEqual(8);
    expect(ranges[0]![0]).toBe(0);
    expect(ranges[ranges.length - 1]![1]).toBe(64);
    const sizes = ranges.map(([lo, hi]) => hi - lo);
    expect(sizes[0]).toBeGreaterThanOrEqual(sizes[sizes.length - 1]!);
  });

  it("rebuilds, covers, drills to source evidence, and removes erased payload from summaries", () => {
    const path = join(dir, `service-${randomUUID()}.sqlite`);
    const store = new IntelligenceEventStore({ path });
    for (let i = 0; i < 18; i += 1) store.append(observation(`e-${i}`, i === 0 ? "secret phrase" : `event ${i}`));
    store.close();

    const memory = new EpisodicMemory({ path, leafSize: 4 });
    const built = memory.rebuild();
    expect(built.eventCount).toBe(18);
    expect(built.leafCount).toBe(5);
    expect(memory.verify().ok).toBe(true);

    const timeline = memory.timeline(3);
    expect(timeline.length).toBeLessThanOrEqual(3);
    const leaf = memory.timeline(99).find((n) => n.level === 0)!;
    const drilled = memory.drill(leaf.id)!;
    expect(drilled.children).toHaveLength(0);
    expect(drilled.events.length).toBeGreaterThan(0);

    const erase = new IntelligenceEventStore({ path });
    erase.eraseSource("episodes.test");
    erase.close();
    memory.rebuild();
    expect(memory.timeline(99).every((n) => !n.summary.includes("secret phrase"))).toBe(true);
  });

  it("maps every cover range to a stored node or stable leaf fallback", () => {
    const fake = Array.from({ length: 17 }, (_, i) => ({
      id: `episode:0:${i}-${i + 1}`, level: 0, leafStart: i, leafEnd: i + 1,
      startSequence: i + 1, endSequence: i + 1, startTime: "2026-01-01T00:00:00Z",
      endTime: "2026-01-01T00:00:00Z", eventCount: 1, summary: String(i), sourceHash: String(i),
      summaryVersion: 1, generatedAt: "2026-01-01T00:00:00Z",
    }));
    expect(selectEpisodeCover(fake, 5).length).toBeGreaterThan(0);
  });
});

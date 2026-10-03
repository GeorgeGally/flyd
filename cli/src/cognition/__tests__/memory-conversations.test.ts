import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../lib/brain-retrieval.js", () => ({
  retrieveResilientLexicalBrainEvidence: async () => ({
    matches: [1, 2, 3, 4].map(i => ({
      id: "brain:" + i, confidence: 0.9 - i / 100, epistemicStatus: "curated",
      content: { excerpt: "Curated dictation note " + i, path: "notes/" + i + ".md" },
      confidenceProfile: { freshness: 0.5 },
    })),
  }),
}));

import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { CognitiveCurator } from "../curator/curator.js";
import { queryMemory } from "../memory.js";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("memory conversation hits", () => {
  it("keeps reranked memory when many recent turns mention a query term", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-memory-")); dirs.push(dir); vi.stubEnv("FLYD_DIR", dir);
    const store = new IntelligenceEventStore();
    try {
      const curator = new CognitiveCurator(store);
      for (let i = 0; i < 10; i++) curator.recordConversationTurn({ sessionId: "s" + i, user: "Flyd chat turn " + i, assistant: "" });
    } finally { store.close(); }
    const result = await queryMemory({ text: "status of flyd dictation", limit: 8, useJev: false });
    expect(result.relevant).toHaveLength(8);
    expect(result.relevant.filter(r => r.id.startsWith("brain:"))).toHaveLength(4);
    expect(result.relevant.filter(r => r.id.startsWith("conversation:"))).toHaveLength(4);
    expect(result.relevant[0].id).toBe("brain:1");
  });
});

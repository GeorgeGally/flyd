import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/llm.js", () => ({
  query: vi.fn(),
}));

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, defaultModel: () => "test-model" };
});

describe("entity-extractor", () => {
  describe("extractEntities", () => {
    it("returns empty for short text", async () => {
      const { extractEntities } = await import("../../lib/entity-extractor.js");
      const result = await extractEntities("short");
      expect(result.triples).toHaveLength(0);
      expect(result.entities).toHaveLength(0);
    });

    it("returns empty when LLM returns unparseable output", async () => {
      const { query } = await import("../../lib/llm.js");
      (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce("I cannot answer that");

      const { extractEntities } = await import("../../lib/entity-extractor.js");
      const result = await extractEntities("A".repeat(200));
      expect(result.triples).toHaveLength(0);
    });

    it("parses valid JSON response from LLM", async () => {
      const { query } = await import("../../lib/llm.js");
      (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        JSON.stringify({
          triples: [{ subject: "flyd", predicate: "uses", object: "qmd SDK", confidence: 0.9 }],
          entities: [{ entity: "flyd", type: "project", mentions: 2 }],
        }),
      );

      const { extractEntities } = await import("../../lib/entity-extractor.js");
      const result = await extractEntities("flyd uses qmd SDK for indexing. ".repeat(10));
      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].subject).toBe("flyd");
      expect(result.triples[0].predicate).toBe("uses");
      expect(result.triples[0].object).toBe("qmd SDK");
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].entity).toBe("flyd");
    });

    it("extracts JSON from code-fenced response", async () => {
      const { query } = await import("../../lib/llm.js");
      (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        "```json\n" +
        JSON.stringify({
          triples: [{ subject: "graph module", predicate: "stores", object: "entities as JSON", confidence: 0.85 }],
          entities: [],
        }) +
        "\n```",
      );

      const { extractEntities } = await import("../../lib/entity-extractor.js");
      const result = await extractEntities("A".repeat(200));
      expect(result.triples).toHaveLength(1);
    });
  });

  describe("extractEntitiesBatch", () => {
    it("processes multiple bodies sequentially", async () => {
      const { query } = await import("../../lib/llm.js");
      (query as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ triples: [], entities: [{ entity: "test", type: "concept", mentions: 1 }] }),
      );

      const { extractEntitiesBatch } = await import("../../lib/entity-extractor.js");
      const bodies = [
        { path: "capture-1.md", body: "A".repeat(200) },
        { path: "capture-2.md", body: "B".repeat(200) },
      ];
      const results = await extractEntitiesBatch(bodies);
      expect(results.size).toBe(2);
      expect(results.has("capture-1.md")).toBe(true);
      expect(results.has("capture-2.md")).toBe(true);
    });
  });
});

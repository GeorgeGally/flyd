import { describe, expect, it, vi } from "vitest";
import type { EvidenceBundle, RankedEvidence } from "../../evidence/types.js";
import { findInspirations, inspirationTerms } from "../inspirations.js";
import { ConversationViewServer } from "../server.js";

function evidence(over: Partial<RankedEvidence>): RankedEvidence {
  return {
    id: over.locator ?? "x", capability: "web", backend: "jina", kind: "reference", content: "", sourceItemId: "x",
    retrievedAt: "2026-11-24T00:00:00.000Z", queryLabel: "q", nativeRank: 1, localRelevance: 1, freshness: 1, sourceQuality: 1,
    provenance: [], rrfScore: 1, capabilities: ["web"], ...over,
  };
}
const bundle = (items: RankedEvidence[]) => ({ evidence: items }) as unknown as EvidenceBundle;

describe("the chat's inspirations", () => {
  it("takes the few plain terms the page sent, and nothing that is not a word", () => {
    expect(inspirationTerms("Logan, swatches ,polybot")).toEqual(["Logan", "swatches", "polybot"]);
    expect(inspirationTerms("Logan,Logan,<script>,x," + "a".repeat(41))).toEqual(["Logan"]);
    expect(inspirationTerms(null)).toEqual([]);
  });

  it("asks the Evidence Engine once for the terms together and keeps its order, as titled public links named by their site", async () => {
    const research = vi.fn(async () => bundle([
      evidence({ kind: "video", title: "Swatch pickers compared", locator: "https://www.youtube.com/watch?v=1", content: "Ten pickers side by side." }),
      evidence({ kind: "discussion", title: "Untitled thread", locator: "file:///etc/passwd" }),
      evidence({ kind: "news", title: "", locator: "https://example.com/no-title" }),
      evidence({ kind: "market", title: "Colour tools market", locator: "https://stats.example.org/colour", publishedAt: "2026-11-20" }),
      evidence({ kind: "video", title: "Swatch pickers compared again", locator: "https://www.youtube.com/watch?v=1" }),
    ]));
    const cards = await findInspirations(["Logan", "swatches"], { research });
    expect(research).toHaveBeenCalledOnce();
    expect(research).toHaveBeenCalledWith("Logan swatches", "quick");
    expect(cards).toEqual([
      { kind: "Video", title: "Swatch pickers compared", text: "Ten pickers side by side.", by: "youtube.com", at: "", url: "https://www.youtube.com/watch?v=1" },
      { kind: "Stat", title: "Colour tools market", text: "", by: "stats.example.org", at: "2026-11-20", url: "https://stats.example.org/colour" },
    ]);
  });

  it("looks nothing up when the chat names nothing", async () => {
    const research = vi.fn(async () => bundle([]));
    expect(await findInspirations([], { research })).toEqual([]);
    expect(research).not.toHaveBeenCalled();
  });

  it("is served only to the view's own page, for the terms it sent, and says so when the lookup fails", async () => {
    const feed = { start() {}, stop() {}, current: () => ({ memories: [], news: [], taste: [] }), onRefresh: () => () => {} };
    const server = new ConversationViewServer({ assistantLabel: "Flyd", canSend: false } as never, undefined, undefined, undefined, feed as never);
    const looked: string[][] = [];
    server.inspirations = async (terms) => { looked.push(terms); return [{ kind: "News", title: "Logan ships", text: "", by: "example.com", at: "", url: "https://example.com/logan" }]; };
    try {
      const base = `http://127.0.0.1:${await server.listen(0)}`;
      const token = (await (await fetch(base + "/api/token")).json()).token as string;
      expect((await fetch(base + "/api/inspirations?q=Logan")).status).toBe(403);
      expect(looked).toEqual([]);
      const found = await fetch(base + "/api/inspirations?q=" + encodeURIComponent("Logan,swatches") + "&token=" + token);
      expect(found.status).toBe(200);
      expect(await found.json()).toEqual({ terms: ["Logan", "swatches"], items: [{ kind: "News", title: "Logan ships", text: "", by: "example.com", at: "", url: "https://example.com/logan" }] });
      expect(looked).toEqual([["Logan", "swatches"]]);
      server.inspirations = async () => { throw new Error("down"); };
      expect((await fetch(base + "/api/inspirations?q=Logan&token=" + token)).status).toBe(502);
    } finally { await server.close(); }
  });
});

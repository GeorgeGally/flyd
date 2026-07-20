import { describe, expect, it } from "vitest";
import { scoreEvidence } from "../librarian.js";

describe("librarian evidence authority", () => {
  it("does not assign curated-wiki confidence to an unpromoted conversation index", () => {
    const scored = scoreEvidence({
      path: "conversations/session.md",
      body: "George discussed an artwork release.",
      source: "wiki",
      score: 80,
      metadata: { type: "conversation-index", promoted: false },
      staleness: null,
    }, ["artwork", "release"], "What did George discuss about the artwork release?");

    expect(scored.reliabilityWeight).toBe(0.5);
  });
});

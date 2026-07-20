import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  retrieveBrainEvidence,
  retrieveLexicalBrainEvidence,
} = vi.hoisted(() => ({
  retrieveBrainEvidence: vi.fn(),
  retrieveLexicalBrainEvidence: vi.fn(),
}));

vi.mock("../../lib/brain-retrieval.js", () => ({
  retrieveBrainEvidence,
  retrieveLexicalBrainEvidence,
}));

import { runSearch } from "../search.js";

const emptyResult = {
  version: "1.0",
  source: "flyd-cli",
  query: "artwork",
  generatedAt: "2026-07-20T00:00:00.000Z",
  sufficiency: { verdict: "insufficient", reason: "No evidence" },
  matches: [],
};

describe("runSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieveBrainEvidence.mockResolvedValue(emptyResult);
    retrieveLexicalBrainEvidence.mockResolvedValue(emptyResult);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("uses immediate lexical memory by default", async () => {
    await runSearch("artwork");

    expect(retrieveLexicalBrainEvidence).toHaveBeenCalledWith("artwork");
    expect(retrieveBrainEvidence).not.toHaveBeenCalled();
  });

  it("only uses semantic retrieval when deep search is requested", async () => {
    await runSearch("artwork", { deep: true });

    expect(retrieveBrainEvidence).toHaveBeenCalledWith("artwork");
    expect(retrieveLexicalBrainEvidence).not.toHaveBeenCalled();
  });
});

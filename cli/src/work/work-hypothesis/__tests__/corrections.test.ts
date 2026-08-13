import { describe, expect, it } from "vitest";
import { parseHypothesisCorrection } from "../corrections.js";

describe("parseHypothesisCorrection", () => {
  it("parses demote flyd", () => {
    expect(parseHypothesisCorrection("don't treat flyd as my primary work")).toEqual({
      kind: "demote",
      projectName: "flyd",
    });
  });

  it("parses reaffirm", () => {
    expect(parseHypothesisCorrection("actually treat CleanX as primary")).toEqual({
      kind: "reaffirm",
      projectName: "CleanX",
    });
  });

  it("parses Flyd not secondary / drives everything as reaffirm", () => {
    expect(parseHypothesisCorrection("Flyd not secondary. should be driving everything")).toEqual({
      kind: "reaffirm",
      projectName: "flyd",
    });
    expect(parseHypothesisCorrection("flyd should be driving everything")).toEqual({
      kind: "reaffirm",
      projectName: "flyd",
    });
  });

  it("returns null for unrelated chat", () => {
    expect(parseHypothesisCorrection("what is the weather")).toBeNull();
  });
});

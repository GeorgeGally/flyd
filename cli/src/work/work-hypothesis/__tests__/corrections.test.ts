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

  it("returns null for unrelated chat", () => {
    expect(parseHypothesisCorrection("what is the weather")).toBeNull();
  });
});

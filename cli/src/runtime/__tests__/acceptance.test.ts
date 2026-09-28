import { describe, expect, it } from "vitest";
import { normalizeCriteria, parseVerdicts, shortfall } from "../acceptance.js";

describe("acceptance", () => {
  it("cleans done_when from a list or a single string", () => {
    expect(normalizeCriteria([" a  b ", "", null])).toEqual(["a b"]);
    expect(normalizeCriteria("one")).toEqual(["one"]);
    expect(normalizeCriteria(undefined)).toEqual([]);
  });

  it("reads verdicts in any order, first answer wins, silence is unmet", () => {
    const checks = parseVerdicts(["a", "b", "c"], "UNMET 2: missing\n- MET 1) seen\nMET 2: changed my mind");
    expect(checks).toEqual([
      { criterion: "a", met: true, note: "seen" },
      { criterion: "b", met: false, note: "missing" },
      { criterion: "c", met: false, note: "the check couldn't confirm it" },
    ]);
    expect(shortfall(checks)).toBe("b (missing); c (the check couldn't confirm it)");
  });

  it("treats a reply with no verdicts as a broken check", () => {
    expect(() => parseVerdicts(["a"], "Looks great to me!")).toThrow(/no verdicts/);
  });
});

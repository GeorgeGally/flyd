import { describe, expect, it } from "vitest";
import {
  citesEvidence, doneWhenStatus, evaluateDoneWhen, normalizeCriteria, parseVerdicts, shortfall, splitClauses, unresolvedItems,
} from "../acceptance.js";

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

  it("splits a blocker alternative from the success clause", () => {
    expect(splitClauses("the deck is in Canva, or if blocked, report one specific blocker with evidence")).toEqual({
      success: "the deck is in Canva", blocker: "report one specific blocker with evidence",
    });
    expect(splitClauses("the site is live (or, if it's blocked: the error)")).toEqual({ success: "the site is live", blocker: "the error" });
    expect(splitClauses("two sets exist")).toEqual({ success: "two sets exist" });
  });

  it("knows a concrete reference from an assertion", () => {
    for (const cited of ["design DAGk3x9QbZ1", "see https://canva.com/d/1", "in ~/DIR/mixes", "wrote compare.md", "`ls` shows it", "exit code 0", "in mixes/ now", "job 9423ba28", "id 123e4567-e89b-12d3-a456-426614174000"]) {
      expect(citesEvidence(cited)).toBe(true);
    }
    for (const claim of ["it's all done", "imported and looks great", "and/or later", "the check passed", "Imported the 12-slide deck into Canva.", "24-pages", "top-10-picks", "the v2-final cut", "a 15-minute talk"]) expect(citesEvidence(claim)).toBe(false);
  });

  it("keeps a met verdict only when evidence backs it, and judges the blocker clause apart", () => {
    const criteria = ["the deck is in Canva, or if blocked, name the blocker", "the notes are saved"];
    const verdicts = parseVerdicts(["the deck is in Canva", "the notes are saved"], "MET 1: looks right\nMET 2: notes.md has them");
    const asserted = evaluateDoneWhen({ criteria, report: "All imported, everything worked.", verdicts });
    expect(doneWhenStatus(asserted)).toBe("short");
    expect(unresolvedItems(asserted)).toEqual(["the deck is in Canva: nothing concrete shows it (no file, command output, link or id)"]);
    const blocked = evaluateDoneWhen({ criteria, report: "The import failed: `canva import` returned HTTP 401.", verdicts: parseVerdicts(["a", "b"], "UNMET 1: none\nMET 2: notes.md") });
    expect(doneWhenStatus(blocked)).toBe("blocked");
    const unrelated = evaluateDoneWhen({ criteria, report: "Fixed the error in src/deck.ts. A blocker in notes.md failed.", verdicts: parseVerdicts(["a", "b"], "UNMET 1: none\nMET 2: notes.md") });
    expect(doneWhenStatus(unrelated)).toBe("short");
    const cited = evaluateDoneWhen({ criteria, report: "The deck is in Canva as design DAGk3x9QbZ1.", verdicts });
    expect(doneWhenStatus(cited)).toBe("done");
    const leftover = evaluateDoneWhen({ criteria, report: "The deck is in Canva as design DAGk3x9QbZ1.", verdicts, leftovers: [{ pid: 9, command: "python3 -m http.server" }] });
    expect(doneWhenStatus(leftover)).toBe("short");
    expect(unresolvedItems(leftover)).toEqual(["nothing it started is left running: still running: pid 9 `python3 -m http.server`"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  checkDomainHandoff, checkProjectAttributionHandoff, citesEvidence, handoffFailureReason, isProjectAttributionRun, projectAttributionFailure, validateFirstmateReturn, doneWhenStatus, evaluateDoneWhen, normalizeCriteria, parseVerdicts, shortfall, splitClauses, unresolvedItems,
} from "../acceptance.js";
import { captainNotice } from "../../command/notice.js";
import { parseDomainResult } from "../../command/result.js";
import type { DomainRun } from "../../command/types.js";

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
      { criterion: "c", met: false, note: "the check couldn't confirm it", unchecked: true },
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
  it("refuses a handoff whose report is a bare flag fragment", () => {
    const handoff = checkDomainHandoff({ report: "--body-file /tmp/flyd-df.json" });
    expect(handoff.ok).toBe(false);
    expect(handoff.missing).toEqual(["brief", "report", "evidence"]);
    expect(handoff.reason).toBe("handoff:missing brief,report,evidence");
  });

  it("refuses a handoff whose report names no clause with a verb", () => {
    expect(checkDomainHandoff({ brief: "Ship the fix", report: "- body file", evidence: ["data/x.md"] }).missing).toEqual(["report"]);
    expect(checkDomainHandoff({ brief: "Ship the fix", report: "tmp flyd df", evidence: ["data/x.md"] }).ok).toBe(false);
  });

  it("accepts a handoff carrying a brief, a report and evidence", () => {
    const handoff = checkDomainHandoff({
      brief: "lodged the four fixes on main",
      report: "Merged the pagination branch and the totals fix into main, then ran the invoice tests.",
      evidence: ["good_neighbours master 593202e", "christmas_invoice_write_test.php passes"],
    });
    expect(handoff).toEqual({ ok: true, missing: [] });
  });

  it("reports only the reason line for a run whose handoff missed, never the raw detail", () => {
    const handoff = checkDomainHandoff({ report: "--body-file /tmp/flyd-df.json" });
    const run = {
      id: "run-1", status: "completed", updatedAt: "2026-10-30T00:00:00.000Z",
      result: { format: "raw", brief: "--body-file /tmp/flyd-df.json", detailedReport: "--body-file /tmp/flyd-df.json", decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "high" },
      incompleteReason: handoff.reason,
    } as unknown as DomainRun;
    const notice = captainNotice(run);
    expect(handoff.ok).toBe(false);
    // The contract's reason code is Flyd's process: he hears only that nothing counts as done.
    expect(notice).toMatch(/came back without a clear report, so nothing counts as done yet\.$/);
    expect(notice).not.toContain("handoff:missing");
    expect(notice).not.toContain("/tmp/flyd-df.json");
  });
  it("refuses a handoff whose report is a bare flag fragment", () => {
    const handoff = checkDomainHandoff({ report: "--body-file /tmp/flyd-df.json" });
    expect(handoff.ok).toBe(false);
    expect(handoff.missing).toEqual(["brief", "report", "evidence"]);
    expect(handoff.reason).toBe("handoff:missing brief,report,evidence");
  });

  it("refuses a handoff whose report names no clause with a verb", () => {
    expect(checkDomainHandoff({ brief: "Ship the fix", report: "- body file", evidence: ["data/x.md"] }).missing).toEqual(["report"]);
    expect(checkDomainHandoff({ brief: "Ship the fix", report: "tmp flyd df", evidence: ["data/x.md"] }).ok).toBe(false);
  });

  it("accepts a handoff carrying a brief, a report and evidence", () => {
    const handoff = checkDomainHandoff({
      brief: "lodged the four fixes on main",
      report: "Merged the pagination branch and the totals fix into main, then ran the invoice tests.",
      evidence: ["good_neighbours master 593202e", "christmas_invoice_write_test.php passes"],
    });
    expect(handoff).toEqual({ ok: true, missing: [] });
  });

  it("reports only the reason line for a run whose handoff missed, never the raw detail", () => {
    const handoff = checkDomainHandoff({ report: "--body-file /tmp/flyd-df.json" });
    const run = {
      id: "run-1", status: "completed", updatedAt: "2026-10-30T00:00:00.000Z",
      result: { format: "raw", brief: "--body-file /tmp/flyd-df.json", detailedReport: "--body-file /tmp/flyd-df.json", decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "high" },
      incompleteReason: handoff.reason,
    } as unknown as DomainRun;
    const notice = captainNotice(run);
    expect(handoff.ok).toBe(false);
    // The contract's reason code is Flyd's process: he hears only that nothing counts as done.
    expect(notice).toMatch(/came back without a clear report, so nothing counts as done yet\.$/);
    expect(notice).not.toContain("handoff:missing");
    expect(notice).not.toContain("/tmp/flyd-df.json");
  });

  it("validates a FirstMate return against the brief/report/evidence contract, naming each missing layer", () => {
    expect(validateFirstmateReturn(parseDomainResult("Done and merged.").result)).toEqual({ ok: false, missing: ["brief", "report", "evidence"] });
    // A brief alone: the reply itself stands in for the report, which is no report.
    expect(validateFirstmateReturn(parseDomainResult(JSON.stringify({ status: "completed", brief: "Merged." })).result)).toEqual({ ok: false, missing: ["report", "evidence"] });
    expect(validateFirstmateReturn(parseDomainResult(JSON.stringify({ brief: "Fixed.", detailed_report: "--body-file /tmp/x.json", evidence: ["commit abc1234"] })).result)).toEqual({ ok: false, missing: ["report"] });
    expect(handoffFailureReason(["report", "evidence"])).toBe("handoff contract unmet after one structured re-request: missing report (no prose account of what was done); evidence (no link, commit, file, id or command output to check it against)");
  });

  it("classifies a structured handoff with brief and evidence but no report", () => {
    const result = parseDomainResult(JSON.stringify({ status: "completed", brief: "Fixed the call site.", evidence: ["src/call.ts"] })).result;
    expect(validateFirstmateReturn(result)).toEqual({ ok: false, missing: ["report"] });
  });

  it("normalises casing, wrapping and a single evidence string before judging the contract", () => {
    const wrapped = "```json\n" + JSON.stringify({ handoff: { BRIEF: "Fixed the call site.", "detailed-report": "Routed the caller through the abstraction and ran the suite.", Evidence: "src/runtime/store.ts" } }) + "\n```";
    expect(validateFirstmateReturn(parseDomainResult(wrapped).result)).toEqual({ ok: true, missing: [] });
    const keyLines = "- **Status:** completed\n- **Brief:** Fixed the call site.\n- **Detailed report:** Routed the caller through the abstraction.\n- **Evidence:** https://github.com/george/flyd/pull/12";
    expect(validateFirstmateReturn(parseDomainResult(keyLines).result)).toEqual({ ok: true, missing: [] });
  });

  const attributionRun = (body: string): DomainRun => {
    const id = "flyd-project-threads-1794406370827";
    return {
      id,
      request: {
        id,
        domain: "coding",
        originalMessage: [
          "Flyd's own note, no work asked and nothing for George. From what you know of the fleet and these conversations, say which project each is about.",
          'Reply with one line per id, "id: Project", using one of: DIR, Flyd, Liesel. Write "id: Other" when it is about none of them or you cannot tell.',
          "",
          "abcd1234 | the dashboard is slow",
          "beef5678 | new email rules",
        ].join("\n"),
        intendedOutcome: "Say which project each exchange is about",
        doneWhen: ["every id listed has a line in the reply"],
        createdAt: "2026-11-17T00:00:00.000Z",
      },
      owner: "FirstMate",
      status: "completed",
      createdAt: "2026-11-17T00:00:00.000Z",
      updatedAt: "2026-11-17T00:01:00.000Z",
      transport: { kind: "firstmate", requestId: id },
      result: parseDomainResult(body).result,
    } as unknown as DomainRun;
  };

  it("recognises the project-attribution task from its outcome, id and done_when", () => {
    expect(isProjectAttributionRun(attributionRun("x"))).toBe(true);
    const other = attributionRun("x");
    other.request = { ...other.request, id: "run-2", originalMessage: "Fix the pagination in the repo.", intendedOutcome: "Fix the pagination", doneWhen: ["tests pass"] };
    expect(isProjectAttributionRun(other)).toBe(false);
  });

  it("rejects an unstructured project-attribution handoff, naming the missing report in the run trace", () => {
    const run = attributionRun("abcd1234: DIR\nbeef5678: Liesel");
    const check = checkProjectAttributionHandoff(run, run.result!);
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(["report"]);
    expect(check.reason).toBe("handoff:missing report");
    const failure = projectAttributionFailure(run, check);
    expect(failure).toContain(run.id);
    expect(failure).toMatch(/bad_output/);
    expect(failure).toMatch(/report/);
  });

  it("rejects a project-attribution handoff that names no exchange's project", () => {
    const run = attributionRun("I matched every exchange to a project and wrote the answer.");
    const check = checkProjectAttributionHandoff(run, run.result!);
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(["project-attribution"]);
    expect(projectAttributionFailure(run, check)).toMatch(/project-attribution/);
  });

  it("accepts a project-attribution handoff with per-exchange projects and a prose report", () => {
    const run = attributionRun(JSON.stringify({
      status: "completed",
      brief: "Placed both exchanges.",
      detailed_report: "I matched each exchange to a project from the list and wrote the answer. abcd1234: DIR. beef5678: Liesel.",
      evidence: ["abcd1234 -> DIR", "beef5678 -> Liesel"],
    }));
    expect(checkProjectAttributionHandoff(run, run.result!)).toEqual({ ok: true, missing: [] });
  });

  it("accepts the plain reply a legacy project-attribution note asked for: id lines plus one prose sentence", async () => {
    // The note Flyd used to send before project tagging moved local (conversation-view/project-tagger.ts); runs already open still settle.
    const note = [
      "Flyd's own note, no work asked and nothing for George. Flyd splits his conversations by project and could not place these exchanges. From what you know of the fleet and these conversations, say which project each is about.",
      'Reply to this note with one line per id, "id: Project", using one of: DIR, Flyd, Liesel. Write "id: Other" when it is about none of them or you cannot tell. After the lines, add one short sentence saying how you placed them (for example "Both are about Flyd\'s overlay work."). Answer from what you know; spawn nobody.',
      "",
      "0a1b2c3d | the dashboard is slow",
      "4e5f6a7b | new email rules",
    ].join("\n");
    const ids = [...note.matchAll(/^([0-9a-f]{8}) \|/gm)].map((match) => match[1]!);
    expect(ids).toHaveLength(2);
    const run = attributionRun(`${ids[0]}: DIR\n${ids[1]}: Liesel\nThe slow dashboard is DIR work and the email rules are Liesel's.`);
    run.request = { ...run.request, originalMessage: note };
    expect(checkProjectAttributionHandoff(run, run.result!)).toEqual({ ok: true, missing: [] });
    // The same lines without the sentence still miss the report layer.
    const bare = attributionRun(`${ids[0]}: DIR\n${ids[1]}: Liesel`);
    bare.request = { ...bare.request, originalMessage: note };
    expect(checkProjectAttributionHandoff(bare, bare.result!).missing).toEqual(["report"]);
  });
});

import { describe, expect, it } from "vitest";
import { modelProseJudge, parseDomainResult, proseOutcomeByWords, validateDomainHandoff } from "../result.js";

describe("validateDomainHandoff", () => {
  it("flags prose with no brief/report/evidence layers", () => {
    const { result } = parseDomainResult("Done — swapped the headline everywhere.\n\nPreview is on 8097.");
    expect(validateDomainHandoff(result)).toEqual({
      ok: false,
      missing: ["brief", "report", "evidence"],
      reason: "domain handoff contract unmet: missing brief, report, evidence",
    });
  });

  it("names only the layer a structured handoff leaves out", () => {
    const { result } = parseDomainResult(JSON.stringify({ status: "completed", brief: "Fixed.", detailed_report: "Changed the call site.", evidence: [" "] }));
    expect(validateDomainHandoff(result)).toEqual({
      ok: false,
      missing: ["evidence"],
      reason: "domain handoff contract unmet: missing evidence",
    });
  });

  it("passes a well-formed brief/report/evidence handoff without touching it", () => {
    const { result } = parseDomainResult(JSON.stringify({
      status: "completed",
      brief: "Headline swapped.",
      detailed_report: "invite.html and remind_me.html updated; titles and alt text checked.",
      evidence: ["commit a5bf7ab"],
    }));
    const before = structuredClone(result);
    expect(validateDomainHandoff(result)).toEqual({ ok: true });
    expect(result).toEqual(before);
  });
});

describe("prose replies", () => {
  it.each([
    ["Done and live: the heading now reads 'What we look for in brands'.", "completed"],
    ["Captain, fixed the typo and confirmed the build passes.", "completed"],
    ["The fix is ready. Do you want it merged now?", "needs_decision"],
    ["Ready to ship; publishing stays George's call.", "needs_decision"],
    ["status=failed: the deploy target refused the key.", "failed"],
    ["Couldn't reproduce the crash on main.", "failed"],
    ["On it — will report once the tests pass.", "working"],
  ])("reads %s as %s by its words", (reply, outcome) => {
    expect(proseOutcomeByWords(reply)).toBe(outcome);
  });

  it("asks the model what the reply says happened, and gives up on anything but a known status", async () => {
    const prompts: string[] = [];
    const judge = modelProseJudge(async (prompt) => { prompts.push(prompt); return "{\"status\": \"needs_decision\"}"; });
    expect(await judge("Ready; shall I merge?", "Fix the footer")).toBe("needs_decision");
    expect(prompts[0]).toContain("Fix the footer");
    expect(prompts[0]).toContain("Ready; shall I merge?");
    expect(await modelProseJudge(async () => "{\"status\": \"maybe\"}")("x", "y")).toBeNull();
    expect(await modelProseJudge(async () => { throw new Error("down"); })("x", "y")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { defaultProseJudge, modelProseJudge, parseDomainResult, proseOutcomeByWords, validateDomainHandoff } from "../result.js";

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
  it("never classifies a reply by its words: the plain-words fallback only says it could not tell", () => {
    for (const reply of [
      "Done and live: the heading now reads 'What we look for in brands'.",
      "Captain, fixed the typo and confirmed the build passes.",
      "status=failed: the deploy target refused the key.",
      "The fix is ready. Do you want it merged now?",
      "All tests passed; zero failed.",
      "Investigated the race; the fix still needs a rebase before it can land.",
    ]) expect(proseOutcomeByWords(reply)).toBe("unclear");
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

  it("defaults to no reader under vitest and to Flyd's model off it", async () => {
    expect(await defaultProseJudge()).toBeUndefined();
    const savedVitest = process.env.VITEST;
    const savedFixture = process.env.FLYD_MODEL_FIXTURE;
    delete process.env.VITEST;
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({ fallback: "{\"status\": \"completed\"}" });
    try {
      const judge = await defaultProseJudge();
      expect(await judge!("Rebased and merged; green.", "land the fix")).toBe("completed");
    } finally {
      if (savedVitest === undefined) delete process.env.VITEST; else process.env.VITEST = savedVitest;
      if (savedFixture === undefined) delete process.env.FLYD_MODEL_FIXTURE; else process.env.FLYD_MODEL_FIXTURE = savedFixture;
    }
  });
});

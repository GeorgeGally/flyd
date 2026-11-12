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

describe("key/value replies", () => {
  it("reads 'status:' with 'brief:' as a structured handoff, so a clear answer closes the run", () => {
    const { status, result } = parseDomainResult("status: completed\nbrief: Done and live: the sidebar opens on Artefacts, with a tab to switch it to Changes.");
    expect(status).toBe("completed");
    expect(result.format).toBe("structured");
    expect(result.brief).toBe("Done and live: the sidebar opens on Artefacts, with a tab to switch it to Changes.");
    expect(result.detailedReport).toContain("sidebar opens on Artefacts");
  });

  it("reads the status in any spelling Flyd knows, and leaves any other status prose for the judge", () => {
    expect(parseDomainResult("Status: Completed\nSummary: The sidebar opens on Artefacts.").status).toBe("completed");
    expect(parseDomainResult("status: needs decision\nbrief: Keep the old sidebar or drop it?").status).toBe("needs_decision");
    expect(parseDomainResult("Status: done\nBrief: Shipped.").status).toBe("completed");
    for (const reply of ["Status: Blocked\nSummary: need your call on whether to keep the old sidebar", "Summary: the sidebar is half done"]) {
      const parsed = parseDomainResult(reply);
      expect(parsed.status).toBeUndefined();
      expect(parsed.result.format).toBe("raw");
    }
  });

  it("keeps the value exactly as written, stripping emphasis only from the key", () => {
    expect(parseDomainResult("status: completed\nreport: Fixed the import in __init__.py").result.detailedReport).toBe("Fixed the import in __init__.py");
    const dressed = parseDomainResult("- **Status:** completed\n- **Brief:** Patched __main__.py");
    expect(dressed.status).toBe("completed");
    expect(dressed.result.brief).toBe("Patched __main__.py");
  });

  it("keeps the value as written when the key closes its own emphasis before the colon", () => {
    expect(parseDomainResult("status: completed\nbrief: Fixed the import.\n**Evidence**: __init__.py").result.evidence).toEqual(["__init__.py"]);
    expect(parseDomainResult("status: completed\n*Brief*: _private helper removed").result.brief).toBe("_private helper removed");
    expect(parseDomainResult("status: completed\n**Brief:** Shipped the fix.").result.brief).toBe("Shipped the fix.");
  });

  it("reads an emphasised status, and single-emphasis keys, as the same structured reply", () => {
    for (const reply of ["**Status:** **Completed**\n**Brief:** Shipped the fix.", "Status: **completed**\nBrief: Shipped the fix.", "*Status:* completed\n*Brief:* Shipped the fix."]) {
      const parsed = parseDomainResult(reply);
      expect(parsed.status).toBe("completed");
      expect(parsed.result).toMatchObject({ format: "structured", brief: "Shipped the fix." });
    }
  });

  it("takes a named PR, commit or URL as the evidence layer", () => {
    const pr = parseDomainResult("status: completed\nbrief: Sidebar done.\ndetailed_report: See https://github.com/GeorgeGally/flyd/pull/167");
    expect(validateDomainHandoff(pr.result)).toEqual({ ok: true });
    const sha = parseDomainResult("status: completed\nbrief: Fixed.\ndetailed_report: commit a5bf7ab, all green.");
    expect(validateDomainHandoff(sha.result)).toEqual({ ok: true });
  });

  it("keeps the evidence gap when no pointer is named, and the reply still counts", () => {
    const { status, result } = parseDomainResult("status: completed\nbrief: Done and live.");
    expect(status).toBe("completed");
    expect(result.format).toBe("structured");
    expect(validateDomainHandoff(result)).toEqual({ ok: false, missing: ["evidence"], reason: "domain handoff contract unmet: missing evidence" });
  });
});

describe("JSON inside prose", () => {
  it("leaves a prose reply quoting an API error body raw, so the judge decides how it ended", () => {
    for (const body of [
      'Couldn\'t deploy, the API returned {"detail":"Not Found"}. Which region should I use?',
      'The service answered {"data":{"summary":"rate limited"}} and I stopped there.',
      'Got {"output":{"report":"quota exceeded"}} back from the build.',
    ]) {
      const parsed = parseDomainResult(body);
      expect(parsed.result.format).toBe("raw");
      expect(parsed.status).toBeUndefined();
    }
  });

  it("leaves a quoted object with its own status raw, so a pasted CI body is not read as the handoff", () => {
    for (const body of [
      'CI is red: {"status":"completed","conclusion":"failure","output":{"summary":"3 tests failed"}}. Should I fix them?',
      'Handoff: {"Status": "failed", "result": {"summary": "The deploy failed."}}',
      'CI is red:\n```json\n{"status":"completed","conclusion":"failure","output":{"summary":"3 tests failed"}}\n```\nShould I fix them?',
      'Deploy stopped:\n```json\n{"detail":"Not Found"}\n```\nWhich region should I use?',
    ]) {
      const parsed = parseDomainResult(body);
      expect(parsed.result.format).toBe("raw");
      expect(parsed.status).toBeUndefined();
    }
  });

  it("reads a whole-body object through its wrapper, and a quoted object through the contract's own keys", () => {
    expect(parseDomainResult(JSON.stringify({ data: { summary: "Fixed the call site." } })).result).toMatchObject({ format: "structured", brief: "Fixed the call site." });
    expect(parseDomainResult('Handoff: {"status": "failed", "brief": "The deploy failed."}')).toMatchObject({ status: "failed", result: { format: "structured", brief: "The deploy failed." } });
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


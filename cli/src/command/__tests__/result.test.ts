import { describe, expect, it } from "vitest";
import { parseDomainResult, validateDomainHandoff } from "../result.js";

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

import { describe, expect, it } from "vitest";
import { fiveWorkingDayWindowStart, hasControlTrialEvidence } from "../metrics.js";

describe("fiveWorkingDayWindowStart", () => {
  it("uses five working days inclusive and skips the weekend", () => {
    expect(fiveWorkingDayWindowStart(new Date("2026-07-17T12:00:00+08:00")).toISOString())
      .toBe("2026-07-12T16:00:00.000Z");
    expect(fiveWorkingDayWindowStart(new Date("2026-07-20T12:00:00+08:00")).toISOString())
      .toBe("2026-07-13T16:00:00.000Z");
  });

  it("requires durable Release 1B activity before claiming control-trial evidence", () => {
    const metrics = {
      routedAssignments: 0,
      acceptedInterventions: 0,
      stopControls: 0,
      retryControls: 0,
      redirectControls: 0,
      replaceControls: 0,
      integrationConflicts: 0,
      permissionRenewals: 0,
      verifiedIntegrations: 0,
    };

    expect(hasControlTrialEvidence(metrics)).toBe(false);
    expect(hasControlTrialEvidence({ ...metrics, routedAssignments: 1 })).toBe(true);
    expect(hasControlTrialEvidence({ ...metrics, permissionRenewals: 1 })).toBe(true);
  });
});

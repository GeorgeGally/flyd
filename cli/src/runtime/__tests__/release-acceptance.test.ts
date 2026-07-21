import { describe, expect, it } from "vitest";
import {
  buildReleaseAcceptanceReport,
  type ReleaseAcceptanceEvidence,
} from "../release-acceptance.js";

function evidence(overrides: Partial<ReleaseAcceptanceEvidence> = {}): ReleaseAcceptanceEvidence {
  const realSessionDates = [
    "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
    "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
  ];
  return {
    release1cAvailableAt: "2026-07-05T12:00:00.000Z",
    timeZone: "UTC",
    realSessions: 10,
    resumedSessions: 5,
    resumedWithoutRestatement: 4,
    acceptedInterpretations: 7,
    correctedInterpretations: 1,
    replacedInterpretations: 2,
    recommendedActions: 10,
    acceptedOrAdaptedActions: 6,
    acceptedInterventionWeeks: 2,
    acceptedInterventionWeekDates: ["2026-07-06", "2026-07-13"],
    completedTasks: 2,
    completedTasksWithVerifiedOutcomeAndReentry: 2,
    parityEvidenceCount: 10,
    propagationLatenciesMs: [120, 180, 250, 300, 350, 410, 500, 620, 800, 1_200],
    memorySafetyReviews: [true],
    rationaleReviews: [true],
    automatedAcceptanceRuns: [{ idempotent: true, permissionsEnforced: true, noDuplicateEffects: true }],
    realSessionDates,
    ...overrides,
  };
}

describe("Release 1 acceptance report", () => {
  it("qualifies only when the two-week trial and every first-release measure pass", () => {
    const report = buildReleaseAcceptanceReport(evidence(), new Date("2026-07-20T00:00:00.000Z"));

    expect(report.status).toBe("qualified");
    expect(report.primaryProductTrial.status).toBe("passed");
    expect(report.technicalTrial).toMatchObject({ status: "passed", realSessions: 10, resumedSessions: 5 });
    expect(report.propagation).toMatchObject({ status: "passed", p95Ms: 1_200, sampleSize: 10 });
    expect(report.measures.every((measure) => measure.status === "passed")).toBe(true);
  });

  it("does not claim success when persisted evidence is missing", () => {
    const report = buildReleaseAcceptanceReport(evidence({
      release1cAvailableAt: null,
      recommendedActions: 0,
      acceptedOrAdaptedActions: 0,
      propagationLatenciesMs: [],
      memorySafetyReviews: [],
      rationaleReviews: [],
      automatedAcceptanceRuns: [],
    }), new Date("2026-07-20T00:00:00.000Z"));

    expect(report.status).toBe("insufficient_evidence");
    expect(report.primaryProductTrial.status).toBe("insufficient_evidence");
    expect(report.propagation.status).toBe("insufficient_evidence");
    expect(report.measures.find((measure) => measure.key === "recommended_actions")?.status).toBe("insufficient_evidence");
    expect(report.measures.find((measure) => measure.key === "memory_safety")?.status).toBe("insufficient_evidence");
    expect(report.automatedAcceptance.status).toBe("insufficient_evidence");
  });

  it("fails recorded evidence below a threshold and uses nearest-rank p95", () => {
    const report = buildReleaseAcceptanceReport(evidence({
      resumedWithoutRestatement: 3,
      propagationLatenciesMs: [100, 200, 300, 400, 500, 600, 700, 800, 900, 2_500],
    }), new Date("2026-07-20T00:00:00.000Z"));

    expect(report.status).toBe("failed");
    expect(report.measures.find((measure) => measure.key === "resume_without_restatement")?.status).toBe("failed");
    expect(report.propagation).toMatchObject({ status: "failed", p95Ms: 2_500 });
  });

  it("uses the latest automated run as the current acceptance status", () => {
    const report = buildReleaseAcceptanceReport(evidence({
      automatedAcceptanceRuns: [
        { idempotent: false, permissionsEnforced: false, noDuplicateEffects: false },
        { idempotent: true, permissionsEnforced: true, noDuplicateEffects: true },
      ],
    }), new Date("2026-07-20T00:00:00.000Z"));

    expect(report.status).toBe("qualified");
    expect(report.automatedAcceptance).toEqual({ status: "passed", runs: 2 });
  });

  it("keeps an unfinished trial insufficient instead of failing it early", () => {
    const report = buildReleaseAcceptanceReport(evidence({
      realSessions: 1,
      resumedSessions: 0,
      resumedWithoutRestatement: 0,
      realSessionDates: ["2026-07-06"],
      propagationLatenciesMs: [120],
    }), new Date("2026-07-08T00:00:00.000Z"));

    expect(report.status).toBe("insufficient_evidence");
    expect(report.primaryProductTrial.status).toBe("insufficient_evidence");
    expect(report.technicalTrial.status).toBe("insufficient_evidence");
    expect(report.propagation.status).toBe("insufficient_evidence");
  });

  it("treats partial parity coverage as missing evidence rather than a failed comparison", () => {
    const report = buildReleaseAcceptanceReport(evidence({
      realSessions: 3,
      parityEvidenceCount: 2,
      propagationLatenciesMs: Array.from({ length: 24 }, () => 200),
    }), new Date("2026-07-20T00:00:00.000Z"));

    expect(report.measures.find((measure) => measure.key === "cross_surface_parity")?.status)
      .toBe("insufficient_evidence");
  });

  it("does not fail provisional ratios or a partial first week", () => {
    const report = buildReleaseAcceptanceReport(evidence({
      release1cAvailableAt: "2026-07-08T00:00:00.000Z",
      realSessions: 1,
      resumedSessions: 1,
      resumedWithoutRestatement: 0,
      acceptedInterpretations: 0,
      correctedInterpretations: 0,
      replacedInterpretations: 1,
      recommendedActions: 1,
      acceptedOrAdaptedActions: 0,
      acceptedInterventionWeeks: 1,
      realSessionDates: ["2026-07-08"],
      propagationLatenciesMs: [],
    }), new Date("2026-07-20T00:00:00.000Z"));

    expect(report.status).toBe("insufficient_evidence");
    expect(report.primaryProductTrial.status).toBe("insufficient_evidence");
  });

  it("reports a failed elapsed trial even when another measure is missing", () => {
    const report = buildReleaseAcceptanceReport(evidence({
      realSessionDates: ["2026-07-06"],
      recommendedActions: 0,
      acceptedOrAdaptedActions: 0,
    }), new Date("2026-07-20T00:00:00.000Z"));

    expect(report.status).toBe("failed");
    expect(report.primaryProductTrial.status).toBe("failed");
  });
});

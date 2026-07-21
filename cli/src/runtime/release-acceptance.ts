export type GateStatus = "passed" | "failed" | "insufficient_evidence";
export type ReleaseAcceptanceObservationKind =
  | "memory_safety"
  | "recommendation_rationale"
  | "automated_acceptance";

export interface ReleaseAcceptanceEvidence {
  release1cAvailableAt: string | null;
  timeZone: string;
  realSessions: number;
  resumedSessions: number;
  resumedWithoutRestatement: number;
  acceptedInterpretations: number;
  correctedInterpretations: number;
  replacedInterpretations: number;
  recommendedActions: number;
  acceptedOrAdaptedActions: number;
  acceptedInterventionWeeks: number;
  acceptedInterventionWeekDates: string[];
  completedTasks: number;
  completedTasksWithVerifiedOutcomeAndReentry: number;
  parityEvidenceCount: number;
  propagationLatenciesMs: number[];
  memorySafetyReviews: boolean[];
  rationaleReviews: boolean[];
  automatedAcceptanceRuns: Array<{
    idempotent: boolean;
    permissionsEnforced: boolean;
    noDuplicateEffects: boolean;
  }>;
  realSessionDates: string[];
}

export interface AcceptanceMeasure {
  key: string;
  label: string;
  status: GateStatus;
  result: string;
}

export interface ReleaseAcceptanceReport {
  status: "qualified" | "failed" | "insufficient_evidence";
  generatedAt: string;
  primaryProductTrial: {
    status: GateStatus;
    release1cAvailableAt: string | null;
    qualifyingWeeks: string[];
    qualifyingWorkingDays: number;
  };
  technicalTrial: {
    status: GateStatus;
    realSessions: number;
    resumedSessions: number;
  };
  measures: AcceptanceMeasure[];
  propagation: {
    status: GateStatus;
    p95Ms: number | null;
    sampleSize: number;
    targetMs: number;
  };
  automatedAcceptance: {
    status: GateStatus;
    runs: number;
  };
}

function ratioStatus(numerator: number, denominator: number, threshold: number): GateStatus {
  if (denominator === 0) return "insufficient_evidence";
  return numerator / denominator >= threshold ? "passed" : "failed";
}

function allRecorded(values: boolean[]): GateStatus {
  if (values.length === 0) return "insufficient_evidence";
  return values.every(Boolean) ? "passed" : "failed";
}

function overall(statuses: GateStatus[]): ReleaseAcceptanceReport["status"] {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("insufficient_evidence")) return "insufficient_evidence";
  return "qualified";
}

function mondayFor(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

function nextWeek(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 7);
  return value.toISOString().slice(0, 10);
}

function dateInTimeZone(value: Date | string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function primaryTrial(evidence: ReleaseAcceptanceEvidence, now: Date): ReleaseAcceptanceReport["primaryProductTrial"] {
  if (!evidence.release1cAvailableAt) {
    return { status: "insufficient_evidence", release1cAvailableAt: null, qualifyingWeeks: [], qualifyingWorkingDays: 0 };
  }

  const availableDate = dateInTimeZone(evidence.release1cAvailableAt, evidence.timeZone);
  const dates = [...new Set(evidence.realSessionDates)]
    .filter((date) => date >= availableDate)
    .filter((date) => {
      const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      return day >= 1 && day <= 5;
    });
  const counts = new Map<string, number>();
  dates.forEach((date) => counts.set(mondayFor(date), (counts.get(mondayFor(date)) ?? 0) + 1));
  const weeks = [...counts.entries()].filter(([, count]) => count >= 5).map(([week]) => week).sort();
  const first = weeks.find((week) => weeks.includes(nextWeek(week)));

  if (!first) {
    const availableWeek = mondayFor(availableDate);
    const firstEligibleWeek = availableDate === availableWeek ? availableWeek : nextWeek(availableWeek);
    const trialEnd = nextWeek(nextWeek(firstEligibleWeek));
    return {
      status: dateInTimeZone(now, evidence.timeZone) < trialEnd ? "insufficient_evidence" : "failed",
      release1cAvailableAt: evidence.release1cAvailableAt,
      qualifyingWeeks: weeks,
      qualifyingWorkingDays: dates.length,
    };
  }
  return {
    status: "passed",
    release1cAvailableAt: evidence.release1cAvailableAt,
    qualifyingWeeks: [first, nextWeek(first)],
    qualifyingWorkingDays: dates.filter((date) => [first, nextWeek(first)].includes(mondayFor(date))).length,
  };
}

function nearestRankP95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

export function buildReleaseAcceptanceReport(
  evidence: ReleaseAcceptanceEvidence,
  now = new Date(),
): ReleaseAcceptanceReport {
  const primaryProductTrial = primaryTrial(evidence, now);
  const technicalStatus: GateStatus = evidence.realSessions < 10 || evidence.resumedSessions < 5
    ? "insufficient_evidence"
    : "passed";
  const interpretationTotal = evidence.acceptedInterpretations
    + evidence.correctedInterpretations
    + evidence.replacedInterpretations;
  const p95Ms = nearestRankP95(evidence.propagationLatenciesMs);
  const propagationStatus: GateStatus = p95Ms == null || evidence.propagationLatenciesMs.length < 10
    ? "insufficient_evidence"
    : p95Ms < 2_000 ? "passed" : "failed";
  const measures: AcceptanceMeasure[] = [
    {
      key: "resume_without_restatement",
      label: "Resumed without manual restatement",
      status: ratioStatus(evidence.resumedWithoutRestatement, evidence.resumedSessions, 0.7),
      result: `${evidence.resumedWithoutRestatement}/${evidence.resumedSessions}`,
    },
    {
      key: "startup_interpretations",
      label: "Startup interpretations accepted or focused-corrected",
      status: ratioStatus(evidence.acceptedInterpretations + evidence.correctedInterpretations, interpretationTotal, 0.8),
      result: `${evidence.acceptedInterpretations + evidence.correctedInterpretations}/${interpretationTotal}`,
    },
    {
      key: "recommended_actions",
      label: "Recommended actions accepted or directly adapted",
      status: ratioStatus(evidence.acceptedOrAdaptedActions, evidence.recommendedActions, 0.5),
      result: `${evidence.acceptedOrAdaptedActions}/${evidence.recommendedActions}`,
    },
    {
      key: "proactive_interventions",
      label: "Accepted reversible intervention per working week",
      status: primaryProductTrial.status !== "passed"
        ? "insufficient_evidence"
        : primaryProductTrial.qualifyingWeeks.every((week) =>
          evidence.acceptedInterventionWeekDates.includes(week)
        ) ? "passed" : "failed",
      result: `${evidence.acceptedInterventionWeeks}/2 weeks`,
    },
    {
      key: "verified_outcomes",
      label: "Completed tasks have verified outcomes and useful re-entry points",
      status: evidence.completedTasks === 0
        ? "insufficient_evidence"
        : evidence.completedTasksWithVerifiedOutcomeAndReentry === evidence.completedTasks ? "passed" : "failed",
      result: `${evidence.completedTasksWithVerifiedOutcomeAndReentry}/${evidence.completedTasks}`,
    },
    {
      key: "cross_surface_parity",
      label: "CLI and Rails expose the same committed task state",
      status: evidence.realSessions === 0 ||
        evidence.parityEvidenceCount < evidence.realSessions ||
        propagationStatus === "insufficient_evidence"
        ? "insufficient_evidence"
        : propagationStatus === "passed" ? "passed" : "failed",
      result: `${evidence.parityEvidenceCount} observations`,
    },
    {
      key: "memory_safety",
      label: "No stale or unsupported memory confirmed as current",
      status: allRecorded(evidence.memorySafetyReviews),
      result: `${evidence.memorySafetyReviews.length} reviews`,
    },
    {
      key: "recommendation_rationale",
      label: "Recommendation rationale is identifiable without evidence noise",
      status: allRecorded(evidence.rationaleReviews),
      result: `${evidence.rationaleReviews.length} reviews`,
    },
  ];
  const automatedStatus = allRecorded(evidence.automatedAcceptanceRuns.map((run) =>
    run.idempotent && run.permissionsEnforced && run.noDuplicateEffects
  ));
  const statuses = [
    primaryProductTrial.status,
    technicalStatus,
    propagationStatus,
    automatedStatus,
    ...measures.map((measure) => measure.status),
  ];
  const hardFailure = primaryProductTrial.status === "failed"
    || propagationStatus === "failed"
    || automatedStatus === "failed"
    || measures
      .filter((measure) => ["memory_safety", "recommendation_rationale"].includes(measure.key))
      .some((measure) => measure.status === "failed");
  const status = hardFailure
    ? "failed"
    : primaryProductTrial.status === "insufficient_evidence" || technicalStatus === "insufficient_evidence"
      ? "insufficient_evidence"
      : overall(statuses);

  return {
    status,
    generatedAt: now.toISOString(),
    primaryProductTrial,
    technicalTrial: {
      status: technicalStatus,
      realSessions: evidence.realSessions,
      resumedSessions: evidence.resumedSessions,
    },
    measures,
    propagation: {
      status: propagationStatus,
      p95Ms,
      sampleSize: evidence.propagationLatenciesMs.length,
      targetMs: 2_000,
    },
    automatedAcceptance: {
      status: automatedStatus,
      runs: evidence.automatedAcceptanceRuns.length,
    },
  };
}

import type { PlanningConfidence } from "../intelligence/world/types.js";
import type { PredictionError } from "./future-model.js";
import type { PlanningLearningExample } from "./store.js";

export interface EmpiricalCalibrationSummary {
  total: number;
  scored: number;
  unscored: number;
  fullyCorrect: number;
  weightedAccuracy: number;
}

function outcomeScore(category: PredictionError): number | null {
  if (category === "insufficient_evidence") return null;
  if (category === "correct") return 1;
  if (category === "partially_correct") return 0.5;
  return 0;
}

/**
 * Calibration is based only on outcomes that could actually be scored.
 * `insufficient_evidence` remains learning data but never counts as an error.
 */
export function empiricalCalibration(examples: PlanningLearningExample[]): EmpiricalCalibrationSummary {
  let scored = 0;
  let fullyCorrect = 0;
  let scoreTotal = 0;
  for (const example of examples) {
    const score = outcomeScore(example.outcome.category);
    if (score == null) continue;
    scored += 1;
    scoreTotal += score;
    if (example.outcome.category === "correct") fullyCorrect += 1;
  }
  return {
    total: examples.length,
    scored,
    unscored: examples.length - scored,
    fullyCorrect,
    weightedAccuracy: scored ? scoreTotal / scored : 0,
  };
}

/**
 * Combine transition consistency with observed prediction accuracy. Sparse
 * calibration data cannot create confidence, while repeated bad predictions
 * can explicitly lower it. This is epistemic confidence only; it never grants
 * execution authority.
 */
export function calibratedEmpiricalConfidence(input: {
  support: number;
  total: number;
  examples: PlanningLearningExample[];
}): { level: PlanningConfidence; reasons: string[]; calibration: EmpiricalCalibrationSummary } {
  const supportRate = input.total ? input.support / input.total : 0;
  const calibration = empiricalCalibration(input.examples);
  const reasons = [
    `${input.support}/${input.total} matching runs support the weakest empirical signal`,
  ];

  if (calibration.scored === 0) {
    reasons.push(`no scored reconciliation outcomes yet; ${calibration.unscored} insufficient-evidence outcomes excluded from accuracy`);
    return {
      level: input.support >= 5 && supportRate >= 0.9 ? "high" : "medium",
      reasons,
      calibration,
    };
  }

  reasons.push(
    `calibration accuracy ${(calibration.weightedAccuracy * 100).toFixed(0)}% across ${calibration.scored} scored outcomes; ${calibration.unscored} insufficient-evidence outcomes excluded`,
  );

  // Three scored outcomes are enough to start exerting a cautious influence,
  // but five are required before calibration may produce high/low confidence.
  if (calibration.scored < 3) {
    return { level: "medium", reasons, calibration };
  }

  const calibrationWeight = Math.min(0.55, (calibration.scored / 10) * 0.55);
  const reliability = supportRate * (1 - calibrationWeight) + calibration.weightedAccuracy * calibrationWeight;
  reasons.push(`blended empirical reliability ${(reliability * 100).toFixed(0)}%`);

  if (calibration.scored >= 5 && calibration.weightedAccuracy < 0.45) {
    return { level: "low", reasons, calibration };
  }
  if (
    input.support >= 5 &&
    calibration.scored >= 5 &&
    calibration.weightedAccuracy >= 0.75 &&
    reliability >= 0.82
  ) {
    return { level: "high", reasons, calibration };
  }
  return { level: reliability >= 0.58 ? "medium" : "low", reasons, calibration };
}

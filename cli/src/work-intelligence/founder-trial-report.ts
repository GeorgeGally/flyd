import type { FounderJournalEntry, FounderEventType } from './types.js';

export type FounderTrialStatus = 'passed' | 'failed' | 'insufficient_evidence';

export interface FounderTrialMetrics {
  interventions_accepted: number;
  retained_improvements: number;
  projects_advanced: number;
  discoveries_missed: number;
  current_project_accuracy_samples: number;
  current_project_accuracy_correct: number;
  corrections_promoted: number;
  learning_improved_later: number;
}

export interface FounderTrialReport {
  status: FounderTrialStatus;
  metrics: FounderTrialMetrics;
  gaps: string[];
}

const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

const SEVEN_DAY_GATE = {
  interventions_accepted: 10,
  retained_improvements: 3,
  projects_advanced: 2,
  discoveries_missed: 3,
  current_project_accuracy_samples: 1,
  current_project_accuracy_rate: 0.90,
  corrections_promoted: 0,
  learning_improved_later: 1,
};

function countByType(entries: FounderJournalEntry[], types: FounderEventType[]): number {
  return entries.filter(e => types.includes(e.eventType)).length;
}

export function generateFounderTrialReport(entries: FounderJournalEntry[]): FounderTrialReport {
  const cutoff = new Date(Date.now() - SEVEN_DAY_MS).toISOString();
  const recent = entries.filter(e => e.timestamp >= cutoff);

  const interventionsAccepted = countByType(recent, ['intervention_accepted']);
  const retainedImprovements = countByType(recent, ['artifact_improved']);
  const projectsAdvanced = countByType(recent, ['project_advanced']);
  const discoveriesMissed = countByType(recent, ['issue_discovered']);
  const correctionsPromoted = countByType(recent, ['correction_applied']);
  const learningImprovedLater = countByType(recent, ['learning_promoted']);

  const accuracySamples = recent.filter(e => e.eventType === 'context_accuracy_sample');
  const accuracyCorrect = accuracySamples.filter(e => e.details.correctProject === true).length;

  const partialActions = countByType(recent, ['action_partial', 'action_failed']);

  const metrics: FounderTrialMetrics = {
    interventions_accepted: interventionsAccepted,
    retained_improvements: retainedImprovements,
    projects_advanced: projectsAdvanced,
    discoveries_missed: discoveriesMissed,
    current_project_accuracy_samples: accuracySamples.length,
    current_project_accuracy_correct: accuracyCorrect,
    corrections_promoted: correctionsPromoted,
    learning_improved_later: learningImprovedLater,
  };

  const gateGaps: string[] = [];

  if (metrics.interventions_accepted < SEVEN_DAY_GATE.interventions_accepted) {
    gateGaps.push(`interventions_accepted: ${metrics.interventions_accepted} / ${SEVEN_DAY_GATE.interventions_accepted} required`);
  }
  if (metrics.retained_improvements < SEVEN_DAY_GATE.retained_improvements) {
    gateGaps.push(`retained_improvements: ${metrics.retained_improvements} / ${SEVEN_DAY_GATE.retained_improvements} required`);
  }
  if (metrics.projects_advanced < SEVEN_DAY_GATE.projects_advanced) {
    gateGaps.push(`projects_advanced: ${metrics.projects_advanced} / ${SEVEN_DAY_GATE.projects_advanced} required`);
  }
  if (metrics.discoveries_missed < SEVEN_DAY_GATE.discoveries_missed) {
    gateGaps.push(`discoveries_missed: ${metrics.discoveries_missed} / ${SEVEN_DAY_GATE.discoveries_missed} required`);
  }
  if (metrics.learning_improved_later < SEVEN_DAY_GATE.learning_improved_later) {
    gateGaps.push(`learning_improved_later: ${metrics.learning_improved_later} / ${SEVEN_DAY_GATE.learning_improved_later} required`);
  }

  if (metrics.current_project_accuracy_samples > 0) {
    const rate = metrics.current_project_accuracy_correct / metrics.current_project_accuracy_samples;
    if (rate < SEVEN_DAY_GATE.current_project_accuracy_rate) {
      gateGaps.push(`current_project_accuracy: ${(rate * 100).toFixed(0)}% / ${(SEVEN_DAY_GATE.current_project_accuracy_rate * 100).toFixed(0)}% required (${metrics.current_project_accuracy_correct}/${metrics.current_project_accuracy_samples})`);
    }
  } else {
    gateGaps.push('current_project_accuracy: no samples recorded');
  }

  if (recent.length === 0) {
    return { status: 'insufficient_evidence', metrics, gaps: gateGaps };
  }

  const observations: string[] = [];
  if (partialActions > 0) {
    observations.push(`partial/failed actions present (${partialActions}): these do not count toward retained improvements or verified progress`);
  }

  if (gateGaps.length === 0) {
    return { status: 'passed', metrics, gaps: observations.length > 0 ? observations : [] };
  }

  const retainedOk = metrics.retained_improvements >= SEVEN_DAY_GATE.retained_improvements;
  const projectsOk = metrics.projects_advanced >= SEVEN_DAY_GATE.projects_advanced;
  const interventionsOk = metrics.interventions_accepted >= SEVEN_DAY_GATE.interventions_accepted;

  if (!retainedOk && !projectsOk && !interventionsOk) {
    if (metrics.interventions_accepted < 5 && recent.length >= 3) {
      return { status: 'failed', metrics, gaps: [...gateGaps, ...observations] };
    }
    return { status: 'insufficient_evidence', metrics, gaps: [...gateGaps, ...observations] };
  }

  return { status: 'insufficient_evidence', metrics, gaps: [...gateGaps, ...observations] };
}

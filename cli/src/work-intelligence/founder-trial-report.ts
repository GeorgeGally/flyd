import type { FounderTrialReport, FounderJournalEntry } from './types.js';
import { listJournalEntries, countJournalEntries } from './outcome-journal.js';

const TRIAL_PERIOD_DAYS = 7;
const GATE_REQUIREMENTS = {
  voluntaryUseDays: 5,
  acceptedInterventions: 10,
  improvedArtifacts: 3,
  advancedProjects: 2,
  discoveredIssues: 3,
  contextAccuracyPercent: 90,
  staleProjectsAllowed: 0,
};

export function generateFounderTrialReport(periodStart: string): FounderTrialReport {
  const periodEnd = new Date(new Date(periodStart).getTime() + TRIAL_PERIOD_DAYS * 86400000).toISOString();
  const allEntries = listJournalEntries({ since: periodStart });
  const endEntries = listJournalEntries({ since: periodStart, eventTypes: [] });

  const voluntaryUseDays = computeVoluntaryUseDays(allEntries);
  const acceptedInterventions = countJournalEntries({ since: periodStart, eventTypes: ['intervention_accepted'] });
  const improvedArtifacts = countJournalEntries({ since: periodStart, eventTypes: ['artifact_improved'] });
  const advancedProjects = countJournalEntries({ since: periodStart, eventTypes: ['project_advanced'] });
  const discoveredIssues = countJournalEntries({ since: periodStart, eventTypes: ['issue_discovered'] });

  const contextSamples = listJournalEntries({ since: periodStart, eventTypes: ['context_accuracy_sample'] });
  const totalSamples = contextSamples.length;
  const correctSamples = contextSamples.filter(e => e.details.correctProject === true).length;
  const staleProjectSamples = contextSamples.filter(e => e.details.correctProject === false).length;

  const contextAccuracyPercent = totalSamples > 0
    ? Math.round((correctSamples / totalSamples) * 100)
    : 0;

  const learningPromoted = countJournalEntries({ since: periodStart, eventTypes: ['learning_promoted'] });

  const gateChecks = {
    voluntaryUseDays: {
      required: GATE_REQUIREMENTS.voluntaryUseDays,
      actual: voluntaryUseDays,
      passed: voluntaryUseDays >= GATE_REQUIREMENTS.voluntaryUseDays,
    },
    acceptedInterventions: {
      required: GATE_REQUIREMENTS.acceptedInterventions,
      actual: acceptedInterventions,
      passed: acceptedInterventions >= GATE_REQUIREMENTS.acceptedInterventions,
    },
    improvedArtifacts: {
      required: GATE_REQUIREMENTS.improvedArtifacts,
      actual: improvedArtifacts,
      passed: improvedArtifacts >= GATE_REQUIREMENTS.improvedArtifacts,
    },
    advancedProjects: {
      required: GATE_REQUIREMENTS.advancedProjects,
      actual: advancedProjects,
      passed: advancedProjects >= GATE_REQUIREMENTS.advancedProjects,
    },
    discoveredIssues: {
      required: GATE_REQUIREMENTS.discoveredIssues,
      actual: discoveredIssues,
      passed: discoveredIssues >= GATE_REQUIREMENTS.discoveredIssues,
    },
    contextAccuracyPercent: {
      required: GATE_REQUIREMENTS.contextAccuracyPercent,
      actual: contextAccuracyPercent,
      passed: totalSamples > 0 && contextAccuracyPercent >= GATE_REQUIREMENTS.contextAccuracyPercent,
    },
    staleProjectsPresented: {
      allowed: GATE_REQUIREMENTS.staleProjectsAllowed,
      actual: staleProjectSamples,
      passed: staleProjectSamples <= GATE_REQUIREMENTS.staleProjectsAllowed,
    },
    laterImprovement: {
      required: true,
      met: learningPromoted > 0,
      passed: learningPromoted > 0,
    },
  };

  const allPassed = Object.values(gateChecks).every(check => check.passed);
  const hasAnyEvidence = allEntries.length > 0;

  let status: 'passed' | 'failed' | 'insufficient_evidence';
  if (!hasAnyEvidence) {
    status = 'insufficient_evidence';
  } else if (allPassed) {
    status = 'passed';
  } else {
    status = 'failed';
  }

  return {
    status,
    periodDays: TRIAL_PERIOD_DAYS,
    gateChecks,
    evidenceSummary: `Period: ${periodStart} to ${periodEnd}. ${allEntries.length} total journal entries. ${correctSamples}/${totalSamples} context accuracy samples correct.`,
    timestamp: new Date().toISOString(),
  };
}

function computeVoluntaryUseDays(entries: FounderJournalEntry[]): number {
  const usedDays = new Set<string>();
  for (const entry of entries) {
    const day = entry.timestamp.slice(0, 10);
    usedDays.add(day);
  }
  return usedDays.size;
}

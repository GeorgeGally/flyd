export type EpisodeEvalMode = "current" | "cover" | "cover-drill";

export interface EpisodeEvalCase {
  id: string;
  category: "what_happened" | "evolution" | "decision" | "change" | "historical_state";
  question: string;
  goldAnswer: string;
  rubric: string;
  evidenceSequences: number[];
  createdAt: string;
  snapshotHeadSequence: number;
}

export interface EpisodeEvalObservation {
  mode: EpisodeEvalMode;
  answer: string;
  seconds: number;
  contextCharacters: number;
  evidenceSequences: number[];
  episodeNodeIds: string[];
  judgeScore?: number;
  judgeReason?: string;
}

export interface EpisodeEvalResult extends EpisodeEvalObservation {
  caseId: string;
  category: EpisodeEvalCase["category"];
  evidenceRecall: number;
  passed: boolean;
}

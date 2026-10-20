import type { EpisodeEvalCase } from "./types.js";

export function evidenceRecall(expected: number[], observed: number[]): number {
  if (!expected.length) return 1;
  const seen = new Set(observed);
  return expected.filter((sequence) => seen.has(sequence)).length / expected.length;
}

export function buildEpisodeJudgePrompt(testCase: EpisodeEvalCase, answer: string): string {
  return [
    "You are grading historical recall by a personal AI assistant.",
    "Judge factual and temporal accuracy against the frozen gold answer and rubric. Do not reward verbosity.",
    `Question: ${testCase.question}`,
    `Gold answer: ${testCase.goldAnswer}`,
    `Rubric: ${testCase.rubric}`,
    `Assistant answer: ${answer || "(empty)"}`,
    'Reply with JSON only: {"score": <integer 1-10>, "reason": "<one sentence naming the biggest error or saying accurate>"}',
  ].join("\n\n");
}

export function parseEpisodeJudge(text: string): { score: number; reason: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { score?: unknown; reason?: unknown };
    const score = Number(parsed.score);
    if (!Number.isFinite(score) || score < 1 || score > 10) return null;
    return { score: Math.round(score), reason: String(parsed.reason ?? "") };
  } catch {
    return null;
  }
}


export interface EpisodePromotionMetrics {
  currentQuality: number;
  drillQuality: number;
  currentPasses: number;
  drillPasses: number;
  currentMedianSeconds: number;
  drillMedianSeconds: number;
  currentContextCharacters: number;
  drillContextCharacters: number;
}

export function evaluatePromotionGate(metrics: EpisodePromotionMetrics): { promoted: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const qualityDelta = metrics.drillQuality - metrics.currentQuality;
  if (qualityDelta < 0.5) reasons.push(`quality delta ${qualityDelta.toFixed(2)} < 0.50`);
  if (metrics.drillPasses < metrics.currentPasses) reasons.push(`passes regressed ${metrics.drillPasses} < ${metrics.currentPasses}`);
  const latencyCeiling = metrics.currentMedianSeconds * 1.75 + 2;
  if (metrics.drillMedianSeconds > latencyCeiling) reasons.push(`median latency ${metrics.drillMedianSeconds.toFixed(1)}s > ${latencyCeiling.toFixed(1)}s ceiling`);
  const contextCeiling = metrics.currentContextCharacters * 3 + 6000;
  if (metrics.drillContextCharacters > contextCeiling) reasons.push(`context ${Math.round(metrics.drillContextCharacters)} chars > ${Math.round(contextCeiling)} ceiling`);
  return { promoted: reasons.length === 0, reasons };
}

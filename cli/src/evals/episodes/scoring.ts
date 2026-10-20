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

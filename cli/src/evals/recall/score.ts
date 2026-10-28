export interface RecallScoreRow {
  answers: string[];
  stale: string[];
  paths: string[];
  noAnswer: boolean;
}

export function scoreRecall(rows: RecallScoreRow[]) {
  const positive = rows.filter((row) => !row.noAnswer);
  const negative = rows.filter((row) => row.noAnswer);
  return {
    answerCases: positive.length,
    top1: positive.filter((row) => row.answers.includes(row.paths[0] ?? "")).length,
    top5: positive.filter((row) => row.paths.slice(0, 5).some((path) => row.answers.includes(path))).length,
    misses: positive.filter((row) => !row.paths.slice(0, 5).some((path) => row.answers.includes(path))).length,
    staleTop1: positive.filter((row) => row.stale.includes(row.paths[0] ?? "")).length,
    negativeCases: negative.length,
    negativeWithResults: negative.filter((row) => row.paths.length > 0).length,
  };
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../../lib/config.js";
import { query } from "../../lib/llm.js";
import { evalJudgeModel } from "../chat/scoring.js";
import { buildEvalContext } from "./context.js";
import { buildEpisodeJudgePrompt, evidenceRecall, parseEpisodeJudge } from "./scoring.js";
import type { EpisodeEvalCase, EpisodeEvalMode, EpisodeEvalResult } from "./types.js";
import { EpisodicMemory } from "../../intelligence/episodes/service.js";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function answer(question: string, context: string, model?: string): Promise<string> {
  return query(
    [
      "Answer George's historical question using only the supplied personal evidence.",
      "Distinguish what was true then from what is true now. If evidence is insufficient, say exactly what is missing.",
      "Do not mention evaluation machinery, episode nodes, event ids, or retrieval strategy.",
      "",
      `Question: ${question}`,
      "",
      "Personal evidence:",
      context || "(none)",
    ].join("\n"),
    model,
    undefined,
    undefined,
    undefined,
    { source: "episode-eval-answer" },
  );
}

async function main(): Promise<void> {
  const model = argValue("--model");
  const judgeModel = argValue("--judge") ?? evalJudgeModel();
  const only = argValue("--only")?.split(",").map((value) => value.trim()).filter(Boolean);
  const casePath = argValue("--cases") ?? join(FLYD_DIR, "evals", "episodes", "cases.json");
  const cases = JSON.parse(readFileSync(casePath, "utf8")) as EpisodeEvalCase[];
  const selected = only ? cases.filter((item) => only.includes(item.id)) : cases;
  if (!selected.length) throw new Error("No episodic eval cases selected");

  new EpisodicMemory().rebuild();
  const modes: EpisodeEvalMode[] = ["current", "cover", "cover-drill"];
  const results: EpisodeEvalResult[] = [];

  for (const testCase of selected) {
    for (const mode of modes) {
      const started = Date.now();
      const context = await buildEvalContext(mode, testCase.question);
      const response = await answer(testCase.question, context.text, model);
      const judged = parseEpisodeJudge(await query(
        buildEpisodeJudgePrompt(testCase, response),
        judgeModel,
        undefined,
        undefined,
        undefined,
        { json: true, source: "episode-eval-judge" },
      ));
      const result: EpisodeEvalResult = {
        caseId: testCase.id,
        category: testCase.category,
        mode,
        answer: response,
        seconds: (Date.now() - started) / 1000,
        contextCharacters: context.text.length,
        evidenceSequences: context.evidenceSequences,
        episodeNodeIds: context.episodeNodeIds,
        evidenceRecall: evidenceRecall(testCase.evidenceSequences, context.evidenceSequences),
        ...(judged ? { judgeScore: judged.score, judgeReason: judged.reason } : {}),
        passed: (judged?.score ?? 0) >= 8,
      };
      results.push(result);
      process.stdout.write(
        `${result.passed ? "PASS" : "FAIL"} ${testCase.id.padEnd(12)} ${mode.padEnd(11)} judge=${result.judgeScore ?? "-"} recall=${result.evidenceRecall.toFixed(2)} ctx=${result.contextCharacters} chars ${result.seconds.toFixed(1)}s\n`
      );
    }
  }

  const directory = join(FLYD_DIR, "evals", "episodes", "runs");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(directory, `${stamp}.jsonl`);
  writeFileSync(path, results.map((row) => JSON.stringify(row)).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });

  process.stdout.write("\nEpisodic memory benchmark\n");
  for (const mode of modes) {
    const rows = results.filter((row) => row.mode === mode);
    const judged = rows.filter((row) => row.judgeScore !== undefined);
    const meanJudge = judged.length ? judged.reduce((sum, row) => sum + (row.judgeScore ?? 0), 0) / judged.length : 0;
    const meanRecall = rows.reduce((sum, row) => sum + row.evidenceRecall, 0) / rows.length;
    const meanContext = rows.reduce((sum, row) => sum + row.contextCharacters, 0) / rows.length;
    process.stdout.write(
      `${mode.padEnd(11)} quality=${meanJudge.toFixed(2)}/10 pass=${rows.filter((row) => row.passed).length}/${rows.length} evidence-recall=${meanRecall.toFixed(2)} median=${median(rows.map((row) => row.seconds)).toFixed(1)}s context≈${Math.round(meanContext)} chars\n`
    );
  }
  const current = results.filter((row) => row.mode === "current");
  const drill = results.filter((row) => row.mode === "cover-drill");
  const currentMean = current.reduce((sum, row) => sum + (row.judgeScore ?? 0), 0) / current.length;
  const drillMean = drill.reduce((sum, row) => sum + (row.judgeScore ?? 0), 0) / drill.length;
  process.stdout.write(`\nDelta cover+drill vs current: ${(drillMean - currentMean).toFixed(2)} judge points\nResults: ${path}\n`);
}

main().catch((error) => {
  process.stderr.write(`episode eval failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

import { runPlanningBenchmark } from "../planning/benchmark.js";

export async function runPlanningEval(options: { json?: boolean } = {}): Promise<void> {
  const result = await runPlanningBenchmark();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Planning benchmark: ${result.passed}/${result.total} passed\n`);
  for (const failure of result.failures) {
    process.stdout.write(`FAIL ${failure.scenario}: expected=${failure.expected} actual=${failure.actual ?? "none"}\n`);
  }
  if (result.failures.length > 0) process.exitCode = 1;
}

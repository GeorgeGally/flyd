import { listSkills, loadHistory, runSkillOptimization, type OptimizationOptions } from "../lib/skill-optimizer.js";
import { updateRaw, embedRaw } from "../lib/qmd.js";

function formatScore(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export async function runOptimizeSkill(
  name: string,
  opts: {
    iterations?: number;
    model?: string;
    executor?: string;
    judge?: string;
    dryRun?: boolean;
    noCache?: boolean;
    history?: boolean;
  },
): Promise<void> {
  const iterations = opts.iterations ?? 2;

  if (opts.history) {
    const entries = loadHistory(name);
    if (entries.length === 0) {
      console.log(`No optimization history for "${name}".`);
      return;
    }
    console.log(`\nOptimization history: ${name}\n`);
    for (const e of entries.reverse()) {
      const status = e.accepted ? "✓" : "✗";
      console.log(`  v${e.version} ${status}  ${e.preScore.toFixed(2)} → ${e.postScore.toFixed(2)}  \$${e.cost.toFixed(2)}  ${e.timestamp.slice(0, 10)}`);
    }
    return;
  }

  const optimizerOpts: OptimizationOptions = {
    iterations,
    executorModel: opts.executor ?? "gpt-4o-mini",
    judgeModel: opts.judge ?? "claude-3-haiku",
    optimizerModel: opts.model ?? "gpt-4o-mini",
    dryRun: opts.dryRun ?? false,
    noCache: opts.noCache ?? false,
  };

  console.log(`\nOptimizing skill: ${name}`);
  console.log(`  iterations: ${iterations}`);
  console.log(`  executor: ${optimizerOpts.executorModel}`);
  console.log(`  judge: ${optimizerOpts.judgeModel}`);
  console.log(`  optimizer: ${optimizerOpts.optimizerModel}`);
  if (optimizerOpts.dryRun) console.log("  [dry run — no changes will be written]\n");
  else console.log();

  const result = await runSkillOptimization(name, optimizerOpts);

  console.log(`\nResult:`);
  console.log(`  Version ${result.version} — ${result.accepted ? "✓ Accepted" : "✗ Rejected"}`);
  console.log(`  Overall: ${formatScore(result.preScore)} → ${formatScore(result.postScore)}`);
  console.log(`  Held-out: ${formatScore(result.heldOutPreScore)} → ${formatScore(result.heldOutPostScore)}`);
  console.log(`  Cost: \$${result.cost.toFixed(2)}`);

  if (!opts.dryRun) {
    await updateRaw();
    await embedRaw();
  }
}

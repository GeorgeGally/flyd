import { readFileSync } from "node:fs";
import { FLYD_DIR } from "../src/lib/config.js";
import { auditRouting, defaultRoutingJudge } from "../src/runtime/routing-audit-runner.js";
import {
  evaluateRouting, importRoutingReceipts, parseRoutingProposal, recordRoutingPrediction,
  reviewRoutingCase, routingCases, routingChallenges, routingHash, routingLabelPrompt, routingReviewQueue, runRoutingAudit,
  type RoutingDecision,
} from "../src/runtime/routing-learning.js";

// Personal evidence stays under FLYD_DIR. No data or label file is written
// into source fixtures. Explicit predict/test commands may inspect holdout;
// the unattended audit only sees development cases.
const [action = "status", ...args] = process.argv.slice(2);
const root = FLYD_DIR;
const count = Math.max(1, Math.min(Number(args[0]) || 100, 100));
let result: unknown;
switch (action) {
  case "import": result = importRoutingReceipts(root); break;
  case "status": result = { cases: routingCases(root).length, reviewPending: routingReviewQueue(root).length, evaluation: evaluateRouting(root) }; break;
  case "sample": result = routingReviewQueue(root).filter((r) => r.entry.split === "development").slice(0, count)
    .map(({ entry }) => ({ caseId: entry.id, split: entry.split, prompt: routingLabelPrompt(entry) })); break;
  case "review-queue": result = { unreviewed: routingReviewQueue(root).filter((r) => r.entry.split === "development").slice(0, count), challenges: routingChallenges(root) }; break;
  case "label":
    result = await runRoutingAudit({ root, force: true, limit: count, judge: defaultRoutingJudge, judgeModel: process.env.FLYD_ROUTING_JUDGE_MODEL });
    break;
  case "review": {
    if (!args[0]) throw new Error("review requires a local JSON file with explicit reviewed labels");
    const rows = JSON.parse(readFileSync(args[0], "utf8")) as Array<{ caseId: string; expected: RoutingDecision; reason: string; reviewer: string }>;
    if (!Array.isArray(rows)) throw new Error("Review file must be an array");
    result = rows.map((r) => reviewRoutingCase(root, r.caseId, r.expected, r.reason, r.reviewer));
    break;
  }
  case "predict": {
    const [arm, split = "validation"] = args;
    if (!arm || !["development", "validation", "test"].includes(split)) throw new Error("predict requires arm-name and development|validation|test");
    const model = process.env.FLYD_ROUTING_JUDGE_MODEL;
    if (!model) throw new Error("Set FLYD_ROUTING_JUDGE_MODEL to the model to benchmark");
    let predicted = 0;
    for (const entry of routingCases(root).filter((e) => e.split === split && e.trace.contextComplete)) {
      const started = Date.now();
      const prompt = routingLabelPrompt(entry);
      const proposal = parseRoutingProposal(await defaultRoutingJudge(prompt), entry, model);
      if (proposal.ambiguous) continue;
      recordRoutingPrediction(root, { caseId: entry.id, arm, decision: proposal.expected, model,
        policyVersion: routingHash(prompt.split("Decision-time input:")[0]), latencyMs: Date.now() - started, at: new Date().toISOString() });
      predicted++;
    }
    result = { arm, split, predicted };
    break;
  }
  case "evaluate": {
    const [arm = "observed", split] = args;
    if (split && !["development", "validation", "test"].includes(split)) throw new Error("Invalid split");
    result = evaluateRouting(root, arm, split as "development" | "validation" | "test" | undefined);
    break;
  }
  case "audit": result = await auditRouting(root, true); break;
  default: throw new Error("Use import|status|sample [N]|label [N]|review <file>|predict <arm> <split>|evaluate [arm] [split]|audit");
}
process.stdout.write(JSON.stringify(result, null, 2) + "\n");

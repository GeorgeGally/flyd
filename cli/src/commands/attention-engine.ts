import { attentionEngine } from "../attention/attention-engine.js";
import { commitmentStore } from "../attention/commitment-store.js";
import { extractAndPersistCommitments } from "../attention/commitment-extractor.js";
import { attentionDispatcher } from "../attention/attention-dispatcher.js";
import { attentionPolicyEngine } from "../attention/attention-policy-engine.js";
import { outcomeRecorder } from "../attention/outcome-recorder.js";
import { candidateBuilder } from "../attention/candidate-builder.js";

export async function runAttentionEngineStatus(): Promise<void> {
  const report = attentionEngine.getEngineReport();
  console.log("Attention Engine Report");
  console.log("=======================");
  console.log(`  Running: ${report.running}`);
  console.log(`  Shadow mode: ${report.shadowMode}`);
  console.log(`  Policy version: ${report.policyVersion}`);
  console.log("");
  console.log("Metrics:");
  console.log(`  Candidates created: ${report.metrics.candidatesCreated}`);
  console.log(`  Candidates deduplicated: ${report.metrics.candidatesDeduplicated}`);
  console.log(`  Surfaces generated: ${report.metrics.surfacesGenerated}`);
  console.log(`  Interruptions delivered: ${report.metrics.interruptionsDelivered}`);
  console.log(`  Interruption budget remaining: ${report.metrics.interruptionsBudgetRemaining}`);
  console.log(`  Policy versions: ${report.metrics.policyVersions}`);
  console.log("");
  console.log("Pipelines:");
  console.log(`  Pending candidates: ${report.pendingCandidates}`);
  console.log(`  Active scene claims: ${report.sceneClaims}`);
  console.log("");
  console.log("Outcomes:");
  console.log(`  Total: ${report.outcomes.total}`);
  console.log(`  Opened: ${report.outcomes.opened}, Dismissed: ${report.outcomes.dismissed}`);
  console.log(`  Corrected: ${report.outcomes.corrected}, Approved: ${report.outcomes.approved}`);
  console.log(`  Acted: ${report.outcomes.acted} (succeeded: ${report.outcomes.actionSucceeded}, failed: ${report.outcomes.actionFailed})`);
}

export async function runAttentionEngineStart(shadow = true): Promise<void> {
  attentionEngine.start({ shadowMode: shadow, logDecisions: true });
  console.log(`Attention engine started (shadow=${shadow})`);
}

export async function runAttentionEngineStop(): Promise<void> {
  attentionEngine.stop();
  console.log("Attention engine stopped");
}

export async function runAttentionEngineCommitmentsList(): Promise<void> {
  const commitments = commitmentStore.list();
  if (commitments.length === 0) {
    console.log("No commitments found");
    return;
  }

  console.log(`Commitments (${commitments.length}):`);
  console.log("");

  for (const c of commitments) {
    const statusIcon = statusIconMap[c.status] ?? "?";
    console.log(`  [${statusIcon}] ${c.title}`);
    console.log(`      id: ${c.id}`);
    console.log(`      kind: ${c.kind}, status: ${c.status}, confidence: ${c.confidence.toFixed(2)}`);
    if (c.dueAt) console.log(`      due: ${c.dueAt}`);
    if (c.consequence) console.log(`      consequence: ${c.consequence}`);
    console.log("");
  }
}

export async function runAttentionEngineCommitmentsCreate(params: {
  title: string;
  kind?: string;
  dueAt?: string;
  status?: string;
  consequence?: string;
}): Promise<void> {
  const created = commitmentStore.create({
    kind: (params.kind as "promise" | "request" | "deadline" | "payment" | "delegation" | "follow_up" | "decision_review") ?? "follow_up",
    title: params.title,
    dueAt: params.dueAt,
    status: (params.status as "proposed" | "open" | "blocked" | "done" | "cancelled" | "expired") ?? "open",
    consequence: params.consequence,
    confidence: 0.8,
  });

  console.log(`Commitment created: ${created.id}`);
  console.log(`  Title: ${created.title}`);
  console.log(`  Status: ${created.status}`);
}

export async function runAttentionEngineDecisions(limit = 10): Promise<void> {
  const decisions = attentionEngine.getDecisionLog().slice(-limit);
  if (decisions.length === 0) {
    console.log("No decisions yet");
    return;
  }

  console.log(`Recent decisions (${decisions.length}):`);
  console.log("");

  for (const d of decisions) {
    const icon = dispositionIconMap[d.disposition] ?? "?";
    console.log(`  [${icon}] ${d.disposition}`);
    console.log(`      candidate: ${d.candidateId}`);
    console.log(`      reasons: ${d.reasonCodes.join(", ")}`);
    console.log(`      confidence: ${d.confidence.toFixed(2)}`);
    console.log(`      policy: ${d.policyVersion}`);
    console.log(`      decided: ${d.decidedAt}`);
    console.log("");
  }
}

export async function runAttentionEngineClaims(): Promise<void> {
  const claims = attentionDispatcher.getSceneClaims(10);
  if (claims.length === 0) {
    console.log("No active scene claims");
    return;
  }

  console.log(`Active scene claims (${claims.length}):`);
  console.log("");

  for (const claim of claims) {
    console.log(`  #${claim.rank} ${claim.headline}`);
    console.log(`      id: ${claim.id}`);
    console.log(`      why: ${claim.whyNow}`);
    if (claim.proposedActions.length > 0) {
      console.log(`      actions: ${claim.proposedActions.map((a) => a.description).join(", ")}`);
    }
    if (claim.expiresAt) console.log(`      expires: ${claim.expiresAt}`);
    console.log("");
  }
}

export async function runAttentionEnginePolicy(): Promise<void> {
  const config = attentionPolicyEngine.getConfig();
  console.log("Policy Configuration");
  console.log("====================");
  console.log(`  Global proactivity: ${config.globalProactivityEnabled}`);
  console.log(`  Interruption budget: ${config.interruptionBudget}`);
  console.log(`  Daily interruption limit: ${config.dailyInterruptionLimit}`);
  console.log(`  Protected hours: ${config.protectedHours.startHour}:00-${config.protectedHours.endHour}:00`);
  console.log(`  Notify-now allowlist: ${config.notifyNowAllowlist.join(", ")}`);
  console.log("");
  console.log("Score Weights:");
  for (const [key, value] of Object.entries(config.scoreWeights)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("");
  console.log("Band Thresholds:");
  for (const [band, range] of Object.entries(config.scoreBandThresholds)) {
    console.log(`  ${band}: ${range.min} - ${range.max}`);
  }
}

export async function runAttentionEngineTick(): Promise<void> {
  const report = await attentionEngine.tick();
  console.log("Tick completed");
  console.log(`  Candidates evaluated: ${report.candidatesEvaluated}`);
  console.log(`  Decisions made: ${report.decisions.length}`);
  console.log(`  Dispatched: ${Object.keys(report.dispatched).length}`);
}

export async function runAttentionEngineKill(params: {
  name?: "global" | "source" | "eventClass";
  value?: string;
  release?: boolean;
}): Promise<void> {
  if (params.release) {
    attentionEngine.release(params.name ?? "global", params.value);
    console.log(`Kill switch released: ${params.name ?? "global"}${params.value ? ` (${params.value})` : ""}`);
  } else {
    attentionEngine.kill(params.name ?? "global", params.value);
    console.log(`Kill switch engaged: ${params.name ?? "global"}${params.value ? ` (${params.value})` : ""}`);
  }
}

export async function runAttentionEngineReset(): Promise<void> {
  attentionEngine.reset();
  console.log("Attention engine reset");
}

const statusIconMap: Record<string, string> = {
  proposed: "~",
  open: "o",
  blocked: "!",
  done: "x",
  cancelled: "-",
  expired: "e",
};

const dispositionIconMap: Record<string, string> = {
  ignore: "_",
  remember: "R",
  prepare: "P",
  next_scene: "S",
  notify_now: "!",
  ask_permission: "?",
  act: "A",
};

import { randomUUID } from "crypto";
import { mkdir, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { FLYD_DIR } from "../lib/config.js";
import { serialize } from "../lib/frontmatter.js";
import { loadLatestTurnReceipt, type TurnReceipt } from "./turn-receipt.js";

export type TurnFailureClass =
  | "model_configuration"
  | "memory_authority"
  | "missing_tool_use"
  | "tool_failure"
  | "answer_quality";

export interface TurnRepair {
  version: 1;
  id: string;
  recordedAt: string;
  turnReceiptId: string;
  sessionId: string;
  turnNumber: number;
  feedback: string;
  source: "explicit_command" | "foreground_feedback";
  foregroundObservationId?: string;
  failureClasses: TurnFailureClass[];
  repairTargets: string[];
}

export interface TurnRepairOptions {
  flydDir?: string;
  sessionId?: string;
  expectedTurnReceiptId?: string;
  source?: "explicit_command" | "foreground_feedback";
  foregroundObservationId?: string;
  id?: () => string;
  now?: () => Date;
}

const TRUSTED_AUTHORITIES = new Set([ "user_confirmed", "verified_outcome", "durable_memory" ]);

function classifyFailure(receipt: TurnReceipt): TurnFailureClass[] {
  const failures: TurnFailureClass[] = [];
  if (/gpt-4o-mini/i.test(receipt.model)) failures.push("model_configuration");
  const hasTrustedMemory = receipt.memory.matches.some((match) =>
    match.authority && TRUSTED_AUTHORITIES.has(match.authority)
  );
  if (receipt.memory.verdict === "sufficient" && !hasTrustedMemory) failures.push("memory_authority");
  const projectQuestion = /\b(?:flyd|repo|repository|project|code|runtime|branch|commit|test)\b/i.test(receipt.message);
  if (projectQuestion && receipt.toolCalls.length === 0) failures.push("missing_tool_use");
  if (receipt.toolCalls.some((call) => !call.succeeded)) failures.push("tool_failure");
  failures.push("answer_quality");
  return failures;
}

function targetsFor(failures: TurnFailureClass[]): string[] {
  const target = new Set<string>();
  for (const failure of failures) {
    if (failure === "model_configuration") target.add("model configuration");
    if (failure === "memory_authority") target.add("memory ranking and sufficiency");
    if (failure === "missing_tool_use" || failure === "tool_failure") target.add("turn tool loop");
    if (failure === "answer_quality") target.add("behavioral regression evaluation");
  }
  return [ ...target ];
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function repairLatestTurn(
  feedback: string,
  options: TurnRepairOptions = {},
): Promise<TurnRepair> {
  const flydDir = options.flydDir ?? FLYD_DIR;
  const receipt = await loadLatestTurnReceipt({ flydDir, sessionId: options.sessionId });
  if (!receipt) throw new Error("No Flyd turn receipt is available to repair");
  if (options.expectedTurnReceiptId && receipt.id !== options.expectedTurnReceiptId) {
    throw new Error("The Flyd turn changed before feedback could be attached");
  }
  const normalizedFeedback = feedback.trim() || "The preceding Flyd response was not useful.";
  const id = (options.id ?? randomUUID)();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("Invalid Flyd repair ID");
  const recordedAt = (options.now?.() ?? new Date()).toISOString();
  const failureClasses = classifyFailure(receipt);
  const repair: TurnRepair = {
    version: 1,
    id,
    recordedAt,
    turnReceiptId: receipt.id,
    sessionId: receipt.sessionId,
    turnNumber: receipt.turnNumber,
    feedback: normalizedFeedback,
    source: options.source ?? "explicit_command",
    foregroundObservationId: options.foregroundObservationId,
    failureClasses,
    repairTargets: targetsFor(failureClasses),
  };

  const correction = serialize({
    type: "correction",
    source: options.source ?? "explicit_command",
    promoted: true,
    epistemic_status: "user_confirmed",
    timestamp: recordedAt,
    turn_receipt_id: receipt.id,
    session_id: receipt.sessionId,
    ...(options.foregroundObservationId
      ? { foreground_observation_id: options.foregroundObservationId }
      : {}),
    failure_classes: failureClasses,
  }, [
    "# Flyd response correction",
    "",
    `For the request: ${receipt.message}`,
    "",
    `George's explicit feedback: ${normalizedFeedback}`,
    "",
    "Do not reuse the rejected answer as knowledge. Treat this correction as authoritative when handling the same intent.",
  ].join("\n"));

  const regression = {
    version: 1,
    incidentId: id,
    turnReceiptId: receipt.id,
    prompt: receipt.message,
    rejectedAnswer: receipt.answer,
    model: receipt.model,
    memory: receipt.memory,
    toolCalls: receipt.toolCalls,
    expected: {
      feedback: normalizedFeedback,
      failureClasses,
      requirements: [
        "Use trusted memory when it directly answers the request",
        "Inspect current project evidence when the request depends on current code",
        "Do not return a generic capability list or outsource prioritization to George",
      ],
    },
  };

  await Promise.all([
    atomicWrite(join(flydDir, "fixes", `${id}.json`), `${JSON.stringify(repair, null, 2)}\n`),
    atomicWrite(join(flydDir, "wiki", "corrections", `flyd-fix-${id}.md`), `${correction}\n`),
    atomicWrite(join(flydDir, "evals", "incidents", `${id}.json`), `${JSON.stringify(regression, null, 2)}\n`),
  ]);
  return repair;
}

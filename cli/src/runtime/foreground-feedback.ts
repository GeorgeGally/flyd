import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { FLYD_DIR } from "../lib/config.js";
import { redactSensitiveText } from "./context-redactor.js";
import { repairLatestTurn } from "./turn-repair.js";
import { loadLatestTurnReceipt } from "./turn-receipt.js";

export type ForegroundFeedbackSource = "chatgpt" | "opencode" | "codex";
export type ForegroundFeedbackAuthorship = "direct_input" | "ambiguous_terminal";

export interface ForegroundFeedbackInput {
  version: 1;
  capturedAt: string;
  source: ForegroundFeedbackSource;
  authorship: ForegroundFeedbackAuthorship;
  application: {
    bundleId: string;
    name: string;
  };
  windowTitle?: string;
  browserURL?: string;
  text: string;
}

export type ForegroundFeedbackStatus = "repaired" | "pending" | "duplicate";
export type ForegroundFeedbackReason =
  | "flyd_turn_not_explicit"
  | "authorship_ambiguous"
  | "flyd_turn_stale"
  | "no_flyd_turn"
  | "turn_changed_before_repair"
  | "recent_duplicate";

export interface ForegroundFeedbackResult {
  observationId: string;
  status: ForegroundFeedbackStatus;
  reason?: ForegroundFeedbackReason;
  turnReceiptId?: string;
}

interface ForegroundFeedbackOptions {
  flydDir?: string;
  id?: () => string;
  repairId?: () => string;
  now?: () => Date;
}

interface StoredForegroundFeedback extends ForegroundFeedbackInput {
  observationId: string;
  receivedAt: string;
  fingerprint: string;
  status: ForegroundFeedbackStatus;
  reason?: ForegroundFeedbackReason;
  turnReceiptId?: string;
}

const MAX_FEEDBACK_CHARS = 4_000;
const TURN_LINK_WINDOW_MS = 6 * 60 * 60 * 1_000;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1_000;
const FLYD_REFERENCE = /\bflyd(?:'s)?\b/i;
const TURN_REFERENCE = /\b(?:answer|response|reply|output|result|last turn|previous turn)\b/i;
const NEGATIVE_ASSESSMENT = /\b(?:bad|generic|useless|wrong|unhelpful|terrible|awful|broken|failed|failing|hallucinat(?:ed|ion)|untrustworthy|not useful|doesn['’]t work|cannot do|can['’]t do)\b/i;

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

function validate(input: ForegroundFeedbackInput): ForegroundFeedbackInput {
  if (input.version !== 1) throw new Error("Unsupported foreground feedback version");
  if (![ "chatgpt", "opencode", "codex" ].includes(input.source)) {
    throw new Error("Unsupported foreground feedback source");
  }
  if (![ "direct_input", "ambiguous_terminal" ].includes(input.authorship)) {
    throw new Error("Unsupported foreground feedback authorship");
  }
  const text = redactSensitiveText(input.text.trim());
  if (!text || text.length > MAX_FEEDBACK_CHARS) throw new Error("Invalid foreground feedback text");
  if (!NEGATIVE_ASSESSMENT.test(text)) throw new Error("Foreground text is not negative feedback");
  const capturedAt = new Date(input.capturedAt);
  if (Number.isNaN(capturedAt.getTime())) throw new Error("Invalid foreground feedback timestamp");
  if (!input.application || typeof input.application.bundleId !== "string" || typeof input.application.name !== "string") {
    throw new Error("Invalid foreground feedback application");
  }
  return {
    ...input,
    text,
    application: {
      bundleId: input.application.bundleId.slice(0, 200),
      name: input.application.name.slice(0, 200),
    },
    windowTitle: input.windowTitle?.slice(0, 500),
    browserURL: input.browserURL?.slice(0, 1_000),
  };
}

function feedbackFingerprint(input: ForegroundFeedbackInput): string {
  return createHash("sha256")
    .update(`${input.source}|${input.authorship}|${input.text.toLocaleLowerCase()}`)
    .digest("hex");
}

async function loadDuplicate(
  flydDir: string,
  fingerprint: string,
  capturedAt: Date,
): Promise<StoredForegroundFeedback | null> {
  try {
    const stored = JSON.parse(await readFile(
      join(flydDir, "foreground-feedback", "fingerprints", `${fingerprint}.json`),
      "utf8",
    )) as StoredForegroundFeedback;
    const previousAt = new Date(stored.capturedAt).getTime();
    return Math.abs(capturedAt.getTime() - previousAt) <= DUPLICATE_WINDOW_MS ? stored : null;
  } catch {
    return null;
  }
}

async function persistObservation(flydDir: string, observation: StoredForegroundFeedback): Promise<void> {
  const serialized = `${JSON.stringify(observation, null, 2)}\n`;
  await Promise.all([
    atomicWrite(
      join(flydDir, "foreground-feedback", "observations", `${observation.observationId}.json`),
      serialized,
    ),
    atomicWrite(
      join(flydDir, "foreground-feedback", "fingerprints", `${observation.fingerprint}.json`),
      serialized,
    ),
  ]);
}

export async function recordForegroundFeedback(
  rawInput: ForegroundFeedbackInput,
  options: ForegroundFeedbackOptions = {},
): Promise<ForegroundFeedbackResult> {
  const input = validate(rawInput);
  const flydDir = options.flydDir ?? FLYD_DIR;
  const observationId = (options.id ?? randomUUID)();
  if (!/^[A-Za-z0-9._-]+$/.test(observationId)) throw new Error("Invalid foreground observation ID");
  const now = options.now?.() ?? new Date();
  const capturedAt = new Date(input.capturedAt);
  const fingerprint = feedbackFingerprint(input);
  const duplicate = await loadDuplicate(flydDir, fingerprint, capturedAt);
  if (duplicate) {
    return {
      observationId: duplicate.observationId,
      status: "duplicate",
      reason: "recent_duplicate",
      turnReceiptId: duplicate.turnReceiptId,
    };
  }

  const receipt = await loadLatestTurnReceipt({ flydDir });
  let status: ForegroundFeedbackStatus = "pending";
  let reason: ForegroundFeedbackReason | undefined;
  let turnReceiptId: string | undefined;

  if (input.authorship !== "direct_input") {
    reason = "authorship_ambiguous";
  } else if (!FLYD_REFERENCE.test(input.text) || !TURN_REFERENCE.test(input.text)) {
    reason = "flyd_turn_not_explicit";
  } else if (!receipt) {
    reason = "no_flyd_turn";
  } else if (Math.abs(capturedAt.getTime() - new Date(receipt.recordedAt).getTime()) > TURN_LINK_WINDOW_MS) {
    reason = "flyd_turn_stale";
  } else {
    turnReceiptId = receipt.id;
  }

  let observation: StoredForegroundFeedback = {
    ...input,
    observationId,
    receivedAt: now.toISOString(),
    fingerprint,
    status,
    reason,
    turnReceiptId,
  };
  await persistObservation(flydDir, observation);

  if (turnReceiptId && !reason) {
    try {
      const repair = await repairLatestTurn(input.text, {
        flydDir,
        expectedTurnReceiptId: turnReceiptId,
        source: "foreground_feedback",
        foregroundObservationId: observationId,
        id: options.repairId,
        now: options.now,
      });
      status = "repaired";
      turnReceiptId = repair.turnReceiptId;
    } catch (error) {
      if ((error as Error).message !== "The Flyd turn changed before feedback could be attached") throw error;
      reason = "turn_changed_before_repair";
      turnReceiptId = undefined;
    }
    observation = { ...observation, status, reason, turnReceiptId };
    await persistObservation(flydDir, observation);
  }
  return { observationId, status, reason, turnReceiptId };
}

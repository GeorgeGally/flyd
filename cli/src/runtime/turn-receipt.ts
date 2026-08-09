import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { FLYD_DIR } from "../lib/config.js";
import type { MemoryEvidence } from "./types.js";

export interface TurnToolCall {
  name: string;
  input: Record<string, unknown>;
  succeeded: boolean;
  error?: string;
}

export interface TurnReceipt {
  version: 1;
  id: string;
  recordedAt: string;
  sessionId: string;
  turnNumber: number;
  route: "conversation" | "coding" | "work-intelligence";
  message: string;
  model: string;
  providerIdentity: string;
  memory: MemoryEvidence;
  toolCalls: TurnToolCall[];
  answer: string;
  status: "succeeded" | "failed";
  error?: string;
}

type TurnReceiptInput = Omit<TurnReceipt, "version" | "id" | "recordedAt">;

interface TurnReceiptOptions {
  flydDir?: string;
  id?: () => string;
  now?: () => Date;
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error("Invalid turn receipt path segment");
  return value;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function persistTurnReceipt(
  input: TurnReceiptInput,
  options: TurnReceiptOptions = {},
): Promise<TurnReceipt> {
  const flydDir = options.flydDir ?? FLYD_DIR;
  const id = safeSegment((options.id ?? randomUUID)());
  const sessionId = safeSegment(input.sessionId);
  const receipt: TurnReceipt = {
    version: 1,
    id,
    recordedAt: (options.now?.() ?? new Date()).toISOString(),
    ...input,
    sessionId,
  };
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const filename = `${String(input.turnNumber).padStart(6, "0")}-${id}.json`;
  await atomicWrite(join(flydDir, "turn-receipts", sessionId, filename), serialized);
  await atomicWrite(join(flydDir, "turn-receipts", sessionId, "latest.json"), serialized);
  await atomicWrite(join(flydDir, "turn-receipts", "latest.json"), serialized);
  return receipt;
}

export async function loadLatestTurnReceipt(
  options: { flydDir?: string; sessionId?: string } = {},
): Promise<TurnReceipt | null> {
  try {
    const sessionId = options.sessionId ? safeSegment(options.sessionId) : null;
    const content = await readFile(
      sessionId
        ? join(options.flydDir ?? FLYD_DIR, "turn-receipts", sessionId, "latest.json")
        : join(options.flydDir ?? FLYD_DIR, "turn-receipts", "latest.json"),
      "utf8",
    );
    const parsed = JSON.parse(content) as TurnReceipt;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

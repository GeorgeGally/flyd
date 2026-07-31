import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import type {
  CapabilityName,
  CapabilityProbe,
  EvidenceItem,
  EvidenceKind,
} from "../types.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CommandOptions {
  cwd?: string;
  timeoutMs?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export const DEFAULT_HTTP_TIMEOUT_MS = 8_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 12_000;
const MAX_COMMAND_BUFFER = 8 * 1024 * 1024;
const MAX_EVIDENCE_CONTENT_CHARS = 24_000;

export const runCommand: CommandRunner = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        encoding: "utf8",
        timeout: options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_COMMAND_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

export async function fetchWithTimeout(
  fetchFn: FetchLike,
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    return await fetchFn(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(
  fetchFn: FetchLike,
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<T> {
  const response = await fetchWithTimeout(fetchFn, input, init, timeoutMs);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  return await response.json() as T;
}

export async function fetchText(
  fetchFn: FetchLike,
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<string> {
  const response = await fetchWithTimeout(fetchFn, input, init, timeoutMs);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  return await response.text();
}

export async function probeHttp(
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string> = {},
): Promise<CapabilityProbe> {
  try {
    const response = await fetchWithTimeout(fetchFn, url, { method: "HEAD", headers }, 4_000);
    if (response.status === 401 || response.status === 403) {
      return { status: "auth_required", reason: `HTTP ${response.status}` };
    }
    if (response.status === 429) {
      return { status: "degraded", reason: "remote rate limit reached" };
    }
    if (response.status >= 500) {
      return { status: "unavailable", reason: `remote service returned HTTP ${response.status}` };
    }
    return { status: "ready" };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "remote health probe failed",
    };
  }
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function relevanceFromRank(rank: number): number {
  return clampScore(1 - Math.max(0, rank - 1) * 0.08);
}

export function freshnessFromDate(value: string | undefined, now = new Date()): number {
  if (!value) return 0.5;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0.5;
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
  if (ageDays <= 1) return 1;
  if (ageDays <= 7) return 0.92;
  if (ageDays <= 30) return 0.8;
  if (ageDays <= 180) return 0.62;
  if (ageDays <= 365) return 0.48;
  return 0.28;
}

export function stableEvidenceId(...parts: Array<string | undefined>): string {
  return createHash("sha256")
    .update(parts.filter(Boolean).join("\n"))
    .digest("hex")
    .slice(0, 20);
}

export interface MakeEvidenceItemInput {
  capability: CapabilityName;
  backend: string;
  kind: EvidenceKind;
  title?: string;
  content: string;
  locator?: string;
  sourceItemId: string;
  publishedAt?: string;
  author?: string;
  queryLabel: string;
  nativeRank: number;
  localRelevance?: number;
  freshness?: number;
  sourceQuality: number;
  engagement?: number;
  metadata?: Record<string, unknown>;
  now?: Date;
}

export function makeEvidenceItem(input: MakeEvidenceItemInput): EvidenceItem {
  const now = input.now ?? new Date();
  const content = input.content.trim().slice(0, MAX_EVIDENCE_CONTENT_CHARS);
  const id = stableEvidenceId(
    input.capability,
    input.backend,
    input.sourceItemId,
    input.locator,
  );

  return {
    id,
    capability: input.capability,
    backend: input.backend,
    kind: input.kind,
    title: input.title?.trim() || undefined,
    content,
    locator: input.locator,
    sourceItemId: input.sourceItemId,
    retrievedAt: now.toISOString(),
    publishedAt: input.publishedAt,
    author: input.author,
    queryLabel: input.queryLabel,
    nativeRank: input.nativeRank,
    localRelevance: input.localRelevance ?? relevanceFromRank(input.nativeRank),
    freshness: input.freshness ?? freshnessFromDate(input.publishedAt, now),
    sourceQuality: clampScore(input.sourceQuality),
    engagement: input.engagement,
    metadata: input.metadata,
    provenance: [{
      capability: input.capability,
      backend: input.backend,
      queryLabel: input.queryLabel,
      nativeRank: input.nativeRank,
      sourceItemId: input.sourceItemId,
      locator: input.locator,
    }],
  };
}

// Turn receipts for the Mac surfaces. Chat has always left a receipt per turn
// (turn-receipt.ts); the overlay (/manifest) and LIVE's flyd_resolve_intent
// now leave the same kind, tagged with their surface, so repair, feedback,
// experience traces and self-improvement see what George was actually shown
// on the product surface, not only in chat. Recording is best-effort: it never
// delays or fails a resolution.

import type { UnifiedMemoryResult } from "../cognition/types.js";
import { meaningfulConflicts } from "../cognition/context-format.js";
import { persistTurnReceipt, type TurnReceipt } from "./turn-receipt.js";
import type { MemoryEvidence } from "./types.js";

export type ResolutionSurface = "overlay" | "live";

/** Which resolve stage produced the answer. */
export type ResolutionPath =
  | "deterministic"
  | "current-work"
  | "account"
  | "work-intelligence"
  | "model"
  | "error";

export interface ResolutionLike {
  mode: string;
  rationale?: string;
  operations?: Array<{ kind?: string; text?: string }>;
  augmentations?: Array<{ content?: string }>;
  composeRationale?: string;
  workSessionId?: string;
}

export interface ResolutionReceiptInput {
  surface: ResolutionSurface;
  /** Conversation, work session or LIVE session id; receipts group under it. */
  sessionId?: string;
  message: string;
  path: ResolutionPath;
  resolution?: ResolutionLike;
  model?: string;
  baseURL?: string;
  memory?: MemoryEvidence;
  status?: TurnReceipt["status"];
  error?: string;
}

export interface ResolutionReceiptOptions {
  flydDir?: string;
  persist?: typeof persistTurnReceipt;
}

const EMPTY_MEMORY: MemoryEvidence = { verdict: "insufficient", matches: [] };

/** What George was shown or what would be typed for him, as receipt text. */
export function resolutionAnswerText(resolution: ResolutionLike): string {
  const augment = (resolution.augmentations ?? []).map((a) => a.content ?? "").filter(Boolean);
  if (augment.length) return augment.join("\n\n");
  const typed = (resolution.operations ?? []).map((op) => op.text ?? "").filter(Boolean);
  if (typed.length) return typed.join("\n");
  return resolution.composeRationale ?? resolution.rationale ?? "";
}

/** The compiled memory the resolution prompt saw, in the receipt's evidence shape. */
export function memoryEvidenceFromCompiled(memory: UnifiedMemoryResult): MemoryEvidence {
  const matches = memory.relevant.slice(0, 12).map((item) => ({
    id: item.id,
    path: item.source,
    excerpt: item.content.slice(0, 300),
    stale: item.temporalStatus === "stale" || item.temporalStatus === "historical",
  }));
  const verdict: MemoryEvidence["verdict"] = meaningfulConflicts(memory.conflicts).length
    ? "conflicting"
    : matches.length >= 3 || memory.current.length > 0
      ? "sufficient"
      : matches.length > 0
        ? "partial"
        : "insufficient";
  return { verdict, matches };
}

function providerIdentity(path: ResolutionPath, model?: string, baseURL?: string): string {
  if (path === "deterministic" || path === "current-work") return "deterministic";
  if (baseURL) {
    try { return new URL(baseURL).host; } catch { /* fall through */ }
  }
  return model ? "default" : "none";
}

function failedResolution(resolution: ResolutionLike | undefined): string | undefined {
  if (!resolution || resolution.mode !== "requires_compose") return undefined;
  const rationale = resolution.rationale ?? "";
  return rationale === "Resolution failed." || rationale.startsWith("Resolution validation failed")
    ? resolution.composeRationale ?? rationale
    : undefined;
}

const turnCounters = new Map<string, number>();

/**
 * Persist a receipt for one overlay or LIVE resolution. Returns null when
 * skipped (under vitest without an explicit target) or when persisting fails.
 */
export async function recordResolutionReceipt(
  input: ResolutionReceiptInput,
  options: ResolutionReceiptOptions = {},
): Promise<TurnReceipt | null> {
  // Tests must never write receipts into George's real ~/.flyd.
  if (process.env.VITEST && !options.flydDir && !options.persist) return null;
  const sessionId = `${input.surface}:${input.sessionId || "invocations"}`;
  const turnNumber = (turnCounters.get(sessionId) ?? 0) + 1;
  turnCounters.set(sessionId, turnNumber);
  const inferredError = failedResolution(input.resolution);
  const status = input.status ?? (inferredError ? "failed" : "succeeded");
  const error = input.error ?? inferredError;
  const persist = options.persist ?? persistTurnReceipt;
  try {
    return await persist({
      sessionId,
      turnNumber,
      route: input.path === "work-intelligence" ? "work-intelligence" : "resolution",
      surface: input.surface,
      message: input.message,
      model: input.model ?? (input.path === "deterministic" || input.path === "current-work" ? "deterministic" : "unknown"),
      providerIdentity: providerIdentity(input.path, input.model, input.baseURL),
      memory: input.memory ?? EMPTY_MEMORY,
      toolCalls: [],
      answer: input.resolution ? resolutionAnswerText(input.resolution) : "",
      status,
      ...(error ? { error } : {}),
      ...(input.resolution
        ? { resolution: { mode: input.resolution.mode, path: input.path, ...(input.resolution.workSessionId ? { workSessionId: input.resolution.workSessionId } : {}) } }
        : { resolution: { mode: "none", path: input.path } }),
    }, options.flydDir ? { flydDir: options.flydDir } : {});
  } catch (persistError) {
    console.warn("[turn-receipt] resolution receipt failed:", persistError instanceof Error ? persistError.message : persistError);
    return null;
  }
}

/** Test-only. */
export function resetResolutionTurnCounters(): void {
  turnCounters.clear();
}

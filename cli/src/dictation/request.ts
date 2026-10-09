import type { DictationTarget } from "./profile.js";
import { parseVoiceContext } from "./context.js";
import { recordCorrection } from "./corrections.js";

export type TranscriptionPurpose =
  | { kind: "conversation" }
  | { kind: "dictation"; target: DictationTarget };

/** The adapter's `start` message says whether this is a question for Flyd or text for another app. */
export function transcriptionPurpose(message: Record<string, unknown>): TranscriptionPurpose {
  if (message.purpose !== "dictation") return { kind: "conversation" };
  // The previous edit arrives in the authenticated start frame. Synchronous
  // ingestion precedes the utterance's vocabulary snapshot, without a HTTP race.
  const correction = message.previousCorrection as Record<string, unknown> | undefined;
  if (correction && typeof correction === "object" &&
      ["before", "after", "invocationId", "bundleId", "scope"].every(key => typeof correction[key] === "string") &&
      (correction.observedAt === undefined || typeof correction.observedAt === "string") &&
      String(correction.invocationId).length <= 200 && String(correction.bundleId).length <= 200) {
    try { recordCorrection(correction as unknown as Parameters<typeof recordCorrection>[0]); }
    catch { /* Learning failure must never break a new dictation. */ }
  }
  const app = (typeof message.app === "object" && message.app !== null ? message.app : {}) as Record<string, unknown>;
  const windowTitle = typeof app.windowTitle === "string" && app.windowTitle.trim() ? app.windowTitle : undefined;
  const context = parseVoiceContext(message.context);
  return {
    kind: "dictation",
    target: {
      bundleId: typeof app.bundleId === "string" && app.bundleId ? app.bundleId : "unknown",
      ...(windowTitle ? { windowTitle } : {}),
      ...(context ? { context } : {}),
    },
  };
}

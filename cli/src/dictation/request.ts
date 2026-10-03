import type { DictationTarget } from "./profile.js";
import { parseVoiceContext } from "./context.js";

export type TranscriptionPurpose =
  | { kind: "conversation" }
  | { kind: "dictation"; target: DictationTarget };

/** The adapter's `start` message says whether this is a question for Flyd or text for another app. */
export function transcriptionPurpose(message: Record<string, unknown>): TranscriptionPurpose {
  if (message.purpose !== "dictation") return { kind: "conversation" };
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

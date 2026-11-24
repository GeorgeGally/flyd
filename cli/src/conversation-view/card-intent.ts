import type { ReplyChoice } from "./choices.js";

// Whether a chat item is a card. Most of what Flyd says is a message and reads
// as one: a link, a list or a heading in the words never makes it a card. Only
// an artefact the item carries does, and that is known from what was attached
// to it before anything is drawn, never from reading the finished words:
//
//   - a decision with answer buttons (its question and the options to tap);
//   - a finished-work result with a picture of it or the page it changed.
//
// Pictures, boards and files that live in the Artefacts and activity columns
// keep their own cards there; this decides only the main conversation. Pure.

export type CardIntent = "decision" | "result";

export interface CardIntentInput {
  role: "user" | "assistant";
  /** The question the item puts to him, with its answer buttons, when it has one. */
  choice?: Pick<ReplyChoice, "options" | "steps">;
  /** Screenshots the turn behind it looked at, kept as Flyd's own copies. */
  shots?: readonly string[];
  /** The web page the turn behind it changed. */
  page?: { url: string };
  /** An answer whose shape Flyd chose: it draws itself and is never a card. */
  form?: unknown;
}

/** The artefact a chat item carries, if any; without one it is a plain message. */
export function cardIntentOf(item: CardIntentInput): CardIntent | undefined {
  if (item.role !== "assistant" || item.form) return undefined;
  if (item.choice && (item.choice.options.length > 0 || (item.choice.steps?.length ?? 0) > 0)) return "decision";
  if ((item.shots?.length ?? 0) > 0 || item.page) return "result";
  return undefined;
}

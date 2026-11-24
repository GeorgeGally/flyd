// Whether a chat item is a card. Most of what Flyd says is a message and reads
// as one: a link, a list, a heading or a question in the words never makes it
// a card. Only finished work the item carries does, known from what was
// attached to it before anything is drawn: the page the turn changed, or a
// picture of work its relay reports landed. A screenshot the turn only looked
// at is no result. A question it asks keeps its answer buttons on the message,
// or on the result card when it carries one. Pictures, boards and files that
// live in the Artefacts and activity columns keep their own cards there; this
// decides only the main conversation. Pure.

export type CardIntent = "result";

export interface CardIntentInput {
  role: "user" | "assistant";
  /** Screenshots the turn behind it looked at, kept as Flyd's own copies. */
  shots?: readonly string[];
  /** The web page the turn behind it changed. */
  page?: { url: string };
  /** Its relay reports the work landed. */
  landed?: boolean;
  /** An answer whose shape Flyd chose: it draws itself and is never a card. */
  form?: unknown;
}

/** The artefact a chat item carries, if any; without one it is a plain message. */
export function cardIntentOf(item: CardIntentInput): CardIntent | undefined {
  if (item.role !== "assistant" || item.form) return undefined;
  if (item.page || (item.landed && (item.shots?.length ?? 0) > 0)) return "result";
  return undefined;
}

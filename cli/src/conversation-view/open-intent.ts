// "Open Flyd", "show the conversation", "bring up the app": the captain
// wants the Conversation window, not an answer about it. Recognised here,
// in Core, so the overlay can open the window directly (requires_surface).
// Only whole utterances match: "open the app store" or "show me the
// conversation about pricing" are ordinary requests.

const POLITE = /^(?:(?:hey|ok|okay)\s+flyd[,\s]+)?(?:please\s+|can you\s+|could you\s+|would you\s+|will you\s+|just\s+)*/;
const VERB = "(?:open(?:\\s+up)?|show(?:\\s+me)?|launch|start|bring\\s+up|pull\\s+up|bring\\s+back|go\\s+to|switch\\s+to)";
const TARGET =
  "(?:(?:the\\s+|your\\s+|my\\s+)?(?:flyd\\s+)?(?:app|application|window|conversation(?:\\s+window)?|chat(?:\\s+window)?)" +
  "|flyd(?:\\s+(?:app|application|window|conversation|chat))?|yourself|firstmate(?:'?s)?\\s+conversation)";
const OPEN_CONVERSATION = new RegExp(`^${VERB}\\s+${TARGET}(?:\\s+(?:please|for me|now))*$`);

export function isOpenConversationIntent(utterance: string): boolean {
  const text = utterance
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.!?,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(POLITE, "")
    .trim();
  return OPEN_CONVERSATION.test(text);
}

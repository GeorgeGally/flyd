import type { StoredEvent } from "../../intelligence/event-store.js";

export interface ConversationPayload {
  sessionId?: string;
  user?: string;
  assistant?: string;
  projectIds?: string[];
  intentKind?: string;
  temporalFrame?: string;
  referents?: Record<string, string>;
}

export function conversationOf(event: StoredEvent): ConversationPayload | null {
  if (!["chat.cognition", "conversation.import"].includes(event.sourceId) || !event.payload) return null;
  const raw = event.payload.conversation;
  if (!raw || typeof raw !== "object") return null;
  const conversation = raw as ConversationPayload;
  if (typeof conversation.user !== "string" || typeof conversation.sessionId !== "string") return null;
  return conversation;
}

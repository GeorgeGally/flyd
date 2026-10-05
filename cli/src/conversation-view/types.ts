// Contracts for the minimal conversation view (`flyd view`).
//
// The view renders a calm, human-only conversation: the captain's own words
// and the assistant's replies to him. Where those words come from is a
// ConversationSource. v1 ships ClaudeCodeTranscriptSource (firstmate's Claude
// Code transcripts); Flyd's own chat is meant to plug in as another source
// without the server or page changing.

export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  /** Stable across updates so the page can replace a message in place. */
  id: string;
  role: ConversationRole;
  /** Markdown. The view renders it; sources never produce HTML. */
  text: string;
  /** ISO timestamp, when the source knows it. */
  timestamp?: string;
}

export interface ConversationSnapshot {
  messages: ConversationMessage[];
  /** The assistant is mid-turn: the captain has spoken and no reply has settled yet. */
  working: boolean;
  /** ISO timestamp of the newest activity the source saw, if known. */
  lastActivity?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  /** ISO timestamp of the last change. */
  updatedAt: string;
}

export interface ConversationFollower {
  close(): void;
}

export interface ConversationSource {
  /** Display name of the assistant side, e.g. "firstmate" or "Flyd". */
  readonly assistantLabel: string;
  /** Newest first. */
  listSessions(): Promise<SessionSummary[]>;
  read(sessionId: string): Promise<ConversationSnapshot>;
  /**
   * Calls onUpdate with the full current snapshot once at start and again
   * whenever the conversation changes. Snapshots are cheap (human messages
   * only); consumers diff them.
   */
  follow(sessionId: string, onUpdate: (snapshot: ConversationSnapshot) => void, onError?: (error: Error) => void): ConversationFollower;
  // Seam for a later input box: a source that can accept the captain's words
  // will add `send(sessionId, text)`. v1 is read-only.
}

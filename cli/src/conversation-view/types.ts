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
  /** Opaque ids of images in the message; fetch them with ConversationSource.image. */
  images?: string[];
  /** Names of documents attached to the message (a PDF, a Word file, notes). */
  files?: string[];
  /** ISO timestamp, when the source knows it. */
  timestamp?: string;
  /** A captain message with no answer yet: what is happening to it, e.g. "Flyd is thinking…". */
  waiting?: string;
  /** An assistant message that answers the captain message with this id. */
  answers?: string;
  /** An assistant message relayed from the assistant's own session: not an answer to the captain message above it. */
  aside?: boolean;
}

/** A message the captain sent from the view, and its answer once there is one. */
export interface Exchange {
  question: ConversationMessage;
  answer?: ConversationMessage;
  /** Shown under the question while there is no answer. */
  waiting: string;
}

export interface ConversationSnapshot {
  messages: ConversationMessage[];
  /** The assistant is mid-turn: the captain has spoken and no reply has settled yet. */
  working: boolean;
  /** While working: what the assistant is doing now, in a few plain words. */
  activity?: string;
  /** ISO timestamp of the newest activity the source saw, if known. */
  lastActivity?: string;
  /** How full the assistant's context window is, when the source knows. */
  context?: { tokens: number; window: number };
}

export interface SessionSummary {
  id: string;
  title: string;
  /** ISO timestamp of the last change. */
  updatedAt: string;
}

/** An image the captain attaches in the view: base64 bytes and their type. */
export interface ImageUpload {
  mediaType: string;
  data: string;
}

/** A document the captain attaches in the view: its file name and base64 bytes. */
export interface FileUpload {
  name: string;
  data: string;
}

export interface ImageData {
  mediaType: string;
  data: Buffer;
}

/** A message the captain sent from the view, as the source recorded it. */
export interface SentMessage {
  /** The id the message will carry in snapshots once the source reads it back. */
  id: string;
  timestamp: string;
  /** Delivered, but something after delivery went wrong (e.g. the recipient was not woken). */
  warning?: string;
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
  /** Whether this source can take the captain's words; the page shows a composer only then. */
  readonly canSend: boolean;
  /**
   * Delivers the captain's message. The returned id appears in a later
   * snapshot once the source can read the message back, so the page can
   * swap its optimistic copy for the real one.
   */
  send(sessionId: string, text: string, images?: ImageUpload[], files?: FileUpload[]): Promise<SentMessage>;
  /** Skills and slash commands the captain can run by typing "/" (empty when the source has none). */
  commands(): Promise<Array<{ name: string; description: string }>>;
  /** Bytes of an image named in a message's `images`, or null when unknown. */
  image(sessionId: string, imageId: string): Promise<ImageData | null>;
}

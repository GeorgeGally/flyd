import type { FlydDesk } from "./flyd-desk.js";
import type { ConversationFollower, ConversationMessage, ConversationSnapshot, ConversationSource, Exchange, FileUpload, ImageData, ImageUpload, SentMessage, SessionSummary } from "./types.js";

export const FLYD_CONVERSATION_ID = "conversation";

export class FlydConversationSource implements ConversationSource {
  readonly assistantLabel = "Flyd";
  readonly canSend = true;
  readonly answersInSession = true;
  private readonly pollMs: number;
  private knownSessions = new Set([FLYD_CONVERSATION_ID]);

  constructor(private readonly options: {
    desk: FlydDesk;
    pollMs?: number;
    resolveDecision?: (decisionId: string, taskId: string, answer: string) => Promise<void>;
  }) {
    this.pollMs = options.pollMs ?? 400;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const sessions = this.options.desk.historySessions();
    this.knownSessions = new Set(sessions.map((session) => session.id));
    return sessions;
  }

  async read(sessionId: string): Promise<ConversationSnapshot> {
    if (!this.isConversationSession(sessionId)) throw new Error(`No such Flyd conversation: ${sessionId}`);
    const exchanges = this.options.desk.exchanges(sessionId);
    const messages = messagesForFlyd(exchanges);
    const active = exchanges.filter((exchange) => !exchange.answer && !exchange.waitingFailed).at(-1);
    const project = this.options.desk.project(sessionId);
    return {
      messages,
      working: active !== undefined,
      ...(project ? { project } : {}),
      ...(active?.question.timestamp ? { lastActivity: active.question.timestamp } : {}),
    };
  }

  follow(sessionId: string, onUpdate: (snapshot: ConversationSnapshot) => void, onError?: (error: Error) => void): ConversationFollower {
    if (!this.isConversationSession(sessionId)) throw new Error(`No such Flyd conversation: ${sessionId}`);
    let closed = false;
    let previous = "";
    const update = async () => {
      if (closed) return;
      try {
        const snapshot = await this.read(sessionId);
        const next = JSON.stringify(snapshot);
        if (next === previous) return;
        previous = next;
        onUpdate(snapshot);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };
    void update();
    const timer = setInterval(() => void update(), this.pollMs);
    timer.unref?.();
    return { close: () => { closed = true; clearInterval(timer); } };
  }

  async send(sessionId: string, text: string, images: ImageUpload[] = [], files: FileUpload[] = []): Promise<SentMessage> {
    if (!this.isConversationSession(sessionId)) throw new Error(`No such Flyd conversation: ${sessionId}`);
    if (files.length) throw new Error("File attachments need an active coding or document tool");
    return this.options.desk.ask(text, images, sessionId);
  }

  async sendDecision(text: string, images: ImageUpload[] = [], decision?: { decisionId: string; taskId: string }): Promise<SentMessage> {
    if (decision && this.options.resolveDecision) {
      if (images.length) throw new Error("Images cannot be attached to a fixed executive decision");
      await this.options.resolveDecision(decision.decisionId, decision.taskId, text);
      return this.options.desk.recordDecisionAnswer(text, FLYD_CONVERSATION_ID);
    }
    return this.send(FLYD_CONVERSATION_ID, text, images);
  }

  async commands(): Promise<Array<{ name: string; description: string }>> {
    return [];
  }

  async image(_sessionId: string, imageId: string): Promise<ImageData | null> {
    return this.options.desk.image(imageId);
  }

  exchanges(): Exchange[] {
    return this.options.desk.exchanges(FLYD_CONVERSATION_ID);
  }

  private isConversationSession(sessionId: string): boolean {
    return this.knownSessions.has(sessionId);
  }
}

export function messagesForFlyd(exchanges: readonly Exchange[]): ConversationMessage[] {
  return exchanges.flatMap(({ question, answer, waiting, waitingFailed }) => [
    { ...question, ...(waiting && !answer ? { waiting, ...(waitingFailed ? { waitingFailed: true } : {}) } : {}) },
    ...(answer ? [answer] : []),
  ]);
}

import { articleChat, listArticleChats } from "./article-chat.js";
import type { FlydDesk } from "./flyd-desk.js";
import type { ConversationFollower, ConversationMessage, ConversationSnapshot, ConversationSource, Exchange, FileUpload, ImageData, ImageUpload, SentMessage, SessionSummary } from "./types.js";

export const FLYD_CONVERSATION_ID = "conversation";
const WINDOW_SESSION = /^window:[A-Za-z0-9-]{8,64}$/;

export class FlydConversationSource implements ConversationSource {
  readonly assistantLabel = "Flyd";
  readonly canSend = true;
  readonly answersInSession = true;
  private readonly pollMs: number;
  private knownSessions = new Set<string>();

  constructor(private readonly options: {
    desk: FlydDesk;
    pollMs?: number;
    /** Where opened article threads are kept. Absent, the history is only what he has said. */
    articlesDir?: string;
    resolveDecision?: (decisionId: string, taskId: string, answer: string) => Promise<void>;
  }) {
    this.pollMs = options.pollMs ?? 400;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const sessions = this.options.desk.historySessions();
    const articles = this.options.articlesDir ? listArticleChats(this.options.articlesDir) : [];
    const byId = new Map(sessions.map((session) => [session.id, session]));
    for (const article of articles) {
      const existing = byId.get(article.id);
      // A thread he has already spoken in keeps the article's title and the link back, not the first question.
      byId.set(article.id, existing
        ? { ...existing, title: article.title, ...(article.link ? { link: article.link } : {}) }
        : article);
    }
    const merged = [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    this.knownSessions = new Set(merged.map((session) => session.id));
    return merged;
  }

  async read(sessionId: string): Promise<ConversationSnapshot> {
    if (!this.isConversationSession(sessionId)) throw new Error(`No such Flyd conversation: ${sessionId}`);
    const exchanges = this.options.desk.exchanges(sessionId);
    const messages = messagesForFlyd(exchanges);
    const active = exchanges.filter((exchange) => !exchange.answer && !exchange.waitingFailed).at(-1);
    const project = this.options.desk.project(sessionId);
    const confirm = this.options.desk.pendingConfirm(sessionId);
    return {
      messages,
      working: active !== undefined,
      ...(project ? { project } : {}),
      ...(confirm ? { confirm } : {}),
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

  async sendDecision(text: string, images: ImageUpload[] = [], decision?: { decisionId: string; taskId: string }, sessionId?: string): Promise<SentMessage> {
    const session = sessionId && this.isConversationSession(sessionId) ? sessionId : (await this.listSessions())[0]?.id ?? FLYD_CONVERSATION_ID;
    if (decision && this.options.resolveDecision) {
      if (images.length) throw new Error("Images cannot be attached to a fixed executive decision");
      await this.options.resolveDecision(decision.decisionId, decision.taskId, text);
      return this.options.desk.recordDecisionAnswer(text, session);
    }
    return this.options.desk.ask(text, images, session);
  }

  async commands(): Promise<Array<{ name: string; description: string }>> {
    return [];
  }

  async image(_sessionId: string, imageId: string): Promise<ImageData | null> {
    return this.options.desk.image(imageId);
  }

  newSession(sessionId: string): SessionSummary | undefined {
    const article = this.options.articlesDir ? articleChat(this.options.articlesDir, sessionId) : undefined;
    if (article) return article;
    return WINDOW_SESSION.test(sessionId) ? { id: sessionId, title: "New conversation", updatedAt: new Date().toISOString() } : undefined;
  }

  resolveConfirm(id: string, allow: boolean): boolean {
    return this.options.desk.resolveConfirm(id, allow);
  }

  exchanges(): Exchange[] {
    return this.options.desk.exchanges();
  }

  private isConversationSession(sessionId: string): boolean {
    return this.knownSessions.has(sessionId) || WINDOW_SESSION.test(sessionId);
  }
}

export function messagesForFlyd(exchanges: readonly Exchange[]): ConversationMessage[] {
  return exchanges.flatMap(({ question, answer, waiting, waitingFailed }) => [
    { ...question, ...(waiting && !answer ? { waiting, ...(waitingFailed ? { waitingFailed: true } : {}) } : {}) },
    ...(answer ? [answer] : []),
  ]);
}

import { workSessionStore } from "./work-intelligence/work-session-store.js";

export interface ConversationTurn {
  user: string;
  assistant: string;
}

interface StoredConversation {
  turns: ConversationTurn[];
  lastActiveAt: number;
}

export class ConversationHistoryStore {
  private readonly conversations = new Map<string, StoredConversation>();

  constructor(
    private readonly maxTurns = 10,
    private readonly ttlMs = 10 * 60 * 1000
  ) {}

  get(conversationId: string, now = Date.now()): ConversationTurn[] {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      const wiTurns = workSessionStore.getActiveConversationTurns(conversationId);
      if (wiTurns.length > 0) {
        return wiTurns.slice(-6);
      }
      return [];
    }
    if (now - conversation.lastActiveAt > this.ttlMs) {
      this.conversations.delete(conversationId);
      return [];
    }
    return conversation.turns.map((turn) => ({ ...turn }));
  }

  append(
    conversationId: string,
    user: string,
    assistant: string,
    now = Date.now()
  ): void {
    const turns = this.get(conversationId, now);
    turns.push({ user, assistant });
    this.conversations.set(conversationId, {
      turns: turns.slice(-this.maxTurns),
      lastActiveAt: now,
    });
  }
}

export const conversationHistory = new ConversationHistoryStore();

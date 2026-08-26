import { randomUUID } from "crypto";
import type { Pool } from "pg";
import type { ConversationTurn } from "./agent-session.js";
import {
  SessionKernel,
  type TurnContext,
  type TurnOutcome,
  type OutputEvent,
} from "./session-kernel.js";
import { InMemoryRunStore, PostgresRunStore, type RunStore } from "./run-store.js";
import { createRuntimePool, runtimeDatabaseUrl } from "./database.js";

// CLI chat sessions on the session kernel — the conversation surface's
// adapter. Durable trail when Postgres answers within the connect timeout,
// in-memory otherwise; the backend is probed once per process.

const PRINCIPAL = { kind: "user" as const, id: "cli-chat" };

export interface OpenChatOptions {
  /** Runs one conversation turn; message is extracted from user_message input. */
  handleTurn(ctx: Omit<TurnContext, "input"> & { message: string }): Promise<TurnOutcome>;
}

interface ChatBackend {
  store: RunStore;
  pool: Pool | null;
}

let backendCache: Promise<ChatBackend> | null = null;

function backend(): Promise<ChatBackend> {
  if (!backendCache) {
    backendCache = (async () => {
      let pool: Pool | null = null;
      try {
        pool = createRuntimePool(runtimeDatabaseUrl(), { connectionTimeoutMillis: 1_000 });
        const store = new PostgresRunStore(pool);
        await store.ensureSchema();
        return { store, pool };
      } catch {
        // Probe failed — release the pool so a dead backend holds no resources.
        await pool?.end().catch(() => undefined);
        return { store: new InMemoryRunStore(), pool: null };
      }
    })();
  }
  return backendCache;
}

/** Test-only: drop the cached backend so the next session re-probes. */
export function resetChatBackend(): void {
  backendCache = null;
}

/**
 * Open a fresh CLI chat session. Each invocation gets its own session key;
 * every conversation turn submits a user_message through the kernel.
 */
export async function openChatSession(
  options: OpenChatOptions,
): Promise<{ kernel: SessionKernel; sessionKey: string }> {
  const { store, pool } = await backend();
  const kernel = new SessionKernel(pool, store, {
    handleTurn: async (ctx) => {
      const message = ctx.input.type === "user_message" ? ctx.input.text : "";
      return options.handleTurn({ ...ctx, message });
    },
  });
  const sessionKey = `cli-chat-${randomUUID()}`;
  await kernel.openSession(PRINCIPAL, sessionKey);
  return { kernel, sessionKey };
}

/** Rebuild chat history from the kernel's event trail. */
export async function chatHistory(
  kernel: SessionKernel,
  sessionKey: string,
): Promise<ConversationTurn[]> {
  const events = await kernel.events(sessionKey);
  const turns: ConversationTurn[] = [];
  let pendingUser: string | null = null;
  for (const event of events) {
    if (event.direction === "input" && event.type === "user_message") {
      pendingUser = String((event.payload as { text?: string }).text ?? "");
    } else if (event.direction === "output" && event.type === "message" && pendingUser !== null) {
      turns.push(
        { role: "user", content: pendingUser },
        { role: "assistant", content: String((event.payload as { text?: string }).text ?? "") },
      );
      pendingUser = null;
    }
  }
  return turns;
}

export function replyText(outputs: OutputEvent[]): string | null {
  for (const output of outputs) {
    if (output.type === "message") return output.text;
  }
  return null;
}

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { conversationOf } from "./curator/conversation.js";
import { learningRequest } from "./learning-service.js";

/**
 * ChatGPT's own data export (Settings › Data controls › Export data), read
 * locally and queued through the conversation.import source. Nothing in the
 * export leaves the machine here; learning from it happens later, under the
 * same consent switch as any other imported conversation.
 */

const MAX_TEXT = 12000;
const BATCH = 50;
const EXPORT_FILE = /^conversations(?:-\d+)?\.json$/i;

export interface ChatGPTTurn {
  sessionId: string;
  messageId: string;
  occurredAt?: string;
  user: string;
  assistant: string;
  truncated: boolean;
}

export interface ChatGPTConversation {
  id: string;
  turns: ChatGPTTurn[];
  attachments: number;
}

interface ExportNode {
  parent?: string | null;
  children?: string[];
  message?: ExportMessage | null;
}

interface ExportMessage {
  id?: string;
  author?: { role?: string };
  create_time?: number | null;
  content?: { content_type?: string; parts?: unknown[]; text?: string };
  recipient?: string;
  metadata?: { is_visually_hidden_from_conversation?: boolean; attachments?: unknown[] };
}

interface ExportConversation {
  id?: string;
  conversation_id?: string;
  create_time?: number | null;
  current_node?: string | null;
  mapping?: Record<string, ExportNode>;
}

const iso = (seconds: unknown) => typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
  ? new Date(seconds * 1000).toISOString() : undefined;

/** The branch ChatGPT shows: current_node up to the root. Edits and regenerations off it are dropped. */
function currentBranch(mapping: Record<string, ExportNode>, currentNode?: string | null): ExportNode[] {
  let id = currentNode && mapping[currentNode] ? currentNode : undefined;
  if (!id) {
    // No current_node: follow the newest child from the root, as the app would.
    id = Object.keys(mapping).find(key => !mapping[key].parent || !mapping[mapping[key].parent!]);
    while (id && mapping[id].children?.length) id = mapping[id].children!.at(-1)!;
  }
  const path: ExportNode[] = [], seen = new Set<string>();
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id);
    path.push(mapping[id]);
    id = mapping[id].parent ?? undefined;
  }
  return path.reverse();
}

/** Spoken and typed text only; images, files and audio are counted, never read. */
function messageText(message: ExportMessage): { text: string; attachments: number } {
  const type = message.content?.content_type;
  const listed = Array.isArray(message.metadata?.attachments) ? message.metadata.attachments.length : 0;
  if (type !== "text" && type !== "multimodal_text") return { text: "", attachments: listed };
  const texts: string[] = [];
  let inline = 0;
  for (const part of message.content?.parts ?? []) {
    if (typeof part === "string") texts.push(part);
    else if (part && typeof part === "object") {
      const p = part as { content_type?: string; text?: unknown };
      if (p.content_type === "audio_transcription" && typeof p.text === "string") texts.push(p.text);
      else if (!/audio/.test(p.content_type ?? "")) inline++;
    }
  }
  // An uploaded image appears both as a listed attachment and as an inline part.
  return { text: texts.join("\n").trim(), attachments: Math.max(listed, inline) };
}

function clip(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_TEXT ? { text: text.slice(0, MAX_TEXT), truncated: true } : { text, truncated: false };
}

/** One user message plus the assistant's visible reply on the current branch is one turn. */
export function parseChatGPTConversation(raw: ExportConversation): ChatGPTConversation | null {
  const id = String(raw.conversation_id ?? raw.id ?? "");
  if (!id || !raw.mapping || typeof raw.mapping !== "object") return null;
  const sessionId = "chatgpt:" + id.slice(0, 190);
  const turns: ChatGPTTurn[] = [];
  let attachments = 0, open: { turn: ChatGPTTurn; replies: string[] } | undefined;
  const close = () => {
    if (!open) return;
    const reply = clip(open.replies.join("\n\n"));
    if (open.turn.user) turns.push({ ...open.turn, assistant: reply.text, truncated: open.turn.truncated || reply.truncated });
    open = undefined;
  };
  for (const node of currentBranch(raw.mapping, raw.current_node)) {
    const message = node.message;
    if (!message?.id || message.metadata?.is_visually_hidden_from_conversation) continue;
    const role = message.author?.role;
    if (role !== "user" && role !== "assistant") continue;
    if (role === "assistant" && message.recipient && message.recipient !== "all") continue;
    const { text, attachments: count } = messageText(message);
    attachments += count;
    if (role === "user") {
      close();
      const user = clip(text);
      open = { replies: [], turn: { sessionId, messageId: message.id.slice(0, 200), user: user.text, assistant: "",
        occurredAt: iso(message.create_time) ?? iso(raw.create_time), truncated: user.truncated } };
    } else if (open && text) open.replies.push(text);
  }
  close();
  return { id, turns, attachments };
}

function exportFiles(path: string): string[] {
  if (!existsSync(path)) throw new Error(`No such file or folder: ${path}`);
  if (statSync(path).isDirectory()) {
    const found: string[] = [];
    for (const dir of [path, ...readdirSync(path, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(path, e.name))])
      for (const name of readdirSync(dir).sort()) if (EXPORT_FILE.test(name)) found.push(join(dir, name));
    return found.map(file => readFileSync(file, "utf8"));
  }
  if (/\.zip$/i.test(path)) {
    // The system unzip reads the archive locally; nothing is extracted to disk.
    const entries = execFileSync("unzip", ["-Z1", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n").map(line => line.trim()).filter(entry => EXPORT_FILE.test(basename(entry))).sort();
    return entries.map(entry => execFileSync("unzip", ["-p", path, entry], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 }));
  }
  return [readFileSync(path, "utf8")];
}

/** Every conversation in an export zip, its extracted folder, or conversations.json itself. */
export function readChatGPTExport(path: string): ChatGPTConversation[] {
  const files = exportFiles(path);
  if (!files.length) throw new Error("No conversations.json in this ChatGPT export");
  const conversations = new Map<string, ChatGPTConversation>();
  for (const text of files) {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error("conversations.json is not valid JSON"); }
    if (!Array.isArray(raw)) throw new Error("conversations.json is not a ChatGPT export");
    for (const item of raw) {
      const conversation = item && typeof item === "object" ? parseChatGPTConversation(item as ExportConversation) : null;
      if (conversation) conversations.set(conversation.id, conversation);
    }
  }
  return [...conversations.values()];
}

export interface ChatGPTImportPlan {
  conversations: number;
  empty: number;
  turns: number;
  newTurns: ChatGPTTurn[];
  alreadyImported: number;
  attachments: number;
  truncated: number;
  from?: string;
  to?: string;
}

/** What an import would add: turns already in the source (by conversation and message id) are left out. */
export function planChatGPTImport(conversations: ChatGPTConversation[], store: IntelligenceEventStore): ChatGPTImportPlan {
  const imported = new Set<string>();
  for (const event of store.readSource("conversation.import")) {
    const conversation = conversationOf(event), messageId = event.payload && (event.payload.conversation as { messageId?: unknown })?.messageId;
    if (conversation && !event.erased && typeof messageId === "string") imported.add(conversation.sessionId + "\u0000" + messageId);
  }
  const turns = conversations.flatMap(c => c.turns);
  const times = turns.flatMap(t => t.occurredAt ? [t.occurredAt] : []).sort();
  const newTurns = turns.filter(t => !imported.has(t.sessionId + "\u0000" + t.messageId));
  return {
    conversations: conversations.length,
    empty: conversations.filter(c => !c.turns.length).length,
    turns: turns.length,
    newTurns,
    alreadyImported: turns.length - newTurns.length,
    attachments: conversations.reduce((n, c) => n + c.attachments, 0),
    truncated: turns.filter(t => t.truncated).length,
    from: times[0],
    to: times.at(-1),
  };
}

/** Queues new turns through the conversation.import route, which enforces consent, redaction and limits. */
export async function importChatGPTTurns(turns: ChatGPTTurn[]): Promise<number> {
  let queued = 0;
  for (let i = 0; i < turns.length; i += BATCH) {
    const batch = turns.slice(i, i + BATCH).map(t => ({ sessionId: t.sessionId, messageId: t.messageId,
      user: t.user, assistant: t.assistant, truncated: t.truncated,
      ...(t.occurredAt ? { occurredAt: t.occurredAt } : {}) }));
    const result = await learningRequest("/learning/conversations", "POST", { turns: batch });
    if (result.status >= 400) throw new Error(`Import stopped after ${queued} turns: ${(result.body as { error?: string }).error ?? "failed"}`);
    queued += batch.length;
  }
  return queued;
}

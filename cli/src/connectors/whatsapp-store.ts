import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { connectorDir } from "./accounts.js";

export type WAMessage = { id: string; chat: string; sender: string; text: string; timestamp: number; fromMe: boolean; kind: string };
export class WhatsAppStore {
  readonly db: Database.Database;
  constructor(directory = join(connectorDir(), "whatsapp")) {
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    const path = join(directory, "state.sqlite");
    this.db = new Database(path); chmodSync(path, 0o600);
    this.db.pragma("journal_mode = DELETE"); this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS auth (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (chat TEXT, id TEXT, sender TEXT, text TEXT, timestamp INTEGER, fromMe INTEGER, kind TEXT, PRIMARY KEY(chat,id));
      CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, chat TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL, messageId TEXT);`);
    this.db.prepare("DELETE FROM messages WHERE timestamp < ?").run(Date.now() - 30 * 86400_000);
    this.db.prepare("DELETE FROM drafts WHERE created < ? AND status = 'draft'").run(Date.now() - 86400_000);
  }
  auth(id: string): string | undefined { return (this.db.prepare("SELECT value FROM auth WHERE id=?").get(id) as { value: string } | undefined)?.value; }
  saveAuth(id: string, value: string | null): void {
    if (value === null) this.db.prepare("DELETE FROM auth WHERE id=?").run(id);
    else this.db.prepare("INSERT OR REPLACE INTO auth VALUES (?,?)").run(id, value);
  }
  chat(id: string, name?: string | null): void {
    if (!/^[\w.-]+@(s.whatsapp.net|g.us|lid)$/.test(id)) return;
    this.db.prepare("INSERT INTO chats VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN excluded.name=excluded.id THEN chats.name ELSE excluded.name END").run(id, name || id);
  }
  message(m: WAMessage): void {
    const cutoff = Date.now() - 30 * 86400_000;
    this.db.prepare("DELETE FROM messages WHERE timestamp < ?").run(cutoff);
    if (m.timestamp < cutoff) return;
    this.chat(m.chat);
    if (!this.db.prepare("SELECT id FROM chats WHERE id=?").get(m.chat)) return;
    this.db.prepare("INSERT OR REPLACE INTO messages VALUES (?,?,?,?,?,?,?)").run(m.chat, m.id, m.sender, m.text.slice(0, 16000), m.timestamp, Number(m.fromMe), m.kind);
  }
  search(query = "", limit = 20): unknown[] {
    return this.db.prepare(`SELECT c.id,c.name,MAX(m.timestamp) AS latest FROM chats c LEFT JOIN messages m ON c.id=m.chat
      WHERE instr(lower(c.name),lower(?))>0 OR instr(c.id,?)>0 OR EXISTS(SELECT 1 FROM messages x WHERE x.chat=c.id AND instr(lower(x.text),lower(?))>0)
      GROUP BY c.id ORDER BY latest DESC LIMIT ?`).all(query, query, query, limit);
  }
  read(chat: string, limit = 30): unknown[] {
    if (!this.db.prepare("SELECT id FROM chats WHERE id=?").get(chat)) throw new Error("WhatsApp chat must come from whatsapp_search");
    return this.db.prepare("SELECT * FROM (SELECT * FROM messages WHERE chat=? ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp").all(chat, limit);
  }
  draft(chat: string, body: string): unknown {
    const recipient = this.db.prepare("SELECT id,name FROM chats WHERE id=?").get(chat);
    if (!recipient) throw new Error("WhatsApp recipient must be an exact chat id from whatsapp_search; never guess a number");
    if (!body.trim() || body.length > 16000) throw new Error("WhatsApp draft body must be 1–16000 characters");
    const id = randomUUID();
    this.db.prepare("INSERT INTO drafts (id,chat,body,created,status) VALUES (?,?,?,?,?)").run(id, chat, body, Date.now(), "draft");
    return { id, recipient, body, status: "draft", sendInstruction: `Send WhatsApp draft ${id}` };
  }
  async send(id: string, transport: (chat: string, body: string) => Promise<string>): Promise<unknown> {
    const draft = this.db.prepare("SELECT * FROM drafts WHERE id=?").get(id) as { chat: string; body: string; created: number; status: string } | undefined;
    if (!draft || draft.status !== "draft" || Date.now() - draft.created > 86400_000) throw new Error("WhatsApp draft is missing, expired, or already attempted; never retry an uncertain send");
    const claimed = this.db.prepare("UPDATE drafts SET status='sending' WHERE id=? AND status='draft'").run(id);
    if (!claimed.changes) throw new Error("WhatsApp draft already attempted");
    try {
      const messageId = await transport(draft.chat, draft.body);
      this.db.prepare("UPDATE drafts SET status='sent',messageId=? WHERE id=?").run(messageId, id);
      return { id, status: "sent", messageId, chat: draft.chat, body: draft.body, delivery: "accepted by transport; not proof of delivery or read" };
    } catch {
      this.db.prepare("UPDATE drafts SET status='uncertain' WHERE id=?").run(id);
      throw new Error("WhatsApp send outcome is uncertain. Check the conversation before creating another draft; this draft cannot be retried");
    }
  }
  close(): void { this.db.close(); }
}

import makeWASocket, { BufferJSON, DisconnectReason, initAuthCreds, proto, normalizeMessageContent, type AuthenticationState, type SignalDataTypeMap, type WAMessage as WireMessage } from "@whiskeysockets/baileys";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectorDir } from "./accounts.js";
import { WhatsAppStore, type WAMessage } from "./whatsapp-store.js";

// No provider log contents: Signal keys, pairing QR and chat text must not enter logs.
const silent = { level: "silent", trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } };
export function extractWhatsAppMessage(wire: WireMessage): WAMessage | null {
  const chat = wire.key.remoteJid, id = wire.key.id;
  if (!chat || !id) return null;
  if (wire.message?.ephemeralMessage || wire.message?.viewOnceMessage || wire.message?.viewOnceMessageV2) return null;
  const content = normalizeMessageContent(wire.message);
  if (!content) return null;
  const kind = content.conversation || content.extendedTextMessage ? "text" : content.imageMessage ? "image" : content.audioMessage ? "audio" : content.videoMessage ? "video" : content.documentMessage ? "document" : "unsupported";
  const text = content.conversation ?? content.extendedTextMessage?.text ?? content.imageMessage?.caption ?? content.videoMessage?.caption ?? `[${kind}: content not downloaded]`;
  return { chat, id, text, kind, sender: wire.key.participant || chat, fromMe: Boolean(wire.key.fromMe), timestamp: Number(wire.messageTimestamp || 0) * 1000 };
}
export class WhatsAppClient {
  readonly store: WhatsAppStore;
  private socket?: ReturnType<typeof makeWASocket>;
  private ready?: Promise<void>;
  private state = "disconnected";
  private retry?: NodeJS.Timeout;
  private stopped = false;
  private retries = 0;
  private lock: string;
  private locked = false;
  constructor(private readonly socketFactory: typeof makeWASocket = makeWASocket) {
    this.store = new WhatsAppStore(); this.lock = join(connectorDir(), "whatsapp", "connection.lock");
  }
  status(): unknown { return { provider: "whatsapp", state: this.state, paired: this.paired(), history: "Partial linked-device history, plus messages received while connected. Text cache retained for 30 days; attachments and calls unsupported." }; }
  paired(): boolean { const raw = this.store.auth("creds"); return Boolean(raw && JSON.parse(raw, BufferJSON.reviver).registered); }
  private acquire(): void {
    if (this.locked) return;
    if (existsSync(this.lock)) {
      const pid = Number(readFileSync(join(this.lock, "pid"), "utf8"));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error("WhatsApp connection lock is invalid; inspect the local lock before reconnecting");
      try { process.kill(pid, 0); throw new Error("WhatsApp connection is owned by another Flyd process; close it before pairing/connecting here"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      rmSync(this.lock, { recursive: true });
    }
    mkdirSync(this.lock, { mode: 0o700 }); writeFileSync(join(this.lock, "pid"), String(process.pid), { mode: 0o600 }); this.locked = true;
  }
  async connect(onQR?: (qr: string) => void): Promise<void> {
    if (this.state === "connected") return;
    if (this.ready) return this.ready;
    if (!onQR && !this.paired()) throw new Error("WhatsApp is not paired. Run flyd whatsapp connect and scan the QR from WhatsApp Linked Devices");
    this.acquire(); this.stopped = false;
    const creds = this.store.auth("creds");
    const state: AuthenticationState = {
      creds: creds ? JSON.parse(creds, BufferJSON.reviver) : initAuthCreds(),
      keys: {
        get: async (type, ids) => {
          const result: Record<string, SignalDataTypeMap[typeof type]> = {};
          for (const id of ids) {
            const raw = this.store.auth(`${type}:${id}`);
            let value = raw ? JSON.parse(raw, BufferJSON.reviver) : undefined;
            if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            result[id] = value;
          }
          return result;
        },
        set: async data => { this.store.db.transaction(() => {
          for (const [type, values] of Object.entries(data)) for (const [id, value] of Object.entries(values || {})) this.store.saveAuth(`${type}:${id}`, value ? JSON.stringify(value, BufferJSON.replacer) : null);
        })(); },
      },
    };
    this.state = "connecting";
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.socket?.end(new Error("Connection timeout")); reject(new Error("WhatsApp connection timed out; check network and pairing")); }, onQR ? 120_000 : 25_000);
      const socket = this.socketFactory({ auth: state, logger: silent, markOnlineOnConnect: false, syncFullHistory: false, getMessage: async () => undefined });
      this.socket = socket;
      socket.ev.on("creds.update", () => this.store.saveAuth("creds", JSON.stringify(state.creds, BufferJSON.replacer)));
      socket.ev.on("chats.upsert", chats => { for (const c of chats) c.id && this.store.chat(c.id, c.name); });
      socket.ev.on("contacts.upsert", contacts => { for (const c of contacts) c.id && this.store.chat(c.id, c.name || c.notify); });
      socket.ev.on("messaging-history.set", history => {
        for (const c of history.chats) c.id && this.store.chat(c.id, c.name);
        for (const c of history.contacts) c.id && this.store.chat(c.id, c.name || c.notify);
        for (const m of history.messages) { const parsed = extractWhatsAppMessage(m); if (parsed) this.store.message(parsed); }
      });
      socket.ev.on("messages.upsert", ({ messages }) => { for (const m of messages) { const parsed = extractWhatsAppMessage(m); if (parsed) this.store.message(parsed); } });
      socket.ev.on("messages.delete", event => {
        if ("keys" in event) for (const key of event.keys) this.store.db.prepare("DELETE FROM messages WHERE chat=? AND id=?").run(key.remoteJid, key.id);
        else if (event.all) this.store.db.prepare("DELETE FROM messages WHERE chat=?").run(event.jid);
      });
      socket.ev.on("messages.update", updates => { for (const { key, update } of updates) {
        if (update.message === null) this.store.db.prepare("DELETE FROM messages WHERE chat=? AND id=?").run(key.remoteJid, key.id);
        else if (update.message) { const parsed = extractWhatsAppMessage({ key, ...update }); if (parsed) this.store.db.prepare("UPDATE messages SET text=?,kind=? WHERE chat=? AND id=?").run(parsed.text, parsed.kind, parsed.chat, parsed.id); }
      } });
      socket.ev.on("connection.update", update => {
        if (this.socket !== socket) return;
        if (update.qr && onQR) onQR(update.qr);
        if (update.connection === "open") { clearTimeout(timer); this.state = "connected"; this.retries = 0; resolve(); }
        if (update.connection === "close") {
          clearTimeout(timer); this.state = "disconnected";
          const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) { this.state = "needs_pairing"; this.store.db.exec("DELETE FROM auth"); }
          if (!this.stopped && code === DisconnectReason.restartRequired && this.retries++ < 5) {
            this.ready = undefined; void this.connect(onQR).then(resolve, reject); return;
          }
          reject(new Error("WhatsApp disconnected; inspect flyd whatsapp status or pair again"));
          if (!this.stopped && code !== DisconnectReason.loggedOut && !onQR && !this.retry && this.retries++ < 5) this.retry = setTimeout(() => {
            this.retry = undefined; this.ready = undefined; void this.connect(onQR).catch(() => undefined);
          }, 3000);
        }
      });
    });
    const attempt = this.ready;
    try { await attempt; } finally { if (this.ready === attempt) this.ready = undefined; }
  }
  async send(chat: string, body: string): Promise<string> {
    await this.connect();
    const result = await this.socket!.sendMessage(chat, { text: body });
    if (!result?.key.id) throw new Error("WhatsApp did not return a message id");
    const parsed = extractWhatsAppMessage(result); if (parsed) this.store.message(parsed);
    return result.key.id;
  }
  disconnectLocal(): void {
    this.acquire(); this.stop(); this.store.close();
    rmSync(join(connectorDir(), "whatsapp"), { recursive: true, force: true });
  }
  stop(): void {
    this.stopped = true; if (this.retry) clearTimeout(this.retry); this.retry = undefined;
    this.socket?.end(undefined); this.state = "disconnected";
    if (this.locked) { rmSync(this.lock, { recursive: true, force: true }); this.locked = false; }
  }
}
let client: WhatsAppClient | undefined;
export function whatsappClient(): WhatsAppClient { return client ??= new WhatsAppClient(); }

export async function startPairedWhatsApp(): Promise<void> {
  const c = whatsappClient(); if (c.paired()) await c.connect();
}

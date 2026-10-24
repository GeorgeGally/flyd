import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { COOKIE, MobileAuth, type Session } from "./auth.js";
import { MobileRequests } from "./requests.js";
import { renderMarkdown } from "../conversation-view/markdown.js";
import { renderWhatsAppPage } from "../conversation-view/whatsapp-page.js";
import { MAIL_PAGE, MAIL_SCRIPT } from "./mail-surface.js";
import { MOBILE_PAGE, LOGIN_PAGE, MOBILE_STYLE, MOBILE_SCRIPT, MOBILE_ICON } from "./surface.js";

export interface MobileServerOptions {
  origin: string;
  auth: MobileAuth;
  requests: MobileRequests;
  answer(text: string, history: Array<{ role: "user" | "assistant"; content: string }>, requestId: string): Promise<string>;
  transcribe?(pcm: Buffer): Promise<string>;
  mail?(action: string, input: Record<string, unknown>): Promise<unknown>;
  whatsapp?(name: string, input: Record<string, unknown>): Promise<unknown>;
  /** Today's news edition, as the desktop shows it. */
  news?(): MobileNews | null;
  /** George's more/less on a story: a local preference write (recordScoutFeedback), not an outward action. False when it is not in today's edition. */
  rateStory?(input: { n: number; url: string; verdict: "more" | "less" }): boolean;
}
export interface MobileNews { date: string; items: Array<{ n: number; title: string; url: string; source: string; why: string; kind: string }> }
export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function parse(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new HttpError(415, "Expected JSON");
  try {
    const value: unknown = JSON.parse((await body(req, 64 * 1024)).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Invalid JSON"); }
}
const equal = (a: unknown, b: string): boolean => typeof a === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Narrow internet adapter. No proxy to the privileged loopback Core/view API. */
export class MobileServer {
  private readonly origin: URL;
  private readonly active = new Set<Promise<void>>();
  private server?: Server;
  private work: Promise<void> = Promise.resolve();
  private queued = new Set<string>();
  private recording = false;
  private peopleBusy = false;
  private mailBusy = false;
  private loginWindow = { start: Date.now(), count: 0 };
  constructor(private readonly options: MobileServerOptions) {
    this.origin = new URL(options.origin);
    if (this.origin.protocol !== "https:" || this.origin.origin !== options.origin || this.origin.username || this.origin.password) {
      throw new Error("FLYD_MOBILE_ORIGIN must be an exact HTTPS origin without a trailing slash");
    }
  }
  async listen(port = 4819): Promise<number> {
    const server = createServer((req, res) => {
      const handling = this.handle(req, res).catch(error => {
        if (!res.headersSent) json(res, error instanceof HttpError ? error.status : 500,
          { error: error instanceof HttpError ? error.message : "Flyd could not complete this request. No automatic retry was made." });
        else res.end();
      }).finally(() => this.active.delete(handling));
      this.active.add(handling);
    });
    server.requestTimeout = 60_000; server.headersTimeout = 10_000; server.maxHeadersCount = 40;
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    this.server = server;
    this.options.requests.recover();
    return (server.address() as { port: number }).port;
  }
  async close(): Promise<void> {
    const server = this.server;
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    // Accepted work survives browser disconnects; service shutdown waits for receipts.
    await Promise.allSettled([...this.active]);
    await this.work;
  }
  private news(): MobileNews | null {
    try { return this.options.news?.() ?? null; } catch { return null; }
  }
  private validOrigin(req: IncomingMessage): boolean { return req.headers.origin === this.origin.origin; }
  private csrf(req: IncomingMessage, session: Session): void {
    if (!this.validOrigin(req) || !equal(req.headers["x-flyd-view-token"], session.csrf)) throw new HttpError(403, "Refresh Flyd before trying again");
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (req.headers.host !== this.origin.host) throw new HttpError(421, "Wrong host");
    const url = new URL(req.url ?? "/", this.origin);
    if (url.origin !== this.origin.origin) throw new HttpError(400, "Invalid URL");
    if (req.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "Wrong origin");
    const path = url.pathname;
    const asset = (type: string, content: string): void => { res.writeHead(200, { "Content-Type": type }); res.end(content); };
    if (req.method === "GET") {
      if (path === "/healthz") { json(res, 200, { ok: true }); return; }
      if (path === "/mobile.css") { asset("text/css", MOBILE_STYLE); return; }
      if (path === "/mail.js") { asset("text/javascript", MAIL_SCRIPT); return; }
      if (path === "/mobile.js") { asset("text/javascript", MOBILE_SCRIPT); return; }
      if (path === "/icon.svg") { asset("image/svg+xml", MOBILE_ICON); return; }
      if (path === "/manifest.webmanifest") { json(res, 200, { name: "Flyd", short_name: "Flyd", start_url: "/", display: "standalone", background_color: "#f5f4ef", theme_color: "#f5f4ef", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }] }); return; }
    }
    if (path === "/auth/login" && req.method === "POST") {
      if (!this.validOrigin(req)) throw new HttpError(403, "Wrong origin");
      if (Date.now() - this.loginWindow.start > 60_000) this.loginWindow = { start: Date.now(), count: 0 };
      if (++this.loginWindow.count > 10) throw new HttpError(429, "Wait a minute before trying another pairing code");
      const value = await parse(req);
      const login = this.options.auth.login(typeof value.code === "string" ? value.code : "");
      if (!login) throw new HttpError(401, "Pairing code expired or already used");
      res.setHeader("Set-Cookie", `${COOKIE}=${login.token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
      json(res, 200, { ok: true }); return;
    }
    const session = this.options.auth.session(req.headers.cookie);
    if (!session) {
      if (req.method === "GET" && path === "/") { asset("text/html; charset=utf-8", LOGIN_PAGE); return; }
      throw new HttpError(401, "Open Flyd and pair this phone to continue");
    }
    if (req.method === "POST") this.csrf(req, session);
    if (req.method === "GET" && path === "/") { asset("text/html; charset=utf-8", MOBILE_PAGE); return; }
    if (req.method === "GET" && path === "/mail") { asset("text/html; charset=utf-8", MAIL_PAGE); return; }
    if (req.method === "GET" && path === "/whatsapp") {
      // Existing renderer: use this session's CSRF token, with a nonce for its static script.
      // Provider content is rendered via textContent by this page.
      const { randomBytes } = await import("node:crypto");
      const nonce = randomBytes(24).toString("hex");
      res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'`);
      const page = renderWhatsAppPage(session.csrf).replace("<script>", `<script nonce="${nonce}">`)
        .replace("Text retained locally for 30 days.", "Text retained by your Flyd host for 30 days.")
        .replace("Focus here and use Flyd dictation to speak.", "Type here or use your iPhone keyboard microphone.");
      asset("text/html; charset=utf-8", page); return;
    }
    if (req.method === "GET" && path === "/api/state") {
      json(res, 200, { csrf: session.csrf, accountsEnabled: !!this.options.whatsapp, mac: "not_connected", voice: !!this.options.transcribe,
        news: this.news(),
        requests: this.options.requests.list().slice(-40).map(row => ({ ...row, html: row.answer ? renderMarkdown(row.answer) : undefined })) }); return;
    }
    if (req.method === "POST" && path === "/auth/logout") {
      this.options.auth.revoke(session);
      res.setHeader("Set-Cookie", `${COOKIE}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`); json(res, 200, { ok: true }); return;
    }
    if (req.method === "POST" && path === "/api/send") {
      const value = await parse(req);
      if (typeof value.id !== "string" || typeof value.text !== "string") throw new HttpError(400, "Enter a message");
      const previous = this.options.requests.get(value.id);
      if (!previous && this.queued.size >= 8) throw new HttpError(429, "Flyd is busy; your message has not been submitted");
      let row;
      try { row = this.options.requests.accept(value.id, value.text); }
      catch { throw new HttpError(409, "Invalid request, or request id already used for different text"); }
      if (!previous && !this.queued.has(row.id)) {
        const { id, text } = row; this.queued.add(id);
        this.work = this.work.then(async () => {
          this.options.requests.settle(id, "running");
          const history = this.options.requests.list().filter(item => item.status === "succeeded" && item.id !== id).slice(-12)
            .flatMap(item => [{ role: "user" as const, content: item.text }, { role: "assistant" as const, content: item.answer ?? "" }]);
          try { this.options.requests.settle(id, "succeeded", await this.options.answer(text, history, id)); }
          catch { this.options.requests.settle(id, "unknown", "I couldn't confirm the result. Check any account changes before trying again; I haven't retried this request."); }
        }).catch(() => { /* Persistence failed: restart recovery marks it unknown. Never dispatch it again. */ })
          .finally(() => this.queued.delete(id));
      }
      json(res, 202, { id: row.id, status: row.status }); return;
    }
    if (req.method === "POST" && path === "/api/news/feedback") {
      if (!this.options.rateStory) throw new HttpError(503, "News is not available on this Flyd host");
      const value = await parse(req);
      const { n, url, verdict } = value;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || typeof url !== "string" || !url || (verdict !== "more" && verdict !== "less")) throw new HttpError(400, "Invalid news feedback");
      if (!this.options.rateStory({ n, url, verdict })) throw new HttpError(409, "That story is no longer in today's news; refresh and try again");
      json(res, 200, { ok: true, verdict }); return;
    }
    if (req.method === "POST" && path === "/api/transcribe") {
      if (!this.options.transcribe) throw new HttpError(503, "Voice is not configured yet");
      if (this.recording) throw new HttpError(429, "Voice transcription is already running");
      if (req.headers["content-type"] !== "application/octet-stream") throw new HttpError(415, "Expected 24 kHz mono PCM16 audio");
      this.recording = true;
      try {
        const pcm = await body(req, 60 * 24000 * 2);
        if (pcm.length < 1600 || pcm.length % 2) throw new HttpError(400, "No speech captured");
        json(res, 200, { text: await this.options.transcribe(pcm) });
      } finally { this.recording = false; }
      return;
    }
    if (req.method === "POST" && path === "/api/mail") {
      if (!this.options.mail) throw new HttpError(503, "Mail is not connected on this Flyd host yet");
      if (this.mailBusy) throw new HttpError(429, "A mail request is still running. Wait for its result.");
      this.mailBusy = true;
      try {
        const value = await parse(req);
        if (typeof value.action !== "string" || !["accounts", "inbox", "search", "read", "save", "drafts"].includes(value.action) || !value.input || typeof value.input !== "object" || Array.isArray(value.input)) throw new HttpError(400, "Invalid mail action");
        json(res, 200, { result: await this.options.mail(value.action, value.input as Record<string, unknown>) });
      } finally { this.mailBusy = false; }
      return;
    }
    if (req.method === "POST" && path === "/api/whatsapp") {
      if (!this.options.whatsapp) throw new HttpError(503, "Accounts are not enabled on this Flyd host yet");
      if (this.peopleBusy) throw new HttpError(429, "Another account action is running; check its result first");
      this.peopleBusy = true;
      try {
      const value = await parse(req);
      if (typeof value.name !== "string" || !["whatsapp_status", "whatsapp_search", "whatsapp_read", "whatsapp_draft", "whatsapp_send"].includes(value.name) || !value.input || typeof value.input !== "object" || Array.isArray(value.input)) throw new HttpError(400, "Invalid account action");
      json(res, 200, { result: await this.options.whatsapp(value.name, value.input as Record<string, unknown>) });
      }
      finally { this.peopleBusy = false; }
      return;
    }
    throw new HttpError(404, "Not found");
  }
}

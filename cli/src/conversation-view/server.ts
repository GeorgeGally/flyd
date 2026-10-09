import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { renderMarkdown } from "./markdown.js";
import { renderPage } from "./page.js";
import type { PlanUsageReader } from "./plan-usage.js";
import { authorSummary, firstSentence, ReplySummarizer, SUMMARY_MIN_CHARS, type SummarySource } from "./summaries.js";
import type { ConversationMessage, ConversationSnapshot, ConversationSource, ImageUpload } from "./types.js";

// Loopback-only HTTP server for the conversation view. It never sends
// transcript content anywhere but the local browser that asked for it. The
// one write it accepts is the captain's message, POST /api/send, which the
// source delivers (for firstmate: its own inbox).

export const VIEW_HOST = "127.0.0.1";
export const DEFAULT_VIEW_PORT = 4818;
const HEARTBEAT_MS = 15_000;
/** Text plus up to four pasted screenshots, base64-encoded. */
const MAX_SEND_BODY_BYTES = 72 * 1024 * 1024;
/** Model summaries are only asked for the newest replies; older ones use what is cached. */
const SUMMARIZE_NEWEST = 20;

export interface RenderedMessage {
  id: string;
  role: ConversationMessage["role"];
  html: string;
  /** Image ids; the page loads each from /api/image. */
  images?: string[];
  /** For a long reply: what to read first. `html` is then the rest of the reply. */
  summary?: { html: string; source: SummarySource; pending?: boolean };
  /** The model's summary of a reply that carries its own, when FLYD_SUMMARY_ALWAYS asks for both. */
  compare?: { html: string; pending?: boolean };
  timestamp?: string;
}

export interface SummaryOptions {
  summarizer: ReplySummarizer;
  /** Also summarise replies that carry their own "» " summary, to compare. */
  always?: boolean;
  /** Called when a requested summary arrives (or fails), so the stream can push it. */
  onSummary?: () => void;
}

interface StreamUpdate {
  /** Every visible message id, in order; the page drops ids not listed. */
  order: string[];
  /** Messages that are new or whose content changed. */
  messages: RenderedMessage[];
  working: boolean;
  lastActivity?: string;
  context?: { tokens: number; window: number };
}

/** Turns successive snapshots into minimal updates, rendering only what changed. */
export class SnapshotDiffer {
  private readonly sent = new Map<string, string>();

  constructor(private readonly summaries?: SummaryOptions) {}

  /** Starts a model summary in the background; the stream re-renders when it lands. */
  private ask(text: string): void {
    const summaries = this.summaries!;
    void summaries.summarizer.request(text).then(() => summaries.onSummary?.());
  }

  /** The summary parts of an assistant reply. Never waits for a model. */
  private summarize(message: ConversationMessage, newest: boolean): Pick<RenderedMessage, "summary" | "compare"> & { body: string } {
    const author = authorSummary(message.text);
    const summarizer = this.summaries?.summarizer;
    const modelFor = (text: string): { text?: string; pending: boolean } => {
      if (!summarizer) return { pending: false };
      const cached = summarizer.cached(text);
      if (cached) return { text: cached, pending: false };
      if (newest && summarizer.wants(text)) this.ask(text);
      return { pending: summarizer.pending(text) };
    };
    if (author) {
      const parts: Pick<RenderedMessage, "summary" | "compare"> & { body: string } = {
        body: author.rest,
        summary: { html: renderMarkdown(author.summary), source: "author" },
      };
      if (this.summaries?.always && author.rest.length >= SUMMARY_MIN_CHARS) {
        const model = modelFor(message.text);
        if (model.text || model.pending) parts.compare = { html: model.text ? renderMarkdown(model.text) : "", ...(model.pending ? { pending: true } : {}) };
      }
      return parts;
    }
    if (message.text.length < SUMMARY_MIN_CHARS) return { body: message.text };
    const model = modelFor(message.text);
    return {
      body: message.text,
      summary: model.text
        ? { html: renderMarkdown(model.text), source: "model" }
        : { html: renderMarkdown(firstSentence(message.text)), source: "first-sentence", ...(model.pending ? { pending: true } : {}) },
    };
  }

  next(snapshot: ConversationSnapshot): StreamUpdate {
    const changed: RenderedMessage[] = [];
    const order: string[] = [];
    const seen = new Set<string>();
    const newest = new Set(
      snapshot.messages.filter((message) => message.role === "assistant").slice(-SUMMARIZE_NEWEST).map((message) => message.id),
    );
    for (const message of snapshot.messages) {
      order.push(message.id);
      seen.add(message.id);
      const parts = message.role === "assistant" ? this.summarize(message, newest.has(message.id)) : { body: message.text };
      const key = JSON.stringify([message.text, message.images ?? [], parts.summary, parts.compare]);
      if (this.sent.get(message.id) === key) continue;
      this.sent.set(message.id, key);
      changed.push({
        id: message.id,
        role: message.role,
        html: renderMarkdown(parts.body),
        ...(message.images?.length ? { images: message.images } : {}),
        ...(parts.summary ? { summary: parts.summary } : {}),
        ...(parts.compare ? { compare: parts.compare } : {}),
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
      });
    }
    for (const id of [...this.sent.keys()]) if (!seen.has(id)) this.sent.delete(id);
    return {
      order,
      messages: changed,
      working: snapshot.working,
      ...(snapshot.lastActivity ? { lastActivity: snapshot.lastActivity } : {}),
      ...(snapshot.context ? { context: snapshot.context } : {}),
    };
  }
}

function isLoopbackHost(hostHeader: string | undefined, port: number): boolean {
  // Rejects DNS-rebinding: a page on another origin that resolves to
  // 127.0.0.1 still sends its own Host header.
  if (!hostHeader) return false;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(hostHeader.toLowerCase());
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sameToken(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function sseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export class ConversationViewServer {
  private server: Server | null = null;
  private port = 0;
  /**
   * Proof a send came from this server's own page: other origins can POST to
   * loopback, but cannot read the page that carries this token.
   */
  private readonly token = randomBytes(24).toString("hex");

  constructor(
    private readonly source: ConversationSource,
    private readonly summaries?: { summarizer: ReplySummarizer; always?: boolean },
    private readonly plan?: PlanUsageReader,
  ) {}

  async listen(port = DEFAULT_VIEW_PORT): Promise<number> {
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        else res.end();
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, VIEW_HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.port = (server.address() as AddressInfo).port;
    return this.port;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLoopbackHost(req.headers.host, this.port)) {
      sendJson(res, 403, { error: "forbidden host" });
      return;
    }
    const url = new URL(req.url ?? "/", `http://${VIEW_HOST}:${this.port}`);
    if (req.method === "POST" && url.pathname === "/api/send") {
      await this.send(req, res);
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        // Inline page only; nothing loads from elsewhere.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
      });
      res.end(renderPage({
        assistantLabel: this.source.assistantLabel,
        ...(this.source.canSend ? { sendToken: this.token } : {}),
      }));
      return;
    }
    if (url.pathname === "/api/sessions") {
      sendJson(res, 200, { assistantLabel: this.source.assistantLabel, sessions: await this.source.listSessions() });
      return;
    }
    if (url.pathname === "/api/token") {
      // Lets an open tab recover after the view process restarted with a new
      // token. Other origins cannot read this response (no CORS), and the Host
      // check above stops DNS rebinding, so it proves the same thing the
      // token embedded in the page does.
      if (!this.source.canSend) sendJson(res, 404, { error: "read-only" });
      else sendJson(res, 200, { token: this.token });
      return;
    }
    if (url.pathname === "/api/plan") {
      sendJson(res, 200, { plan: this.plan?.current() ?? null });
      return;
    }
    if (url.pathname === "/api/image") {
      await this.image(res, url.searchParams.get("session"), url.searchParams.get("id"));
      return;
    }
    if (url.pathname === "/api/stream") {
      await this.stream(req, res, url.searchParams.get("session"));
      return;
    }
    sendJson(res, 404, { error: "not found" });
  }

  private async send(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.source.canSend) {
      sendJson(res, 405, { error: "read-only" });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !isLoopbackHost(origin.replace(/^http:\/\//, ""), this.port)) {
      sendJson(res, 403, { error: "forbidden origin" });
      return;
    }
    if (!sameToken(req.headers["x-flyd-view-token"], this.token)) {
      sendJson(res, 403, { error: "missing or wrong token" });
      return;
    }
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
      sendJson(res, 415, { error: "expected application/json" });
      return;
    }
    let payload: { session?: unknown; text?: unknown; images?: unknown };
    try {
      payload = JSON.parse(await readBody(req, MAX_SEND_BODY_BYTES)) as typeof payload;
    } catch {
      sendJson(res, 400, { error: "invalid body" });
      return;
    }
    const images = payload.images ?? [];
    const validImages = Array.isArray(images) && images.every((image) =>
      typeof image === "object" && image !== null &&
      typeof (image as ImageUpload).mediaType === "string" && typeof (image as ImageUpload).data === "string");
    if (typeof payload.session !== "string" || typeof payload.text !== "string" || !validImages ||
        (!payload.text.trim() && (images as ImageUpload[]).length === 0)) {
      sendJson(res, 400, { error: "expected { session, text, images? }" });
      return;
    }
    try {
      sendJson(res, 200, await this.source.send(payload.session, payload.text, images as ImageUpload[]));
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async image(res: ServerResponse, session: string | null, id: string | null): Promise<void> {
    let image = null;
    try {
      image = session && id ? await this.source.image(session, id) : null;
    } catch {
      image = null;
    }
    if (!image) {
      sendJson(res, 404, { error: "no such image" });
      return;
    }
    res.writeHead(200, {
      "content-type": image.mediaType,
      "content-length": image.data.length,
      "x-content-type-options": "nosniff",
      // An id always names the same bytes.
      "cache-control": "private, max-age=86400, immutable",
    });
    res.end(image.data);
  }

  private async stream(req: IncomingMessage, res: ServerResponse, requested: string | null): Promise<void> {
    const sessions = await this.source.listSessions();
    const session = requested ? sessions.find((candidate) => candidate.id === requested) : sessions[0];
    if (!session) {
      sendJson(res, 404, { error: requested ? `No such session: ${requested}` : "No sessions found" });
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    sseEvent(res, "session", { ...session, assistantLabel: this.source.assistantLabel });

    let latest: ConversationSnapshot | null = null;
    let closed = false;
    const differ = new SnapshotDiffer(this.summaries
      ? {
          ...this.summaries,
          // A summary landed: push whatever it changed.
          onSummary: () => {
            if (!closed && latest) sseEvent(res, "update", differ.next(latest));
          },
        }
      : undefined);
    const follower = this.source.follow(
      session.id,
      (snapshot) => {
        latest = snapshot;
        sseEvent(res, "update", differ.next(snapshot));
      },
      (error) => sseEvent(res, "problem", { error: error.message }),
    );
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
    heartbeat.unref?.();
    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      follower.close();
    });
  }
}

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname } from "node:path";
import { renderCaptainMarkdown, renderMarkdown } from "./markdown.js";
import { renderPage } from "./page.js";
import { readTaste, restoreRule, rewordRule, vetoRule } from "../council/taste.js";
import { syncTasteSkills } from "../council/taste-skills.js";
import { readProjects } from "../council/projects.js";
import { renderTastePage } from "./taste-page.js";
import type { PlanUsageReader } from "./plan-usage.js";
import { statusOf } from "./status.js";
import { authorSummary, digestMarkdown, digestReply, isActionable, isRoutine, isRoutineAnswer, ReplySummarizer, SUMMARY_MIN_CHARS, type SummarySource } from "./summaries.js";
import type { ConversationMessage, ConversationSnapshot, ConversationSource, FileUpload, ImageUpload } from "./types.js";
import type { AnswerInterpreter } from "./interpret.js";
import { inFlydsVoice } from "./flyd-voice.js";
import { renderBriefing, statusSummaryHtml } from "./executive.js";
import { showOf, type ShowProject, type ShowScreen } from "./show.js";
import { ArtefactFeed, type ArtefactInputs } from "./artefact.js";
import { boxesOf, type Box, type BoxReadings } from "./boxes.js";
import type { WeatherReader } from "./weather.js";
import { ComposerPredictions, eligibleDraft, boundedPredictionMessages } from "./composer-predictions.js";

// Loopback-only view. Explicit composer typing may request a bounded model
// completion; predictions cannot invoke the source's send or dispatch work.

export const VIEW_HOST = "127.0.0.1";
export const DEFAULT_VIEW_PORT = 4818;

const SHOT_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const HEARTBEAT_MS = 15_000;
/** Text plus up to four attachments (screenshots or documents), base64-encoded. */
const MAX_SEND_BODY_BYTES = 72 * 1024 * 1024;
/** Model summaries are only asked for the newest replies; older ones use what is cached. */
const SUMMARIZE_NEWEST = 20;

export interface RenderedMessage {
  id: string;
  role: ConversationMessage["role"];
  html: string;
  /** Image ids; the page loads each from /api/image. */
  images?: string[];
  /** Names of documents attached to the message. */
  files?: string[];
  /** For a long reply: what to read first. `html` is then the rest of the reply. */
  summary?: { html: string; source: SummarySource | "flyd" | "brief"; pending?: boolean };
  /** The model's summary of a reply that carries its own, when FLYD_SUMMARY_ALWAYS asks for both. */
  compare?: { html: string; pending?: boolean };
  /** The reply hands the captain something to act on: the page never folds it behind its summary. */
  expanded?: boolean;
  /** Routine chatter (an acknowledgement, a status ping): the page mutes it. */
  routine?: boolean;
  timestamp?: string;
  waiting?: string;
  waitingFailed?: boolean;
  answers?: string;
  aside?: boolean;
}

export interface SummaryOptions {
  summarizer?: ReplySummarizer;
  /** Flyd's own reading of firstmate's answer to one of his notes. */
  interpreter?: AnswerInterpreter;
  /** Also summarise replies that carry their own "» " summary, to compare. */
  always?: boolean;
  /** Called when a requested summary arrives (or fails), so the stream can push it. */
  onSummary?: () => void;
}

/** What artefact view needs beyond the conversation: who answers, his projects, and Flyd's artefact. */
export interface ShowOptions {
  assistant?: string;
  projects?: () => ShowProject[];
  /** Flyd's artefact: firstmate's fleet snapshot, Flyd's memory, the news and its taste. */
  artefact?: () => ArtefactInputs;
  /** Plan usage and weather, for the overview's boxes. */
  readings?: () => BoxReadings;
}

interface StreamUpdate {
  /** Every visible message id, in order; the page drops ids not listed. */
  order: string[];
  /** Messages that are new or whose content changed. */
  messages: RenderedMessage[];
  working: boolean;
  /** While working: what the assistant is doing now, in a few plain words. */
  activity?: string;
  lastActivity?: string;
  context?: { tokens: number; window: number };
  /** Show mode's screen: Flyd's few things, picked from this snapshot. */
  show: ShowScreen;
  /** The overview: Flyd's screen laid out as boxes, calls first. */
  boxes: Box[];
}

/**
 * With no model reading coming, Flyd's briefing of the whole reply leads: the
 * engineering stubs gone and several pieces of work as a status card, but every
 * sentence kept. A local digest cut a reply to its lead and left him almost
 * nothing to read; it only stands in while a model summary is on its way.
 */
function briefOf(text: string): NonNullable<RenderedMessage["summary"]> {
  return { html: renderBriefing(text), source: "brief" };
}

/** Turns successive snapshots into minimal updates, rendering only what changed. */
export class SnapshotDiffer {
  private readonly sent = new Map<string, string>();

  constructor(private readonly summaries?: SummaryOptions, private readonly show?: ShowOptions) {}

  /** Flyd's own reading of a message, when it has made one: its interpretation of an answer, else its summary. */
  private reading(message: ConversationMessage): string | undefined {
    if (message.answers?.startsWith("note:")) return this.summaries?.interpreter?.cached(message.text);
    const model = this.summaries?.summarizer?.cached(message.text);
    return model && !isRoutineAnswer(model) ? inFlydsVoice(model) : undefined;
  }

  /** Starts a model summary in the background; the stream re-renders when it lands. */
  private ask(text: string): void {
    const summaries = this.summaries!;
    void summaries.summarizer!.request(text).then(() => summaries.onSummary?.());
  }

  /**
   * Firstmate's answer to his note, as Flyd tells it: Flyd's interpretation
   * leads, firstmate's own words wait behind "more". Until it lands the lead
   * is the answer's local digest; with none coming, Flyd's whole briefing of it.
   */
  private interpret(message: ConversationMessage, snapshot: ConversationSnapshot, newest: boolean): Pick<RenderedMessage, "summary"> & { body: string } {
    const interpreter = this.summaries?.interpreter;
    const cached = interpreter?.cached(message.text);
    if (cached) return { body: message.text, summary: { html: statusSummaryHtml(message.text, inFlydsVoice(cached)) ?? renderBriefing(inFlydsVoice(cached)), source: "flyd" } };
    if (interpreter && newest && interpreter.wants(message.text)) {
      const at = snapshot.messages.findIndex((candidate) => candidate.id === message.answers);
      const before = at >= 0 ? at : snapshot.messages.indexOf(message);
      const summaries = this.summaries!;
      void interpreter
        .request({ question: snapshot.messages[at]?.text ?? "", answer: message.text, recent: snapshot.messages.slice(0, Math.max(0, before)) })
        .then(() => summaries.onSummary?.());
    }
    const pending = interpreter?.pending(message.text) ?? false;
    return { body: message.text, summary: pending ? { html: statusSummaryHtml(message.text) ?? renderBriefing(digestMarkdown(digestReply(message.text))), source: "digest", pending: true } : briefOf(message.text) };
  }

  /** The summary parts of an assistant reply. Never waits for a model. */
  private summarize(message: ConversationMessage, newest: boolean): Pick<RenderedMessage, "summary" | "compare" | "routine" | "expanded"> & { body: string } {
    const author = authorSummary(message.text);
    const summarizer = this.summaries?.summarizer;
    const modelFor = (text: string): { text?: string; pending: boolean } => {
      if (!summarizer) return { pending: false };
      const cached = summarizer.cached(text);
      if (cached) return { text: inFlydsVoice(cached), pending: false };
      if (newest && summarizer.wants(text)) this.ask(text);
      return { pending: summarizer.pending(text) };
    };
    if (author) {
      const parts: Pick<RenderedMessage, "summary" | "compare" | "expanded"> & { body: string } = {
        body: author.rest,
        summary: { html: statusSummaryHtml(author.rest, author.summary) ?? renderBriefing(author.summary), source: "author" },
        ...(isActionable(author.rest) ? { expanded: true } : {}),
      };
      if (this.summaries?.always && author.rest.length >= SUMMARY_MIN_CHARS) {
        const model = modelFor(message.text);
        if (model.text || model.pending) parts.compare = { html: model.text ? renderBriefing(model.text) : "", ...(model.pending ? { pending: true } : {}) };
      }
      return parts;
    }
    if (message.text.length < SUMMARY_MIN_CHARS) return { body: message.text, ...(isRoutine(message.text) ? { routine: true } : {}) };
    // Rules to paste, steps to carry out: the summary leads, the reply shows open under it.
    const actionable = isActionable(message.text);
    const model = modelFor(message.text);
    const digest = digestReply(message.text);
    // The model found no outcome, decision or ask: one muted line.
    if (model.text && isRoutineAnswer(model.text) && !actionable) return { body: message.text, routine: true, summary: { html: renderMarkdown(digest.lead), source: "model" } };
    const summary: NonNullable<RenderedMessage["summary"]> = model.text && !isRoutineAnswer(model.text)
      ? { html: statusSummaryHtml(message.text, model.text) ?? renderBriefing(model.text), source: "model" }
      : model.pending ? { html: statusSummaryHtml(message.text) ?? renderBriefing(digestMarkdown(digest)), source: "digest", pending: true } : briefOf(message.text);
    return { body: message.text, summary, ...(actionable && summary.source !== "brief" ? { expanded: true } : {}) };
  }

  next(snapshot: ConversationSnapshot): StreamUpdate {
    const changed: RenderedMessage[] = [];
    const order: string[] = [];
    const seen = new Set<string>();
    const newest = new Set(
      snapshot.messages.filter((message) => message.role === "assistant").slice(-SUMMARIZE_NEWEST).map((message) => message.id),
    );
    for (const message of snapshot.messages) {
      // An answer to his own question is never muted as routine: Flyd's shows whole, firstmate's is told by Flyd.
      const parts: Pick<RenderedMessage, "summary" | "compare" | "routine" | "expanded"> & { body: string } = message.role !== "assistant" ? { body: message.text }
        : !message.answers ? this.summarize(message, newest.has(message.id))
          : message.answers.startsWith("note:") ? this.interpret(message, snapshot, newest.has(message.id))
            : { body: message.text };
      if (parts.summary?.source === "brief" && parts.summary.html === renderMarkdown(parts.body)) delete parts.summary;
      const routine = parts.routine === true;
      // Relayed updates are only worth his attention when they carry an outcome, decision or ask.
      if (message.aside && routine) continue;
      order.push(message.id);
      seen.add(message.id);
      const expanded = parts.expanded === true;
      const key = JSON.stringify([message.text, message.images ?? [], message.files ?? [], parts.summary, parts.compare, routine, expanded, message.waiting, message.waitingFailed, message.answers, message.aside]);
      if (this.sent.get(message.id) === key) continue;
      this.sent.set(message.id, key);
      changed.push({
        id: message.id,
        role: message.role,
        // His first read is Flyd's briefing; firstmate's own words, links and all, wait behind "more".
        html: message.role === "user" ? renderCaptainMarkdown(parts.body) : parts.summary ? renderMarkdown(parts.body) : renderBriefing(parts.body),
        ...(message.images?.length ? { images: message.images } : {}),
        ...(message.files?.length ? { files: message.files } : {}),
        ...(parts.summary ? { summary: parts.summary } : {}),
        ...(parts.compare ? { compare: parts.compare } : {}),
        ...(routine ? { routine: true } : {}),
        ...(expanded ? { expanded: true } : {}),
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
        ...(message.waiting ? { waiting: message.waiting } : {}),
        ...(message.waiting && message.waitingFailed ? { waitingFailed: true } : {}),
        ...(message.answers ? { answers: message.answers } : {}),
        ...(message.aside ? { aside: true } : {}),
      });
    }
    for (const id of [...this.sent.keys()]) if (!seen.has(id)) this.sent.delete(id);
    const show = showOf(snapshot, {
        ...(this.show?.assistant ? { assistant: this.show.assistant } : {}),
        projects: this.show?.projects?.() ?? [],
        ...(this.show?.artefact ? { artefact: this.show.artefact() } : {}),
        reading: (message) => this.reading(message),
        muted: (message) => {
          const model = message.answers ? undefined : this.summaries?.summarizer?.cached(message.text);
          return model !== undefined && isRoutineAnswer(model) && !isActionable(message.text);
        },
      });
    return {
      order,
      messages: changed,
      working: snapshot.working,
      ...(snapshot.working && snapshot.activity ? { activity: snapshot.activity } : {}),
      ...(snapshot.lastActivity ? { lastActivity: snapshot.lastActivity } : {}),
      ...(snapshot.context ? { context: snapshot.context } : {}),
      show,
      boxes: boxesOf(show, this.show?.readings?.() ?? {}),
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
  private readonly predictionContexts = new Map<string, { at: number; messages: ConversationMessage[] }>();
  /**
   * Proof a send came from this server's own page: other origins can POST to
   * loopback, but cannot read the page that carries this token.
   */
  private readonly token = randomBytes(24).toString("hex");

  constructor(
    private readonly source: ConversationSource,
    private readonly summaries?: { summarizer?: ReplySummarizer; interpreter?: AnswerInterpreter; always?: boolean },
    private readonly plan?: PlanUsageReader,
    private readonly show?: Pick<ShowOptions, "projects">,
    private readonly feed: ArtefactFeed = new ArtefactFeed(),
    private readonly weather?: WeatherReader,
    private readonly predictions = new ComposerPredictions(),
  ) {}

  async listen(port = DEFAULT_VIEW_PORT): Promise<number> {
    this.feed.start();
    this.weather?.start();
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
    this.predictions.close();
    this.predictionContexts.clear();
    this.feed.stop();
    this.weather?.stop();
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
    if (req.method === "POST" && (url.pathname === "/api/predict" || url.pathname === "/api/prediction-feedback")) {
      await this.predict(req, res, url.pathname === "/api/prediction-feedback");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/taste") {
      await this.editTaste(req, res);
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
    if (url.pathname === "/taste") {
      if (!sameToken(url.searchParams.get("token") ?? undefined, this.token)) {
        sendJson(res, 403, { error: "missing or wrong token" });
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
      });
      res.end(renderTastePage(readTaste(), { token: this.token, projects: readProjects() }));
      return;
    }
    if (url.pathname === "/api/sessions") {
      sendJson(res, 200, { assistantLabel: this.source.assistantLabel, sessions: await this.source.listSessions() });
      return;
    }
    if (url.pathname === "/api/token") {
      // Lets an open tab recover after the view process restarted with a new
      // token. Other origins cannot read this response (no CORS), and the Host
      // check above stops DNS rebinding.
      sendJson(res, 200, { token: this.token });
      return;
    }
    if (url.pathname === "/api/commands") {
      sendJson(res, 200, { commands: await this.source.commands() });
      return;
    }
    if (url.pathname === "/api/prediction-status") {
      if (!sameToken(url.searchParams.get("token") ?? undefined, this.token)) { sendJson(res, 403, { error: "missing or wrong token" }); return; }
      sendJson(res, 200, this.predictions.status());
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
    if (url.pathname === "/api/artefact-shot") {
      if (!sameToken(url.searchParams.get("token") ?? undefined, this.token)) {
        sendJson(res, 403, { error: "missing or wrong token" });
        return;
      }
      await this.artefactShot(res, url.searchParams.get("task") ?? "", url.searchParams.get("file") ?? "");
      return;
    }
    if (url.pathname === "/api/status") {
      await this.statusStream(req, res);
      return;
    }
    if (url.pathname === "/api/stream") {
      if (!sameToken(url.searchParams.get("token") ?? undefined, this.token)) {
        sendJson(res, 403, { error: "missing or wrong token" });
        return;
      }
      await this.stream(req, res, url.searchParams.get("session"));
      return;
    }
    sendJson(res, 404, { error: "not found" });
  }

  /** Suggestions and feedback share the composer's origin, host and token gates. */
  private async predict(req: IncomingMessage, res: ServerResponse, feedback: boolean): Promise<void> {
    const origin = req.headers.origin;
    if (!this.source.canSend || (origin !== undefined && !isLoopbackHost(origin.replace(/^http:\/\//, ""), this.port)) || !sameToken(req.headers["x-flyd-view-token"], this.token)) {
      sendJson(res, 403, { error: "forbidden" }); return;
    }
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) { sendJson(res, 415, { error: "expected application/json" }); return; }
    let payload: { session?: unknown; draft?: unknown; id?: unknown; event?: unknown; characters?: unknown };
    try { payload = JSON.parse(await readBody(req, 8192)) as typeof payload; }
    catch { sendJson(res, 400, { error: "invalid body" }); return; }
    if (typeof payload.session !== "string" || !payload.session || payload.session.length > 512) { sendJson(res, 400, { error: "expected session" }); return; }
    if (feedback) {
      if (typeof payload.id !== "string" || typeof payload.event !== "string" || (payload.characters !== undefined && (typeof payload.characters !== "number" || !Number.isFinite(payload.characters)))) { sendJson(res, 400, { error: "invalid feedback" }); return; }
      this.predictions.feedback(payload.session, payload.id, payload.event, payload.characters as number | undefined);
      sendJson(res, 200, { ok: true }); return;
    }
    if (typeof payload.draft !== "string" || payload.draft.length > 2000) { sendJson(res, 400, { error: "expected draft" }); return; }
    if (!eligibleDraft(payload.draft)) { sendJson(res, 200, { prediction: null }); return; }
    const local = this.predictions.localPrediction(payload.session, payload.draft);
    if (local) { sendJson(res, 200, { prediction: local }); return; }
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.once("close", disconnected);
    try {
      const cached = this.predictionContexts.get(payload.session);
      const messages = cached && Date.now() - cached.at < 5 * 60_000 ? cached.messages : this.cachePredictionContext(payload.session, (await this.source.read(payload.session)).messages);
      const prediction = await this.predictions.predict({ session: payload.session, draft: payload.draft, messages }, controller.signal);
      if (!controller.signal.aborted) sendJson(res, 200, { prediction });
    } catch { if (!controller.signal.aborted) sendJson(res, 200, { prediction: null }); }
    finally { res.off("close", disconnected); }
  }

  private cachePredictionContext(session: string, messages: ConversationMessage[]): ConversationMessage[] {
    const recent = boundedPredictionMessages(messages);
    this.predictionContexts.delete(session);
    if (this.predictionContexts.size >= 5) this.predictionContexts.delete(this.predictionContexts.keys().next().value!);
    this.predictionContexts.set(session, { at: Date.now(), messages: recent });
    return recent;
  }

  /** A screenshot a fleet task saved, only when the artefact listed it. */
  private async artefactShot(res: ServerResponse, task: string, file: string): Promise<void> {
    const path = this.feed.shotPath(task, file);
    const type = SHOT_TYPES[extname(file).toLowerCase()];
    if (!path || !type) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    let data: Buffer;
    try {
      data = await readFile(path);
    } catch {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    res.writeHead(200, { "content-type": type, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" });
    res.end(data);
  }

  /** George rewords, vetoes or restores a learned taste rule from the taste page. */
  private async editTaste(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    if (origin !== undefined && !isLoopbackHost(origin.replace(/^http:\/\//, ""), this.port)) {
      sendJson(res, 403, { error: "forbidden origin" });
      return;
    }
    if (!sameToken(req.headers["x-flyd-view-token"], this.token)) {
      sendJson(res, 403, { error: "missing or wrong token" });
      return;
    }
    let payload: { action?: unknown; id?: unknown; text?: unknown };
    try {
      payload = JSON.parse(await readBody(req, 16 * 1024)) as typeof payload;
    } catch {
      sendJson(res, 400, { error: "invalid body" });
      return;
    }
    const id = typeof payload.id === "string" ? payload.id : "";
    const done = payload.action === "veto" ? vetoRule(id)
      : payload.action === "restore" ? restoreRule(id)
        : payload.action === "reword" && typeof payload.text === "string" ? rewordRule(id, payload.text)
          : null;
    if (done === null) sendJson(res, 400, { error: "expected { action: veto|restore|reword, id, text? }" });
    else if (!done) sendJson(res, 404, { error: "unknown rule" });
    else {
      // A reworded or vetoed rule changes what agents are told at once.
      try { syncTasteSkills(); } catch { /* the next council pass catches up */ }
      sendJson(res, 200, { ok: true });
    }
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
    let payload: { session?: unknown; text?: unknown; images?: unknown; files?: unknown };
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
    const files = payload.files ?? [];
    const validFiles = Array.isArray(files) && files.every((file) =>
      typeof file === "object" && file !== null &&
      typeof (file as FileUpload).name === "string" && typeof (file as FileUpload).data === "string");
    if (typeof payload.session !== "string" || typeof payload.text !== "string" || !validImages || !validFiles ||
        (!payload.text.trim() && (images as ImageUpload[]).length === 0 && (files as FileUpload[]).length === 0)) {
      sendJson(res, 400, { error: "expected { session, text, images?, files? }" });
      return;
    }
    try {
      const sent = await this.source.send(payload.session, payload.text, images as ImageUpload[], files as FileUpload[]);
      this.predictions.remember(payload.text);
      sendJson(res, 200, sent);
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

  /**
   * A compact feed for Flyd's notch island: the newest session's status,
   * sent when it changes (and re-checked every 30s so "working" can go stale).
   */
  private async statusStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const [session] = await this.source.listSessions();
    if (!session) {
      sendJson(res, 404, { error: "No sessions found" });
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
    let latest: ConversationSnapshot | null = null;
    let sent = "";
    const emit = () => {
      if (!latest) return;
      const status = JSON.stringify({ session: session.id, ...statusOf(latest) });
      if (status === sent) return;
      sent = status;
      res.write(`event: status\ndata: ${status}\n\n`);
    };
    const follower = this.source.follow(session.id, (snapshot) => {
      latest = snapshot;
      emit();
    });
    const tick = setInterval(() => {
      emit();
      res.write(": keep-alive\n\n");
    }, 30_000);
    tick.unref?.();
    req.on("close", () => {
      clearInterval(tick);
      follower.close();
    });
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
      : undefined, {
        assistant: this.source.assistantLabel,
        ...this.show,
        artefact: () => this.feed.current(),
        readings: () => ({ plan: this.plan?.current() ?? null, weather: this.weather?.current() ?? null }),
      });
    const follower = this.source.follow(
      session.id,
      (snapshot) => {
        latest = snapshot;
        this.cachePredictionContext(session.id, snapshot.messages);
        sseEvent(res, "update", differ.next(snapshot));
      },
      (error) => sseEvent(res, "problem", { error: error.message }),
    );
    const stopFeed = this.feed.onRefresh(() => {
      if (!closed && latest) sseEvent(res, "update", differ.next(latest));
    });
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
    heartbeat.unref?.();
    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      stopFeed();
      follower.close();
    });
  }
}

import { PreparationStore } from "../runtime/preparation-store.js";
import { renderPreparationPage } from "./preparation-page.js";
import { RoutineArtefacts } from "./routines.js";
import { renderRoutinesPage } from "./routines-page.js";
import { renderWhatsAppPage } from "./whatsapp-page.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { extname, join, sep } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { firstmateHome } from "../lib/firstmate-home.js";
import { renderCaptainMarkdown, renderMarkdown } from "./markdown.js";
import { renderPage } from "./page.js";
import { currentPage, type CurrentPage } from "./site-changes.js";
import { readTaste, restoreRule, rewordRule, vetoRule } from "../council/taste.js";
import { syncTasteSkills } from "../council/taste-skills.js";
import { readProjects } from "../council/projects.js";
import { renderTastePage } from "./taste-page.js";
import type { PlanUsageReader } from "./plan-usage.js";
import { statusOf } from "./status.js";
import { authorSummary, digestMarkdown, digestReply, isActionable, isRoutine, isRoutineAnswer, ReplySummarizer, SUMMARY_MIN_CHARS, type SummarySource } from "./summaries.js";
import type { ConversationMessage, ConversationSnapshot, ConversationSource, Exchange, FileUpload, ImageUpload } from "./types.js";
import type { AnswerInterpreter } from "./interpret.js";
import { inFlydsVoice } from "./flyd-voice.js";
import { handledBy, renderBriefing, stateOf, statusSummaryHtml } from "./executive.js";
import { showOf, type ShowProject, type ShowScreen } from "./show.js";
import { ArtefactFeed, composeArtefact, type ArtefactInputs } from "./artefact.js";
import { boxesOf, closedLinks, withClosedLinks, type Box, type BoxReadings } from "./boxes.js";
import type { Rail, RailState } from "./rail.js";
import { composeRail, conversationPreviews, loopbackPage, normalizeLoopback, PHONE_VIEWPORT, outcomeFirst, phoneCommentNote, phoneWork, RAIL_CARD_TITLES, railImageSrc, railServer, spoken, type RailArtefact, type RailPreview } from "./rail.js";
import { Workshop } from "./workshop.js";
import { composeMemory, type MemoryReader } from "./memory.js";
import { withFollowUps } from "./follow-ups.js";
import { answerNote, PASSAGE_CHARS, passageNote, replyNote } from "./replies.js";
import { answeredForHim, choiceOf, choiceTarget, openChoice, withoutClosingAsk, type ReplyChoice } from "./choices.js";
import type { AutoAnswers } from "./auto-answers.js";
import { PreviewProbe } from "./preview-probe.js";
import type { WeatherReader } from "./weather.js";
import { ComposerPredictions, eligibleDraft, boundedPredictionMessages } from "./composer-predictions.js";
import { ComposerDrafts, draftKey } from "./drafts.js";
import { unreadNotes, unreadWarning } from "./note-receipts.js";
import { noteSaid } from "../council/reply-review.js";

// Loopback-only view. Explicit composer typing may request a bounded model
// completion; predictions cannot invoke the source's send or dispatch work.

export const VIEW_HOST = "127.0.0.1";
export const DEFAULT_VIEW_PORT = 4818;

const SHOT_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
/** What a fleet deliverable or review board page may load from firstmate's data tree. */
const RAIL_FILE_TYPES: Record<string, string> = {
  ...SHOT_TYPES,
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const HEARTBEAT_MS = 15_000;
/** Text plus up to four attachments (screenshots or documents), base64-encoded. */
const MAX_SEND_BODY_BYTES = 72 * 1024 * 1024;
/** One attachment, base64-encoded, as it is added to the box. */
const MAX_DRAFT_ATTACHMENT_BYTES = 18 * 1024 * 1024;
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
  /** The screenshot behind the answer (on a question, behind its inline outcome), as a same-origin src. */
  shots?: string[];
  /** The web page the answer changed, as a button that opens it. */
  page?: { label: string; url: string };
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
  settled?: boolean;
  /** Under a settled outcome: what is still being done on this message. */
  doing?: string;
  answers?: string;
  aside?: boolean;
  /** His reply to an answer: the question it replies to, and his words there as quoted. */
  replyTo?: string;
  replyQuote?: string;
  /** A note to firstmate: sent, or read by firstmate. */
  receipt?: "sent" | "read";
  /** The reply asks him something he has not answered yet: its question, options, and where his answer goes. */
  choice?: ReplyChoice & { replyTo: string };
  /** Flyd answered a question for him by this standing rule of his; `undone` once he took it back. */
  answeredFor?: string;
  undone?: boolean;
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
  /** Flyd's right column: his conversations, their answers and the artefacts beside them. */
  rail?: (snapshot: ConversationSnapshot) => Rail;
  /** Whether a page on this machine answers, so a link to one that closed is said in words. */
  live?: (url: string) => string;
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
  /** The right column: his conversations with their answers, and artefacts beside them. */
  rail?: Rail;
  /** The page the work is on now, kept in the header whenever there is one. */
  page?: CurrentPage;
}

/**
 * With no model reading coming, Flyd's briefing of the whole reply leads: the
 * engineering stubs gone and several pieces of work as a status card, but every
 * sentence kept. A local digest cut a reply to its lead and left him almost
 * nothing to read; it only stands in while a model summary is on its way.
 */
function briefOf(text: string, handled?: Handled): NonNullable<RenderedMessage["summary"]> {
  return { html: renderBriefing(text, {}, handled), source: "brief" };
}

/** Of a reply's questions, the ones Flyd already answered for him. */
type Handled = (text: string) => boolean;

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
  private interpret(message: ConversationMessage, snapshot: ConversationSnapshot, newest: boolean, handled?: Handled): Pick<RenderedMessage, "summary"> & { body: string } {
    const interpreter = this.summaries?.interpreter;
    const cached = interpreter?.cached(message.text);
    if (cached) return { body: message.text, summary: { html: statusSummaryHtml(message.text, inFlydsVoice(cached), handled) ?? renderBriefing(inFlydsVoice(cached)), source: "flyd" } };
    if (interpreter && newest && interpreter.wants(message.text)) {
      const at = snapshot.messages.findIndex((candidate) => candidate.id === message.answers);
      const before = at >= 0 ? at : snapshot.messages.indexOf(message);
      const summaries = this.summaries!;
      void interpreter
        .request({ question: snapshot.messages[at]?.text ?? "", answer: message.text, recent: snapshot.messages.slice(0, Math.max(0, before)) })
        .then(() => summaries.onSummary?.());
    }
    const pending = interpreter?.pending(message.text) ?? false;
    return { body: message.text, summary: pending ? { html: statusSummaryHtml(message.text, undefined, handled) ?? renderBriefing(digestMarkdown(digestReply(message.text))), source: "digest", pending: true } : briefOf(message.text, handled) };
  }

  /** The summary parts of an assistant reply. Never waits for a model. */
  private summarize(message: ConversationMessage, newest: boolean, handled?: Handled): Pick<RenderedMessage, "summary" | "compare" | "routine" | "expanded"> & { body: string } {
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
        summary: { html: statusSummaryHtml(author.rest, author.summary, handled) ?? renderBriefing(author.summary), source: "author" },
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
      ? { html: statusSummaryHtml(message.text, model.text, handled) ?? renderBriefing(model.text), source: "model" }
      : model.pending ? { html: statusSummaryHtml(message.text, undefined, handled) ?? renderBriefing(digestMarkdown(digest)), source: "digest", pending: true } : briefOf(message.text, handled);
    return { body: message.text, summary, ...(actionable && summary.source !== "brief" ? { expanded: true } : {}) };
  }

  /** A reply Flyd's model judged routine (nothing asked, nothing to act on), or one plainly routine. */
  private routine(message: ConversationMessage): boolean {
    if (isRoutine(message.text)) return true;
    const model = message.answers ? undefined : this.summaries?.summarizer?.cached(message.text);
    return model !== undefined && isRoutineAnswer(model) && !isActionable(message.text);
  }

  next(snapshot: ConversationSnapshot): StreamUpdate {
    const changed: RenderedMessage[] = [];
    const order: string[] = [];
    const seen = new Set<string>();
    const newest = new Set(
      snapshot.messages.filter((message) => message.role === "assistant").slice(-SUMMARIZE_NEWEST).map((message) => message.id),
    );
    // The question a reply put to him, until he answers it.
    const open = openChoice(snapshot.messages, (message) => this.routine(message));
    // The questions Flyd answered for him: each reply's card shows them handled, not waiting on him.
    const answered = answeredForHim(snapshot.messages);
    // Answers Flyd gave for him that he took back since.
    const undone = new Set<string>();
    const takenBack = new Set<string>();
    for (const message of [...snapshot.messages].reverse()) {
      if (message.undoes && message.replyTo) takenBack.add(message.replyTo);
      else if (message.answeredFor && message.replyTo && takenBack.has(message.replyTo)) undone.add(message.id);
    }
    for (const message of snapshot.messages) {
      // An answer to his own question is never muted as routine: Flyd's shows whole, firstmate's is told by Flyd.
      const handled = message.role === "assistant" ? handledBy(answered.get(choiceTarget(message))) : undefined;
      const parts: Pick<RenderedMessage, "summary" | "compare" | "routine" | "expanded"> & { body: string } = message.role !== "assistant" ? { body: message.text }
        : !message.answers ? this.summarize(message, newest.has(message.id), handled)
          : message.answers.startsWith("note:") ? this.interpret(message, snapshot, newest.has(message.id), handled)
            : { body: message.text };
      const choice = open?.message === message ? { ...open.choice, replyTo: choiceTarget(message) } : undefined;
      // The card under the reply asks its question; Flyd's briefing does not say it again.
      if (choice && parts.summary?.source === "brief") parts.summary = briefOf(withoutClosingAsk(message.text), handled);
      if (parts.summary?.source === "brief" && parts.summary.html === renderMarkdown(parts.body)) delete parts.summary;
      const routine = parts.routine === true;
      // Relayed updates are only worth his attention when they carry an outcome, decision or ask.
      if (message.aside && routine) continue;
      order.push(message.id);
      seen.add(message.id);
      const expanded = parts.expanded === true;
      // Only Flyd's own copies are shown; a relayed update's transcript ids are not.
      const shots = (message.shots ?? []).filter((shot) => shot.startsWith("/")).map(railImageSrc);
      const key = JSON.stringify([message.text, message.images ?? [], message.files ?? [], shots, message.page, parts.summary, parts.compare, routine, expanded, message.waiting, message.waitingFailed, message.settled, message.doing, message.answers, message.aside, message.replyTo, message.receipt, choice, message.answeredFor, undone.has(message.id)]);
      if (this.sent.get(message.id) === key) continue;
      this.sent.set(message.id, key);
      changed.push({
        id: message.id,
        role: message.role,
        // His first read is Flyd's briefing; firstmate's own words, links and all, wait behind "more".
        html: message.role === "user" ? renderCaptainMarkdown(parts.body) : parts.summary ? renderMarkdown(parts.body) : renderBriefing(parts.body, {}, handled),
        ...(message.images?.length ? { images: message.images } : {}),
        ...(message.files?.length ? { files: message.files } : {}),
        ...(shots.length ? { shots } : {}),
        ...(message.page ? { page: message.page } : {}),
        ...(parts.summary ? { summary: parts.summary } : {}),
        ...(parts.compare ? { compare: parts.compare } : {}),
        ...(routine ? { routine: true } : {}),
        ...(expanded ? { expanded: true } : {}),
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
        ...(message.waiting ? { waiting: message.waiting } : {}),
        ...(message.waiting && message.waitingFailed ? { waitingFailed: true } : {}),
        ...(message.waiting && message.settled ? { settled: true, ...(message.doing ? { doing: message.doing } : {}) } : {}),
        ...(message.answers ? { answers: message.answers } : {}),
        ...(message.aside ? { aside: true } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo, ...(message.replyQuote ? { replyQuote: message.replyQuote } : {}) } : {}),
        ...(message.receipt ? { receipt: message.receipt } : {}),
        ...(choice ? { choice } : {}),
        ...(message.answeredFor !== undefined ? { answeredFor: message.answeredFor, ...(undone.has(message.id) ? { undone: true } : {}) } : {}),
      });
    }
    for (const id of [...this.sent.keys()]) if (!seen.has(id)) this.sent.delete(id);
    const show = showOf(snapshot, {
        ...(this.show?.assistant ? { assistant: this.show.assistant } : {}),
        projects: this.show?.projects?.() ?? [],
        ...(this.show?.artefact ? { artefact: this.show.artefact() } : {}),
        reading: (message) => this.reading(message),
        muted: (message) => this.routine(message),
      });
    const live = this.show?.live ?? (() => "up");
    const found = currentPage(snapshot.messages);
    // A page on this machine that stopped answering is not where the work is: the header never offers a dead link.
    const page = found?.local && live(found.url) === "down" ? undefined : found;
    return {
      order,
      messages: changed,
      working: snapshot.working,
      ...(snapshot.working && snapshot.activity ? { activity: snapshot.activity } : {}),
      ...(snapshot.lastActivity ? { lastActivity: snapshot.lastActivity } : {}),
      ...(snapshot.context ? { context: snapshot.context } : {}),
      // The calls sheet says a closed review page in words too.
      show: show.calls ? { ...show, calls: show.calls.map((call) => (call.links ? { ...call, links: closedLinks(call.links, live) } : call)) } : show,
      boxes: withClosedLinks(boxesOf(show, this.show?.readings?.() ?? {}), live),
      ...(this.show?.rail ? { rail: this.show.rail(snapshot) } : {}),
      ...(page ? { page } : {}),
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
  /** Each followed session's recent conversation, kept current by its stream; others are read fresh. */
  private readonly predictionContexts = new Map<string, ConversationMessage[]>();
  /**
   * Proof a send came from this server's own page: other origins can POST to
   * loopback, but cannot read the page that carries this token.
   */
  private readonly token = randomBytes(24).toString("hex");
  /** Review boards and finished deliverables the fleet left in firstmate's data tree. */
  private readonly workshop = new Workshop(() => join(firstmateHome(), "data"));

  constructor(
    private readonly source: ConversationSource,
    private readonly summaries?: { summarizer?: ReplySummarizer; interpreter?: AnswerInterpreter; always?: boolean },
    private readonly plan?: PlanUsageReader,
    private readonly show?: Pick<ShowOptions, "projects">,
    private readonly feed: ArtefactFeed = new ArtefactFeed(),
    private readonly weather?: WeatherReader,
    private readonly predictions = new ComposerPredictions(),
    private readonly drafts = new ComposerDrafts(),
    private readonly previews = new PreviewProbe(),
    /** Flyd's memory stores, read for the column; without it the column shows no memory. */
    private readonly memory?: MemoryReader,
    /** Answers firstmate's routine questions by his standing rules; without it every question waits for him. */
    private readonly autoAnswers?: AutoAnswers,
    private readonly routines = new RoutineArtefacts(),
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
    this.previews.close();
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
    if (url.pathname === "/api/preparation") {
      await this.preparationAction(req, res, url); return;
    }
    if (req.method === "GET" && url.pathname === "/preparation") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'", "referrer-policy": "no-referrer" });
      res.end(renderPreparationPage(this.token)); return;
    }
    if (url.pathname === "/api/routines") {
      await this.routineAction(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/routines") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        "referrer-policy": "no-referrer",
      });
      res.end(renderRoutinesPage(this.token));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/whatsapp") {
      const origin = req.headers.origin;
      if ((origin !== undefined && !isLoopbackHost(origin.replace(/^http:\/\//, ""), this.port)) || !sameToken(req.headers["x-flyd-view-token"], this.token)) { sendJson(res, 403, { error: "forbidden" }); return; }
      try {
        const body = JSON.parse(await readBody(req, 32 * 1024)) as { name: string; input: Record<string, unknown> };
        const wa = await import("../connectors/whatsapp-tools.js");
        if (!wa.whatsappTools.some(t => t.name === body.name) || !body.input || typeof body.input !== "object") { sendJson(res, 400, { error: "invalid action" }); return; }
        sendJson(res, 200, { result: await wa.runWhatsAppTool(body.name, body.input) });
      } catch { sendJson(res, 400, { error: "WhatsApp action unavailable. Check pairing and Core connection; do not retry an uncertain send." }); }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      await this.send(req, res);
      return;
    }
    if (req.method === "POST" && (url.pathname === "/api/predict" || url.pathname === "/api/prediction-feedback")) {
      await this.predict(req, res, url.pathname === "/api/prediction-feedback");
      return;
    }
    if (url.pathname === "/api/draft" || url.pathname === "/api/draft/attachment") {
      await this.draft(req, res, url);
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
    if (url.pathname === "/whatsapp") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:", "referrer-policy": "no-referrer" });
      res.end(renderWhatsAppPage(this.token)); return;
    }
    if (url.pathname === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        // Inline page only; the right column may frame a loopback site it previews.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self' http://127.0.0.1:* http://localhost:*",
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
    if (url.pathname === "/api/note") {
      // Whether firstmate has read one note he sent from an artefact: "sent", then "read".
      if (!sameToken(url.searchParams.get("token") ?? undefined, this.token)) { sendJson(res, 403, { error: "missing or wrong token" }); return; }
      const id = url.searchParams.get("id") ?? "";
      const note = this.source.exchanges?.().find((exchange) => exchange.question.id === id);
      sendJson(res, 200, { receipt: note ? (note.answer ? "read" : note.question.receipt ?? "sent") : null });
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
    if (url.pathname.startsWith("/rail-file/")) {
      const [, , token = "", ...rest] = url.pathname.split("/");
      if (!sameToken(token, this.token)) {
        sendJson(res, 403, { error: "missing or wrong token" });
        return;
      }
      let path: string;
      try {
        path = `/${rest.map((part) => decodeURIComponent(part)).join("/")}`;
      } catch {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      await this.railFile(res, path);
      return;
    }
    if (url.pathname === "/api/rail-image") {
      if (!sameToken(url.searchParams.get("token") ?? undefined, this.token)) {
        sendJson(res, 403, { error: "missing or wrong token" });
        return;
      }
      await this.railImage(res, url.searchParams.get("path") ?? "");
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
      const messages = this.predictionContexts.get(payload.session) ?? boundedPredictionMessages((await this.source.read(payload.session)).messages);
      const prediction = await this.predictions.predict({ session: payload.session, draft: payload.draft, messages }, controller.signal);
      if (!controller.signal.aborted) sendJson(res, 200, { prediction });
    } catch { if (!controller.signal.aborted) sendJson(res, 200, { prediction: null }); }
    finally { res.off("close", disconnected); }
  }

  private cachePredictionContext(session: string, messages: ConversationMessage[]): void {
    const recent = boundedPredictionMessages(messages);
    this.predictionContexts.delete(session);
    if (this.predictionContexts.size >= 5) this.predictionContexts.delete(this.predictionContexts.keys().next().value!);
    this.predictionContexts.set(session, recent);
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

  /** Flyd's right column: his questions with their answers, and the artefacts beside them. */
  private rail(snapshot: ConversationSnapshot): Rail {
    const projects = this.show?.projects?.() ?? [];
    const project = (repo: string): string | undefined => {
      const name = repo.toLowerCase();
      return projects.find((entry) => entry.repos.some((path) => path.replace(/\/+$/, "").split("/").pop()!.toLowerCase() === name) || entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === name)?.name;
    };
    // Changes made to a website lead the column's artefacts: the element it changed, and the page to open.
    const sites: RailArtefact[] = showOf(snapshot, { projects }).items
      .filter((item) => item.open)
      .map((item) => ({
        id: item.id,
        title: item.headline,
        line: item.open!.label,
        url: item.open!.url,
        ...(item.shots?.[0] ? { image: item.shots[0].src } : {}),
        ...(item.at ? { at: item.at } : {}),
      }));
    const artefacts: RailArtefact[] = [...sites, ...composeArtefact(this.feed.current(), { project })
      .filter((item) => item.kind !== "call")
      .map((item) => ({
        id: item.id,
        title: item.headline,
        ...(item.detail ? { line: item.detail } : {}),
        ...(item.links?.[0]?.url ? { url: item.links[0].url } : {}),
      }))];
    const interpreter = this.summaries?.interpreter;
    const { boards, deliverables } = this.workshop.current();
    // A Lavish board refuses to be framed; the column frames the page it reviews instead and links the board.
    const board = new Map<string, RailPreview>(boards.map((entry) => {
      const url = normalizeLoopback(entry.url) ?? entry.url;
      return [url, { id: `live:${url}`, kind: "live", url, title: `Review board: ${entry.title}`, line: entry.task ?? entry.title, frame: this.railFileSrc(entry.file) }];
    }));
    const workshop: RailPreview[] = [
      // A board whose server stopped is gone, not "not running".
      ...[...board.values()].filter((preview) => this.previews.state(preview.url) !== "down"),
      ...deliverables.map((entry): RailPreview => ({
        id: entry.id,
        kind: "file",
        url: this.railFileSrc(entry.open),
        title: entry.title,
        line: `${entry.task} · ${entry.kinds.map((kind) => kind.toUpperCase()).join(" + ")}`,
        ...(entry.html ? { frame: this.railFileSrc(entry.html) } : {}),
        at: new Date(entry.mtimeMs).toISOString(),
      })),
    ];
    // A question still under way says in the column what its line says in the window.
    const lines = new Map(snapshot.messages.filter((message) => message.role === "user" && message.waiting).map((message) => [message.id, message.waiting!]));
    const recorded = this.source.exchanges?.() ?? [];
    const formal = new Map(recorded.map((exchange) => [exchange.question.id, exchange.answer]));
    const exchanges = withFollowUps(recorded, snapshot.followUps ?? {}, snapshot.working).map((exchange): Exchange & { state?: RailState } => {
      const waiting = !exchange.answer && lines.has(exchange.question.id) ? { ...exchange, waiting: lines.get(exchange.question.id)! } : exchange;
      if (!exchange.question.id.startsWith("note:") || !exchange.answer) return waiting;
      // A note's answer in the column is the reply firstmate recorded for it; a chat paragraph that only
      // seemed to be about it is not shown there, though it still says where the note stands.
      const own = formal.get(exchange.question.id);
      if (own) {
        const seen = exchange.answer;
        return { ...exchange, answer: { ...own, ...(!own.shots?.length && seen.shots?.length ? { shots: seen.shots } : {}), ...(!own.page && seen.page ? { page: seen.page } : {}) } };
      }
      const { answer, ...rest } = exchange;
      const state = stateOf(answer.text);
      return { ...rest, waiting: "", answered: true, state: state === "needs" ? "needs" : state === "underway" ? "underway" : "done" };
    });
    const rail = composeRail(exchanges, artefacts, [...workshop, ...conversationPreviews(snapshot.messages)], {
      live: (url) => this.previews.state(url),
      phone: phoneWork(snapshot.messages),
      known: (preview) => board.get(preview.url) ?? preview,
      // Which server answers on the page's port: the process, its folder, and whether that is the project's own.
      server: (url) => {
        const served = this.previews.servedBy(url);
        return served ? railServer(url, served, projects, homedir()) : undefined;
      },
      // An answer to a note is told as Flyd tells it in the window; until Flyd has read it, its words without the machine header.
      // Either way it leads with what changed, never a salutation or a bare "done".
      voice: (answer) => {
        const reading = answer.answers?.startsWith("note:") ? interpreter?.cached(answer.text) : undefined;
        return renderBriefing(outcomeFirst(reading ? inFlydsVoice(reading) : spoken(answer.text), spoken(answer.text)), RAIL_CARD_TITLES);
      },
    });
    return this.memory ? { ...rail, memory: composeMemory(this.memory.current(), snapshot.messages, projects) } : rail;
  }

  /** The same-origin src of a file in firstmate's data tree; its relative assets resolve under the same prefix. */
  private railFileSrc(path: string): string {
    return `/rail-file/${this.token}${path.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
  }

  /**
   * A deliverable or review board page, served only from firstmate's data
   * tree. HTML runs sandboxed in an opaque origin, so a page the fleet made
   * can never reach this window's token or its API.
   */
  private async railFile(res: ServerResponse, file: string): Promise<void> {
    const type = RAIL_FILE_TYPES[extname(file).toLowerCase()];
    if (!file.startsWith("/") || !type || file.includes("\0")) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    let real: string;
    let root: string;
    try {
      real = await realpath(file);
      root = await realpath(join(firstmateHome(), "data"));
    } catch {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (!real.startsWith(root + sep)) {
      sendJson(res, 403, { error: "not allowed" });
      return;
    }
    try {
      const data = await readFile(real);
      res.writeHead(200, {
        "content-type": type,
        "cache-control": "private, max-age=30",
        "x-content-type-options": "nosniff",
        ...(type.startsWith("application/pdf") ? {} : { "content-security-policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox" }),
      });
      res.end(data);
    } catch {
      sendJson(res, 404, { error: "not found" });
    }
  }

  /** A screenshot a reply named, served only from firstmate's own tree or Flyd's. */
  private async railImage(res: ServerResponse, file: string): Promise<void> {
    const type = SHOT_TYPES[extname(file).toLowerCase()];
    if (!file.startsWith("/") || !type || file.includes("\0")) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    let real: string;
    try {
      real = await realpath(file);
    } catch {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    const roots = await Promise.all([firstmateHome(), FLYD_DIR].map((root) => realpath(root).catch(() => root)));
    if (!roots.some((root) => real === root || real.startsWith(root + sep))) {
      sendJson(res, 403, { error: "not allowed" });
      return;
    }
    try {
      const data = await readFile(real);
      res.writeHead(200, { "content-type": type, "cache-control": "private, max-age=60", "x-content-type-options": "nosniff" });
      res.end(data);
    } catch {
      sendJson(res, 404, { error: "not found" });
    }
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

  /**
   * The message box's draft: read back when the page loads, kept on every
   * change, and its attachments stored once as they are added.
   */
  private async draft(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
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
    if (req.method === "GET" && url.pathname === "/api/draft") {
      sendJson(res, 200, { draft: this.drafts.load(draftKey(url.searchParams.get("key"))) });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
      sendJson(res, 415, { error: "expected application/json" });
      return;
    }
    const attachment = url.pathname === "/api/draft/attachment";
    let payload: { key?: unknown; draft?: unknown };
    try {
      payload = JSON.parse(await readBody(req, attachment ? MAX_DRAFT_ATTACHMENT_BYTES : 1024 * 1024)) as typeof payload;
    } catch {
      sendJson(res, 400, { error: "invalid body" });
      return;
    }
    if (attachment) {
      const stored = this.drafts.attach(payload);
      if (stored) sendJson(res, 200, stored);
      else sendJson(res, 400, { error: "expected { name, data } or { mediaType, data }" });
      return;
    }
    if (this.drafts.save(draftKey(payload.key), payload.draft)) sendJson(res, 200, { ok: true });
    else sendJson(res, 400, { error: "expected { key, draft: { text, selectionStart, selectionEnd, attachments } }" });
  }

  private async preparationAction(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const origin = req.headers.origin;
    if ((origin !== undefined && !isLoopbackHost(origin.replace(/^http:\/\//, ""), this.port)) || !sameToken(req.headers["x-flyd-view-token"], this.token)) {
      sendJson(res, 403, { error: "forbidden" }); return;
    }
    try {
      const requested = url.searchParams.get("session");
      const session = !requested || requested === "latest" ? (await this.source.listSessions())[0]?.id : requested;
      if (!session || session.length > 180) { sendJson(res, 400, { error: "Open a conversation first." }); return; }
      const sessionId = `view:${session}`, store = new PreparationStore();
      store.recoverInterrupted();
      if (req.method === "GET") { sendJson(res, 200, { remits: store.listRemits(sessionId), attempts: store.list(sessionId) }); return; }
      if (req.method !== "POST") { sendJson(res, 405, { error: "method not allowed" }); return; }
      const body = JSON.parse(await readBody(req, 2048));
      if (body?.action === "cancel" && typeof body.id === "string") store.cancel(sessionId, body.id);
      else if (body?.action === "erase") store.erase(sessionId);
      else { sendJson(res, 400, { error: "Invalid preparation control." }); return; }
      sendJson(res, 200, { ok: true });
    } catch { sendJson(res, 400, { error: "Preparation unavailable." }); }
  }

  /** Each run enters the existing router; definitions cannot dispatch tools directly. */
  private async routineAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    if ((origin !== undefined && !isLoopbackHost(origin.replace(/^http:\/\//, ""), this.port)) ||
        !sameToken(req.headers["x-flyd-view-token"], this.token)) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }
    if (req.method === "GET") { sendJson(res, 200, this.routines.list()); return; }
    if (req.method !== "POST") { sendJson(res, 405, { error: "method not allowed" }); return; }
    try {
      const payload = JSON.parse(await readBody(req, 24 * 1024));
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid request");
      if (payload.action === "save") {
        sendJson(res, 200, { routine: this.routines.save(payload) });
        return;
      }
      if (payload.action === "dismiss" && typeof payload.id === "string") this.routines.dismiss(payload.id);
      else if (payload.action === "enabled" && typeof payload.enabled === "boolean") this.routines.enable(payload.enabled);
      else if (payload.action === "erase") this.routines.erase();
      else if (payload.action === "run") {
        if (!this.source.canSend) { sendJson(res, 405, { error: "read-only" }); return; }
        if (typeof payload.id !== "string" || typeof payload.session !== "string" || typeof payload.requestId !== "string" ||
            !Number.isInteger(payload.revision) || !payload.inputs || typeof payload.inputs !== "object" || Array.isArray(payload.inputs)) {
          throw new Error("Invalid run");
        }
        const session = payload.session === "latest" ? (await this.source.listSessions())[0]?.id : payload.session;
        if (!session) throw new Error("Open a conversation before running a routine.");
        const claimed = this.routines.claim(payload.id, payload.revision, session, payload.requestId, payload.inputs);
        if (!claimed.fresh) { sendJson(res, 200, claimed); return; }
        let receipt: string | undefined;
        try { receipt = (await this.source.send(claimed.run.session, claimed.run.text, [], [])).id; }
        catch { /* May have been delivered. Never repeat this run's dispatch. */ }
        sendJson(res, 200, { run: this.routines.settle(claimed.run, receipt) });
        return;
      } else throw new Error("Unknown routine action");
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Routine unavailable" });
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
    let payload: { session?: unknown; text?: unknown; images?: unknown; files?: unknown; decision?: unknown; replyTo?: unknown; undo?: unknown; comment?: unknown; about?: unknown; passage?: unknown };
    try {
      payload = JSON.parse(await readBody(req, MAX_SEND_BODY_BYTES)) as typeof payload;
    } catch {
      sendJson(res, 400, { error: "invalid body" });
      return;
    }
    if (payload.undo !== undefined) {
      await this.undo(res, payload.session, payload.undo);
      return;
    }
    const images = payload.images ?? [];
    const validImages = Array.isArray(images) && images.every((image) =>
      typeof image === "object" && image !== null &&
      typeof (image as ImageUpload).mediaType === "string" && typeof (image as ImageUpload).data === "string");
    if (payload.decision !== undefined) {
      const call = this.feed.current().fleet?.calls.find((row) => row.task === payload.decision);
      if (typeof payload.decision !== "string" || !call || !this.source.sendDecision) {
        sendJson(res, 409, { error: "This question is no longer available; refresh before answering" });
        return;
      }
      if (typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 4000) {
        sendJson(res, 400, { error: "Enter an answer of at most 4000 characters" });
        return;
      }
      if (!validImages) {
        sendJson(res, 400, { error: "expected images as [{ mediaType, data }]" });
        return;
      }
      try {
        const sent = await this.source.sendDecision(`Answer to pending decision ${call.task}: ${call.label}\nQuestion: ${call.detail ?? call.label}\n\n${payload.text.trim()}`, images as ImageUpload[]);
        sendJson(res, 200, { ...sent, waiting: "Sent to firstmate" });
      } catch (error) {
        sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (payload.comment !== undefined) {
      await this.comment(res, payload.session, payload.comment);
      return;
    }
    if (payload.about !== undefined) {
      if (!validImages) {
        sendJson(res, 400, { error: "expected images as [{ mediaType, data }]" });
        return;
      }
      await this.sendAbout(res, payload.about, payload.text, images as ImageUpload[]);
      return;
    }
    if (payload.passage !== undefined) {
      await this.commentOnPassage(res, payload.session, payload.passage, payload.text);
      return;
    }
    const files = payload.files ?? [];
    const validFiles = Array.isArray(files) && files.every((file) =>
      typeof file === "object" && file !== null &&
      typeof (file as FileUpload).name === "string" && typeof (file as FileUpload).data === "string");
    if (typeof payload.session !== "string" || typeof payload.text !== "string" || !validImages || !validFiles ||
        (!payload.text.trim() && (images as ImageUpload[]).length === 0 && (files as FileUpload[]).length === 0)) {
      sendJson(res, 400, { error: "expected { session, text, images?, files? }" });
      return;
    }
    if (payload.replyTo !== undefined) {
      await this.reply(res, payload.session, payload.replyTo, payload.text);
      return;
    }
    try {
      const sent = await this.source.send(payload.session, payload.text, images as ImageUpload[], files as FileUpload[]);
      this.predictionContexts.delete(payload.session);
      this.predictions.remember(payload.text);
      let routineSuggestion = false;
      if (!sent.warning && (images as ImageUpload[]).length === 0 && (files as FileUpload[]).length === 0) {
        try { routineSuggestion = Boolean(this.routines.observe(payload.session, sent.id, payload.text)); }
        catch { /* A delivered message stays delivered if discovery fails. */ }
      }
      sendJson(res, 200, { ...sent, ...(routineSuggestion ? { routineSuggestion: true } : {}) });
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** His comment on a spot of the phone preview: to whoever is doing the work, with the page, viewport and spot. */
  private async comment(res: ServerResponse, session: unknown, raw: unknown): Promise<void> {
    const comment = raw as { url?: unknown; x?: unknown; y?: unknown; element?: unknown; text?: unknown } | null;
    const url = typeof comment?.url === "string" ? loopbackPage(comment.url) : undefined;
    const spot = (value: unknown, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
    if (typeof session !== "string" || !comment || !url || !spot(comment.x, PHONE_VIEWPORT.width) || !spot(comment.y, PHONE_VIEWPORT.height) ||
        typeof comment.text !== "string" || !comment.text.trim() || comment.text.length > 4000 ||
        (comment.element !== undefined && (typeof comment.element !== "string" || comment.element.length > 300))) {
      sendJson(res, 400, { error: "expected { session, comment: { url, x, y, element?, text } } on a local page" });
      return;
    }
    try {
      const note = phoneCommentNote({ url, x: comment.x, y: comment.y, text: comment.text, ...(typeof comment.element === "string" && comment.element.trim() ? { element: comment.element.trim() } : {}) });
      const sent = await this.source.send(session, note, [], [], "firstmate");
      sendJson(res, 200, sent);
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** His comment on a passage he selected in a message: to firstmate, quoting it and naming the conversation. */
  private async commentOnPassage(res: ServerResponse, session: unknown, raw: unknown, text: unknown): Promise<void> {
    const passage = typeof raw === "object" && raw !== null ? raw as { quote?: unknown; from?: unknown } : {};
    if (typeof session !== "string" || !session || typeof passage.quote !== "string" || !passage.quote.trim() || passage.quote.length > PASSAGE_CHARS ||
        (passage.from !== "user" && passage.from !== "assistant")) {
      sendJson(res, 400, { error: `expected { session, passage: { quote, from: "user" | "assistant" }, text } with a passage of at most ${PASSAGE_CHARS} characters` });
      return;
    }
    if (typeof text !== "string" || !text.trim() || text.length > 4000) {
      sendJson(res, 400, { error: "Enter a comment of at most 4000 characters" });
      return;
    }
    try {
      const title = (await this.source.listSessions()).find((summary) => summary.id === session)?.title;
      const note = passageNote({ quote: passage.quote, from: passage.from, assistant: this.source.assistantLabel, conversation: { id: session, ...(title ? { title } : {}) } }, text);
      sendJson(res, 200, await this.source.send(session, note, [], [], "firstmate"));
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * His words about one artefact, from the chat box at its foot: straight to
   * firstmate as a note that names the artefact (its title, task and page), so
   * firstmate knows what "this" is without the screen. Images he pasted into
   * the box go with it.
   */
  private async sendAbout(res: ServerResponse, about: unknown, text: unknown, images: ImageUpload[] = []): Promise<void> {
    const card = typeof about === "object" && about !== null ? about as { title?: unknown; task?: unknown; url?: unknown } : {};
    const field = (value: unknown) => (typeof value === "string" && value.trim() && value.length <= 2000 ? value.trim() : undefined);
    const title = field(card.title);
    if (!title || (card.task !== undefined && !field(card.task)) || (card.url !== undefined && !field(card.url))) {
      sendJson(res, 400, { error: "expected { about: { title, task?, url? }, text }" });
      return;
    }
    if (typeof text !== "string" || (!text.trim() && !images.length) || text.length > 4000) {
      sendJson(res, 400, { error: "Enter a message of at most 4000 characters" });
      return;
    }
    if (!this.source.sendDecision) {
      sendJson(res, 405, { error: "read-only" });
      return;
    }
    const task = field(card.task);
    const url = field(card.url);
    const named = [`About the artefact "${title}"`, ...(task ? [`Task: ${task}`] : []), ...(url ? [`Page: ${url}`] : [])].join("\n");
    try {
      const words = text.trim();
      sendJson(res, 200, { ...await this.source.sendDecision(words ? `${named}\n\n${words}` : named, images), waiting: "Sent to firstmate" });
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** His reply to one answer: back to whoever gave it, saying what it answers. */
  private async reply(res: ServerResponse, session: string, replyTo: unknown, text: string): Promise<void> {
    if (typeof replyTo !== "string" || !text.trim()) {
      sendJson(res, 400, { error: "expected { session, text, replyTo }" });
      return;
    }
    try {
      const snapshot = await this.source.read(session);
      const parent = withFollowUps(this.source.exchanges?.() ?? [], snapshot.followUps ?? {}, snapshot.working)
        .find((exchange) => exchange.question.id === replyTo);
      // A question the session put to him in its own reply, not under a note of his: the answer goes back to that session.
      const asked = parent ? undefined : snapshot.messages.find((message) => message.role === "assistant" && message.id === replyTo);
      const question = asked ? choiceOf(asked.text)?.question : undefined;
      if (!parent && !(asked && question)) {
        sendJson(res, 409, { error: "That answer is no longer here; send it as a new message" });
        return;
      }
      const note = parent ? replyNote(parent, text) : answerNote(asked!, question!, text);
      const sent = await this.source.send(session, note, [], [], replyTo.startsWith("ask:") ? "flyd" : "firstmate");
      this.predictions.remember(text);
      sendJson(res, 200, sent);
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** He takes back an answer Flyd gave for him: the session is told to hold off until he answers. */
  private async undo(res: ServerResponse, session: unknown, noteId: unknown): Promise<void> {
    const note = typeof noteId === "string" ? this.source.exchanges?.().find((exchange) => exchange.question.id === noteId)?.question : undefined;
    if (typeof session !== "string" || !note?.answeredFor || !this.autoAnswers) {
      sendJson(res, 409, { error: "That answer is no longer here" });
      return;
    }
    try {
      sendJson(res, 200, await this.autoAnswers.undo(note, (text) => this.source.send(session, text, [], [], "firstmate")));
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** A routine question firstmate just put to him that a standing rule of his settles: Flyd answers it. */
  private autoAnswer(session: string, snapshot: ConversationSnapshot): void {
    if (!this.autoAnswers || !this.source.canSend) return;
    const open = openChoice(snapshot.messages, (message) => isRoutine(message.text));
    void this.autoAnswers
      .answer(session, open, (text) => this.source.send(session, text, [], [], "firstmate"))
      .catch((error: unknown) => console.warn(`[view] Flyd could not answer for him: ${error instanceof Error ? error.message : String(error)}`));
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
      const current = statusOf(latest);
      const status = JSON.stringify({ session: session.id, ...current });
      if (status === sent) return;
      sent = status;
      // What the island and the line under his message say, kept for Flyd's self-review.
      if (current.activity) noteSaid({ surface: "status", text: current.activity });
      if (current.waiting && !current.waiting.failed) noteSaid({ surface: "status", text: current.waiting.text });
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
    // Notes firstmate has left unread too long: a warning over the composer, checked on every update and heartbeat.
    let unreadSent = "";
    const emitUnread = () => {
      if (closed) return;
      const unread = unreadNotes(this.source.exchanges?.() ?? []);
      const data = unread ? { count: unread.count, oldest: unread.oldest, text: unreadWarning(unread) } : { count: 0 };
      if (JSON.stringify(data) === unreadSent) return;
      unreadSent = JSON.stringify(data);
      sseEvent(res, "unread", data);
    };
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
        rail: (snapshot) => this.rail(snapshot),
        live: (url) => this.previews.state(url),
      });
    const follower = this.source.follow(
      session.id,
      (snapshot) => {
        latest = snapshot;
        this.cachePredictionContext(session.id, snapshot.messages);
        this.autoAnswer(session.id, snapshot);
        sseEvent(res, "update", differ.next(snapshot));
        emitUnread();
      },
      (error) => sseEvent(res, "problem", { error: error.message }),
    );
    const stopFeed = this.feed.onRefresh(() => {
      if (!closed && latest) sseEvent(res, "update", differ.next(latest));
    });
    // A previewed page came up or went down: the column's card changes.
    const stopPreviews = this.previews.onChange(() => {
      if (!closed && latest) sseEvent(res, "update", differ.next(latest));
    });
    // A memory landed: the column's "Remembering now" shows it.
    const stopMemory = this.memory?.onChange(() => {
      if (!closed && latest) sseEvent(res, "update", differ.next(latest));
    });
    const heartbeat = setInterval(() => {
      res.write(": keep-alive\n\n");
      emitUnread();
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      stopFeed();
      stopPreviews();
      stopMemory?.();
      follower.close();
      this.predictionContexts.delete(session.id);
    });
  }
}

import { recommendationText } from "../intelligence/executive/decision-step.js";
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
import { answerHtml } from "./answer-form.js";
import { renderCaptainMarkdown, renderMarkdown } from "./markdown.js";
import { renderPage } from "./page.js";
import { currentPage, type CurrentPage } from "./site-changes.js";
import { readTaste, restoreRule, rewordRule, vetoRule } from "../council/taste.js";
import { syncTasteSkills } from "../council/taste-skills.js";
import { readProjects } from "../council/projects.js";
import { renderTastePage } from "./taste-page.js";
import type { PlanUsageReader } from "./plan-usage.js";
import { islandStatusOf, statusOf } from "./status.js";
import { authorSummary, digestReply, isActionable, isRoutine, isRoutineAnswer, askedForArtefact, replyArtefact, ReplySummarizer, SUMMARY_MIN_CHARS, type ReplyArtefact, type SummarySource } from "./summaries.js";
import type { ConversationMessage, ConversationSnapshot, ConversationSource, Exchange, FileUpload, ImageUpload } from "./types.js";
import type { AnswerInterpreter } from "./interpret.js";
import type { ArtefactJudge } from "./artefact-judge.js";
import type { SemanticJudge } from "./semantic-judge.js";
import type { ImportanceJudge } from "./importance-judge.js";
import { activityObjectsFromShow, artifactObjectsFromShow, decisionObjectsFromShow, composeSemanticSnapshot, semanticEvents, semanticFocus, semanticObjectsFromShow, type SemanticObject } from "./semantic.js";
import { inFlydsVoice } from "./flyd-voice.js";
import { handledBy, renderBriefing, stateOf } from "./executive.js";
import { condense, fitsAtAGlance, georgeMarkdown, outcomesOf, replyCard, staffLine, type Outcomes, type OutcomeState } from "./for-george.js";
import { showOf, situationOf, titleOf, type ShowProject, type ShowScreen } from "./show.js";
import { ArtefactFeed, composeArtefact, WHATSAPP_LINK, type ArtefactInputs } from "./artefact.js";
import type { WhatsAppPairing } from "../connectors/whatsapp-pairing.js";
import { boxesOf, closedLinks, withClosedLinks, type Box, type BoxReadings } from "./boxes.js";
import type { Rail, RailState } from "./rail.js";
import { composeRail, conversationPreviews, loopbackPage, normalizeLoopback, PHONE_VIEWPORT, outcomeFirst, phoneCommentNote, phoneWork, RAIL_CARD_TITLES, railImageSrc, railServer, spoken, type RailArtefact, type RailNotice, type RailPreview } from "./rail.js";
import { Workshop } from "./workshop.js";
import type { ActivityPanel, ActivityReader } from "./activity.js";
import { composeMemory, type MemoryReader } from "./memory.js";
import { withFollowUps } from "./follow-ups.js";
import { answerNote, artefactAsk, PASSAGE_CHARS, passageNote, replyNote, undoNote } from "./replies.js";
import { matchCommand } from "./commands.js";
import { withCommandMarker } from "./firstmate-inbox.js";
import { answered, answeredForHim, choiceOf, choiceTarget, labelOf, openChoice, withoutClosingAsk, type ReplyChoice } from "./choices.js";
import { PreviewProbe } from "./preview-probe.js";
import type { WeatherReader } from "./weather.js";
import { ComposerPredictions, eligibleDraft, boundedPredictionMessages } from "./composer-predictions.js";
import { ComposerDrafts, draftKey } from "./drafts.js";
import { concernKind, readStaffView, type StaffView } from "../command/fleet-monitor.js";
import { reachesGeorge } from "../lib/reaches-george.js";
import { noteSaid, recordHeld } from "../council/reply-review.js";
import { relayShortfalls, stripCommitIds } from "../runtime/honesty-check.js";
import { expandScrawl, fileScrawl } from "./scrawl-capture.js";
import { NoticeBoard, noticeLine, noticeOf, type NoticeInput } from "./notices.js";

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
/** How often the island's status stream checks that it still follows the live session. */
const STATUS_SESSION_CHECK_MS = 5_000;
/** Text plus up to four attachments (screenshots or documents), base64-encoded. */
const MAX_SEND_BODY_BYTES = 72 * 1024 * 1024;
/** One attachment, base64-encoded, as it is added to the box. */
const MAX_DRAFT_ATTACHMENT_BYTES = 18 * 1024 * 1024;
/** Reply steps kept in the column's Artefacts: the newest few. */
const MAX_REPLY_ARTEFACTS = 3;
/** A note older than this is not chased for a missing artefact: opening the window never replays the backlog. */
const ARTEFACT_CHASE_MAX_AGE_MS = 24 * 60 * 60_000;
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
  artifact?: ReplyArtefact;
  /** Routine chatter (an acknowledgement, a status ping): the page mutes it. */
  routine?: boolean;
  /**
   * A relayed staff update as Flyd shows it: one line, what kind of news it is,
   * and the link to what landed. The page draws it as a compact card; the staff's
   * own words wait behind "more".
   */
  card?: { kind: "landed" | "decision" | "blocker" | "underway" | "note"; line: string; sub?: string; url?: string };
  /** A reply that reports several pieces of work: its opening line and a card per piece. */
  outcomes?: Outcomes;
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
  choice?: ReplyChoice & { replyTo: string; session?: string };
  /** Flyd answered a question for him by this standing rule of his; `undone` once he took it back. */
  answeredFor?: string;
  undone?: boolean;
}

export interface SummaryOptions {
  summarizer?: ReplySummarizer;
  /** Flyd's own reading of firstmate's answer to one of his notes. */
  interpreter?: AnswerInterpreter;
  /** Flyd's call on replies whose steps the rules leave unclear: artefact or text. */
  artefacts?: ArtefactJudge;
  /** Jev's bounded semantic decision layer; shadow-only while ShowItem still renders the UI. */
  semantic?: SemanticJudge;
  importance?: ImportanceJudge;
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
  /** Flyd's left column: what it is doing now and has done lately. */
  leftColumn?: () => ActivityPanel;
  /** Whether a page on this machine answers, so a link to one that closed is said in words. */
  live?: (url: string) => string;
  /** Whether WhatsApp still needs linking: the offer card is shown in the timeline and the panel only while it does. */
  whatsappUnlinked?: () => boolean;
}

interface StreamUpdate {
  /** Every visible message id, in order; the page drops ids not listed. */
  order: string[];
  /** Messages that are new or whose content changed. */
  messages: RenderedMessage[];
  working: boolean;
  project?: string;
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
  /** The left column: what Flyd is doing now and has done lately. */
  leftColumn?: ActivityPanel;
  /** The page the work is on now, kept in the header whenever there is one. */
  page?: CurrentPage;
}

/**
 * What he reads first of a reply, whoever wrote the reading: a few short
 * lines at most, never a list or a status card. The full words, links and
 * all, wait behind "more".
 */
function glance(text: string, source: NonNullable<RenderedMessage["summary"]>["source"], pending = false, keepAsk = true): NonNullable<RenderedMessage["summary"]> {
  return { html: renderMarkdown(condense(text, { keepAsk })), source, ...(pending ? { pending: true } : {}) };
}

/** With no model reading coming, the reply itself, held to a glance; without its question when a card asks it. */
function briefOf(text: string, keepAsk = true): NonNullable<RenderedMessage["summary"]> {
  return glance(text, "brief", false, keepAsk);
}

/**
 * A relayed update from his staff that Flyd keeps rather than shows him:
 * progress, findings, checks, internal calls, acknowledgements. One that
 * hands him something to act on (rules to paste, steps to carry out) is
 * never kept back.
 */
function absorbed(message: ConversationMessage, handled?: Handled): boolean {
  return message.role === "assistant" && message.aside === true && staffLine(message.text, handled).kind === "absorbed" && !isActionable(message.text);
}

/** Of a reply's questions, the ones Flyd already answered for him. */
type Handled = (text: string) => boolean;

/**
 * The replies whose steps the column's Artefacts keeps, by message id: the
 * newest few the rule calls clear steps or Flyd's judge has called steps or
 * options. The window points only these there.
 */
function railReplies(messages: ConversationMessage[], judge?: ArtefactJudge): Map<string, ReplyArtefact> {
  const kept = new Map<string, ReplyArtefact>();
  for (const message of [...messages].reverse()) {
    if (kept.size >= MAX_REPLY_ARTEFACTS) break;
    if (message.role !== "assistant" || kept.has(message.id)) continue;
    if (message.artefact) {
      kept.set(message.id, replyArtefact(message.artefact)?.artefact ?? { title: "Full breakdown", steps: artefactLines(message.artefact) });
      continue;
    }
    const call = replyArtefact(message.text);
    if (!call) continue;
    const kind = call.clear ? "steps" : judge?.cached(message.text);
    if (kind === "steps" || kind === "options") kept.set(message.id, replyArtefact(message.text, kind)!.artefact);
  }
  return kept;
}

/** An answer's top-level list items and table body rows, without their markers, the table's header or its divider. */
function artefactLines(body: string): string[] {
  const out: string[] = [];
  let fenced = false;
  let header = true;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) fenced = !fenced;
    if (fenced || /^```/.test(trimmed)) continue;
    if (/^\|.*\|$/.test(trimmed)) {
      if (/^\|?[\s:|-]+\|?$/.test(trimmed)) continue;
      if (!header) out.push(trimmed.slice(1, -1).split("|").map((cell) => cell.trim()).filter(Boolean).join(" · "));
      header = false;
      continue;
    }
    header = true;
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item?.[1]?.trim()) out.push(item[1].trim());
  }
  return out;
}

/**
 * The column's cards for those replies: steps as a numbered list, options as
 * a choice whose tap answers the reply with that option, until he has
 * answered it. A reply that closes on its own question is answered in the
 * card under it in the window; its options here are only listed.
 */
export function replyCards(messages: ConversationMessage[], judge?: ArtefactJudge): RailArtefact[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return [...railReplies(messages, judge)].map(([id, artifact]) => {
    if (!artifact.options) return { id: `reply:${id}`, title: artifact.title, steps: artifact.steps };
    const message = byId.get(id)!;
    const choice: ReplyChoice = { question: artifact.title, options: artifact.steps.map(labelOf) };
    const open = message.answers !== undefined && !choiceOf(message.text) && !answered(messages, message, choice);
    return { id: `reply:${id}`, title: artifact.title, choice: { ...choice, ...(open ? { replyTo: choiceTarget(message) } : {}) } };
  });
}

/** For each reply, the questions Flyd answered for him, by the notes that answered them. */
function handledIn(messages: ConversationMessage[]): (message: ConversationMessage) => Handled | undefined {
  const answered = answeredForHim(messages);
  return (message) => (message.role === "assistant" ? handledBy(answered.get(choiceTarget(message))) : undefined);
}

/** Turns successive snapshots into minimal updates, rendering only what changed. */
/** Held relays already recorded in this process, so a reload or a reconnect does not record one twice. */
const heldRelays = new Set<string>();

export class SnapshotDiffer {
  private readonly sent = new Map<string, string>();
  private semantic: SemanticObject[] = [];

  constructor(private readonly summaries?: SummaryOptions, private readonly show?: ShowOptions) {}

  /** Flyd's own reading of a message, when it has made one: its interpretation of an answer, else its summary. */
  private reading(message: ConversationMessage): string | undefined {
    if (message.answers?.startsWith("note:")) return this.summaries?.interpreter?.cached(message.text);
    const model = this.summaries?.summarizer?.cached(message.text);
    return model && !isRoutineAnswer(model) ? inFlydsVoice(model) : undefined;
  }

  /**
   * Whether a relay from the staff fails the outgoing-answer checks a chat reply
   * passes (backstage machinery, a phrase he ruled out, a placeholder), so it may
   * not reach him as written. Each one held is recorded once for a reviewer.
   */
  private heldRelay(text: string): boolean {
    const said = inFlydsVoice(text);
    const held = relayShortfalls(said);
    if (!held.length) return false;
    if (!heldRelays.has(said)) {
      heldRelays.add(said);
      recordHeld({ surface: "relay", source: "relay:staff", text: said }, held);
    }
    return true;
  }

  /** Asks Flyd's judge about a reply in the background; the stream re-renders when it answers. */
  private judge(judge: ArtefactJudge, text: string): void {
    void judge.request(text).then(() => this.summaries?.onSummary?.());
  }

  /** Asks Jev for the canonical semantic kind in the background; visual rendering does not wait on it. */
  private judgeSemantic(judge: SemanticJudge, item: import("./show.js").ShowItem): void {
    void judge.request(item).then(() => this.summaries?.onSummary?.());
  }

  /** Starts a model summary in the background; the stream re-renders when it lands. */
  private ask(text: string): void {
    const summaries = this.summaries!;
    void summaries.summarizer!.request(text).then(() => summaries.onSummary?.());
  }

  /**
   * Asks Flyd's interpreter for its own reading of a note firstmate answered,
   * once, in the background; the stream re-renders when it lands. Its reading
   * is Flyd's on every reply, an artefact as much as a paragraph.
   */
  private readAnswer(message: ConversationMessage, snapshot: ConversationSnapshot, newest: boolean): void {
    const interpreter = this.summaries?.interpreter;
    if (!interpreter || !newest || !interpreter.wants(message.text)) return;
    const at = snapshot.messages.findIndex((candidate) => candidate.id === message.answers);
    const before = at >= 0 ? at : snapshot.messages.indexOf(message);
    const summaries = this.summaries!;
    void interpreter
      .request({ question: snapshot.messages[at]?.text ?? "", answer: message.text, recent: snapshot.messages.slice(0, Math.max(0, before)) })
      .then(() => summaries.onSummary?.());
  }

  /**
   * Firstmate's answer to his note, as Flyd tells it: Flyd's interpretation
   * leads, firstmate's own words wait behind "more". Until it lands the lead
   * is the answer's local digest; with none coming, Flyd's whole briefing of it.
   */
  private interpret(message: ConversationMessage, snapshot: ConversationSnapshot, newest: boolean): (Pick<RenderedMessage, "summary"> & { body: string }) | null {
    const interpreter = this.summaries?.interpreter;
    const cached = interpreter?.cached(message.text);
    const shown = stripCommitIds(message.text);
    if (cached) return { body: message.text, summary: glance(inFlydsVoice(cached), "flyd") };
    this.readAnswer(message, snapshot, newest);
    // With no reading of Flyd's to lead, staff words that fail the checks are not shown at all: Flyd handles them.
    if (this.heldRelay(message.text)) return null;
    const pending = interpreter?.pending(message.text) ?? false;
    return { body: message.text, summary: pending ? glance(shown, "digest", true) : briefOf(shown) };
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
        summary: glance(author.summary, "author"),
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
    // The model found no outcome, decision or ask: one muted line.
    if (model.text && isRoutineAnswer(model.text) && !actionable) return { body: message.text, routine: true, summary: { html: renderMarkdown(digestReply(message.text).lead), source: "model" } };
    const summary: NonNullable<RenderedMessage["summary"]> = model.text && !isRoutineAnswer(model.text)
      ? glance(model.text, "model")
      : model.pending ? glance(message.text, "digest", true) : briefOf(message.text);
    return { body: message.text, summary, ...(actionable ? { expanded: true } : {}) };
  }

  /** An answer to him, or a relayed update that answers him, as one compact card: Flyd's reading when it has one. */
  private answerCard(message: ConversationMessage): RenderedMessage["card"] {
    const reading = message.answers?.startsWith("note:") ? this.summaries?.interpreter?.cached(message.text) : undefined;
    const said = replyCard(inFlydsVoice(reading ?? message.text));
    if (!said) return undefined;
    const kinds: Record<OutcomeState, NonNullable<RenderedMessage["card"]>["kind"]> = { landed: "landed", needs: "decision", stuck: "blocker", underway: "underway", note: "note", handled: "note" };
    const url = message.text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/)?.[0];
    return { kind: kinds[said.state], line: said.line, ...(said.sub ? { sub: said.sub } : {}), ...(url && said.state === "landed" ? { url } : {}) };
  }

  /** A reply Flyd's model judged routine (nothing asked, nothing to act on), or one plainly routine. */
  private routine(message: ConversationMessage, handled?: Handled): boolean {
    if (isRoutine(message.text) || absorbed(message, handled)) return true;
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
    // The questions Flyd answered for him: each reply shows them handled, not waiting on him.
    const handledOf = handledIn(snapshot.messages);
    // Answers Flyd gave for him that he took back since.
    const undone = new Set<string>();
    const takenBack = new Set<string>();
    for (const message of [...snapshot.messages].reverse()) {
      if (!message.replyTo) continue;
      const asked = `${message.replyTo}\n${message.replyQuote ?? ""}`;
      if (message.undoes) takenBack.add(asked);
      else if (message.answeredFor && takenBack.has(asked)) undone.add(message.id);
    }
    const judge = this.summaries?.artefacts;
    const kept = railReplies(snapshot.messages, judge);
    // The same line relayed again ("still waiting on you: may I delete…" asked twice) is shown once, where it was said last.
    const repeated = new Set<string>();
    const lines = new Set<string>();
    for (const message of [...snapshot.messages].reverse()) {
      if (message.role !== "assistant" || !message.aside) continue;
      const said = staffLine(message.text, handledOf(message));
      if (said.kind === "absorbed") continue;
      const key = `${said.kind} ${said.kind === "landed" ? said.url ?? "" : ""} ${said.line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
      if (lines.has(key)) repeated.add(message.id);
      lines.add(key);
    }
    // Where he last said anything: a question before it is answered or moved past.
    const lastSaid = snapshot.messages.map((message) => message.role).lastIndexOf("user");
    let previous: ConversationMessage | undefined;
    for (const [index, message] of snapshot.messages.entries()) {
      if (repeated.has(message.id)) continue;
      // Artefact or text is Flyd's call on every reply: the rule decides clear ones, its judge the rest.
      const call = message.role === "assistant" ? replyArtefact(message.text) : undefined;
      // Asked once: a re-render while the verdict is out must not ask again, or each answer re-renders and asks forever.
      if (call && !call.clear && judge && newest.has(message.id) && judge.cached(message.text) === undefined && !judge.pending(message.text)) this.judge(judge, message.text);
      const artifact = kept.get(message.id);
      // No summary is asked for a reply that may yet be an artefact.
      const fresh = newest.has(message.id) && !(call && judge?.pending(message.text));
      // An artefact that answers his note still gets Flyd's reading, which the column speaks in its place of firstmate's words.
      if (artifact && message.answers?.startsWith("note:")) this.readAnswer(message, snapshot, fresh);
      // His staff's chatter is Flyd's to keep; only what landed, his own decisions and real blockers reach him.
      // A reply to words he typed into the session himself answers him, and is never kept back.
      const toHim = previous?.role === "user" && !/^(?:note|ask):/.test(previous.id);
      previous = message;
      const handled = handledOf(message);
      if (!toHim && absorbed(message, handled)) continue;
      // Landed, his call or stuck: a compact card, whether or not it answers something he typed.
      const relay = message.role === "assistant" && message.aside ? staffLine(message.text, handled) : undefined;
      // An answer to his own question is never muted as routine: firstmate's is told by Flyd, Flyd's own
      // shows whole when it fits a glance and else leads with its first few lines.
      const parts: (Pick<RenderedMessage, "summary" | "compare" | "routine" | "expanded"> & { body: string }) | null = message.form ? { body: message.text } : message.role !== "assistant" ? { body: message.text }
        : artifact ? { body: authorSummary(message.text)?.rest ?? message.text, summary: { html: renderMarkdown(`**${artifact.title}**: ${artifact.steps.length} ${artifact.options ? "options" : "steps"}, kept in Artefacts.`), source: "flyd" } }
          : relay && relay.kind !== "absorbed" ? { body: message.text, summary: { html: renderMarkdown(georgeMarkdown(relay)), source: "flyd" } }
            : !message.answers ? this.summarize(message, fresh)
              : message.answers.startsWith("note:") ? this.interpret(message, snapshot, fresh)
                : fitsAtAGlance(message.text) ? { body: message.text }
                  : { body: message.text, summary: glance(message.text, "flyd"), ...(isActionable(message.text) ? { expanded: true } : {}) };
      if (!parts) continue;
      // A question the staff put to him mid-reply is answerable where it stands too, until he has spoken since.
      const choice = open?.message === message ? { ...open.choice, replyTo: choiceTarget(message) }
        : relay?.kind === "decision" && !open && index > lastSaid ? { question: inFlydsVoice(relay.line), options: relay.options, replyTo: choiceTarget(message) } : undefined;
      // The card under the reply asks its question; Flyd's briefing does not say it again.
      if (choice && parts.summary?.source === "brief") parts.summary = briefOf(stripCommitIds(withoutClosingAsk(message.text)), false);
      if (parts.summary?.source === "brief" && parts.summary.html === renderMarkdown(parts.body)) delete parts.summary;
      const routine = parts.routine === true;
      // Relayed updates are only worth his attention when they carry an outcome, decision or ask.
      if (message.aside && routine) continue;
      order.push(message.id);
      seen.add(message.id);
      // Only Flyd's own copies are shown; a relayed update's transcript ids are not.
      const shots = (message.shots ?? []).filter((shot) => shot.startsWith("/")).map(railImageSrc);
      const card: RenderedMessage["card"] = relay && relay.kind !== "absorbed"
        ? { kind: relay.kind, line: inFlydsVoice(relay.line).replace(/[:;,]$/, ""), ...(relay.kind === "landed" && relay.url ? { url: relay.url } : {}) }
        : message.role === "assistant" && !message.form && !routine && !message.answers?.startsWith("ask:") && (message.aside || message.answers) ? this.answerCard(message) : undefined;
      // The card is his glance: the reply as written waits behind it, never shown twice.
      if (card && !parts.summary) parts.summary = briefOf(message.text);
      // What he has to act on stays open under the card, never folded behind "as written".
      const expanded = parts.expanded === true || (card !== undefined && !artifact && isActionable(message.text));
      // Several pieces of work read as a card each, not as paragraphs; Flyd's own answers stay as written.
      const outcomes = message.role === "assistant" && !message.form && !routine && !message.answers?.startsWith("ask:") ? outcomesOf(message.text, handled) ?? undefined : undefined;
      const key = JSON.stringify([message.text, message.images ?? [], message.files ?? [], shots, message.page, parts.summary, parts.compare, artifact, routine, expanded, card, outcomes, message.waiting, message.waitingFailed, message.settled, message.doing, message.answers, message.aside, message.replyTo, message.receipt, choice, message.answeredFor, message.form, undone.has(message.id)]);
      if (this.sent.get(message.id) === key) continue;
      this.sent.set(message.id, key);
      changed.push({
        id: message.id,
        role: message.role,
        // His first read is Flyd's briefing; firstmate's own words, links and all, wait behind "more".
        html: message.form ? answerHtml(message.form) : message.role === "user" ? renderCaptainMarkdown(parts.body) : parts.summary ? renderMarkdown(parts.body) : renderBriefing(parts.body, {}, handled),
        ...(message.images?.length ? { images: message.images } : {}),
        ...(message.files?.length ? { files: message.files } : {}),
        ...(shots.length ? { shots } : {}),
        ...(message.page ? { page: message.page } : {}),
        ...(parts.summary ? { summary: parts.summary } : {}),
        ...(parts.compare ? { compare: parts.compare } : {}),
        ...(routine ? { routine: true } : {}),
        ...(expanded ? { expanded: true } : {}),
        ...(artifact ? { artifact } : {}),
        ...(card ? { card } : {}),
        ...(outcomes ? { outcomes } : {}),
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
    // WhatsApp unlinked: the one action card, last in the timeline, until he links it.
    if (this.show?.whatsappUnlinked?.()) {
      order.push(WHATSAPP_LINK.id);
      seen.add(WHATSAPP_LINK.id);
      if (this.sent.get(WHATSAPP_LINK.id) !== "1") {
        this.sent.set(WHATSAPP_LINK.id, "1");
        changed.push({ id: WHATSAPP_LINK.id, role: "assistant", html: "", card: { kind: "decision", line: WHATSAPP_LINK.title, sub: WHATSAPP_LINK.line, url: WHATSAPP_LINK.url } });
      }
    }
    for (const id of [...this.sent.keys()]) if (!seen.has(id)) this.sent.delete(id);
    const artefact = this.show?.artefact?.();
    // Without a reading of the fleet, nothing on the screen may claim that all is quiet (show.ts).
    const known = !artefact || Boolean(artefact.fleet && !artefact.fleet.unavailable);
    const show = showOf(snapshot, {
        ...(this.show?.assistant ? { assistant: this.show.assistant } : {}),
        projects: this.show?.projects?.() ?? [],
        ...(artefact ? { artefact } : {}),
        reading: (message) => this.reading(message),
        muted: (message) => this.routine(message, handledOf(message)),
      });
    // Flyd's judgment on what is his: an item it is sure he would not want leaves the screen.
    const importance = this.summaries?.importance;
    if (importance) {
      const his = snapshot.messages.filter((message) => message.role === "user").slice(-6).map((message) => message.text);
      for (const item of show.items) {
        if (item.kind === "clear" || importance.asked(item) || importance.pending(item)) continue;
        // Redraw only when the answer takes something off his screen; a yes or an unsure changes nothing.
        void importance.request(item, his).then((changed) => { if (changed) this.summaries?.onSummary?.(); });
      }
      const kept = show.items.filter((item) => importance.matters(item) !== false);
      let trimmed = kept.length !== show.items.length;
      if (trimmed) {
        show.items = kept.length || !known ? kept : [{ id: "clear", kind: "clear", headline: "Nothing needs you right now.", why: "I'll flag it when something does" }];
      }
      // A call Flyd is sure is not his leaves the sheet too, and "N need you" counts only what the sheet can open.
      if (show.calls) {
        const calls = show.calls.filter((call) => importance.matters(call) !== false);
        if (calls.length !== show.calls.length) {
          trimmed = true;
          show.counts = { ...show.counts, call: calls.length };
          if (calls.length) show.calls = calls;
          else delete show.calls;
        }
      }
      // The opening line and the tally speak for what is left on the screen, not what the judge took off it.
      if (trimmed) {
        show.title = titleOf(show.items, false, known);
        show.summary = situationOf(show.counts, known);
      }
    }
    const semanticJudge = this.summaries?.semantic;
    if (semanticJudge) {
      for (const item of show.items) if (!item.task && item.kind !== "call" && !item.decision && !semanticJudge.cached(item) && !semanticJudge.pending(item)) this.judgeSemantic(semanticJudge, item);
      show.semantic = semanticObjectsFromShow(show.items, (item) => semanticJudge.cached(item)?.kind);
    }
    const live = this.show?.live ?? (() => "up");
    // Semantic evidence carries whether a local/live link has already closed,
    // so the native manifestation never resurrects a dead decision link.
    if (show.calls) show.calls = show.calls.map((call) => (call.links ? { ...call, links: closedLinks(call.links, live) } : call));
    const visibleSemantic = show.semantic ?? semanticObjectsFromShow(show.items);
    show.activities = activityObjectsFromShow(show);
    show.decisions = decisionObjectsFromShow(show);
    show.artifacts = artifactObjectsFromShow(show);
    const left = this.show?.leftColumn?.();
    show.monitors = left?.monitors ?? [];
    const semantic = composeSemanticSnapshot({
      visible: visibleSemantic,
      activities: show.activities,
      decisions: show.decisions,
      artifacts: show.artifacts,
      monitors: show.monitors,
    });
    show.events = semanticEvents(this.semantic, semantic);
    show.semantic = semantic;
    show.focus = semanticFocus(semantic);
    this.semantic = semantic;
    const found = currentPage(snapshot.messages);
    // A page on this machine that stopped answering is not where the work is: the header never offers a dead link.
    const page = found?.local && live(found.url) === "down" ? undefined : found;
    return {
      order,
      messages: changed,
      working: snapshot.working,
      ...(snapshot.project ? { project: snapshot.project } : {}),
      ...(snapshot.working && snapshot.activity ? { activity: snapshot.activity } : {}),
      ...(snapshot.lastActivity ? { lastActivity: snapshot.lastActivity } : {}),
      ...(snapshot.context ? { context: snapshot.context } : {}),
      // The calls sheet says a closed review page in words too.
      show,
      boxes: withClosedLinks(boxesOf(show, this.show?.readings?.() ?? {}), live),
      ...(this.show?.rail ? { rail: this.show.rail(snapshot) } : {}),
      ...(left ? { leftColumn: { ...left, semantic: show.activities } } : {}),
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
  /** What Core's staff watch found stuck (command/fleet-monitor.ts); nothing under tests unless one sets it. */
  staffView: () => StaffView | null = process.env.VITEST ? () => null : () => readStaffView();
  private readonly chased = new Set<string>();
  /** Notices that would have been macOS notifications: the island rings for those that need him, the column keeps the rest. */
  readonly notices = new NoticeBoard();

  constructor(
    private readonly source: ConversationSource,
    private readonly summaries?: { summarizer?: ReplySummarizer; interpreter?: AnswerInterpreter; artefacts?: ArtefactJudge; semantic?: SemanticJudge; importance?: ImportanceJudge; always?: boolean },
    private readonly plan?: PlanUsageReader,
    private readonly show?: Pick<ShowOptions, "projects">,
    private readonly feed: ArtefactFeed = new ArtefactFeed(),
    private readonly weather?: WeatherReader,
    private readonly predictions = new ComposerPredictions(),
    private readonly drafts = new ComposerDrafts(),
    private readonly previews = new PreviewProbe(),
    /** Flyd's memory stores, read for the column; without it the column shows no memory. */
    private readonly memory?: MemoryReader,
    private readonly routines = new RoutineArtefacts(),
    /** Flyd's own activity records, read for the left column; without it the column is not offered. */
    private readonly activity?: ActivityReader,
    /** WhatsApp, when it still needs linking: the code is drawn here, and the offers are shown here. */
    private readonly whatsapp?: WhatsAppPairing,
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
    if (req.method === "POST" && url.pathname === "/api/whatsapp-pair") {
      const origin = req.headers.origin;
      if ((origin !== undefined && !isLoopbackHost(origin.replace(/^http:\/\//, ""), this.port)) || !sameToken(req.headers["x-flyd-view-token"], this.token)) { sendJson(res, 403, { error: "forbidden" }); return; }
      if (!this.whatsapp) { sendJson(res, 200, { result: { paired: false } }); return; }
      this.whatsapp.start();
      const { paired } = this.whatsapp.state();
      sendJson(res, 200, { result: { paired } });
      return;
    }
    if (url.pathname === "/api/whatsapp-qr") {
      if (!sameToken(url.searchParams.get("token") ?? undefined, this.token)) { sendJson(res, 403, { error: "missing or wrong token" }); return; }
      const { qrSvg, PAIRING_PLACEHOLDER_SVG } = await import("../connectors/whatsapp-pairing.js");
      const code = this.whatsapp?.state().code;
      res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'", "x-content-type-options": "nosniff" });
      res.end(code ? qrSvg(code) : PAIRING_PLACEHOLDER_SVG);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/notice") {
      await this.notice(req, res);
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
    if (req.method === "POST" && url.pathname === "/api/scout-feedback") {
      await this.scoutFeedback(req, res);
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
        ...(this.source.newSession ? { newSession: `window:${randomBytes(16).toString("hex")}` } : {}),
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
      // Where one note he sent from an artefact stands: "sent", then "read"; and
      // the reply about it, formal or said in firstmate's own chat, so it can land
      // in the card's own thread. A note firstmate has taken but not answered is
      // never reported finished with: it can still gain a reply, so the card keeps
      // asking until one arrives or the note goes from the inbox for good.
      if (!sameToken(url.searchParams.get("token") ?? undefined, this.token)) { sendJson(res, 403, { error: "missing or wrong token" }); return; }
      const id = url.searchParams.get("id") ?? "";
      const note = (this.source.exchanges?.() ?? []).find((exchange) => exchange.question.id === id);
      const chat = note && !note.answer && this.source.noteAnswer ? await this.source.noteAnswer(id).catch(() => undefined) : undefined;
      const answer = note?.answer ?? chat;
      sendJson(res, 200, {
        receipt: note ? (answer || note.handoff === "taken" || note.question.receipt === "read" ? "read" : "sent") : null,
        ...(answer ? { answer: { text: answer.text, ...(answer.timestamp ? { timestamp: answer.timestamp } : {}) } } : {}),
      });
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

  /**
   * A notice from a local tool (Claude Code's Notification hook, say). No token:
   * the sender is a script, not this page. A browser always names its origin on
   * a cross-site POST and cannot send JSON without one, so a request with an
   * origin, or without a JSON body, is refused; the Host check covers rebinding.
   */
  private async notice(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.origin !== undefined) { sendJson(res, 403, { error: "forbidden" }); return; }
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) { sendJson(res, 415, { error: "expected application/json" }); return; }
    let input: NoticeInput;
    try {
      const parsed: unknown = JSON.parse(await readBody(req, 16 * 1024));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      input = parsed as NoticeInput;
    } catch {
      sendJson(res, 400, { error: "expected a JSON object" });
      return;
    }
    const evidence = noticeOf(input);
    if (!evidence) { sendJson(res, 400, { error: "a notice needs a message" }); return; }
    const decisionWork = this.feed.decide([{
      sourceId: "staff.notice",
      eventId: `${evidence.source}:${evidence.session ?? evidence.project ?? ""}:${evidence.message}`,
      kind: "reply", state: "reported", label: evidence.title, detail: evidence.message,
      evidenceRefs: [`notice:${evidence.source}:${evidence.session ?? "unscoped"}`],
    }]);
    if (decisionWork) {
      const decision = (await decisionWork.catch(() => []))[0];
      if (!decision?.show) { sendJson(res, 200, { backstage: true }); return; }
      const message = decision.question
        ? `${decision.question} ${(decision.options ?? []).join(" / ")}${decision.recommendation ? ` ${recommendationText(decision.recommendation)}` : ""}`
        : decision.summary;
      input = { source: "Flyd", message, session: decision.decisionId, kind: decision.notify ? "attention" : "idle" };
      if (this.notices.list().some((notice) => notice.session === decision.decisionId)) {
        sendJson(res, 200, { id: decision.decisionId, duplicate: true }); return;
      }
    }
    const held = this.notices.add(input);
    if (!held) { sendJson(res, 400, { error: "a notice needs a message" }); return; }
    sendJson(res, 200, { id: held.id, kind: held.kind, count: held.count });
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

  /** Whether WhatsApp still needs linking. The offers are shown only while it does. */
  private whatsappUnlinked(): boolean {
    return Boolean(this.whatsapp && !this.whatsapp.state().paired);
  }

  /** The artefact inputs with the unlinked-WhatsApp offer folded in, when it applies. */
  private artefactInputs(): ArtefactInputs {
    const inputs = this.feed.current();
    return this.whatsappUnlinked() ? { ...inputs, whatsappLink: true } : inputs;
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
    // The same replies the window points here, each once, newest first.
    const reported = replyCards(snapshot.messages, this.summaries?.artefacts);
    const artefacts: RailArtefact[] = [...sites, ...reported, ...composeArtefact(this.artefactInputs(), { project })
      .filter((item) => !item.id.startsWith("call:"))
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
    const recorded = (this.source.exchanges?.() ?? []).filter((exchange) => !exchange.question.flydAsked);
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
      kept: new Set(reported.map((card) => card.id)),
      live: (url) => this.previews.state(url),
      phone: phoneWork(snapshot.messages),
      known: (preview) => board.get(preview.url) ?? preview,
      // Which server answers on the page's port: the process, its folder, and whether that is the project's own.
      server: (url) => {
        const served = this.previews.servedBy(url);
        return served ? railServer(url, served, projects, homedir()) : undefined;
      },
      // An answer to a note is told as Flyd tells it in the window; until Flyd has read it, its words without the machine header.
      // Either way it leads with what changed, never a salutation or a bare "done", in a few lines: the whole answer is in the window.
      voice: (answer) => {
        const reading = answer.answers?.startsWith("note:") ? interpreter?.cached(answer.text) : undefined;
        return renderBriefing(condense(outcomeFirst(reading ? inFlydsVoice(reading) : spoken(answer.text), spoken(answer.text))), RAIL_CARD_TITLES);
      },
    });
    const notices: RailNotice[] = this.notices.list().map((notice) => ({
      id: notice.id,
      kind: notice.kind,
      text: noticeLine(notice),
      at: notice.last,
      ...(notice.count > 1 ? { count: notice.count } : {}),
    }));
    return {
      ...rail,
      ...(this.memory ? { memory: composeMemory(this.memory.current(), snapshot.messages, projects) } : {}),
      ...(notices.length ? { notices } : {}),
    };
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
  /** "More like this" or "less like this" on a story in today's news: the same verdict `flyd scout more|less` records. */
  private async scoutFeedback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    if ((origin !== undefined && !isLoopbackHost(origin.replace(/^http:\/\//, ""), this.port)) || !sameToken(req.headers["x-flyd-view-token"], this.token)) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }
    let payload: { n?: unknown; url?: unknown; verdict?: unknown };
    try {
      payload = JSON.parse(await readBody(req, 4 * 1024)) as typeof payload;
    } catch {
      sendJson(res, 400, { error: "invalid body" });
      return;
    }
    const { n, url, verdict } = payload;
    if (typeof n !== "number" || !Number.isInteger(n) || typeof url !== "string" || (verdict !== "more" && verdict !== "less")) {
      sendJson(res, 400, { error: "expected { n, url, verdict: more|less }" });
      return;
    }
    const scout = await import("../council/scout.js");
    // The story must still be that number in the latest edition: a newer edition renumbers its stories.
    if (scout.latestEdition()?.items.find((item) => item.n === n)?.url !== url) {
      sendJson(res, 404, { error: "not in the latest edition" });
      return;
    }
    sendJson(res, 200, { ok: Boolean(scout.recordScoutFeedback(n, verdict)), verdict });
  }

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
    let payload: { session?: unknown; text?: unknown; images?: unknown; files?: unknown; decision?: unknown; replyTo?: unknown; questionText?: unknown; undo?: unknown; comment?: unknown; about?: unknown; passage?: unknown };
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
      const call = this.feed.current().fleet?.calls.find((row) => row.executiveDecisionId ? row.executiveDecisionId === payload.decision : row.task === payload.decision);
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
        const executive = Boolean(call.executiveDecisionId);
        const answer = executive ? payload.text.trim() : `Answer to pending decision ${call.task}: ${call.label}\nQuestion: ${call.detail ?? call.label}\n\n${payload.text.trim()}`;
        const sent = await this.source.sendDecision(executive ? answer : withCommandMarker(answer, await this.commandIn(payload.text)), images as ImageUpload[], executive ? {
          decisionId: call.executiveDecisionId!,
          taskId: call.task ?? "",
        } : undefined, typeof payload.session === "string" ? payload.session : undefined);
        if (executive) await this.feed.refresh();
        sendJson(res, 200, { ...sent, waiting: executive ? "Flyd is carrying your decision into the work" : "Sent to firstmate" });
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
      await this.sendAbout(res, payload.about, payload.text, images as ImageUpload[], typeof payload.session === "string" ? payload.session : undefined);
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
      await this.reply(res, payload.session, payload.replyTo, payload.text, payload.questionText);
      return;
    }
    try {
      const expanded = await expandScrawl({ text: payload.text, images: images as ImageUpload[] });
      const sent = await this.source.send(payload.session, expanded.text, expanded.images, files as FileUpload[]);
      if (expanded.bundle) {
        await fileScrawl(expanded.bundle).catch((error: unknown) =>
          console.warn(`[view] Flyd could not file the Scrawl capture: ${error instanceof Error ? error.message : String(error)}`));
      }
      this.predictionContexts.delete(payload.session);
      this.predictions.remember(payload.text);
      let routineSuggestion = false;
      if (!sent.warning && (expanded.images ?? []).length === 0 && (files as FileUpload[]).length === 0) {
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
      sendJson(res, 200, await this.source.send(session, withCommandMarker(note, await this.commandIn(text)), [], [], "firstmate"));
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
  private async sendAbout(res: ServerResponse, about: unknown, text: unknown, images: ImageUpload[] = [], session?: string): Promise<void> {
    const card = typeof about === "object" && about !== null ? about as { title?: unknown; task?: unknown; url?: unknown; line?: unknown; detail?: unknown } : {};
    const field = (value: unknown) => (typeof value === "string" && value.trim() && value.length <= 2000 ? value.trim() : undefined);
    const content = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 2000) : undefined);
    const title = field(card.title);
    if (!title || (card.task !== undefined && !field(card.task)) || (card.url !== undefined && !field(card.url))
      || (card.line !== undefined && typeof card.line !== "string") || (card.detail !== undefined && typeof card.detail !== "string")) {
      sendJson(res, 400, { error: "expected { about: { title, task?, url?, line?, detail? }, text }" });
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
    const line = content(card.line);
    const detail = content(card.detail);
    const named = [`About the artefact "${title.replace(/\s+/g, " ")}"`, ...(task ? [`Task: ${task}`] : []), ...(url ? [`Page: ${url}`] : []), ...(line ? [`Line: ${line}`] : []), ...(detail ? [`Detail: ${detail}`] : [])].join("\n");
    try {
      const words = text.trim();
      const note = words ? withCommandMarker(`${named}\n\n${words}`, await this.commandIn(words)) : named;
      sendJson(res, 200, { ...await this.source.sendDecision(note, images, undefined, session), waiting: "Sent to firstmate" });
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async commandIn(words: string): Promise<string | undefined> {
    return matchCommand(words, await this.source.commands())?.name;
  }

  /** His reply to one answer: back to whoever gave it, saying what it answers. */
  private async reply(res: ServerResponse, session: string, replyTo: unknown, text: string, questionText?: unknown): Promise<void> {
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
      const question = (asked && choiceOf(asked.text)?.question) || (typeof questionText === "string" && questionText.trim() ? questionText.trim() : undefined);
      if (!parent && !question) {
        sendJson(res, 409, { error: "That answer is no longer here; send it as a new message" });
        return;
      }
      const command = await this.commandIn(text);
      const note = withCommandMarker(parent ? replyNote(parent, text) : answerNote(asked ?? { id: replyTo, role: "assistant", text: "" }, question!, text), command);
      const sent = await this.source.send(session, note, [], [], replyTo.startsWith("ask:") && !command ? "flyd" : "firstmate");
      this.predictions.remember(text);
      sendJson(res, 200, sent);
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** He takes back an answer Flyd gave for him: the session is told to hold off until he answers. */
  private async undo(res: ServerResponse, session: unknown, noteId: unknown): Promise<void> {
    const note = typeof noteId === "string" ? this.source.exchanges?.().find((exchange) => exchange.question.id === noteId)?.question : undefined;
    if (typeof session !== "string" || !note?.answeredFor || !note.replyTo || !this.source.canSend) {
      sendJson(res, 409, { error: "That answer is no longer here" });
      return;
    }
    try {
      sendJson(res, 200, await this.source.send(session, undoNote(note.replyTo, note.replyQuote ?? "", note.text), [], [], "firstmate"));
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private chaseArtefact(session: string, snapshot: ConversationSnapshot): void {
    if (!this.source.canSend) return;
    const exchanges = withFollowUps(this.source.exchanges?.() ?? [], snapshot.followUps ?? {}, snapshot.working);
    const chased = new Set(exchanges.filter((exchange) => exchange.question.flydAsked && exchange.question.replyTo).map((exchange) => exchange.question.replyTo!));
    const now = Date.now();
    for (const exchange of exchanges) {
      const id = exchange.question.id;
      if (!id.startsWith("note:") || exchange.question.flydAsked || this.chased.has(id) || chased.has(id)) continue;
      const askedAt = Date.parse(exchange.question.timestamp ?? "");
      if (!Number.isFinite(askedAt) || now - askedAt > ARTEFACT_CHASE_MAX_AGE_MS) continue;
      if (!exchange.answer || !askedForArtefact(exchange.question.text) || replyArtefact(exchange.answer.text)) continue;
      this.chased.add(id);
      void this.source.send(session, artefactAsk(exchange), [], [], "firstmate")
        .catch((error: unknown) => {
          this.chased.delete(id);
          console.warn(`[view] Flyd could not ask for the artefact: ${error instanceof Error ? error.message : String(error)}`);
        });
      // One ask per pass: a backlog of missed artefacts is chased over later passes, never in a burst.
      break;
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
      const current = islandStatusOf(statusOf(latest), this.feed.current().fleet);
      const ringing = this.notices.ringing();
      const status = JSON.stringify({ session: session.id, ...current, ...(ringing ? { notice: { id: ringing.id, text: noticeLine(ringing) } } : {}) });
      if (status === sent) return;
      sent = status;
      // What the island and the line under his message say, kept for Flyd's self-review.
      if (current.reply) noteSaid({ surface: "status", text: current.reply.headline });
      res.write(`event: status\ndata: ${status}\n\n`);
    };
    const follower = this.source.follow(session.id, (snapshot) => {
      latest = snapshot;
      emit();
    });
    const stopNotices = this.notices.onChange(emit);
    const stopFeed = this.feed.onRefresh(emit);
    const tick = setInterval(() => {
      emit();
      res.write(": keep-alive\n\n");
    }, 30_000);
    tick.unref?.();
    // Another session became the live one (a new firstmate session took the lock): end this stream, and the
    // island reconnects to that one.
    const moved = setInterval(() => {
      void this.source.listSessions().then(([newest]) => {
        if (newest && newest.id !== session.id) {
          stop();
          res.end();
        }
      }).catch(() => undefined);
    }, STATUS_SESSION_CHECK_MS);
    moved.unref?.();
    const stop = () => {
      clearInterval(tick);
      clearInterval(moved);
      stopNotices();
      stopFeed();
      follower.close();
    };
    req.on("close", stop);
  }

  private async stream(req: IncomingMessage, res: ServerResponse, requested: string | null): Promise<void> {
    // A session he chose by hand stays; no choice (or "latest") follows whichever holds the lock now.
    const chosen = requested && requested !== "latest" ? requested : null;
    const sessions = await this.source.listSessions();
    const session = chosen ? sessions.find((candidate) => candidate.id === chosen) ?? this.source.newSession?.(chosen) : sessions[0];
    if (!session) {
      sendJson(res, 404, { error: chosen ? `No such session: ${chosen}` : "No sessions found" });
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    sseEvent(res, "session", { ...session, assistantLabel: this.source.assistantLabel, answersInSession: this.source.answersInSession === true });

    let latest: ConversationSnapshot | null = null;
    let closed = false;
    // Coding work Core found stuck after chasing it: said over the composer, only in Flyd's own window.
    let staffSent = "";
    const emitStaff = () => {
      if (closed || !this.source.canSend) return;
      let text = "";
      try {
        // Only what he has been told, and only what the gate lets reach him: staff silence stays Flyd's to chase.
        text = (this.staffView()?.concerns ?? []).filter((concern) => concern.toldAt).flatMap((concern) => {
          const gated = reachesGeorge({ kind: concernKind(concern), text: concern.text }, "notice");
          return gated.reach ? [gated.line] : [];
        }).join(" ");
      } catch {
        text = "";
      }
      if (text === staffSent) return;
      staffSent = text;
      sseEvent(res, "staff", { text });
    };
    const differ = new SnapshotDiffer(this.summaries
      ? {
          ...this.summaries,
          // A summary landed: push whatever it changed.
          onSummary: () => {
            if (!closed && latest) emitUpdate(latest);
          },
        }
      : undefined, {
        assistant: this.source.assistantLabel,
        ...this.show,
        artefact: () => this.artefactInputs(),
        readings: () => ({ plan: this.plan?.current() ?? null, weather: this.weather?.current() ?? null }),
        rail: (snapshot) => this.rail(snapshot),
        ...(this.activity ? { leftColumn: () => this.activity!.current() } : {}),
        live: (url) => this.previews.state(url),
        whatsappUnlinked: () => this.whatsappUnlinked(),
      });
    const emitUpdate = (snapshot: ConversationSnapshot) => {
      const update = differ.next(snapshot);
      sseEvent(res, "update", {
        ...update,
        messages: update.messages.map((message) => message.choice
          ? { ...message, choice: { ...message.choice, session: session.id } }
          : message),
      });
    };
    const follower = this.source.follow(
      session.id,
      (snapshot) => {
        latest = snapshot;
        this.cachePredictionContext(session.id, snapshot.messages);
        this.chaseArtefact(session.id, snapshot);
        emitUpdate(snapshot);
      },
      (error) => sseEvent(res, "problem", { error: error.message }),
    );
    const stopFeed = this.feed.onRefresh(() => {
      if (!closed && latest) emitUpdate(latest);
    });
    // A previewed page came up or went down: the column's card changes.
    const stopPreviews = this.previews.onChange(() => {
      if (!closed && latest) emitUpdate(latest);
    });
    // A memory landed: the column's "Remembering now" shows it.
    const stopMemory = this.memory?.onChange(() => {
      if (!closed && latest) emitUpdate(latest);
    });
    // A notice came: the column shows it.
    const stopNotices = this.notices.onChange(() => {
      if (!closed && latest) sseEvent(res, "update", differ.next(latest));
    });
    // Flyd did or started something: the left column's cards change.
    const stopActivity = this.activity?.onChange(() => {
      if (!closed && latest) emitUpdate(latest);
    });
    // WhatsApp linked (or a new code drawn): the offer goes, or its code turns over.
    const stopPairing = this.whatsapp?.onChange(() => {
      if (!closed && latest) emitUpdate(latest);
    });
    emitStaff();
    const heartbeat = setInterval(() => {
      res.write(": keep-alive\n\n");
      emitStaff();
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    // On the live session (not one he chose): another session taking the lock ends this stream, and the page
    // reconnects to that one. A stream he opened on a chosen session stays on it.
    let moved: ReturnType<typeof setInterval> | null = null;
    if (!chosen) {
      moved = setInterval(() => {
        void this.source.listSessions().then(([newest]) => {
          if (!newest || newest.id === session.id) return;
          if (moved) clearInterval(moved);
          res.end();
        }).catch(() => undefined);
      }, STATUS_SESSION_CHECK_MS);
      moved.unref?.();
    }
    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      if (moved) clearInterval(moved);
      stopFeed();
      stopPreviews();
      stopMemory?.();
      stopActivity?.();
      stopPairing?.();
      stopNotices();
      follower.close();
      this.predictionContexts.delete(session.id);
    });
  }
}

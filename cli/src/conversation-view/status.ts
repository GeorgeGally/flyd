import { plainLinks } from "./line-links.js";
import { answeredForHim, choiceTarget, openChoice } from "./choices.js";
import { asksIn, brief, decisionOf, handledBy, statusHeadline, withoutStubs } from "./executive.js";
import { staffLine } from "./for-george.js";
import { inFlydsVoice } from "./flyd-voice.js";
import { authorSummary, digestReply, isActionable, isRoutine } from "./summaries.js";
import type { FleetArtefact } from "./artefact.js";
import type { ConversationSnapshot } from "./types.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// A glanceable status of the conversation for Flyd's notch island: is the
// assistant working, what is it doing, and what did its newest reply say
// (or ask)? Routine replies (an acknowledgement, a status ping) never
// surface, nor does the staff chatter Flyd keeps (see for-george.ts): the
// island keeps naming the last reply that mattered, a relayed update by its
// one line.

export interface ConversationStatus {
  working: boolean;
  /** What the assistant is doing now, while working. */
  activity?: string;
  lastActivity?: string;
  reply?: { id: string; headline: string; asks: boolean };
  /** His newest message still waiting for its answer, and the line saying what is happening to it. */
  waiting?: { id: string; text: string; failed?: true };
}

/** Working only counts while there was activity recently; a stalled turn is not "working". */
const WORKING_STALE_MS = 10 * 60 * 1000;
const HEADLINE_CHARS = 72;

/** The reply asks the captain something: a question, or a call for his decision. */
export function asksForDecision(text: string): boolean {
  return asksIn(text).length > 0 || brief(text).items.some((item) => item.state === "needs");
}

const PR_LINK = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\b/g;
/** Firstmate's own states for work that went wrong or stopped for him; "isn't blocked" or "no checks failed" is not one. */
const FAILURE_STATE = /(?<!\b(?:not|no|never|nothing|none|without|\w+n['’]t)(?:\s+[\w'’-]+){0,2}\s+)\b(?:failed|blocked|needs-decision)\b/i;

/** The pull requests a message names, by URL. */
export function pullRequestsIn(text: string): string[] {
  return text.match(PR_LINK) ?? [];
}

/**
 * Whether a reply firstmate gave to its own machinery (a supervision wake)
 * is for the captain: it names a pull request not `named` before, asks for
 * his decision, or reports a failure. Anything else (a stale wake that needed
 * nothing, a PR already reported) is supervision chatter. The window and the
 * island both see only what passes this.
 */
export function forCaptain(text: string, named: ReadonlySet<string>): boolean {
  return pullRequestsIn(text).some((url) => !named.has(url)) || asksForDecision(text) || FAILURE_STATE.test(text);
}

/**
 * A few words for the island. A report on several pieces of work reads as
 * where they stand; else the decision it asks of him; else the reply's own
 * » summary, else the labels of its numbered points (so a three-part report
 * names all three), else its lead sentence without the salutation.
 */
export function headlineOf(text: string): string {
  return readingOf(text).headline;
}

/** The island's line for a reply, and whether that line names a decision of his; a question Flyd answered for him (`handled`) is not one. */
function readingOf(text: string, handled?: (text: string) => boolean): { headline: string; asks: boolean } {
  const asks = asksIn(text).filter((sentence) => !handled?.(sentence));
  // A report on several pieces of work reads as where they stand.
  const { items } = brief(text, handled);
  if (items.length >= 2) return statusHeadline(items, asks, HEADLINE_CHARS);
  // A decision of his is named as the decision, never put on a result.
  const decision = decisionOf(asks);
  if (decision) return { headline: fit(decision), asks: true };
  const said = withoutStubs(text);
  const own = authorSummary(said)?.summary;
  const digest = own ? null : digestReply(said);
  // A label that only quotes something (a notice's title) names nothing of his.
  const labels = digest?.points.map((point) => point.label).filter((label): label is string => Boolean(label) && !/^["“']/.test(label!)) ?? [];
  return { headline: fit(own ?? (labels.length >= 2 && labels.length === digest!.points.length ? labels.join(" · ") : digest!.lead)), asks: false };
}

function fit(text: string): string {
  const headline = text.replace(/\s+/g, " ").trim();
  if (headline.length <= HEADLINE_CHARS) return headline;
  const cut = headline.slice(0, HEADLINE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

/** A relayed update's one line for him, or null when Flyd keeps it; a question Flyd answered for him (`handled`) is not his. */
function relayReading(text: string, handled?: (text: string) => boolean): { headline: string; asks: boolean } | null {
  const said = staffLine(text, handled);
  if (said.kind === "absorbed") return isActionable(text) ? readingOf(text, handled) : null;
  return { headline: fit(inFlydsVoice(said.line).replace(/[:;,]$/, "")), asks: said.kind === "decision" };
}

export function statusOf(snapshot: ConversationSnapshot, now = Date.now()): ConversationStatus {
  const recent = snapshot.lastActivity ? now - Date.parse(snapshot.lastActivity) < WORKING_STALE_MS : false;
  let reply: { id: string; headline: string; asks: boolean } | undefined;
  // A question he has spoken since is only his decision while it is still the open one: an answered one is no news.
  const open = openChoice(snapshot.messages, (message) => isRoutine(message.text))?.message.id;
  const answered = answeredForHim(snapshot.messages);
  let spokenSince = false;
  for (const message of [...snapshot.messages].reverse()) {
    if (message.role === "user") spokenSince = true;
    if (message.role !== "assistant" || isRoutine(message.text)) continue;
    const handled = handledBy(answered.get(choiceTarget(message)));
    let reading = message.aside ? relayReading(message.text, handled) : readingOf(message.text, handled);
    if (reading?.asks && spokenSince && message.id !== open) reading = message.aside ? null : { ...reading, asks: false };
    if (!reading) continue;
    reply = { id: message.id, ...reading };
    break;
  }
  const working = snapshot.working && recent;
  const newest = [...snapshot.messages].reverse().find((message) => message.role === "user");
  return {
    working,
    ...(working && snapshot.activity ? { activity: snapshot.activity } : {}),
    ...(snapshot.lastActivity ? { lastActivity: snapshot.lastActivity } : {}),
    ...(reply ? { reply } : {}),
    ...(newest?.waiting ? { waiting: { id: newest.id, text: plainLinks(newest.waiting), ...(newest.waitingFailed ? { failed: true as const } : {}) } } : {}),
  };
}

export function islandStatusOf(current: ConversationStatus, fleet?: FleetArtefact): ConversationStatus {
  const ask = fleet?.calls.find((row) => !row.ledgerOnly);
  const notable = fleet?.landed.find((row) => row.notable);
  const reply = ask
    ? { id: `decision:${ask.executiveDecisionId ?? ask.task ?? ask.label}`, headline: ask.question ?? ask.label, asks: true }
    : notable
      ? { id: `outcome:${notable.executiveDecisionId ?? notable.task ?? notable.label}`, headline: notable.label, asks: false }
      : current.reply?.asks || current.reply?.id.startsWith("answer:") ? current.reply : undefined;
  return {
    working: current.working,
    ...(current.lastActivity ? { lastActivity: current.lastActivity } : {}),
    ...(reply ? { reply } : {}),
    ...(current.waiting?.failed ? { waiting: current.waiting } : {}),
  };
}

/**
 * Each island item rings once, ever. The island only remembers the last id it
 * saw, so an open call that drops out of the fleet snapshot (an unreadable
 * read) or trades places with another call came back as "new" and rang every
 * minute or two. An id already sent is taken out of the feed; the record
 * survives restarts.
 */
/** One key per wording, shared by replies and notices: the same ask rings once whichever path it takes. */
function wordKey(text: string): string {
  return `notice:${text.replace(/^needs you:\s*/i, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160)}`;
}

/** How long an item keeps going out after it first rings: every connection open at that moment sees it, then never again. */
const RING_WINDOW_MS = 60_000;

export class IslandRung {
  /** Key → when it first rang. */
  private readonly rung: Map<string, number>;
  // Tests keep the record in memory unless they name a file: never George's real one.
  constructor(
    private readonly file: string | null = process.env.VITEST ? null : join(process.env.FLYD_DIR || join(homedir(), ".flyd"), "view", "island-rung.json"),
    private readonly max = 500,
    private readonly now: () => number = Date.now,
  ) {
    let saved: unknown = [];
    try { if (file && existsSync(file)) saved = JSON.parse(readFileSync(file, "utf8")); } catch { saved = []; }
    // An older record is a plain list of keys: each rang long ago.
    this.rung = new Map(Array.isArray(saved) ? saved.flatMap((entry): Array<[string, number]> =>
      typeof entry === "string" ? [[entry, 0]] : Array.isArray(entry) && typeof entry[0] === "string" ? [[entry[0], Number(entry[1]) || 0]] : []) : []);
  }

  /** The status with any reply already rung removed; a first-seen reply is recorded and kept. */
  once(status: ConversationStatus): ConversationStatus {
    const reply = status.reply;
    if (!reply) return status;
    // The same ask comes back re-filed as a new decision with a new id, so the
    // wording counts as well as the id.
    const worded = this.ringing(wordKey(reply.headline));
    const fresh = this.ringing(reply.id) && worded;
    if (fresh) return status;
    const { reply: _rung, ...rest } = status;
    return rest;
  }

  /**
   * A notice rings once per wording: the sender re-posts the same ask under a
   * new id every few minutes, so the id alone can't stop the repeat.
   */
  onceNotice<T extends { text: string }>(notice: T | undefined): T | undefined {
    if (!notice) return undefined;
    return this.ringing(wordKey(notice.text)) ? notice : undefined;
  }

  /** True while a key is new: unseen (it is recorded now) or first rung within the window. */
  private ringing(key: string): boolean {
    const at = this.now();
    const first = this.rung.get(key);
    if (first !== undefined) return at - first < RING_WINDOW_MS;
    this.rung.set(key, at);
    while (this.rung.size > this.max) this.rung.delete(this.rung.keys().next().value!);
    if (!this.file) return true;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify([...this.rung]));
    } catch { /* best effort: worst case one more ring after a restart */ }
    return true;
  }
}

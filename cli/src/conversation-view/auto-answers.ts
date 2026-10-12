import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { choiceTarget, type ReplyChoice } from "./choices.js";
import { autoAnswerNote, undoNote } from "./replies.js";
import { inline } from "./summaries.js";
import type { ConversationMessage, SentMessage } from "./types.js";

// Firstmate's routine questions, answered by Flyd for him. When firstmate puts
// a yes-or-no question to him that one of his own recorded preferences
// already settles ("Merge green Flyd PRs without asking"), Flyd answers it
// through the same note path his own answer would take, and shows him a small
// "answered for you" line he can take back. The rules are few and explicit,
// and each holds only while his recorded words for it are still in his
// profile: delete the line and the rule stops. Anything destructive,
// irreversible, security-sensitive, costly or public, anything firstmate says
// it wants his own word on, and anything no rule plainly settles stays his,
// as a card. Every answer and every take-back is logged.

/** A rule Flyd answers by, and the recorded preference of his it stands on. */
interface StandingRule {
  id: string;
  /** His recorded words that settle the question; without them in his profile, the rule is off. */
  preference: RegExp;
  /** The question it settles, read from the question itself. */
  asks: RegExp;
  /** What else must hold, read from the question and the whole reply. */
  holds?: (question: string, reply: string) => boolean;
  answer: "Yes";
}

const FLYD_PULL = /https:\/\/github\.com\/[\w.-]+\/flyd\/pull\/\d+/i;
const ANY_PULL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/gi;
/** The work is not green: a merge waits for him. */
const NOT_GREEN = /\b(?:fail(?:ed|ing|s|ure)?|red|broken|conflicts?|not (?:yet )?(?:green|passing)|still running|pending checks?)\b/i;

const RULES: StandingRule[] = [
  {
    id: "merge-green-flyd",
    preference: /merge green flyd (?:prs|pull requests|changes) without asking/i,
    asks: /\b(?:merge|land)\b/i,
    // Flyd's own work, named in the question or the only work the reply links to, and green.
    holds: (question, reply) => {
      const pulls = reply.match(ANY_PULL) ?? [];
      const flyds = /\bflyd\b/i.test(question) || (pulls.length > 0 && pulls.every((url) => FLYD_PULL.test(url)));
      return flyds && !NOT_GREEN.test(reply);
    },
    answer: "Yes",
  },
  {
    id: "show-the-real-thing",
    preference: /start the local preview server and send him the url/i,
    asks: /\b(?:start|open|run|spin up|bring up|launch)\b[^?]*\bpreview\b|\bpreview\b[^?]*\b(?:up|running|open)\b/i,
    answer: "Yes",
  },
];

/** Never answered for him, whatever a rule says: what cannot be taken back, costs, goes public or touches access. */
const NEVER = /\b(?:delet|remov|drop|wip|purg|destroy|force|reset|revert|roll ?back|overwrit|discard|uninstall|publish|deploy|releas|email|post|tweet|whatsapp|message|pay|purchas|buy|spend|cost|bill|charg|subscri|price|secret|token|password|credential|api key|permission|secur|auth|production|prod\b|public|share|firstmate|irreversibl|undo)/i;
/** Firstmate wants his own word on it. */
const WANTS_HIM = /\b(?:needs? your (?:go|yes|ok|okay|approval|call|decision|sign-?off|word)|want your (?:yes|go|ok|okay|approval|word)|your (?:yes|go-ahead|approval|sign-?off) first|only you can|up to you)\b/i;
/** Only a question just asked is answered for him; an old one he may already be weighing. */
const ANSWER_WITHIN_MS = 15 * 60 * 1000;

export interface Settled {
  rule: string;
  answer: string;
  /** His recorded words the answer stands on, one line. */
  because: string;
}

/** The recorded line that holds this preference, without its list mark or date. */
function recordedLine(preferences: string, preference: RegExp): string | null {
  const line = preferences.split("\n").find((entry) => preference.test(entry));
  if (!line) return null;
  return inline(line).replace(/^[-*+]\s+/, "").replace(/(?:\s*\(\d{4}-\d{2}-\d{2}\))+\s*$/, "").trim();
}

/**
 * The answer one of his standing rules gives this question, or null when no
 * rule plainly settles it or something rules it out. Pure.
 */
export function settledBy(message: ConversationMessage, choice: ReplyChoice, preferences: string): Settled | null {
  // A yes-or-no question only, put by firstmate, not by Flyd's own desk.
  if (!choice.options.includes("Yes") || choiceTarget(message).startsWith("ask:")) return null;
  const question = choice.question;
  if (NEVER.test(question) || WANTS_HIM.test(message.text)) return null;
  for (const rule of RULES) {
    if (!rule.asks.test(question) || (rule.holds && !rule.holds(question, message.text))) continue;
    const because = recordedLine(preferences, rule.preference);
    if (because) return { rule: rule.id, answer: rule.answer, because };
  }
  return null;
}

export interface AutoAnswerEntry {
  at: string;
  session: string;
  /** The reply that asked, and where the answer went. */
  asked: string;
  target: string;
  question: string;
  answer: string;
  rule: string;
  because: string;
  /** The note that carried the answer. */
  note: string;
}

export function defaultAutoAnswerLog(): string {
  return join(homedir(), ".flyd", "view", "auto-answers.jsonl");
}

/** Answers his routine questions once each, by his standing rules, and logs it. */
export class AutoAnswers {
  private readonly preferences: () => string;
  private readonly logFile?: string;
  private readonly now: () => number;
  /** Questions already answered for him (or being answered), by where the answer goes and what was asked. */
  private readonly done = new Set<string>();

  constructor(options: { preferences: () => string; logFile?: string; now?: () => number }) {
    this.preferences = options.preferences;
    this.logFile = options.logFile;
    this.now = options.now ?? Date.now;
    for (const entry of this.read()) this.done.add(key(entry.target, entry.question));
  }

  /**
   * Answers the question still open for him when a standing rule settles it,
   * once: never again after he takes it back. Returns what it answered.
   */
  async answer(
    session: string,
    open: { message: ConversationMessage; choice: ReplyChoice } | null,
    send: (note: string) => Promise<SentMessage>,
  ): Promise<AutoAnswerEntry | null> {
    if (!open) return null;
    const { message, choice } = open;
    const target = choiceTarget(message);
    const id = key(target, choice.question);
    if (this.done.has(id)) return null;
    const at = Date.parse(message.timestamp ?? "");
    if (Number.isNaN(at) || this.now() - at > ANSWER_WITHIN_MS) return null;
    let preferences = "";
    try {
      preferences = this.preferences();
    } catch {
      return null;
    }
    const settled = settledBy(message, choice, preferences);
    if (!settled) return null;
    this.done.add(id);
    const sent = await send(autoAnswerNote(target, choice.question, settled.answer, settled.because));
    const entry: AutoAnswerEntry = {
      at: new Date(this.now()).toISOString(),
      session,
      asked: message.id,
      target,
      question: choice.question,
      answer: settled.answer,
      rule: settled.rule,
      because: settled.because,
      note: sent.id,
    };
    this.write(entry);
    return entry;
  }

  /** He takes back an answer Flyd gave for him: the session holds off until he answers. */
  async undo(note: ConversationMessage, send: (note: string) => Promise<SentMessage>): Promise<SentMessage> {
    if (!note.answeredFor || !note.replyTo) throw new Error("That answer was his own");
    const sent = await send(undoNote(note.replyTo, note.replyQuote ?? "", note.text));
    this.write({ at: new Date(this.now()).toISOString(), undo: note.id, target: note.replyTo, note: sent.id });
    return sent;
  }

  /** The answers logged so far; a take-back line is not one. */
  private read(): AutoAnswerEntry[] {
    if (!this.logFile || !existsSync(this.logFile)) return [];
    try {
      return readFileSync(this.logFile, "utf8").split("\n").filter(Boolean).flatMap((line) => {
        try {
          const entry = JSON.parse(line) as AutoAnswerEntry;
          return typeof entry.target === "string" && typeof entry.question === "string" ? [entry] : [];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  private write(entry: object): void {
    if (!this.logFile) return;
    try {
      mkdirSync(dirname(this.logFile), { recursive: true });
      appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      console.warn(`[view] could not log an answer Flyd gave: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function key(target: string, question: string): string {
  return `${target}\n${question}`;
}

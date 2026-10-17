import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { choiceTarget, type ReplyChoice } from "./choices.js";
import { autoAnswerNote, undoNote } from "./replies.js";
import { inline, sentences } from "./summaries.js";
import type { ConversationMessage, SentMessage } from "./types.js";

// Flyd's authority over its staff's questions. George leads; Flyd is his chief
// of staff and decides what is routine in his place. When firstmate puts a
// yes-or-no question to him that his standing preferences already settle
// (merge or sync green work, build the obvious follow-up, make a wording or
// formatting call), Flyd answers it with his delegated authority, through the
// same note path his own answer would take, and shows him a quiet "handled"
// line he can take back. Each answer stands on a line of his recorded words:
// delete the line and Flyd stops answering by it. What stays his: anything
// destructive or irreversible, anything that costs money, touches security or
// access, goes public or speaks for him to other people, a genuine taste or
// strategy call, anything firstmate says only he can give, and anything no
// rule plainly settles. Every answer and every take-back is logged.

/** A rule Flyd answers by, and the recorded preferences of his it can stand on, most specific first. */
interface StandingRule {
  id: string;
  /** His recorded words that settle the question; without any of them in his profile, the rule is off. */
  preferences: RegExp[];
  /** The question it settles, read from the question itself. */
  asks: RegExp;
  /** What else must hold, read from the question, the whole reply and the recorded line it stands on. */
  holds?: (question: string, reply: string, because: string) => boolean;
  answer: "Yes";
}

const FLYD_PULL = /https:\/\/github\.com\/[\w.-]+\/flyd\/pull\/\d+/i;
const ANY_PULL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/gi;
/** The work is not green: a merge waits for him. */
const NOT_GREEN = /\b(?:fail(?:ed|ing|s|ure)?|red|broken|conflicts?|not (?:yet )?(?:green|passing)|still running|pending checks?)\b/i;
/** A merge is only ever settled by the merge rule, which reads whether the work is green. */
const LANDS = /\b(?:merge|land)\b/i;
/** He asked his staff to take control rather than hand problems back: what lets Flyd settle the routine. */
const TAKE_CONTROL = [
  /take control of situations|rather than sending problems back/i,
  /does not want to be given extra work or decisions/i,
];

/** Flyd's own work, named in the question or the only work the reply links to. */
function flyds(question: string, reply: string): boolean {
  const pulls = reply.match(ANY_PULL) ?? [];
  return /\bflyd\b/i.test(question) || (pulls.length > 0 && pulls.every((url) => FLYD_PULL.test(url)));
}

const RULES: StandingRule[] = [
  {
    id: "merge-green-flyd",
    preferences: [/merge green flyd (?:prs|pull requests|changes) without asking/i, /always merge finished, reviewed, green work without asking/i],
    asks: /\b(?:merge|land)\b/i,
    // Green, and Flyd's own unless his words cover every project.
    holds: (question, reply, because) => !NOT_GREEN.test(reply) && (flyds(question, reply) || /\ball projects\b/i.test(because)),
    answer: "Yes",
  },
  {
    id: "sync-green-work",
    preferences: [/never ask whether to sync/i, ...TAKE_CONTROL],
    // Commit, rebase onto the latest, push, pull, fast-forward: keeping his copies in
    // step. A merge or land is the merge rule's, and "pull request" is no git pull.
    asks: /\b(?:commit|push|rebase|sync|pull(?!\s+requests?\b)|fast-forward|on top of)\b/i,
    holds: (question) => !LANDS.test(question) && !NOT_GREEN.test(question),
    answer: "Yes",
  },
  {
    id: "obvious-follow-up",
    preferences: TAKE_CONTROL,
    // "Do you want the command that lets…", "Want me to add tests for it?", "Shall I fix the other two?"
    asks: /\b(?:do you want|would you like|want me to|shall (?:i|we)|should (?:i|we)|ok(?:ay)? to)\b.*\b(?:command|tool|fix|tests?|checks?|script|feature|helper|add|build|make|write|wire|implement|finish|continue|carry on)\b/i,
    holds: (question) => !LANDS.test(question) && !NOT_GREEN.test(question),
    answer: "Yes",
  },
  {
    id: "wording-and-format",
    preferences: TAKE_CONTROL,
    asks: /\b(?:word(?:ing|ed|s)?|phras\w*|format\w*|label|typo|spelling|capitali[sz]\w*|rename)\b/i,
    holds: (question) => !LANDS.test(question),
    answer: "Yes",
  },
  {
    id: "show-the-real-thing",
    preferences: [/start the local preview server and send him the url/i],
    asks: /\b(?:start|open|run|spin up|bring up|launch)\b[^?]*\bpreview\b|\bpreview\b[^?]*\b(?:up|running|open)\b/i,
    holds: (question) => !LANDS.test(question),
    answer: "Yes",
  },
];

/**
 * Never answered for him, whatever a rule says: what cannot be taken back,
 * costs, goes public or touches access.
 */
const NEVER = /\b(?:delet|remov|drop|wip(?:e|ing)\b|purg|destroy|force|reset|revert|roll ?back|overwrit|discard|uninstall|publish|deploy|releas|go(?:es|ing)? live|live site|tweet|whatsapp|pay|purchas|buy|spend|cost|bill|charg|subscri|price|pricing|invoice|contract|secret|token|password|credential|api key|permission|secur|auth(?:entic|oriz)|login|production|prod\b|public|share|irreversibl|client|customer)/i;
/**
 * Speaks for him to other people: a message sent, posted, written or announced,
 * unless the one it reaches is Flyd or the staff Flyd itself runs. Messages
 * between them are Flyd's to decide.
 */
/**
 * Sending, writing or posting at all: the act alone can speak for him, even
 * when the one it reaches is left implicit ("post an update", "announce it").
 */
const OUTWARD = /\b(?:messag\w*|dm|notif\w*|ping\w*|emails?|emailing|send\w*|sending|sent|slack\w*|comment\w*(?=\s+(?:on|to|about)\b)|forward\w*|\bcc\b|invit\w*|respond\w*|repl(?:y|ies|ying)\s+to|reach(?:es|ing)?\s+out\b|posts?|posting|posted|tweet\w*|whatsapp\w*|announc\w*)\b/i;
/** Writing to or telling people something: outward only when the one reached is not Flyd's own staff. */
const TELLS_PEOPLE = /\b(?:writ(?:e|es|ing|ten)|tell(?:s|ing)?|told|updat(?:e|es|ing)|text(?:s|ed|ing)?)\s+(?:it\s+|the\s+|a\s+|an\s+|my\s+|his\s+|her\s+|their\s+|our\s+|him\s+|them\s+|this\s+|that\s+|everyone\s+)?(?:team|clients?|customers?|reviewers?|stakeholders?|subscribers?|followers?|audience|boss|colleagues?|everyone|someone|guys|folks|him|her|them|public)\b/i;
/** An outward word whose one it reaches is Flyd or its staff: what Flyd decides for itself. */
const TO_OWN_STAFF = /\b(?:messag\w*|dm|notif\w*|ping\w*|emails?|emailing|send\w*|sending|sent|slack\w*|forward\w*|\bcc\b|invit\w*|respond\w*|text(?:s|ed|ing)?|repl(?:y|ies|ying)\s+to|posts?|posting|posted|tweet\w*|whatsapp\w*|announc\w*|writ(?:e|es|ing|ten)|tell(?:s|ing)?|told|updat(?:e|es|ing))\s+(?:the\s+|a\s+|an\s+|my\s+|his\s+|her\s+|their\s+|our\s+)?(?:flyd|first ?mate|crew ?mates?|staff|crew|agents?|workers?|subagents?|itself)\b/gi;

/** Whether the question speaks for him to other people: a message sent or written to someone other than Flyd's own staff. */
function speaksForHim(question: string): boolean {
  const toOthers = question.replace(TO_OWN_STAFF, " ");
  return OUTWARD.test(toOthers) || TELLS_PEOPLE.test(toOthers);
}
/** A taste or strategy call: his to make even when it is reversible. */
const HIS_TASTE = /\b(?:design|look|feel|colou?rs?|fonts?|layout|style|brand\w*|logo|strategy|direction|priorit\w*|roadmap)\b/i;
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

/**
 * The recorded line that holds this preference: its rule, without its list
 * mark, date or the gloss after a dash; in a long memo, the sentence that says it.
 */
function recordedLine(preferences: string, preference: RegExp): string | null {
  const line = preferences.split("\n").find((entry) => preference.test(entry));
  if (!line) return null;
  const rule = inline(line).replace(/^[-*+]\s+/, "").replace(/(?:\s*\(\d{4}-\d{2}-\d{2}\))+\s*$/, "").split(/\s+[—–]\s+/)[0]!;
  const said = rule.length > MEMO_CHARS ? sentences(rule).find((sentence) => preference.test(sentence)) ?? rule : rule;
  return said.replace(/[.;:,]+$/, "").trim();
}

/** Longer than this, a recorded line is a memo, quoted by the sentence that settles the question. */
const MEMO_CHARS = 140;

/** One question put to him: the sentence, and the taps that answer it. */
export interface Asked {
  question: string;
  options: string[];
}

/**
 * The answer one of his standing rules gives this question, or null when it
 * stays his: no rule plainly settles it, or it is destructive, costly,
 * public, a taste call, or something firstmate wants his own word on. Pure.
 */
export function settledBy(message: ConversationMessage, asked: Asked, preferences: string): Settled | null {
  // A yes-or-no question only, put by firstmate, not by Flyd's own desk.
  if (!asked.options.includes("Yes") || choiceTarget(message).startsWith("ask:")) return null;
  const question = asked.question;
  if (NEVER.test(question) || HIS_TASTE.test(question) || WANTS_HIM.test(message.text) || speaksForHim(question)) return null;
  for (const rule of RULES) {
    if (!rule.asks.test(question)) continue;
    for (const preference of rule.preferences) {
      const because = recordedLine(preferences, preference);
      if (because && (!rule.holds || rule.holds(question, message.text, because))) return { rule: rule.id, answer: rule.answer, because };
    }
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
   * Answers the questions still open for him that his standing rules settle,
   * each once: never again after he takes it back. Of several asked at once,
   * Flyd answers the ones it can and leaves him the rest. Returns what it answered.
   */
  async answer(
    session: string,
    open: { message: ConversationMessage; choice: ReplyChoice } | null,
    send: (note: string) => Promise<SentMessage>,
  ): Promise<AutoAnswerEntry[]> {
    if (!open) return [];
    const { message, choice } = open;
    const at = Date.parse(message.timestamp ?? "");
    if (Number.isNaN(at) || this.now() - at > ANSWER_WITHIN_MS) return [];
    let preferences = "";
    try {
      preferences = this.preferences();
    } catch {
      return [];
    }
    const target = choiceTarget(message);
    const answered: AutoAnswerEntry[] = [];
    for (const asked of choice.steps ?? [choice]) {
      const id = key(target, asked.question);
      if (this.done.has(id)) continue;
      const settled = settledBy(message, asked, preferences);
      if (!settled) continue;
      this.done.add(id);
      const sent = await send(autoAnswerNote(target, asked.question, settled.answer, settled.because));
      const entry: AutoAnswerEntry = {
        at: new Date(this.now()).toISOString(),
        session,
        asked: message.id,
        target,
        question: asked.question,
        answer: settled.answer,
        rule: settled.rule,
        because: settled.because,
        note: sent.id,
      };
      this.write(entry);
      answered.push(entry);
    }
    return answered;
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

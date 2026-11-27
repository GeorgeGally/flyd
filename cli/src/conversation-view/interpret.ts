import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readConsistentMemoryText } from "../council/memory-store.js";
import { gateOutgoing, relayMayShow } from "../council/reply-review.js";
import { plainSaid } from "../lib/backstage.js";
import { stripCommitIds } from "../runtime/honesty-check.js";
import { readUserProfile } from "../lib/user-profile.js";
import type { Complete } from "./flyd-desk.js";
import { inFlydsVoice } from "./flyd-voice.js";
import { forHim, PA_VOICE } from "../lib/pa-voice.js";
import { isAcknowledgement, isRoutine } from "./summaries.js";
import type { ConversationMessage } from "./types.js";

// Firstmate's answer to one of George's notes, told to him by Flyd, his chief
// of staff. Flyd's own model reads the question, firstmate's whole answer, the
// recent conversation, what Flyd knows about George and its own memory, judges
// the answer against them, and answers his question first, in a few short
// lines: the outcome, a decision only he can make, and the links.
// Cached on disk by the answer's text, so each answer is interpreted once.

const PROMPT_VERSION = "6";
const MAX_ANSWER_CHARS = 8_000;
const MAX_PROFILE_CHARS = 3_000;
const MAX_MEMORY_CHARS = 3_000;
const RECENT_MESSAGES = 6;
const TIMEOUT_MS = 60_000;
const MAX_IN_FLIGHT = 2;
/** Interpretations kept on disk: the newest ones, as only the newest replies are interpreted. */
const KEEP = 20;

/**
 * What George reads in place of a reading the outgoing checks held when the
 * staff's answer may not lead either: Flyd's own neutral line, never the held
 * words. The staff's answer stays one tap away.
 */
export const HELD_READING = "There's an answer to this; it's under show original.";

/** Whether the staff's own answer may lead in place of a held reading. */
function answerMayShow(answer: string): boolean {
  return relayMayShow(plainSaid(stripCommitIds(answer)));
}

interface Interpretation {
  text: string;
  at: string;
  /** Passed the outgoing checks when it was made; a reading cached before them is screened again before it is shown. */
  screened?: true;
}

export interface InterpretInput {
  question: string;
  answer: string;
  recent: ConversationMessage[];
}

export function interpretPrompt(input: InterpretInput, profile: string | null, memory: string | null = null): string {
  const recent = input.recent
    .slice(-RECENT_MESSAGES)
    .map((message) => `${message.role === "user" ? "George" : message.aside ? "Firstmate (update)" : "Flyd"}: ${message.text.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
  const answer = input.answer.length > MAX_ANSWER_CHARS ? `${input.answer.slice(0, MAX_ANSWER_CHARS)}\n…` : input.answer;
  return [
    "You are Flyd, George's personal assistant. Firstmate, the coding boss, has answered a question. The Chief of Staff is a separate role between you and the domain bosses. Judge the answer against what George asked and tell him what it means in your own voice.",
    "Never call him \"Captain\". Do not quote firstmate or say \"firstmate says\"; tell him yourself.",
    PA_VOICE,
    "Answer his question first, in at most three short lines. Then, only if there is one, the decision only he can make, with your recommendation. Keep the link to what landed and any number that matters to him. Leave out how the work was done (reviews, checks, tests, tools, who did it, internal choices) and anything you or the team can handle; he can open the full answer if he wants it. Never answer with only an acknowledgement.",
    "You decide routine calls yourself with his delegated authority (committing, syncing, pushing or merging green work, the obvious follow-up build, wording and formatting): tell him you have handled them, never ask him. Only what is destructive or irreversible, costs money, touches security or access, goes public or speaks for him, or is a genuine taste or strategy call is his decision.",
    "Speak in short plain-English prose, never bullet points, numbered lists or headings. Name the work by what it does, never by PR or issue number, branch name, commit hash or check count; put a link on the words that name the work, as a Markdown link, never a bare URL.",
    profile ? `What you know about George:\n${profile.slice(0, MAX_PROFILE_CHARS)}` : "",
    memory?.trim() ? `Your memory:\n${memory.slice(0, MAX_MEMORY_CHARS)}` : "",
    recent ? `Recent conversation:\n${recent}` : "",
    `George asked: ${input.question.trim()}`,
    `Firstmate's full answer:\n${answer}`,
    "Reply with what you tell George, nothing else.",
  ].filter(Boolean).join("\n\n");
}

export function defaultInterpretationCache(): string {
  return join(homedir(), ".flyd", "view", "interpretations.json");
}

function profileOrNull(): string | null {
  try {
    return readUserProfile();
  } catch {
    return null;
  }
}

function memoryOrNull(): string | null {
  try {
    return readConsistentMemoryText();
  } catch {
    return null;
  }
}

/** Interpretations keyed by a hash of the answer: asked for at most once per answer in a process, kept on disk. */
export class AnswerInterpreter {
  private readonly cache: Record<string, Interpretation>;
  private readonly inFlight = new Map<string, Promise<string | undefined>>();
  private readonly failed = new Set<string>();
  private readonly profile: () => string | null;
  private readonly memory: () => string | null;
  private readonly queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly options: { complete: Complete; cacheFile: string; profile?: () => string | null; memory?: () => string | null; timeoutMs?: number }) {
    this.profile = options.profile ?? profileOrNull;
    this.memory = options.memory ?? memoryOrNull;
    try {
      this.cache = JSON.parse(readFileSync(options.cacheFile, "utf8")) as Record<string, Interpretation>;
    } catch {
      this.cache = {};
    }
  }

  static key(answer: string): string {
    return createHash("sha256").update(`${PROMPT_VERSION}\0${answer}`).digest("hex").slice(0, 32);
  }

  /** The reading he is shown: one cached before the outgoing checks is screened first; a held one gives way to the staff's answer when that may lead, else to Flyd's neutral line. */
  cached(answer: string): string | undefined {
    const entry = this.cache[AnswerInterpreter.key(answer)];
    if (!entry || entry.screened || relayMayShow(entry.text)) return entry?.text;
    return answerMayShow(answer) ? undefined : HELD_READING;
  }

  pending(answer: string): boolean {
    return this.inFlight.has(AnswerInterpreter.key(answer));
  }

  /** Whether a call for this answer is still worth making. */
  wants(answer: string): boolean {
    const key = AnswerInterpreter.key(answer);
    return !this.cache[key] && !this.failed.has(key) && !this.inFlight.has(key);
  }

  /** Resolves with the interpretation, or undefined when the model failed or only acknowledged. Never rejects. */
  request(input: InterpretInput): Promise<string | undefined> {
    const key = AnswerInterpreter.key(input.answer);
    if (this.cache[key]) return Promise.resolve(this.cached(input.answer));
    if (this.failed.has(key)) return Promise.resolve(undefined);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const job = this.slot()
      .then((release) => this.interpret(input).finally(release))
      .then((text) => {
        this.cache[key] = { text, at: new Date().toISOString(), screened: true };
        this.save();
        return text;
      })
      .catch(() => {
        this.failed.add(key);
        return undefined;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return job;
  }

  private async interpret(input: InterpretInput): Promise<string> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const raw = await Promise.race([
        this.options.complete(interpretPrompt(input, this.profile(), this.memory())),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timed out")), this.options.timeoutMs ?? TIMEOUT_MS);
        }),
      ]);
      const text = stripCommitIds(forHim(inFlydsVoice(raw.trim())));
      if (!text || isRoutine(text) || isAcknowledgement(text)) throw new Error("no interpretation");
      // The relayed update reaches George under the same outgoing-answer checks
      // a chat reply passes: one that names backstage machinery (unless he
      // asked how Flyd works), is a placeholder or hands him an internal call
      // is not shown, and what was held is recorded (council/reply-review.ts).
      // The staff's answer leads instead when it passes; else Flyd's neutral line.
      const gated = gateOutgoing({ surface: "relay", source: "relay:interpretation", text, asked: input.question }, null);
      if (gated) return gated;
      if (answerMayShow(input.answer)) throw new Error("relay held back");
      return HELD_READING;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private slot(): Promise<() => void> {
    return new Promise((resolve) => {
      const start = () => {
        this.running += 1;
        resolve(() => {
          this.running -= 1;
          this.queue.shift()?.();
        });
      };
      if (this.running < MAX_IN_FLIGHT) start();
      else this.queue.push(start);
    });
  }

  private save(): void {
    for (const key of Object.keys(this.cache).slice(0, -KEEP)) delete this.cache[key];
    mkdirSync(dirname(this.options.cacheFile), { recursive: true });
    const tmp = `${this.options.cacheFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cache), { mode: 0o600 });
    renameSync(tmp, this.options.cacheFile);
  }
}

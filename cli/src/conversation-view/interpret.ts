import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readUserProfile } from "../lib/user-profile.js";
import type { Complete } from "./flyd-desk.js";
import { inFlydsVoice } from "./flyd-voice.js";
import { isAcknowledgement, isRoutine } from "./summaries.js";
import type { ConversationMessage } from "./types.js";

// Firstmate's answer to one of George's notes, told to him by Flyd. Flyd's own
// model reads the question, firstmate's whole answer, the recent conversation
// and what Flyd knows about George, and says what he needs to lead well: every
// outcome, every decision he must make and what it leads to, and the links.
// Cached on disk by the answer's text, so each answer is interpreted once.

const PROMPT_VERSION = "2";
const MAX_ANSWER_CHARS = 8_000;
const MAX_PROFILE_CHARS = 3_000;
const RECENT_MESSAGES = 6;
const TIMEOUT_MS = 60_000;
const MAX_IN_FLIGHT = 2;
/** Interpretations kept on disk: the newest ones, as only the newest replies are interpreted. */
const KEEP = 20;

export interface InterpretInput {
  question: string;
  answer: string;
  recent: ConversationMessage[];
}

export function interpretPrompt(input: InterpretInput, profile: string | null): string {
  const recent = input.recent
    .slice(-RECENT_MESSAGES)
    .map((message) => `${message.role === "user" ? "George" : message.aside ? "Firstmate (update)" : "Flyd"}: ${message.text.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
  const answer = input.answer.length > MAX_ANSWER_CHARS ? `${input.answer.slice(0, MAX_ANSWER_CHARS)}\n…` : input.answer;
  return [
    "You are Flyd, George's personal assistant. He leads a software fleet; firstmate, his engineering lead, has answered a question he asked. Tell him what the answer means for him, in your own voice.",
    "Address him as \"sir\", never \"Captain\". Do not quote firstmate or say \"firstmate says\"; tell him yourself.",
    "Give him as much detail as he needs to lead well, given who he is and what you were talking about: every outcome (what changed, what was found), every decision he must make with what each choice leads to, every ask of him. Drop narration, tool names and pleasantries. Never answer with only an acknowledgement.",
    "Speak in short plain-English prose, never bullet points or numbered lists. Name the work by what it does, never by URL, PR or issue number, branch name, commit hash or check count; put a link on the words that name the work, as a Markdown link, never a bare URL.",
    profile ? `What you know about George:\n${profile.slice(0, MAX_PROFILE_CHARS)}` : "",
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

/** Interpretations keyed by a hash of the answer: asked for at most once per answer in a process, kept on disk. */
export class AnswerInterpreter {
  private readonly cache: Record<string, { text: string; at: string }>;
  private readonly inFlight = new Map<string, Promise<string | undefined>>();
  private readonly failed = new Set<string>();
  private readonly profile: () => string | null;
  private readonly queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly options: { complete: Complete; cacheFile: string; profile?: () => string | null; timeoutMs?: number }) {
    this.profile = options.profile ?? profileOrNull;
    try {
      this.cache = JSON.parse(readFileSync(options.cacheFile, "utf8")) as Record<string, { text: string; at: string }>;
    } catch {
      this.cache = {};
    }
  }

  static key(answer: string): string {
    return createHash("sha256").update(`${PROMPT_VERSION}\0${answer}`).digest("hex").slice(0, 32);
  }

  cached(answer: string): string | undefined {
    return this.cache[AnswerInterpreter.key(answer)]?.text;
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
    if (this.cache[key]) return Promise.resolve(this.cache[key].text);
    if (this.failed.has(key)) return Promise.resolve(undefined);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const job = this.slot()
      .then((release) => this.interpret(input).finally(release))
      .then((text) => {
        this.cache[key] = { text, at: new Date().toISOString() };
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
        this.options.complete(interpretPrompt(input, this.profile())),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timed out")), this.options.timeoutMs ?? TIMEOUT_MS);
        }),
      ]);
      const text = inFlydsVoice(raw.trim());
      if (!text || isRoutine(text) || isAcknowledgement(text)) throw new Error("no interpretation");
      return text;
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

import { PreparationStore } from "../runtime/preparation-store.js";
import type { ConversationTurnSource } from "../runtime/conversation-turn.js";
import { isAccountIntent } from "../connectors/invocation.js";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inFlydsVoice } from "./flyd-voice.js";
import { clipKeepingLinks } from "./line-links.js";
import { answeringLine } from "./living.js";
import { MAX_IMAGE_BYTES, MAX_IMAGES, sniffImage } from "./firstmate-inbox.js";
import { isPlaceholderStatus, relayStatus, type InFlightTool } from "./status-text.js";
import type { ConversationMessage, Exchange, ImageData, ImageUpload, SentMessage } from "./types.js";
import { collectRoutingCase, routingHash, safeRoutingValue, type RoutingTrace } from "../runtime/routing-learning.js";
import type { RouteReading } from "../runtime/turn-plan.js";

// Flyd is the voice of the conversation window. A question that is not
// software or fleet work (what to do in Bangkok tonight) is Flyd's to answer,
// with its own assistant turn, and never reaches firstmate. Each question and
// its answer are kept as one file under ~/.flyd/view/asks, so they survive the
// view restarting.

/** Who answers a message sent from the window. */
export type Route = "flyd" | "firstmate";

/** One model call: the prompt in, the model's text out. */
export type Complete = (prompt: string) => Promise<string>;
export type DeskPrediction = RouteReading & { decided: boolean; needsCode: boolean | null };
export interface DeskRoutingOptions {
  mode?: "off" | "shadow" | "live";
  predict?: (text: string, recent: ConversationMessage[]) => Promise<DeskPrediction | null>;
  collect?: (trace: RoutingTrace) => void | Promise<void>;
}
/** Ownership follows intent and code access, not the occurrence of a repo name. */
export function deskOwnerFor(prediction: DeskPrediction | null): Route | null {
  if (!prediction?.decided) return null;
  if (prediction.needsCode === true) return "firstmate";
  if (prediction.route === "delegate") return prediction.domain === "coding" ? "firstmate"
    : prediction.domain && prediction.domain !== "general" ? "flyd" : null;
  return prediction.needsCode === false ? "flyd" : null;
}
async function defaultDeskPrediction(text: string, recent: ConversationMessage[]): Promise<DeskPrediction | null> {
  if (process.env.VITEST) return null;
  const { routeWithJev } = await import("../runtime/turn-plan.js");
  return routeWithJev(text, recent.map((message) => ({
    role: message.role, content: (message.aside ? "Firstmate update: " : "") + message.text,
  })));
}

const ROUTE_TIMEOUT_MS = 8_000;
const RECENT_FOR_ROUTE = 4;
const HISTORY_EXCHANGES = 4;
const MAX_ERROR_CHARS = 160;
const MAX_STEP_CHARS = 90;

export function routePrompt(text: string, recent: ConversationMessage[]): string {
  const context = recent
    .slice(-RECENT_FOR_ROUTE)
    .map((message) => `${message.role === "user" ? "George" : message.aside ? "Firstmate (update)" : "Flyd"}: ${message.text.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
  return [
    "George is talking to Flyd, his personal assistant, in Flyd's conversation window.",
    "Flyd answers everything that is not software work itself, from its own memory of him and the web: questions about his own life and history (where he studied, worked or lived, people he knows, what he said or did before), his calendar and plans, travel, places, facts, the news, writing, his day.",
    "Firstmate is the engineering lead who runs his software fleet. It takes requests that require inspecting or changing code, repositories, pull requests, builds, bugs, deployments or crew work, and replies to something firstmate asked him (a choice like \"A\", a yes/no, \"go ahead\"). Mere discussion of software, Flyd or firstmate is Flyd's unless inspecting the code or work state is needed. Planning-only requests keep their no-implementation constraint.",
    "Local draft preparation remits, concerns about those goals, and stopping or reviewing those preparations belong to Flyd. They do not require code access. Explicit coding tasks still belong to Firstmate.",
    "Questions about Flyd itself (which models it uses, its settings, its features, why it answered the way it did) and follow-ups to an answer Flyd just gave are Flyd's: Flyd looks up its own setup and passes on what it can't answer.",
    context ? `Recent conversation:\n${context}` : "",
    `New message from George: ${text.replace(/\s+/g, " ").slice(0, 1_000)}`,
    "Who should handle it? Answer with exactly one word: FLYD or FIRSTMATE.",
  ].filter(Boolean).join("\n\n");
}

/** How long after his last message a new one still continues that conversation. */
export const CONTINUES_WITHIN_MS = 10 * 60_000;

/** Who is answering the conversation his new message continues: the handler of his last message, if it was recent. */
export function continuing(previous: { owner: Route; at?: string } | undefined, now = Date.now()): Route | null {
  const at = previous?.at ? Date.parse(previous.at) : NaN;
  return previous && !Number.isNaN(at) && now - at >= 0 && now - at <= CONTINUES_WITHIN_MS ? previous.owner : null;
}

/**
 * Decides who answers. When the router can't tell (a slow or failed model), a
 * message that continues a conversation stays with whoever is having it, so a
 * follow-up to Flyd's own answer is never sent to firstmate; anything else
 * goes to firstmate, the window's only path before, so a work request is never
 * dropped on the floor.
 */
export async function routeMessage(
  input: { text: string; files?: number; command?: string; recent: ConversationMessage[]; sessionId?: string; previous?: { owner: Route; at?: string } },
  complete: Complete,
  timeoutMs = ROUTE_TIMEOUT_MS,
  options: DeskRoutingOptions = {},
): Promise<Route> {
  // Documents are read by firstmate; a screenshot goes with his words to whoever they are for.
  if (input.command || (input.files ?? 0) > 0 || !input.text.trim()) return "firstmate";
  if (/\bwhatsapp\b/i.test(input.text) && isAccountIntent(input.text)) return "flyd";
  const started = Date.now();
  const mode = options.mode ?? (process.env.FLYD_ROUTING_CASCADE === "live" ? "live" : process.env.FLYD_ROUTING_CASCADE === "off" ? "off" : "shadow");
  const fast = mode === "off" ? null : await (options.predict ?? defaultDeskPrediction)(input.text, input.recent).catch(() => null);
  const candidate = deskOwnerFor(fast);
  const prompt = routePrompt(input.text, input.recent);
  const record = (owner: Route, source: string, fallbackReason?: string): void => {
    if (process.env.FLYD_ROUTING_LEARNING === "0") return;
    const trace: RoutingTrace = {
      version: 1, surface: "desk", at: new Date().toISOString(),
      sessionId: input.sessionId ?? "desk-unknown",
      input: safeRoutingValue({ text: input.text, fallbackPrompt: prompt,
        ...(fast?.evidence?.input ?? { conversation_recap: input.recent.slice(-4) }),
      }) as Record<string, unknown>,
      contextComplete: true, policyVersion: routingHash(["desk.routing.v2", fast?.evidence?.policyVersion, mode]),
      observed: { owner }, source, latencyMs: Date.now() - started,
      ...(fast ? { confidence: fast.confidence, model: fast.evidence?.model, judgments: fast.evidence?.judgments } : {}),
      models: { ...(fast?.evidence?.model ? { jev: fast.evidence.model } : {}), ...(source !== "jev" ? { fallback: process.env.FLYD_ROUTING_FALLBACK_MODEL ?? "incumbent-desk-classifier" } : {}) },
      ...(candidate ? { candidate: { owner: candidate } } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
    };
    // Detached, bounded local capture: never delays dispatch or turns a send
    // into an error; an injected collector is also isolated.
    void Promise.resolve().then(async () => {
      if (options.collect) await options.collect(trace);
      else if (!process.env.VITEST) {
        const { FLYD_DIR } = await import("../lib/config.js");
        collectRoutingCase(FLYD_DIR, randomBytes(16).toString("hex"), trace);
      }
    }).catch(() => undefined);
  };
  if (mode === "live" && candidate) { record(candidate, "jev"); return candidate; }
  const unrouted = (): Route => (mode === "live" ? "flyd" : continuing(input.previous) ?? "firstmate");
  let timer: NodeJS.Timeout | undefined;
  try {
    const answer = await Promise.race([
      complete(prompt),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(""), timeoutMs);
      }),
    ]);
    const valid = /^(?:FLYD|FIRSTMATE)[.!]?$/i.test(answer.trim());
    const owner = valid ? /^flyd/i.test(answer.trim()) ? "flyd" : "firstmate" : unrouted();
    record(owner, valid ? "llm" : "incumbent_failure", !valid ? "fallback_failed" : candidate && mode === "shadow" ? "shadow_only" : fast ? "uncertain_route_or_domain" : "jev_unavailable");
    return owner;
  } catch {
    const owner = unrouted();
    record(owner, "incumbent_failure", "fallback_failed");
    return owner;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One question George asked Flyd from the window, as stored. */
interface AskRecord {
  sessionId?: string;
  preparationId?: string;
  interactionClass?: "conversation" | "work_status" | "decision" | "deliverable";
  id: string;
  at: string;
  text: string;
  /** Its screenshots, as image ids kept beside the asks. */
  images?: string[];
  /** What those screenshots show, read once and kept for the answer and every follow-up. */
  seen?: string;
  answer?: string;
  answeredAt?: string;
  error?: string;
  /** Status lines that only said something was happening, and the concrete status George was shown instead. */
  statusSubstitutions?: Array<{ raw: string; shown: string }>;
}

/** Flyd's own answer to a question, given the window's earlier questions and answers; `onStep` says what it is doing as it goes. */
export type Answerer = (question: string, history: Array<{ role: "user" | "assistant"; content: string }>, onStep?: (step: string, tool?: InFlightTool) => void, turn?: { source: ConversationTurnSource; onPreparation(id: string): void; onInteraction(kind: "conversation" | "work_status" | "decision" | "deliverable"): void }) => Promise<string>;

/** What the screenshots he attached to a question show, in words, for Flyd's turn, which takes words only. */
export type Seer = (question: string, images: ImageUpload[], onStep?: (step: string, tool?: InFlightTool) => void) => Promise<string>;

/** A question with what its screenshots show, as Flyd's turn reads it. */
function asAsked(record: AskRecord): string {
  return record.seen ? `${record.text}\n\n${record.seen}` : record.text;
}

const ASK_IMAGE = /^a(\d+-[0-9a-f]+-\d+\.(?:png|jpg|gif|webp))$/;

export function defaultAsksDir(): string {
  return join(homedir(), ".flyd", "view", "asks");
}

export class FlydDesk {
  private readonly dir: string;
  private readonly answerer: Answerer;
  private readonly see?: Seer;
  private readonly preparations: PreparationStore;
  /** Questions this process is answering right now. */
  private readonly inFlight = new Set<string>();
  /** What Flyd is doing on each question it is answering, said the moment it changes. */
  private readonly steps = new Map<string, string>();
  /** Parsed records by file name, with the size and mtime they were read at; a file is read again only when those change. */
  private readonly parsed = new Map<string, { stamp: string; record: AskRecord | null }>();

  constructor(options: { answer: Answerer; see?: Seer; dir?: string; preparationStore?: PreparationStore }) {
    this.answerer = options.answer;
    this.preparations = options.preparationStore ?? new PreparationStore();
    this.see = options.see;
    this.dir = options.dir ?? defaultAsksDir();
  }

  private write(record: AskRecord): void {
    mkdirSync(this.dir, { recursive: true });
    const path = join(this.dir, `${record.id}.json`);
    const staging = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(staging, JSON.stringify(record), { mode: 0o600 });
    renameSync(staging, path);
  }

  private records(): AskRecord[] {
    if (!existsSync(this.dir)) return [];
    const names = new Set(readdirSync(this.dir).filter((name) => name.endsWith(".json")));
    for (const name of this.parsed.keys()) if (!names.has(name)) this.parsed.delete(name);
    const records: AskRecord[] = [];
    for (const name of names) {
      const record = this.read(name);
      if (record) records.push(record);
    }
    return records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  private read(name: string): AskRecord | null {
    const path = join(this.dir, name);
    let stamp: string;
    try {
      const stat = statSync(path);
      stamp = `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
    const known = this.parsed.get(name);
    if (known?.stamp === stamp) return known.record;
    let record: AskRecord | null = null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as AskRecord;
      if (typeof parsed.id === "string" && typeof parsed.at === "string" && typeof parsed.text === "string") record = parsed;
    } catch {
      // A torn or foreign file: not one of ours.
    }
    this.parsed.set(name, { stamp, record });
    return record;
  }

  /** Takes the question and starts answering it; the answer lands in a later `exchanges()`. */
  ask(text: string, images: ImageUpload[] = [], sessionId = "conversation"): SentMessage {
    const id = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const kept = this.keepImages(id, images);
    let record: AskRecord = { id, sessionId, at: new Date().toISOString(), text: text.trim(), ...(kept.length ? { images: kept } : {}) };
    const history = this.records()
      .filter((earlier) => earlier.answer && (earlier.sessionId ?? "conversation") === sessionId)
      .slice(-HISTORY_EXCHANGES)
      .flatMap((earlier) => [
        { role: "user" as const, content: asAsked(earlier) },
        { role: "assistant" as const, content: earlier.answer! },
      ]);
    this.write(record);
    this.inFlight.add(record.id);
    const first = clipKeepingLinks(answeringLine(record.text, kept.length > 0), MAX_STEP_CHARS, 40);
    this.steps.set(record.id, first);
    const onStep = (step: string, tool?: InFlightTool): void => {
      const line = step.replace(/\s+/g, " ").trim();
      if (!line || !this.inFlight.has(record.id)) return;
      // The one boundary a relayed status crosses before it becomes the line under his message: a placeholder
      // never passes; it is replaced by a status built from the tool call under way, and both are kept for review.
      const shown = relayStatus(line, tool) || this.steps.get(record.id);
      if (!shown) return;
      if (isPlaceholderStatus(line)) {
        record = { ...record, statusSubstitutions: [...(record.statusSubstitutions ?? []), { raw: line, shown }] };
        this.write(record);
      }
      this.steps.set(record.id, clipKeepingLinks(shown.replace(/[.…]+$/, ""), MAX_STEP_CHARS, 40));
    };
    const turn = {
      source: { turnId: `ask:${id}`, sessionId: `view:${sessionId}`, surface: "view" as const, text: record.text,
        context: this.records().filter(earlier => (earlier.sessionId ?? "conversation") === sessionId && earlier.id !== id)
          .slice(-4).map(earlier => ({ ref: `ask:${earlier.id}`, text: earlier.text.slice(0, 350) })),
        revision: 1, consentRef: `conversation:view:${sessionId}`, final: true as const, retention: "local_default" as const },
      onInteraction: (interactionClass: "conversation" | "work_status" | "decision" | "deliverable") => { record = { ...record, interactionClass }; this.write(record); },
      onPreparation: (preparationId: string) => { record = { ...record, preparationId }; this.write(record); },
    };
    const answering = images.length && this.see
      ? this.see(record.text, images, onStep).then((seen) => {
        if (seen.trim()) {
          record = { ...record, seen: seen.trim() };
          this.write(record);
        }
        return this.answerer(asAsked(record), history, onStep, turn);
      })
      : this.answerer(record.text, history, onStep, turn);
    void answering
      .then((answer) => {
        if (!answer.trim()) throw new Error("no answer came back");
        this.write({ ...record, answer: answer.trim(), answeredAt: new Date().toISOString() });
      })
      .catch((error: unknown) => {
        this.write({ ...record, error: (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS) });
      })
      .finally(() => {
        this.inFlight.delete(record.id);
        this.steps.delete(record.id);
      });
    return { id: `ask:${record.id}`, timestamp: record.at, waiting: first };
  }

  /** Checks and keeps the screenshots of a question beside the asks; returns their image ids. */
  private keepImages(id: string, images: ImageUpload[]): string[] {
    if (images.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images per message`);
    const decoded = images.map((image) => {
      const bytes = Buffer.from(image.data, "base64");
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error(`Images must be under ${MAX_IMAGE_BYTES / (1024 * 1024)}MB`);
      const type = sniffImage(bytes);
      if (!type) throw new Error("Only PNG, JPEG, GIF and WebP images can be sent");
      return { bytes, type };
    });
    if (!decoded.length) return [];
    mkdirSync(join(this.dir, "images"), { recursive: true });
    return decoded.map(({ bytes, type }, index) => {
      const name = `${id}-${index}.${type.ext}`;
      writeFileSync(join(this.dir, "images", name), bytes, { mode: 0o600, flag: "wx" });
      return `a${name}`;
    });
  }

  /** A screenshot kept with a question, by its image id; null when it is not one of ours. */
  image(imageId: string): ImageData | null {
    const name = ASK_IMAGE.exec(imageId)?.[1];
    const path = name ? join(this.dir, "images", name) : "";
    if (!path || !existsSync(path)) return null;
    const data = readFileSync(path);
    const type = sniffImage(data);
    return type ? { mediaType: type.mediaType, data } : null;
  }

  exchanges(): Exchange[] {
    return this.records().map((record) => {
      const question: ConversationMessage = { id: `ask:${record.id}`, role: "user", text: record.text, timestamp: record.at, ...(record.images?.length ? { images: record.images } : {}) };
      if (record.answer) {
        const preparation = record.preparationId ? this.preparations.read(record.preparationId) : undefined;
        const prepared = preparation?.status === "prepared" && preparation.content
          ? `\n\n### Prepared draft\n\n${preparation.content}\n\n[Review or stop preparation](/preparation?session=${encodeURIComponent(record.sessionId ?? "conversation")})` : "";
        const failure = preparation?.status === "failed" || preparation?.status === "unknown"
          ? "\n\nI could not finish checking the draft. Nothing was sent." : preparation?.status === "cancelled" ? "\n\nThis preparation was stopped." : "";
        return {
          question,
          answer: { id: `answer:${record.id}`, role: "assistant", text: inFlydsVoice(record.answer) + prepared + failure, timestamp: record.answeredAt ?? record.at, answers: question.id },
          waiting: "",
        };
      }
      if (this.inFlight.has(record.id) && !record.error) return { question, waiting: this.steps.get(record.id) ?? answeringLine(record.text, Boolean(record.images?.length)) };
      const waiting = record.error ? `Flyd couldn't answer this: ${record.error}` : "Flyd was interrupted before answering; send it again";
      return { question, waiting, waitingFailed: true };
    });
  }
}

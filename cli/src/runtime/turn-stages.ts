// One brain: the stages every turn goes through, whichever surface George used.
//
// Chat (respondToConversation) runs all of them and answers with tools. The
// overlay (/manifest, INVOKED text/voice) and LIVE's flyd_resolve_intent run
// the same stages and hand the result to resolve.ts, which stays the output
// adapter that shapes the answer into native/augment/compose/task outcomes
// for the Swift adapter. So the same SOUL, the same route reading, the same
// knowledge and private notes, the same skill pick and the same receipt
// shape stand behind an answer wherever he asked.
//
//   gatherTurnKnowledge  who he is, the knowledge pool, backstage notes
//   routeTurn            Jev's ~0.3s route/skill/note reading
//   readRoomStage        the LLM room reading when Jev isn't sure (chat only)
//   turnExtras           the one skill and the one note that ride this turn
//   turnBriefParts       what the answer is told about this turn
//   finishInFlydsVoice   narration and ruled-out phrases cut before he sees it

import { decisionPolicyVersion } from "../lib/decision-policy.js";
import type { RemitSummary } from "./preparation-reading.js";
import { readTheRoom, roomPrompt, ROOM_RUBRIC_VERSION, type RoomInput, type RoomRead } from "./read-the-room.js";
import { buildRoomContext, privateNotes } from "./room-context.js";
import { safeRoutingValue, type RoutingTrace } from "./routing-learning.js";
import { loadSkills, seedSkills, skillPromptBlock, type Skill } from "./skills.js";
import { planBrief, planTurn, routeWithJev, type RouteReading, type TurnPlan } from "./turn-plan.js";
import { checkGrounding, retiredPhrasesIn, stripInternalNarration, stripRetiredPhrases } from "./honesty-check.js";
import type { MemoryEvidence } from "./types.js";

export type TurnHistory = Array<{ role: "user" | "assistant"; content: string }>;
export type FastRouteReading = RouteReading & { decided: boolean; needsCode?: boolean | null; skill?: string | null; raise?: string | null };
export type RouteTurn = (message: string, history: TurnHistory, notes?: Array<{ id: string; text: string }>, remits?: RemitSummary[]) => Promise<FastRouteReading | null>;
export type ReadRoom = (input: RoomInput) => Promise<RoomRead | null>;
export type PrivateNote = Awaited<ReturnType<typeof privateNotes>>[number];
export type TurnReading = Pick<RouteReading, "route" | "source" | "domain">;
/** Where George asked. Chat has tools; the overlay and LIVE answer through resolve.ts. */
export type TurnSurface = "chat" | "overlay" | "live";

/** Jev's route, skill and note reading; null under tests or without a key. */
export async function defaultRouteTurn(message: string, history: TurnHistory, notes: Array<{ id: string; text: string }> = [], remits: RemitSummary[] = []): Promise<FastRouteReading | null> {
  if (process.env.VITEST) return null;
  try { seedSkills(); } catch { /* skills are optional */ }
  return routeWithJev(message, history, loadSkills(), notes, remits);
}

/** The LLM room reading; null under tests or with FLYD_ROOM=0. */
export async function defaultReadRoom(input: RoomInput): Promise<RoomRead | null> {
  if (process.env.FLYD_ROOM === "0" || process.env.VITEST) return null;
  const { quickQuery } = await import("../lib/llm.js");
  return readTheRoom(input, (prompt) => quickQuery(prompt, { model: process.env.FLYD_ROUTING_FALLBACK_MODEL, json: true }));
}

/** Stage 1: what Flyd could draw on this turn — who he is, the knowledge pool, backstage notes. */
export async function gatherTurnKnowledge(now: Date, retrieved: MemoryEvidence["matches"]): Promise<{ notes: PrivateNote[]; roomContext: ReturnType<typeof buildRoomContext> }> {
  const notes = await privateNotes(now).catch(() => []);
  const { readUserProfile } = await import("../lib/user-profile.js");
  const { readMemoryEntries } = await import("../council/memory-store.js");
  const roomContext = buildRoomContext({
    now,
    profile: (() => { try { return readUserProfile(); } catch { return null; } })(),
    memory: (() => { try { return readMemoryEntries(); } catch { return []; } })(),
    retrieved: retrieved.filter((item) => item.authority !== "assistant_output" && item.outcome !== "rejected"),
  });
  return { notes, roomContext };
}

export interface RoomStageInput {
  /** What George said, verbatim (the routing trace's input). */
  message: string;
  roomInput: RoomInput;
  fast: FastRouteReading | null;
  unattended: boolean;
  sessionId: string;
  /** Injected reader; absent means the default, which FLYD_ROOM=0 switches off. */
  readRoom?: ReadRoom;
  /**
   * False on the overlay and LIVE: the ~10s LLM room reading never sits on
   * their hot path, so a turn Jev isn't sure of answers, as chat does when
   * the reading fails.
   */
  allowRoomRead?: boolean;
  onReading?: () => void;
}

export interface RoomStage {
  room: RoomRead | null;
  reading: TurnReading | null;
  routingTrace?: RoutingTrace;
}

/** Stage 3: Jev decides when sure; otherwise the room reading (where allowed), else an answer. */
export async function readRoomStage(input: RoomStageInput): Promise<RoomStage> {
  const { fast, unattended, roomInput } = input;
  const fallbackStarted = Date.now();
  // FLYD_ROOM=0 switches the room reading off: a choice, not a failure, so an
  // unsure turn runs unplanned as it did before routing.
  const roomOff = !input.readRoom && process.env.FLYD_ROOM === "0";
  const skipped = input.allowRoomRead === false;
  const readsRoom = !(unattended || fast?.decided || roomOff || skipped);
  if (readsRoom) input.onReading?.();
  const room = readsRoom ? await (input.readRoom ?? defaultReadRoom)(roomInput).catch(() => null) : null;
  // An uncertain Jev prediction does not gain authority when the fallback
  // fails, but Flyd can still answer: read-only, never a forced question.
  const reading: TurnReading | null = room ? { route: room.route, source: "llm" as const }
    : fast?.decided ? fast : unattended || roomOff ? null : { route: "answer" as const, source: "llm" as const };
  let routingTrace: RoutingTrace | undefined;
  if (reading && !unattended && process.env.FLYD_ROUTING_LEARNING !== "0") {
    const attempted = readsRoom;
    routingTrace = {
      version: 1, surface: "runtime", at: roomInput.now.toISOString(), sessionId: input.sessionId,
      input: safeRoutingValue({ ...(fast?.evidence?.input ?? {}),
        message: input.message,
        ...(!fast?.decided
          ? attempted ? { fallbackPrompt: roomPrompt(roomInput) } : {}
          : { conversation_recap: fast?.evidence?.input.conversation_recap ?? roomInput.history.slice(-4) }),
      }) as Record<string, unknown>,
      contextComplete: true, policyVersion: [fast?.evidence?.policyVersion ?? "jev-unavailable", ROOM_RUBRIC_VERSION, decisionPolicyVersion() ?? "baseline"].join(":"),
      observed: { route: reading.route, ...(fast?.decided && fast.domain ? { domain: fast.domain } : {}) },
      source: room ? "llm" : fast?.decided ? "jev" : "answer_after_failure",
      ...(fast ? { confidence: fast.confidence, judgments: fast.evidence?.judgments, model: fast.evidence?.model } : {}),
      ...(room ? { model: process.env.FLYD_ROUTING_FALLBACK_MODEL ?? "configured-room-reader" } : {}),
      models: { ...(fast?.evidence?.model ? { jev: fast.evidence.model } : {}), ...(!fast?.decided && attempted ? { fallback: process.env.FLYD_ROUTING_FALLBACK_MODEL ?? "configured-room-reader" } : {}) },
      ...(fast && fast.confidence > 0 ? { candidate: { route: fast.route, ...(fast.domain ? { domain: fast.domain } : {}) } } : {}),
      latencyMs: (fast?.evidence?.latencyMs ?? 0) + (room || (!fast?.decided && attempted) ? Date.now() - fallbackStarted : 0),
      ...(!fast?.decided ? { fallbackReason: skipped ? "room_reading_off_hot_path" : fast ? "uncertain_route_or_domain" : "jev_unavailable" } : {}),
    };
  }
  return { room, reading, ...(routingTrace ? { routingTrace } : {}) };
}

/** Stage 4: the one skill that fits this turn and the one backstage note worth raising, if any. */
export function turnExtras(fast: FastRouteReading | null, room: RoomRead | null, notes: PrivateNote[], skills: () => Skill[] = loadSkills): { skill: Skill | null; fastNote: PrivateNote | null; raisedAdvisory?: string } {
  const skill = fast?.skill ? (() => { try { return skills().find((item) => item.name === fast.skill) ?? null; } catch { return null; } })() : null;
  // On the fast path the room reading never runs, so a note Jev found relevant rides in the plan.
  const fastNote = !room && fast?.raise ? notes.find((note) => note.id === fast.raise) ?? null : null;
  const raisedId = room?.raise ?? (room ? null : fast?.raise ?? null);
  const raisedAdvisory = raisedId ? notes.find((note) => note.id === raisedId)?.advisoryId : undefined;
  return { skill, fastNote, ...(raisedAdvisory ? { raisedAdvisory } : {}) };
}

/**
 * The plan's instruction where no tools are in reach. Chat's instructions
 * tell the model to look things up and hand work off with its tools; the
 * overlay and LIVE resolution has none, so the same route is said in terms
 * it can follow.
 */
export function toollessPlanBrief(plan: TurnPlan): string {
  const instruction = plan.route === "clarify"
    ? plan.instruction
    : plan.route === "answer"
      ? "This turn is an answer. Answer him in full from what you have here. Never offer to look something up or ask whether to. Don't claim to have started or changed anything; if doing something would clearly help, offer it in one line."
      : "He wants something done. Nothing runs from this answer: give him exactly what gets it done (the draft, the steps, or who should take it) and never claim it is done or started.";
  return planBrief({ ...plan, instruction });
}

/** Stage 5: what the answer is told about this turn — its plan, the skill's know-how, a note worth weaving in. */
export function turnBriefParts(input: { plan: TurnPlan | null; skill: Skill | null; fastNote: PrivateNote | null; surface?: TurnSurface }): string[] {
  const toolless = input.surface === "overlay" || input.surface === "live";
  return [
    input.plan ? (toolless ? toollessPlanBrief(input.plan) : planBrief(input.plan)) : "",
    input.skill ? skillPromptBlock(input.skill) : "",
    input.fastNote ? `Something from your own background thinking that bears on this; weave it in, in your own words, if it fits: ${input.fastNote.text}` : "",
  ].filter(Boolean);
}

/** Last stage: internal narration and phrases George has ruled out never reach him. */
export function finishInFlydsVoice(answer: string): string {
  let final = stripInternalNarration(answer).cleaned;
  // A phrase George has ruled out never reaches him: cut any a failed rewrite left behind.
  const leftover = retiredPhrasesIn(final);
  if (leftover.length) {
    console.warn(`[his-voice] cut a ruled-out phrase the rewrite left: ${leftover.join(", ")}`);
    final = stripRetiredPhrases(final);
  }
  return final;
}

/** Names and dates the answer uses that this turn's context (his message, what Flyd knows, tool output) does not contain. */
export function ungroundedSpans(answer: string, groundingText: string, message: string): string[] {
  return checkGrounding(stripInternalNarration(answer).cleaned, groundingText, message);
}

export function groundingProblems(spans: string[]): string[] {
  return spans.length ? [`These spans were not found in context — remove or ground these: ${spans.join(", ")}.`] : [];
}

/** An answer that still carries ungrounded names or dates never goes out as-is: it says so. */
export function hedgeUngroundedAnswer(answer: string, remaining: string[]): string {
  return remaining.length
    ? `${answer}\n\nI can't verify those names or dates from the context I have.`
    : answer;
}

export interface SurfaceTurnInput {
  surface: "overlay" | "live";
  message: string;
  history: TurnHistory;
  sessionId: string;
  now?: Date;
  routeTurn?: RouteTurn;
  skills?: () => Skill[];
}

export interface SurfaceTurn {
  /** Goes into the resolution prompt; empty when there is nothing to say. */
  brief: string;
  plan: TurnPlan | null;
  skill: string | null;
  routing?: RoutingTrace;
  raisedAdvisory?: string;
}

/**
 * The overlay's and LIVE's run of the shared stages, ahead of resolve.ts's
 * answer. It needs no retrieved memory (the room reading that selects from
 * the knowledge pool stays off their hot path), so it runs alongside context
 * compilation rather than after it: the one Jev call adds no serial wait.
 */
export async function prepareSurfaceTurn(input: SurfaceTurnInput): Promise<SurfaceTurn> {
  const now = input.now ?? new Date();
  const notes = await privateNotes(now).catch(() => []);
  const fast = await (input.routeTurn ?? defaultRouteTurn)(input.message, input.history, notes, []).catch(() => null);
  const { room, reading, routingTrace } = await readRoomStage({
    message: input.message,
    roomInput: { message: input.message, history: input.history, now, core: "", knowledge: [], notes },
    fast, unattended: false, sessionId: input.sessionId, allowRoomRead: false,
  });
  const plan = planTurn(reading, room?.cover ?? []);
  const { skill, fastNote, raisedAdvisory } = turnExtras(fast, room, notes, input.skills);
  const brief = turnBriefParts({ plan, skill, fastNote, surface: input.surface }).join("\n\n");
  return { brief, plan, skill: skill?.name ?? null, ...(routingTrace ? { routing: routingTrace } : {}), ...(raisedAdvisory ? { raisedAdvisory } : {}) };
}

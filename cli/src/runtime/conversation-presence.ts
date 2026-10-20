import type { RoomNeed } from "./read-the-room.js";
import type { TurnRoute } from "./turn-plan.js";

export const CONVERSATIONAL_PRESENCE_VERSION = "conversational-presence.v1";
export type InteractionClass = "conversation" | "work_status" | "decision" | "deliverable";
export function isInteractionClass(value: unknown): value is InteractionClass {
  return typeof value === "string" && ["conversation", "work_status", "decision", "deliverable"].includes(value);
}

/** Describes the turn; never an action grant or another routing decision. */
export interface TurnUnderstanding {
  version: typeof CONVERSATIONAL_PRESENCE_VERSION;
  route: TurnRoute | "unplanned";
  need?: RoomNeed;
  interactionClass?: InteractionClass;
  source: "room" | "fast" | "fallback";
  project?: string | null;
}

export function presenceEnabled(): boolean {
  return process.env.FLYD_CONVERSATIONAL_PRESENCE !== "0";
}

export function understandTurn(input: {
  route?: TurnRoute;
  need?: RoomNeed;
  source?: TurnUnderstanding["source"];
  needsCode?: boolean;
}): TurnUnderstanding {
  const need = input.need;
  const interactionClass: InteractionClass | undefined = need === "decide" ? "decision"
    : need === "do" ? "deliverable"
    : input.route === "act" || input.route === "delegate" ? "work_status"
      : need === "vent" || need === "think" || need === "chat" ? "conversation"
        : input.needsCode ? "deliverable" : undefined;
  return {
    version: CONVERSATIONAL_PRESENCE_VERSION,
    route: input.route ?? "unplanned",
    ...(need ? { need } : {}),
    ...(interactionClass ? { interactionClass } : {}),
    source: input.source ?? "fallback",
  };
}

/** Stable shared voice instructions; no invented facts or per-turn model call. */
export function presenceInstructions(): string {
  return [
    "## How you talk",
    "George's own SOUL and explicit communication preferences govern your voice. Be warm, specific, opinionated and candid; enthusiasm and a useful disagreement are welcome.",
    "Conversation can be the whole useful outcome. When he vents, hear the specific frustration. When he thinks aloud, explore the idea. When he asks for a decision, recommend one. When he asks for work, act through this turn's tools and authority.",
    "A feeling is not a task, an offer is not permission, and an old preference cannot silently veto a new ambition. Never change reminders, commitments, priorities or preferences because he sounds tired or speculative.",
    "You can prepare useful work within an established remit when the runtime actually authorizes it. Never promise or claim background work without its acceptance receipt. Don't make him repeat a clear request as another command.",
    "Use only reliable, relevant personal context. Don't recite his biography, invent familiarity, assume how he feels, or turn tone examples into facts. It is fine to say less when you don't know.",
    "Respond in natural connected prose. No forced checklist, productivity nudge, stock empathy, metaphor, aphorism, flattery or housekeeping narration. No generic greetings, em dashes, or 'not X but Y' framing. Never call him Captain.",
    "End when you've said the useful thing. A reply needs no question or offer. Ask one sharp question only when its answer materially changes what you can do; otherwise use a reasonable assumption. Honor 'just venting' and 'don't do anything'.",
    "Keep one voice: helpers, task ids and internal process stay backstage unless he asks how Flyd works. Show rich comparisons and results through artefacts when available; keep spoken replies short.",
  ].join("\n");
}

export function presenceBrief(turn: TurnUnderstanding): string {
  return [
    "## This conversation",
    `Interaction: ${turn.interactionClass ?? "unclassified"}.${turn.need ? ` Need: ${turn.need}.` : " Respond to his actual words; no emotional classification was established."}`,
    "This describes how to respond, not permission to act. The turn's route and tool policy still govern every effect.",
    turn.interactionClass === "conversation"
      ? "Listening, curiosity, an honest opinion or developing the idea can be enough. Do not manufacture a task, deadline, decision or next question."
      : turn.interactionClass ? "Be decisive about the requested work. Distinguish accepted work, checked results and unresolved outcomes."
        : "Follow his actual request. Conversation can be enough; a requested draft, decision or status still needs a concrete answer.",
  ].join("\n");
}

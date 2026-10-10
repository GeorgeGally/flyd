import { localDay } from "../council/memory-store.js";
import { TURN_ROUTES, type TurnRoute } from "./turn-plan.js";

// Before Flyd answers, it reads the room: what George needs from this
// message, how he seems, which one or two things Flyd knows actually matter,
// and what to leave unsaid. The answer is then written from that reading
// with only the knowledge it selected — Flyd knows everything, mentions
// little. Background helpers (advisors, news, crew) hand their findings in
// here as private notes; Flyd decides whether any belongs in this moment.

export type RoomNeed = "vent" | "think" | "decide" | "do" | "ask" | "chat";
export const ROOM_RUBRIC_VERSION = "room-read.v2";

export interface RoomRead {
  need: RoomNeed;
  mode: "companion" | "operator";
  stance: string;
  avoid: string;
  length: "short" | "medium" | "long";
  use: string[];
  raise: string | null;
  /** Something concrete Flyd can start right now, in the background, that would genuinely help. */
  act: string | null;
  /** What kind of turn this is; the harness enforces it (turn-plan.ts). */
  route: TurnRoute;
  /** The points the reply must address, whatever its length. */
  cover: string[];
}

export interface RoomItem { id: string; text: string }

export interface RoomInput {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  now: Date;
  core: string;
  knowledge: RoomItem[];
  notes: RoomItem[];
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function roomPrompt(input: RoomInput): string {
  const when = input.now.toLocaleString("en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false });
  const recent = input.history.slice(-6).map((turn) => `${turn.role === "user" ? "George" : "Flyd"}: ${clip(turn.content.replace(/\s+/g, " "), 300)}`).join("\n");
  return [
    "You are the part of Flyd that reads the room before it answers George. Flyd is his second brain and closest aide.",
    `It is ${when} (${localDay(input.now)}).`,
    "",
    "Who George is:",
    input.core || "(little known yet)",
    "",
    recent ? `Recent conversation:\n${recent}\n` : "",
    `George just said: """${clip(input.message, 1_500)}"""`,
    "",
    "Things Flyd knows (ids in brackets):",
    ...input.knowledge.map((item) => `[${item.id}] ${clip(item.text, 200)}`),
    "",
    "Private notes from Flyd's background work (never quote these as coming from anyone; Flyd may bring one up in its own words only if it truly helps now):",
    ...(input.notes.length ? input.notes.map((item) => `[${item.id}] ${clip(item.text, 220)}`) : ["(none)"]),
    "",
    "Decide:",
    "- need: vent (wants to be heard), think (wants a sparring partner), decide (wants a recommendation), do (wants something done), ask (wants information), chat (small talk).",
    "- mode: operator only when answering needs his code, repos, files, or work state inspected; otherwise companion.",
    "- stance: 1-2 sentences on how a wise friend who knows him would respond right now — the angle, the tone, what he actually needs underneath the words.",
    "- avoid: what not to say or do here (e.g. reciting his achievements back at him, listing projects, to-do lists, lecturing, explaining process).",
    "- length: short (1-3 sentences), medium (a short paragraph or two), long (only for plans, drafts, research).",
    "- use: the 0-4 knowledge ids that genuinely change the answer. Knowing is not a reason to mention; fewer is better.",
    "- raise: one private note id worth weaving in, or null. Default null; only if it serves what he needs right now.",
    "- route: what this turn is. answer = he wants to know, hear, or think something through; answer from what you know or can look up, and change nothing. clarify = what he wants is genuinely unclear and a wrong guess would waste real effort; ask one question. act = he asked for something done now, outside any codebase (a reminder, a note, a setting, a schedule), or anything that needs his yes before it runs (installing, running a command, sending): only a live turn can ask him. delegate = any change at all to code in one of his repos (a feature, a fix, a typo), or other real work that takes minutes or more and needs no approval along the way (a long document, research across sources, generating and judging things); it gets handed off with checkable done_when points. Anything you can write well in the reply itself (an email, a message, a short plan) is answer. When in doubt between answer and act, answer and offer.",
    "- cover: the 1-3 things the reply must address for him to have what he asked for (e.g. for \"anything I should know before tomorrow?\": tomorrow's calendar and reminders; the open loose end that matters). Short replies still cover these.",
    "- act: for act or delegate only, the concrete piece of work to start (e.g. generate two new DIR sets with better prompts and judge them; draft the follow-up email). Only local, reversible work. null for answer and clarify.",
    "",
    'Reply with JSON only: {"need":"...","mode":"...","route":"...","cover":["..."],"stance":"...","avoid":"...","length":"...","use":["k1"],"raise":null,"act":null}',
  ].join("\n");
}

const NEEDS: RoomNeed[] = ["vent", "think", "decide", "do", "ask", "chat"];

export function parseRoom(text: string, input: Pick<RoomInput, "knowledge" | "notes">): RoomRead | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    const known = new Set(input.knowledge.map((item) => item.id));
    const noteIds = new Set(input.notes.map((item) => item.id));
    const stance = String(raw.stance ?? "").trim();
    if (!stance) return null;
    return {
      need: NEEDS.includes(raw.need as RoomNeed) ? raw.need as RoomNeed : "chat",
      mode: raw.mode === "operator" ? "operator" : "companion",
      stance: clip(stance, 400),
      avoid: clip(String(raw.avoid ?? "").trim(), 300),
      length: raw.length === "short" || raw.length === "long" ? raw.length : "medium",
      use: Array.isArray(raw.use) ? raw.use.map(String).filter((id) => known.has(id)).slice(0, 4) : [],
      raise: typeof raw.raise === "string" && noteIds.has(raw.raise) ? raw.raise : null,
      act: typeof raw.act === "string" && raw.act.trim() ? clip(raw.act.trim(), 300) : null,
      // A malformed action reading cannot establish authority to mutate.
      route: TURN_ROUTES.includes(raw.route as TurnRoute) ? raw.route as TurnRoute : raw.need === "do" ? "clarify" : "answer",
      cover: Array.isArray(raw.cover) ? raw.cover.map((item) => clip(String(item ?? "").trim(), 160)).filter(Boolean).slice(0, 3) : [],
    };
  } catch {
    return null;
  }
}

/** Read the room; null when the model is slow or unsure, so the caller falls back to its defaults. */
export async function readTheRoom(input: RoomInput, complete: (prompt: string) => Promise<string>, timeoutMs = 12_000): Promise<RoomRead | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const slow = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const reply = await Promise.race([complete(roomPrompt(input)), slow]);
    return reply === null ? null : parseRoom(reply, input);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The brief the answer is written from. */
export function roomBrief(room: RoomRead, knowledge: RoomItem[], notes: RoomItem[]): string {
  const used = knowledge.filter((item) => room.use.includes(item.id));
  const raised = notes.find((item) => item.id === room.raise);
  const length = { short: "1-3 sentences", medium: "a short paragraph or two", long: "as long as the job needs, and no longer" }[room.length];
  return [
    "## This moment",
    `He needs: ${room.need}. ${room.stance}`,
    room.avoid ? `Avoid: ${room.avoid}` : "",
    `Length: ${length}.`,
    used.length ? `What you know that matters here (use it; don't announce that you know it):\n${used.map((item) => `- ${item.text}`).join("\n")}` : "",
    room.act && (room.route === "act" || room.route === "delegate") ? `The work to start: ${room.act}` : "",
    raised ? `Something from your own background thinking you may weave in, in your own words, if it fits naturally: ${raised.text}` : "",
  ].filter(Boolean).join("\n");
}

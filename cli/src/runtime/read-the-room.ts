import { localDay } from "../council/memory-store.js";

// Before Flyd answers, it reads the room: what George needs from this
// message, how he seems, which one or two things Flyd knows actually matter,
// and what to leave unsaid. The answer is then written from that reading
// with only the knowledge it selected — Flyd knows everything, mentions
// little. Background helpers (advisors, news, crew) hand their findings in
// here as private notes; Flyd decides whether any belongs in this moment.

export type RoomNeed = "vent" | "think" | "decide" | "do" | "ask" | "chat";

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
    "- act: one concrete piece of work Flyd could start right now in the background that would genuinely move things for him (e.g. generate two new DIR sets with better prompts and judge them; draft the follow-up email; research three venues). Only local, reversible work. Venting is not a reason for null: if real work would lift the thing he's down about, name it. null only when nothing concrete would help.",
    "",
    'Reply with JSON only: {"need":"...","mode":"...","stance":"...","avoid":"...","length":"...","use":["k1"],"raise":null,"act":null}',
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
    room.act ? `Worth starting now: ${room.act} If it fits what he said, start it with background_task and tell him in a line what you're doing; if you're not sure it's wanted, offer it in one line instead.` : "",
    raised ? `Something from your own background thinking you may weave in, in your own words, if it fits naturally: ${raised.text}` : "",
  ].filter(Boolean).join("\n");
}

import { readSoul } from "../lib/soul.js";

// Flyd says hello. The session briefing gathers facts — due reminders,
// the council's advisories, today's stories, crew work, what Flyd has
// promised — and Flyd turns them into what a thoughtful aide would say
// as George sits down: a few warm sentences about what matters today, not a
// dashboard. The full list stays one command away in /brief.

export interface GreetingInput {
  briefing: string[];
  hypothesis?: string | null;
  now: Date;
  /** USER.md: who George is and what he has asked of Flyd. His standing instructions win. */
  profile?: string | null;
}

const PROFILE_CHARS = 4_000;

export function greetingPrompt(input: GreetingInput): string {
  const day = input.now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const time = input.now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const morning = input.now.getHours() < 12;
  const freshNews = input.briefing.some((line) => /^Today's news, not yet told him/.test(line.trim()));
  const profile = input.profile?.trim() ? input.profile.trim().slice(0, PROFILE_CHARS) : "";
  return [
    readSoul(),
    "",
    "George has just sat down and opened you. The header already said good morning/afternoon; you speak next, as his PA.",
    `It is ${day}, ${time}.`,
    "A good PA doesn't wait to be asked: walk in with what he needs to know and what you've already done, then offer the next useful thing.",
    ...(profile ? ["", "Who he is and what he has asked of you (his standing instructions override the rules below):", profile] : []),
    "",
    "What you know right now:",
    ...input.briefing.map((line) => `- ${line.trim()}`),
    ...(input.hypothesis?.trim() ? [`- Flyd's read on his work: ${input.hypothesis.trim()}`] : []),
    "",
    "Rules:",
    ...(morning && freshNews
      ? ["- It's morning and he hasn't had the news: lead with it. The two or three stories that matter most to him, each with a few words on why it matters to him specifically. Then his day: calendar, anything due."]
      : ["- Lead with what matters to him right now: something due or overdue, what's on his calendar next, a decision with a clock on it, or news he hasn't heard. If nothing is pressing, say so lightly."]),
    "- Mention good news from work you did for him while he was away, if any.",
    "- End with one concrete offer you can act on now, tied to something above (\"Want me to…?\"), unless nothing fits.",
    "- Plain prose, up to 6 short sentences, under 120 words. No lists, no headings, no labels like 'Strategist:' or 'Crew:'. Don't open with 'Hello' or his name.",
    "- Weekends and evenings are lighter: don't nag about work, commits, or backlogs.",
    "- Skip your own plumbing (memory, write paths, workstream counts, task ids, commits) unless he must act on it. Never name internal helpers.",
    "- Never invent anything that is not in these notes. No sign-off.",
    "- If there is more in the notes than you mentioned, end with: (/brief has the rest.)",
    "",
    "Reply with the text only.",
  ].join("\n");
}

/** Accept only plain, short prose; anything list-shaped or empty falls back. */
export function parseGreeting(text: string): string | null {
  const cleaned = text.trim().replace(/^["“]|["”]$/g, "").trim();
  if (!cleaned || cleaned.length > 900) return null;
  if (/^\s*(?:[-*•]|\d+\.)\s/m.test(cleaned) || /^#/m.test(cleaned)) return null;
  return cleaned.replace(/\s*\n\s*/g, " ");
}

/** What to say when the Muse is unavailable: the urgent facts, plainly, and a pointer. */
export function fallbackGreeting(briefing: string[]): string {
  const urgent = briefing.filter((line) => /^(?:Overdue|Due today):/.test(line.trim()));
  const rest = briefing.length - urgent.length;
  const parts = [...urgent.map((line) => `${line.trim()}.`)];
  if (rest > 0) parts.push("A few other things are waiting in /brief.");
  if (parts.length === 0) parts.push("Nothing pressing. What's on your mind?");
  return parts.join(" ");
}

export async function museGreeting(
  input: GreetingInput,
  complete: (prompt: string) => Promise<string>,
): Promise<string> {
  if (input.briefing.length === 0 && !input.hypothesis?.trim()) return "What's on your mind?";
  try {
    return parseGreeting(await complete(greetingPrompt(input))) ?? fallbackGreeting(input.briefing);
  } catch {
    return fallbackGreeting(input.briefing);
  }
}

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
}

export function greetingPrompt(input: GreetingInput): string {
  const day = input.now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const time = input.now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return [
    readSoul(),
    "",
    "George has just sat down and opened you. You have already said hello.",
    `It is ${day}, ${time}.`,
    "Write what you would say next, the way a sharp PA who knows him talks when he sits down — not a report.",
    "",
    "What you know right now (raw notes, most of it can wait):",
    ...input.briefing.map((line) => `- ${line.trim()}`),
    ...(input.hypothesis?.trim() ? [`- Flyd's read on his work: ${input.hypothesis.trim()}`] : []),
    "",
    "Rules:",
    "- 2 to 4 short sentences, under 70 words, plain prose. No lists, no headings, no labels like 'Strategist:' or 'Crew:'.",
    "- Lead with the one thing that genuinely matters to him today: something due or overdue, a person, a decision with a clock on it. If nothing is pressing, say so lightly.",
    "- Then, if it fits, one thing he might enjoy or find useful — a story worth his time (say why in a few words), or good news from work Flyd did for him.",
    "- Weekends and evenings are lighter: don't nag about work, commits, or backlogs.",
    "- Skip your own plumbing (memory, write paths, workstream counts, task ids, commits) unless he must act on it. Never name internal helpers.",
    "- Never invent anything that is not in the notes. No greeting — you already said hello. No sign-off.",
    "- If there is more in the notes than you mentioned, end with: (/brief has the rest.)",
    "",
    "Reply with the text only.",
  ].join("\n");
}

/** Accept only plain, short prose; anything list-shaped or empty falls back. */
export function parseGreeting(text: string): string | null {
  const cleaned = text.trim().replace(/^["“]|["”]$/g, "").trim();
  if (!cleaned || cleaned.length > 600) return null;
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

import { PROFILE_SECTIONS, readUserProfile, type ProfileSection } from "../lib/user-profile.js";
import { parseFacts, type ProfileFact } from "./profile-bootstrap.js";

// Flyd learns about George from what he says, the way a PA would: durable
// facts (people, routines, preferences, constraints) go into USER.md in the
// background after a turn. Questions and task chatter never qualify.

const FIRST_PERSON = /\b(?:i|i'm|im|i've|ive|i'd|my|mine|me|we|our)\b/i;
const QUESTION_ONLY = /^(?:so\s+)?(?:how|why|what|when|where|who|which|is|are|do|does|can|could|should|would|will)\b[^.!]*\??\s*$/i;

/** Cheap gate before spending a model call: must be George talking about himself. */
export function mightStatePersonalFact(message: string): boolean {
  const text = message.trim();
  if (text.length < 12 || text.length > 2_000) return false;
  if (QUESTION_ONLY.test(text)) return false;
  return FIRST_PERSON.test(text);
}

export function learningPrompt(message: string, profile: string | null): string {
  return [
    "George just said this to his personal assistant:",
    `"""${message}"""`,
    "Extract only DURABLE facts worth remembering for months about George and the people in his life: names and relationships, where they live, their needs (e.g. a guest's diet), and George's work, preferences, routines, goals, constraints. File facts about other people under People.",
    "Ignore requests, questions, one-off tasks, moods, and anything about software internals. Do not repeat facts already in his profile.",
    `Sections: ${PROFILE_SECTIONS.join(", ")}.`,
    `Current profile:\n${profile ?? "(empty)"}`,
    'Reply with JSON only: {"facts": [{"section": "...", "fact": "<short third-person sentence>"}]} — usually [], at most 3.',
  ].join("\n\n");
}

export interface LearnDependencies {
  complete(prompt: string): Promise<string>;
  addFact(fact: string, section: ProfileSection): boolean;
  readProfile?: () => string | null;
}

export async function learnFromMessage(message: string, deps: LearnDependencies): Promise<ProfileFact[]> {
  if (!mightStatePersonalFact(message)) return [];
  const facts = parseFacts(await deps.complete(learningPrompt(message, (deps.readProfile ?? readUserProfile)()))).slice(0, 3);
  return facts.filter(({ fact, section }) => deps.addFact(fact, section));
}

/** Fire-and-forget hook for live chat turns. */
export function learnInBackground(message: string): void {
  if (process.env.VITEST || process.env.FLYD_PROFILE_AUTOLEARN === "0") return;
  if (!mightStatePersonalFact(message)) return;
  void (async () => {
    const [{ query }, { chatModelChain }, profile] = await Promise.all([
      import("../lib/llm.js"),
      import("../lib/config.js"),
      import("../lib/user-profile.js"),
    ]);
    const chain = chatModelChain();
    // The cheapest configured model is plenty for extraction; fall back to the chain head.
    const model = process.env.FLYD_PROFILE_LEARN_MODEL?.trim() || chain[chain.length - 1];
    await learnFromMessage(message, {
      complete: (prompt) => query(prompt, model),
      addFact: (fact, section) => profile.addUserProfileFact(fact, { section }),
    });
  })().catch(() => undefined);
}

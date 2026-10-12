// In the conversation window Flyd is the one speaking to him, and Flyd calls
// him "sir". Firstmate writes to Flyd, and calls Flyd "Captain"; anything of
// firstmate's that the window shows is put in Flyd's words first, so a
// "Captain, …" line never reaches him verbatim. Code, links and names that
// merely contain the word ("captain-held", data/captain-shared.md) are left as
// written: rewritten, they would point nowhere.

const FENCE = /(```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+|\]\([^)\s]*\))/g;
/** The word on its own, not part of a path, file or name: "captain." ends a sentence, "captain.ts" is a file. */
const ALONE = String.raw`(?![\w/-]|\.\w)`;
const THE_CAPTAIN = new RegExp(String.raw`(?<![\w/.-])(?:the|our) captain${ALONE}`, "gi");
const LEADING_CAPTAIN = new RegExp(String.raw`(^\s*(?:[-*+]\s+|>\s*)?|[.!?]\s+)captain${ALONE}`, "gim");
const CAPTAIN = new RegExp(String.raw`(?<![\w/.-])captain${ALONE}`, "gi");

function rephrase(prose: string): string {
  return prose
    // "the captain's call" → "your call"; "for the captain" → "for you".
    .replace(/(?<![\w/.-])(?:the |our )?captain's\b/gi, (match) => (/^[A-Z]/.test(match) ? "Your" : "your"))
    .replace(THE_CAPTAIN, (match) => (/^[A-Z]/.test(match) ? "You" : "you"))
    // "Captain, the filter…" → "Sir, the filter…"; "Done, Captain." → "Done, sir."
    .replace(LEADING_CAPTAIN, (_match, lead: string) => `${lead}Sir`)
    .replace(CAPTAIN, "sir");
}

/** Firstmate's words as Flyd says them to him: addressed to "sir", never "Captain". Code and links are left as written. */
export function inFlydsVoice(text: string): string {
  return text
    .split(FENCE)
    .map((part, index) => (index % 2 === 1 ? part : rephrase(part)))
    .join("");
}

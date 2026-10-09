// In the conversation window Flyd is the one speaking to him, and Flyd calls
// him "sir". Firstmate writes to Flyd, and calls Flyd "Captain"; anything of
// firstmate's that the window shows is put in Flyd's words first, so a
// "Captain, …" line never reaches him verbatim.

const FENCE = /(```[\s\S]*?```|`[^`\n]*`)/g;

function rephrase(prose: string): string {
  return prose
    // "the captain's call" → "your call"; "for the captain" → "for you".
    .replace(/\b(?:the |our )?captain's\b/gi, (match) => (/^[A-Z]/.test(match) ? "Your" : "your"))
    .replace(/\b(?:the|our) captain\b/gi, (match) => (/^[A-Z]/.test(match) ? "You" : "you"))
    // "Captain, the filter…" → "Sir, the filter…"; "Done, Captain." → "Done, sir."
    .replace(/(^\s*(?:[-*+]\s+|>\s*)?|[.!?]\s+)captain\b/gim, (_match, lead: string) => `${lead}Sir`)
    .replace(/\bcaptain\b/gi, "sir");
}

/** Firstmate's words as Flyd says them to him: addressed to "sir", never "Captain". Code is left as written. */
export function inFlydsVoice(text: string): string {
  return text
    .split(FENCE)
    .map((part, index) => (index % 2 === 1 ? part : rephrase(part)))
    .join("");
}

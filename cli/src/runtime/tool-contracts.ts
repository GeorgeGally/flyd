// Checks on a call's arguments against what the tool is for, run by the
// harness before the tool does anything. A tool whose description overlaps
// another's gets chosen by coin-flip; the check turns a wrong pick into a
// correction the model can act on in the same turn.

/** How George wants Flyd to write, in the words speaking_style actually supports. */
const SUPPORTED_STYLE = /\b(?:plain|literal|simple|simplified)\b[^.\n]{0,40}\benglish\b|\bste[- ]?100\b|\bsimplified technical english\b/i;
const ABOUT_HOW_FLYD_WRITES = /\b(?:talk|speak|write|reply|respond|answer|word)(?:s|ing)?\b/i;

/** null when the call fits its tool; otherwise what to do instead. */
/** Steps the crew can't take; they have to be approved as after_land instead. */
const BEYOND_THE_CREW = /\b(?:deploy(?:s|ed|ing|ment)?|push(?:es|ed|ing)?\s+(?:it|this|that|to|the)|publish(?:es|ed|ing)?|go(?:es)? live|ship(?:s|ped)? (?:it )?to (?:prod|production|live))\b/i;

export function contractError(name: string, input: Record<string, unknown>): string | null {
  if (name === "start_coding_task") {
    const steps = Array.isArray(input.after_land) ? input.after_land.map(String) : [];
    const beyond = String(input.outcome ?? "").match(BEYOND_THE_CREW);
    if (beyond && steps.length === 0) {
      return `Error: the outcome includes "${beyond[0]}", which the crew can't do (it builds, tests and commits on its own branch). Put push/deploy in after_land so George approves it now, or drop it from the outcome.`;
    }
  }
  if (name === "remember") {
    const text = String(input.text ?? "");
    if (SUPPORTED_STYLE.test(text) && ABOUT_HOW_FLYD_WRITES.test(text)) {
      return "Error: that's how he wants you to write, which speaking_style sets (style asd-ste100 is plain, literal Simplified Technical English). Call speaking_style instead; remember is for facts about his life.";
    }
  }
  return null;
}

// George's standing rule for code: he always works on main, and his ~/Documents
// copy and GitHub are always in sync. Committing, merging finished work into main,
// syncing and pushing it to his own GitHub are therefore routine, never his call,
// however the staff word the ask ("needs George's approval to push"). Anything
// that goes live, can't be taken back, costs money, touches access or reaches
// someone else's repo still is.

export const ROUTINE_GIT_RULE = "George always works on main, and his ~/Documents copy and GitHub are always in sync, so committing, merging, syncing and pushing finished work is routine.";

/** The git steps the rule covers. */
const GIT_STEP = /\b(?:push(?:es|ed|ing)?|merg(?:e|es|ed|ing)|sync(?:s|ed|ing)?|land(?:s|ed|ing)?|fast-?forward(?:s|ed|ing)?|commit(?:s|ted|ting)?)\b/i;

/** Still his, whatever else the ask says. */
const STILL_HIS = /\b(?:deploy|publish|releas|go(?:es|ing)? live|live site|production|prod\b|force|delet|wip(?:e|ing)\b|purg|destroy|reset|revert|roll ?back|overwrit|discard|pay|purchas|buy|spend|cost|bill|charg|invoice|contract|secret|token|password|credential|api key|secur|login|access|collaborator|ssh key|sudo|public|share|client|customer|whatsapp|email|tweet|upstream|fork|someone else|third[- ]party|open[- ]source|other people)/i;

/** A choice between options: the work's own engineering call, never settled as a plain go-ahead. */
const EITHER_OR = /\bor\b|\b(?:which|pick|choose|instead)\b/i;

/** The work is not finished and green. */
const FAILING = /\b(?:fail(?:s|ed|ing|ures?)?|broken|red|not (?:yet )?(?:green|passing))\b/i;

/**
 * True when the ask is a plain go-ahead for a routine git step on George's own finished work:
 * no either-or, and nothing in the ask says it is failing. Pure.
 */
export function routineGitStep(ask: string, context = ""): boolean {
  const asked = ask.replace(/\s+/g, " ").trim();
  const said = `${asked} ${context.replace(/\s+/g, " ").trim()}`;
  return GIT_STEP.test(said) && !STILL_HIS.test(said) && !EITHER_OR.test(asked) && !FAILING.test(asked);
}

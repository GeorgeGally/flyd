// George's standing rule for code: he always works on main, and his ~/Documents
// copy and GitHub are always in sync. Committing, merging finished work into main,
// syncing and pushing it to his own GitHub are therefore routine, never his call,
// however the staff word the ask ("needs George's approval to push"). Anything
// that goes live, can't be taken back, costs money, touches access or reaches
// someone else's repo still is.

export const ROUTINE_GIT_RULE = "George always works on main, and his ~/Documents copy and GitHub are always in sync, so committing, merging, syncing and pushing finished work is routine.";

/** The git steps the rule covers. */
const GIT_STEP = /\b(?:push(?:es|ed|ing)?|merg(?:e|es|ed|ing)|sync(?:s|ed|ing)?|land(?:s|ed|ing)?|fast-?forward(?:s|ed|ing)?|commit(?:s|ted|ting)?)\b/i;

/** Going live as the action itself ("deploy to production", "push and deploy", "go live"), never as a description ("the deploy script fix"). */
export const DEPLOY_ACTION = /(?:^|[.;:,?!]\s*|\b(?:and|then|to|will|can|should|shall|please|i'?ll|we'?ll)\s+)(?:deploy|publish|release|go live)\b|\b(?:push|ship|deploy)\w*\s+(?:it\s+)?to (?:prod|production|live)\b/im;

/** Still his, whatever else the ask says. */
const STILL_HIS = /\b(?:force|delet|wip(?:e|ing)\b|purg|destroy|reset|revert|roll ?back|overwrit|discard|pay|purchas|buy|spend|cost|bill|charg|invoice|contract|secret|token|password|credential|api key|secur|login|access|collaborator|ssh key|sudo|public|share|client|customer|whatsapp|email|tweet|upstream|fork|someone else|third[- ]party|open[- ]source|other people)/i;

/** A choice between options: the work's own engineering call, never settled as a plain go-ahead. */
const EITHER_OR = /\bor\b|\b(?:which|pick|choose|instead)\b/i;

/** Tests, checks, CI, lint or the build failing now ("Lint failing", "CI red", "two tests still fail", "not green"). */
const STILL_FAILING = /\bstill (?:fail(?:s|ing)?|red|broken)\b|\b(?:tests?|checks?|ci|lint|build|suite)\W+(?:[\w'-]+\W+){0,2}?(?:fail(?:s|ing)?|red|broken)\b|\bnot (?:yet )?(?:green|passing)\b/gi;

/** Said of a failure that is past ("lint was failing", "no longer fails"). */
const PAST = /\b(?:no longer|fixed|resolved|was|were|used to)\W+(?:[\w'-]+\W+){0,2}$/i;

function failingNow(text: string): boolean {
  return [...text.matchAll(STILL_FAILING)].some((found) => {
    const failure = /(?:fail(?:s|ing)?|red|broken|green|passing)$/i.exec(found[0])!;
    return !PAST.test(text.slice(0, found.index! + failure.index));
  });
}

/**
 * True when the ask is a plain go-ahead for a routine git step on George's own finished work:
 * no either-or, and nothing in the ask or the staff's report says it is failing. Pure.
 */
export function routineGitStep(ask: string, context = ""): boolean {
  const asked = ask.replace(/\s+/g, " ").trim();
  const said = `${asked} ${context.replace(/\s+/g, " ").trim()}`;
  return GIT_STEP.test(said) && !STILL_HIS.test(said) && !EITHER_OR.test(asked) && !DEPLOY_ACTION.test(said) && !failingNow(said);
}

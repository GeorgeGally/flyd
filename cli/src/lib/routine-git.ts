// George's standing rule for code: he always works on main, and his ~/Documents
// copy and GitHub are always in sync. Committing, merging finished work into main,
// syncing and pushing it to his own GitHub are therefore routine, never his call,
// however the staff word the ask ("needs George's approval to push") and whatever
// words describe the work. Only going live, a force push, someone else's repo or
// failing tests and checks still are.

export const ROUTINE_GIT_RULE = "George always works on main, and his ~/Documents copy and GitHub are always in sync, so committing, merging, syncing and pushing finished work is routine.";

/** The git steps the rule covers. */
const GIT_STEP = /\bpush(?:es|ed|ing)?\b(?!\s+(?:notifications?|messages?|tokens?|alerts?)\b)|\bmerg(?:e|es|ed|ing)\b(?!\s+(?:conflicts?|sort|requests?|tools?)\b)|\b(?:land(?:s|ed)?|fast-?forward(?:s|ed|ing)?)\b|\bcommit(?:s|ted|ting)?\b(?!\s+(?:hook|message|msg|history|log|hash|sha|id)s?\b)|\bsync(?:s|ed|ing)?\s+(?:[\w'-]+\s+){0,2}?(?:to|with)\s+(?:github|origin|main|remote|git)\b/i;

/** Going live as a step of its own ("push and deploy", "then publish", "push it to production", `npm publish`), never a word describing the work ("release notes"). */
export const DEPLOY_ACTION = /\b(?:and|then)\s+(?:then\s+)?(?:deploy|publish|release|go live)\b|\b(?:push|ship|deploy)\w*\s+(?:it\s+)?to (?:prod|production|live)\b|\b(?:vercel|netlify|firebase|wrangler|flyctl|fly)\s+deploy\b|\b(?:npm|pnpm|yarn)\s+publish\b|\bgh release create\b/i;

/** Still his: a force push, or a push to someone else's repo. */
const STILL_HIS = /\bforce[- ]?push\w*|--force\b|\bpush\w*\s+(?:\S+\s+)?-f\b|(?<!--set-)\bupstream\b|\b(?:forks?|forked|someone else(?:'s)?|other people(?:'s)?|third[- ]party|another remote|their repo)\b/i;

/** A step that destroys or rewrites work anywhere in the ask ("Needs approval to revert the last commit and push"); only a word naming the work itself is exempt ("the password reset fix"). */
const DESTRUCTIVE = /\b(?:revert|reset|delet|drop|amend|force|filter-branch|rebase -i|rewrit\w* (?:the )?history)\w*\b(?!(?:-[\w']+|\s+(?!(?:the|a|an|this|that|these|those|my|our|his|her|their|last|old|all|any|some)\b)[\w'-]+)?[\s-]+(?:fix|fixes|bug|bugs|button|shadow|feature|flow|page|form|link|modal|screen|tests?|copy)\b)/i;

/** Secret material the ask itself commits or pushes ("commit the .env", "push the API key"). */
const SECRET = /(?:^|\s)\.env\b|\b(?:(?:commit|push|add)\w*|check in|with|including|containing)\s+(?:(?:the|a|my|his|our|these|those)\s+)?(?:api[- ]?keys?|secrets?|credentials?|tokens?|passwords?|private keys?)(?=\s*(?:$|[.,;:?!]|(?:and|to|into|with|in|file|files)\b))/i;

/** A choice between options: the work's own engineering call, never settled as a plain go-ahead. */
const EITHER_OR = /\bor\b|\b(?:which|pick|choose|instead)\b/i;

/** Tests, checks, CI, lint or the build failing now ("Lint failing", "CI red", "two tests still fail", "not green"). */
const STILL_FAILING = /\bstill (?:fail(?:s|ing)?|red|broken)\b|\b(?:tests?|checks?|ci|lint|build|suite)\W+(?:[\w'-]+\W+){0,2}?(?:fail(?:s|ing)?|red|broken)\b|\bnot (?:yet )?(?:green|passing)\b/gi;

/** Said of a failure that is past or none ("lint was failing", "no longer fails", "0 failing"). */
const PAST = /\b(?:fixed|resolved|was|were|used to|0|no|none|nothing|zero)(?:[\s-]+[\w'-]+){0,2}[\s-]+$/i;

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
  return GIT_STEP.test(said) && !STILL_HIS.test(said) && !DESTRUCTIVE.test(asked) && !SECRET.test(asked) && !EITHER_OR.test(asked) && !DEPLOY_ACTION.test(said) && !failingNow(said);
}

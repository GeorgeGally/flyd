import { existsSync } from "node:fs";
import { homedir } from "node:os";

// A last look before an answer reaches George: does it claim work that no
// tool did this turn, or point at files that are not there? Models complete
// the pattern — "I wrote the spec, it's in ~/Documents/Glasses" — and it reads
// as fact. This catches that class mechanically and sends the answer back once.

// Finished work ("I've drafted it") needs a tool that did it this turn.
const DONE_CLAIM = /\bI(?:'ve| have| just)?\s+(?:wrote|written|created|saved|drafted|built|set up|scheduled|added|sent|booked|put together|taken (?:them|it) off|cancelled|canceled)\b/i;
// Work under way ("I've started", "I'm drafting") may rest on a handed-off job.
const STARTED_CLAIM = /\bI(?:'ve| have| just)?\s+(?:started|kicked off|begun|queued)\b|\bI(?:'m| am) (?:now )?(?:already )?(?:drafting|building|going through|working (?:on|through)|writing|generating|putting together|pulling together)\b/i;
/** Tools that start work which finishes later: they back "I've started", never "I've drafted". */
const DELEGATIONS = new Set(["background_task", "start_coding_task"]);
/**
 * After a hand-off, any first-person perfect ("I've left it on", "I've made
 * sure…") describes work nobody has done yet. Matched by grammar, not a verb
 * list: the list only ever catches last week's phrasing.
 */
const PERFECT_CLAIM = /\bI(?:'ve| have)\s+(?:also\s+|already\s+)?(?!started\b|kicked\b|begun\b|queued\b|handed\b|passed\b|asked\b|got\b)[a-z]+(?:ed|en|t|de|ne|ft|ht)\b/i;
const LOCAL_PATH = /(?:~|\/Users\/[^/\s]+)\/[^\s`'"),;:]+/g;

export interface ClaimToolCall { name: string; input: Record<string, unknown>; succeeded: boolean }

export function unsupportedClaims(
  answer: string,
  toolCalls: ClaimToolCall[],
  isMutating: (name: string, input: Record<string, unknown>) => boolean,
  exists: (path: string) => boolean = existsSync,
): string[] {
  const problems: string[] = [];
  const acted = toolCalls.filter((call) => call.succeeded && isMutating(call.name, call.input));
  const didItNow = acted.some((call) => !DELEGATIONS.has(call.name));
  const onlyHandedOff = acted.length > 0 && !didItNow && toolCalls.every((call) => !call.succeeded || DELEGATIONS.has(call.name));
  if ((DONE_CLAIM.test(answer) || (onlyHandedOff && PERFECT_CLAIM.test(answer))) && !didItNow) {
    problems.push(acted.length
      ? "It says the work is done, but you only started it in the background; nothing is finished or on disk yet. Say you've started it and that it will come back when done."
      : "It says you did or made something, but no action ran in this turn. Only claim what a tool did now; otherwise say what you will do or what you don't know.");
  } else if (STARTED_CLAIM.test(answer) && !acted.length) {
    problems.push("It says work is under way, but nothing was started in this turn. Start it with a tool, or offer to.");
  }
  const touched = JSON.stringify(toolCalls.map((call) => call.input));
  for (const raw of new Set(answer.match(LOCAL_PATH) ?? [])) {
    const path = raw.replace(/[.…]+$/, "");
    const full = path.startsWith("~") ? `${homedir()}${path.slice(1)}` : path;
    if (!exists(full) && !touched.includes(path) && !touched.includes(full)) {
      problems.push(`It mentions ${path}, which does not exist on his Mac.`);
    }
  }
  return problems;
}

export function honestyRewritePrompt(answer: string, problems: string[]): string {
  return [
    "Rewrite this reply to George. Problems found:",
    ...problems.map((problem) => `- ${problem}`),
    "",
    "Keep everything that is true and specific. Plain, direct words, like a sharp friend texting. Don't apologise at length or explain why. Reply with the rewritten text only.",
    "",
    `Reply:\n"""${answer}"""`,
  ].join("\n");
}

// Stock phrasing George has called "AI slop": greeting-card empathy and
// metaphors standing in for something specific. Checked mechanically so the
// voice holds even when the model drifts.
const SLOP = /\b(?:stings?|lonely|the silence|a verdict|in the room|into the (?:dark|void)|wears? on you|a lot to carry|carry(?:ing)? (?:that|this)|sit with|the part that|heavy lift|journey|resonates?|tapestry|testament|navigat(?:e|ing) (?:this|the)|at the end of the day|it's (?:okay|ok) to feel)\b/i;

// George only ever talks to Flyd (AGENTS.md "One voice"): the crew, jobs,
// worktrees and council are Flyd's own backstage.
const BACKSTAGE = /\b(?:crew ?mates?|crewmember|worktrees?|subagents?|the (?:council|librarian|strategist|critic|muse|scout))\b/i;

export function styleProblems(answer: string): string[] {
  const problems: string[] = [];
  const backstage = answer.match(BACKSTAGE);
  if (backstage) problems.push(`It names your own backstage ("${backstage[0]}"). Speak as yourself: say what you're doing, not who inside you is doing it.`);
  const phrase = answer.match(SLOP);
  if (phrase) problems.push(`It uses stock phrasing ("${phrase[0]}"). Say the literal, specific thing instead, in plain words.`);
  if ((answer.match(/—/g) ?? []).length >= 2) problems.push("It leans on em dashes. Use full stops or commas.");
  const contrast = answer.match(/\b(?:isn'?t|is not|wasn'?t|aren'?t)\b[^.!?\n]{1,80}?(?:—|,|;)\s*(?:it'?s|it is|that'?s|they'?re)\b|\b(?:a|an|the)\s[\w-]+(?:\s[\w-]+)?,\s+not\s+(?:a|an|the)\s[\w-]+|—\s*not\s+(?:a|an|the|just)\b/i);
  if (contrast) problems.push(`It uses "not X, it's Y" contrast framing ("${contrast[0].slice(0, 60)}"). He dislikes it; state the point directly.`);
  return problems;
}

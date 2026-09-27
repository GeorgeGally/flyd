import { existsSync } from "node:fs";
import { homedir } from "node:os";

// A last look before an answer reaches George: does it claim work that no
// tool did this turn, or point at files that are not there? Models complete
// the pattern — "I wrote the spec, it's in ~/Documents/Glasses" — and it reads
// as fact. This catches that class mechanically and sends the answer back once.

const ACTION_CLAIM = /\bI(?:'ve| have| just)?\s+(?:wrote|written|created|saved|drafted|built|set up|scheduled|added|sent|booked|put together)\b/i;
const LOCAL_PATH = /(?:~|\/Users\/[^/\s]+)\/[^\s`'"),;:]+/g;

export interface ClaimToolCall { name: string; input: Record<string, unknown>; succeeded: boolean }

export function unsupportedClaims(
  answer: string,
  toolCalls: ClaimToolCall[],
  isMutating: (name: string, input: Record<string, unknown>) => boolean,
  exists: (path: string) => boolean = existsSync,
): string[] {
  const problems: string[] = [];
  const acted = toolCalls.some((call) => call.succeeded && isMutating(call.name, call.input));
  if (ACTION_CLAIM.test(answer) && !acted) {
    problems.push("It says you did or made something, but no action ran in this turn. Only claim what a tool did now; otherwise say what you will do or what you don't know.");
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

export function styleProblems(answer: string): string[] {
  const problems: string[] = [];
  const phrase = answer.match(SLOP);
  if (phrase) problems.push(`It uses stock phrasing ("${phrase[0]}"). Say the literal, specific thing instead, in plain words.`);
  if ((answer.match(/—/g) ?? []).length >= 2) problems.push("It leans on em dashes. Use full stops or commas.");
  return problems;
}

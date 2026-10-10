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
const DELEGATIONS = new Set(["background_task", "start_coding_task", "start_knowledge_task"]);
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

// George wants the outcome or nothing (AGENTS.md "One voice"): no "Passing
// this to Firstmate", no "One moment please sir", no "Let me check". A
// rewrite prompt can be ignored, so these sentences are cut mechanically from
// every answer before it reaches him.
// Each pattern matches Flyd speaking about its own machinery, so it is anchored
// to the sentence opening or a first-person subject: advice ("I'd suggest
// handing it to your accountant"), outcomes ("I sent the fix to Firstmate this
// morning") and commitments ("Let me check with Sam tomorrow") stay.
// Handing something to George himself ("I'll pass it to you") is not routing.
const HANDOFF = /^(?:(?:I'?m |I am |now )?(?:passing|handing|routing)|I'?ll (?:pass|hand|route)|I will (?:pass|hand|route)) (?:this|it|that)(?: along| over| on)?(?: to (?!your\b)(?:the )?(?:[\w-]+ )?(?:firstmate|crew|boss|team|agent|worker)s?\b|\s*(?:[.!,…]|$))|^(?:this|that|it)(?: one)?(?:'s| is) for the crew\s*[.!…]*$/i;
const STALL_PHRASE = "one moment|give me a (?:sec(?:ond)?|moment|minute)|let me check|just checking|checking now";
const STALL = new RegExp(`^(?:(?:${STALL_PHRASE})(?:,? (?:please|sir|now|that|this|it|for you|on that|real quick))*|(?:still )?loading(?: now| it| that| up)?)[,\\s]*(?:[.…!]+)?$`, "i");
const TOOL_NARRATION = /^(?:I'?m|I am) (?:calling|running|invoking|using) (?:the|my) (?:[\w-]+ ){0,3}tool\b|^(?:now )?(?:calling|running|invoking|using) (?:the|my) (?:[\w-]+ ){0,3}tool(?: now)?\s*[.!…]*$|\bI (?:ran|called|used|invoked) (?:the|my) (?:[\w-]+ ){0,3}tools?\b|\bmy tools\b/i;
// "Internally" alone is ordinary English ("I'd handle payroll internally");
// only Flyd's own checking or running describes its machinery.
const INTERNALLY = /\bI(?:'ve|'m)? (?:checked|checking|ran|running|looked|looking|searched|searching|processed|processing|routed|routing)\b[^.!?]*\binternally\b/i;
// A stall that opens a real sentence ("Let me check — the venue opens at 9.")
// loses only its opening clause.
const LEADING_STALL = new RegExp(`^((?:${STALL_PHRASE})(?:,? please)?(?:,? sir)?\\s*(?:—|–|-|,|:|\\.\\.\\.|…))\\s+(\\S.*)$`, "i");

function isNarration(sentence: string): boolean {
  // Quoting a phrase (no more "Let me check") talks about it; it does not narrate.
  const own = sentence.replace(/"[^"]*"|“[^”]*”/g, "\"\"");
  return HANDOFF.test(own) || STALL.test(own) || TOOL_NARRATION.test(own) || INTERNALLY.test(own);
}

/**
 * Cuts sentences that narrate Flyd's own routing, stalling or tools. Code
 * blocks are left alone. When nothing substantive would be left, the original
 * stands and nothing is reported removed.
 */
export function stripInternalNarration(answer: string): { cleaned: string; removed: string[] } {
  const removed: string[] = [];
  const parts = answer.split(/(```[\s\S]*?```)/);
  const cleanedParts = parts.map((part, index) => {
    if (index % 2 === 1) return part;
    return part.split("\n").flatMap((line) => {
      if (!line.trim()) return [line];
      const indent = line.match(/^\s*/)?.[0] ?? "";
      const kept: string[] = [];
      for (const sentence of line.trim().split(/(?<=[.!?…])\s+/)) {
        const leading = sentence.match(LEADING_STALL);
        if (leading && !isNarration(leading[2])) {
          removed.push(leading[1]);
          kept.push(leading[2].charAt(0).toUpperCase() + leading[2].slice(1));
        } else if (isNarration(sentence)) {
          removed.push(sentence);
        } else {
          kept.push(sentence);
        }
      }
      return kept.length ? [indent + kept.join(" ")] : [];
    }).join("\n");
  });
  if (!removed.length) return { cleaned: answer, removed };
  const cleaned = cleanedParts.join("").replace(/\n{3,}/g, "\n\n").trim();
  if (!/[\p{L}\p{N}]{2,}/u.test(cleaned)) return { cleaned: answer, removed: [] };
  return { cleaned, removed };
}

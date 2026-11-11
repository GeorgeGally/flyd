// Flyd talks to George, never about him. Text written by staff or a model
// often still says "George needs to…", "his picks", "the captain"; this turns
// it to him: "you need to…", "your picks", "you". Pure and deterministic, so
// stored text that was written in the third person reads right too.

/** "the CapFive lab round 5 captain": a captain qualified only by names, numbers and lab words is still him. */
const QUALIFIED_CAPTAIN = String.raw`\b[Tt]he\s+(?:(?:[A-Z][\w-]*|\d+|lab|round|design|project|client|site)\s+){1,6}captain\b`;
const HIM = String.raw`(?:${QUALIFIED_CAPTAIN}|\bGeorge\b|\b[Tt]he captain\b|\b[Oo]ur captain\b)`;

/** Verbs whose third-person form follows "you" once he is the subject. */
const AGREE: Record<string, string> = {
  has: "have", is: "are", was: "were", does: "do", needs: "need", wants: "want", must: "must", makes: "make",
  picks: "pick", chooses: "choose", decides: "decide", asks: "ask", says: "say", prefers: "prefer", likes: "like",
  approves: "approve", reviews: "review", owns: "own", gets: "get", sees: "see", knows: "know", thinks: "think",
  acts: "act", replies: "reply", answers: "answer", signs: "sign", looks: "look", checks: "check", confirms: "confirm",
  goes: "go", sends: "send", lands: "land", merges: "merge", comes: "come", returns: "return", agrees: "agree",
  gives: "give", tells: "tell", reads: "read", opens: "open", tests: "test", tries: "try", uses: "use", plays: "play",
  "hasn't": "haven't", "isn't": "aren't", "wasn't": "weren't", "doesn't": "don't",
};
const VERBS = Object.keys(AGREE).join("|");

/** His decisions: a bare "his" before one of these is him even with no name in the sentence ("Still open: his picks"). */
const HIS_CALLS = "picks?|calls?|choices?|decisions?|answers?|approval|go-ahead";

/** Things of his that "his" names once he is named earlier in the sentence. A "his" before anything else may be someone else's. */
const HIS_THINGS = "picks?|calls?|choices?|go-ahead|ok|okay|approval|answers?|decisions?|word|review|look|sign-off|input|feedback|reply|replies|preferences?|taste|eye|attention|say|own|inbox|desk|time|questions?|call|pick|tab|screen|phone|mac|laptop|computer|browser|calendar|email";

/** Lower case unless the word was "I": the last pass capitalises whatever now starts a sentence. */
const capital = (word: string, _like: string): string => (word.startsWith("I ") ? word : word.toLowerCase());

/** "he", "his", "him" said after he is named in the same sentence: "George needs … which will reload his tab". */
function afterHim(sentence: string): string {
  const named = new RegExp(HIM).exec(sentence);
  if (!named) return sentence;
  const at = named.index + named[0].length;
  const rest = sentence.slice(at)
    .replace(new RegExp(`\\b([Hh])is (${HIS_THINGS})\\b`, "g"), (_found, _h: string, thing: string) => `your ${thing}`)
    .replace(new RegExp(`\\b([Hh])e (${VERBS})\\b`, "g"), (_found, _h: string, verb: string) => `you ${AGREE[verb.toLowerCase()] ?? verb}`)
    .replace(/\b(for|to|ask|tell|show|give|from|with|remind|let) him\b/gi, (_found, word: string) => `${word} you`);
  return sentence.slice(0, at) + rest;
}

/**
 * The same words said to him. "The CapFive lab round 5 captain has posted three
 * open questions" reads "I have three open questions": the questions are Flyd's
 * to bring him. Code and links are not touched by callers that need them kept.
 */
export function toYou(text: string): string {
  if (!text) return text;
  const said = text
    .replace(/[^.!?\n]+[.!?]*/g, afterHim)
    // Questions brought to him: from where he sits, Flyd has them for him.
    .replace(new RegExp(`${HIM}\\s+(?:has|have)\\s+(?:posted|raised|left|sent|opened|asked)(?=\\s+(?:\\w+\\s+){0,3}(?:questions?|calls?|decisions?)\\b)`, "g"), (found) => capital("I have", found))
    // "is George" → "are you" in a question.
    .replace(new RegExp(`\\b([Ii]s|[Hh]as|[Dd]oes|[Ww]as) ${HIM}(?!['’]s)`, "g"), (found, verb: string) => capital(`${AGREE[verb.toLowerCase()]!.replace(/n't$/, "")} you`, found))
    .replace(new RegExp(`${HIM}['’]s\\b`, "g"), (found) => capital("your", found))
    .replace(new RegExp(`${HIM}\\s+(${VERBS})\\b`, "g"), (found, verb: string) => capital(`you ${AGREE[verb.toLowerCase()] ?? verb}`, found))
    .replace(new RegExp(HIM, "g"), (found) => capital("you", found))
    // "captain calls on V5", "captain's picks": a bare "captain" owning a decision is him too.
    .replace(/\b[Cc]aptain['’]s (calls?|picks?|decisions?|choices?|answers?)\b/g, (_found, thing: string) => `your ${thing}`)
    .replace(/\b[Cc]aptain calls (?=on\b)/g, "your calls ")
    .replace(new RegExp(`\\b[Hh]is (${HIS_CALLS})\\b`, "g"), (_found, thing: string) => `your ${thing}`)
    // "Is you's call needed?" never: a possessive "you" is "your".
    .replace(/\byou['’]s\b/gi, (found) => capital("your", found));
  return said.replace(/(^\s*|[.!?]\s+|\n\s*)(you|your|i|are|have|do|were|haven't|aren't|don't|weren't)\b/g, (_found, lead: string, word: string) => `${lead}${word === "i" ? "I" : word.charAt(0).toUpperCase() + word.slice(1)}`);
}

/** Whether a line still talks about him in the third person. */
export function aboutHim(text: string): boolean {
  return new RegExp(`${HIM}|\\b[Hh]is (?:${HIS_CALLS})\\b`).test(text);
}

// Flyd talks to George, never about him. Text written by staff or a model
// often still says "George needs to…", "his picks", "the captain"; this turns
// it to him: "you need to…", "your picks", "you". Pure and deterministic, so
// stored text that was written in the third person reads right too. Someone
// else's words to him ("Anna: Hi George, can you call?", a quoted message) and
// his full name ("Invoice to George Gally") are said exactly as written.

/** "the CapFive lab round 5 captain": a captain qualified only by names, numbers and lab words is still him. */
const QUALIFIED_CAPTAIN = String.raw`\b[Tt]he\s+(?:(?:[A-Z][\w-]*|\d+|lab|round|design|project|client|site)\s+){1,6}captain\b`;
/** "George", never "George Gally": his full name is a name on a document, not Flyd talking about him. */
const HIM = String.raw`(?:${QUALIFIED_CAPTAIN}|\bGeorge\b(?!\s+[A-Z][a-z])|\b[Tt]he captain\b|\b[Oo]ur captain\b)`;

/** Verbs whose third-person form follows "you" once he is the subject. */
const AGREE: Record<string, string> = {
  has: "have", is: "are", was: "were", does: "do", needs: "need", wants: "want", must: "must", makes: "make",
  picks: "pick", chooses: "choose", decides: "decide", asks: "ask", says: "say", prefers: "prefer", likes: "like",
  approves: "approve", reviews: "review", owns: "own", gets: "get", sees: "see", knows: "know", thinks: "think",
  acts: "act", replies: "reply", answers: "answer", signs: "sign", looks: "look", checks: "check", confirms: "confirm",
  goes: "go", sends: "send", lands: "land", merges: "merge", comes: "come", returns: "return", agrees: "agree",
  gives: "give", tells: "tell", reads: "read", opens: "open", tests: "test", tries: "try", uses: "use", plays: "play",
  plans: "plan", hopes: "hope", expects: "expect", feels: "feel", loves: "love", means: "mean", keeps: "keep",
  leaves: "leave", flies: "fly", travels: "travel", calls: "call", writes: "write", works: "work", lives: "live",
  "hasn't": "haven't", "isn't": "aren't", "wasn't": "weren't", "doesn't": "don't",
};
const VERBS = Object.keys(AGREE).join("|");

/** His decisions: a bare "his" before one of these is him ("Still open: his picks"). A "his" before anything else may be someone else's. */
const HIS_CALLS = "picks?|calls?|choices?|decisions?|answers?|approval|go-ahead";

/**
 * Someone else's words, said as written: a quoted message, and a greeting to
 * him to the end of its line ("Hi George, can you call?" is Anna talking).
 */
const NOT_FLYDS = /“[^”\n]*”|"[^"\n]*"|\b(?:Hi|Hey|Hello|Dear|Thanks|Thank you|Good morning|Morning|Cheers)\s+George\b[^\n]*/g;
const KEPT = /(\d+)/g;

/** The text with someone else's words set aside, and how to put them back. Pure. */
function setAside(text: string): { prose: string; back: (said: string) => string } {
  const kept: string[] = [];
  const prose = text.replace(NOT_FLYDS, (span) => `${kept.push(span) - 1}`);
  return { prose, back: (said) => said.replace(KEPT, (_found, index: string) => kept[Number(index)]!) };
}

/** The text without someone else's words in it: what a check on Flyd's own words reads. Pure. */
export function flydsOwnWords(text: string): string {
  return text.replace(NOT_FLYDS, " ");
}

/** One sentence at a time; a dot inside "v2.1" or a link does not end one. */
const SENTENCE = /(?:[^.!?\n]|[.!?](?=\S))+[.!?]*/g;
/** Capitalised words that name no one: Flyd itself ("I'll") and words that only start a sentence or line. */
const NO_ONE = /^(?:I(?:['’](?:m|ll|ve|d))?|The|A|An|It|Its|This|That|These|Those|So|And|But|Or|Then|Also|Yes|No|If|When|Once|After|Before|While|Since|Until|Because|Now|Today|Tomorrow|Yesterday|Still|Question|Note|Update|He|His|Him|You|Your|We|Our|There|Here|Please|Just|Only|Both)$/;

/**
 * "George said he wants the blue one before his trip" reads "You said you want
 * the blue one before your trip". A he/him/his after him in the same sentence
 * is him only when no one else is named there ("Mark wants George to give him
 * feedback" is Mark's); when a verb after "he" cannot be agreed, the sentence
 * is left as written rather than said half-right. Pure.
 */
function pronounsToYou(text: string): string {
  return text.replace(SENTENCE, (sentence) => {
    const first = new RegExp(HIM).exec(sentence);
    if (!first) return sentence;
    const head = sentence.slice(0, first.index + first[0].length);
    const tail = sentence.slice(head.length);
    if (!/\b(?:he|him|his|himself)\b/i.test(tail)) return sentence;
    // "George's brother called and he wants a lift": someone of his is named, and may be who "he" is.
    if (new RegExp(`${HIM}['’]s\\s+[a-z]`).test(sentence)) return sentence;
    if (/\b(?:the|a|an|my|her|their)\s+(?:[a-z]+\s+)?[a-z]*(?:er|or|ist|ant|ent|ian|man|woman|boss|friend|brother|sister|dad|mum|mom|son|wife|husband|partner|guy)\b/i.test(tail.slice(0, tail.search(/\b(?:he|him|his|himself)\b/i)))) return sentence;
    // Anyone else named in the sentence may be who "he" is.
    const others = sentence.replace(new RegExp(HIM, "g"), " ").match(/\b[A-Z][\w'’-]*/g) ?? [];
    if (others.some((word) => !NO_ONE.test(word))) return sentence;
    for (const found of tail.matchAll(/\bhe\s+([a-z'’]+)/gi)) {
      const verb = found[1]!.toLowerCase().replace(/’/g, "'");
      if (!AGREE[verb] && /[^s]s$/.test(verb)) return sentence;
    }
    return head + tail
      .replace(new RegExp(`\\bhe\\s+(${VERBS})\\b`, "gi"), (_found, verb: string) => `you ${AGREE[verb.toLowerCase()]}`)
      .replace(/\bhe['’]s\b/gi, "you're")
      .replace(/\bhe['’](ll|d)\b/gi, (_found, rest: string) => `you'${rest}`)
      .replace(/\bhimself\b/gi, "yourself")
      .replace(/\bhim\b/gi, "you")
      .replace(/\bhis\b/gi, "your")
      .replace(/\bhe\b/gi, "you");
  });
}

/** Lower case unless the word was "I": the last pass capitalises whatever now starts a sentence. */
const capital = (word: string, _like: string): string => (word.startsWith("I ") ? word : word.toLowerCase());

/**
 * The same words said to him. "The CapFive lab round 5 captain has posted three
 * open questions" reads "I have three open questions": the questions are Flyd's
 * to bring him. Code and links are not touched by callers that need them kept.
 */
export function toYou(text: string): string {
  if (!text) return text;
  const { prose, back } = setAside(text);
  const said = pronounsToYou(prose)
    // Questions brought to him: from where he sits, Flyd has them for him.
    .replace(new RegExp(`${HIM}\\s+(?:has|have)\\s+(?:posted|raised|left|sent|opened|asked)(?=\\s+(?:\\w+\\s+){0,3}(?:questions?|calls?|decisions?)\\b)`, "g"), (found) => capital("I have", found))
    // "is George" → "are you" in a question.
    .replace(new RegExp(`\\b([Ii]s|[Hh]as|[Dd]oes|[Ww]as) ${HIM}(?!['’]s)(?=(?:[^.!?\\n]|\\.(?=\\S))*\\?)`, "g"), (found, verb: string) => capital(`${AGREE[verb.toLowerCase()]!.replace(/n't$/, "")} you`, found))
    .replace(new RegExp(`${HIM}['’]s\\b`, "g"), (found) => capital("your", found))
    .replace(new RegExp(`${HIM}\\s+(${VERBS})\\b`, "g"), (found, verb: string) => capital(`you ${AGREE[verb.toLowerCase()] ?? verb}`, found))
    .replace(new RegExp(HIM, "g"), (found) => capital("you", found))
    // "captain calls on V5", "captain's picks": a bare "captain" owning a decision is him too.
    .replace(/\b[Cc]aptain['’]s (calls?|picks?|decisions?|choices?|answers?)\b/g, (_found, thing: string) => `your ${thing}`)
    .replace(/\b[Cc]aptain calls (?=on\b)/g, "your calls ")
    .replace(new RegExp(`\\b[Hh]is (${HIS_CALLS})\\b`, "g"), (_found, thing: string) => `your ${thing}`)
    // "Is you's call needed?" never: a possessive "you" is "your".
    .replace(/\byou['’]s\b/gi, (found) => capital("your", found));
  return back(said.replace(/(^\s*|[.!?]\s+|\n\s*)(you|your|i|are|have|do|were|haven't|aren't|don't|weren't)\b/g, (_found, lead: string, word: string) => `${lead}${word === "i" ? "I" : word.charAt(0).toUpperCase() + word.slice(1)}`));
}

/** Whether a line still talks about him in the third person (someone else's words to him aside). */
export function aboutHim(text: string): boolean {
  return new RegExp(`${HIM}|\\b[Hh]is (?:${HIS_CALLS})\\b`).test(flydsOwnWords(text));
}

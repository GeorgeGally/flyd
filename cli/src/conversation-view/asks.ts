/**
 * Words that put something to George: a question, a choice between things, or his say-so asked for.
 */
const ASKS_HIM = /\?|\b(?:which|whether|or not|pick(?:s|ed)?|choos(?:e|es|ing)|choice|decid(?:e|es|ing)|decision|approv(?:e|es|al)|confirm(?:s|ation)?|prefer(?:s|red)?|should|shall|want(?:s)?|go[- ]ahead|sign[- ]off|say so|your (?:call|ok|okay|say|answer|pick|word|view|review|look)|needs? (?:you|your|george|the captain|captain)|ok to|okay to|keep or|or drop|yes\s*\/\s*no|let (?:me|us|firstmate|flyd) know|tell (?:me|us|firstmate|flyd)|ask(?:s|ing)? (?:you|him|george|the captain))\b/i;

/**
 * Words that report where something stands ("Picture desk not shipping; worker stopped on purpose"). An instruction
 * ("Publish the launch post") reports nothing: it is still his call.
 */
const REPORTS = /\b(?:stop(?:s|ped)|kept|keeps|not (?:shipping|shipped|going to ship)|won'?t ship|replac(?:es|ed|ing)|supersed(?:es|ed|ing)|done|(?:is|are|went|gone|now|already) live)\b/i;

/** Whether a line asks him anything (see ASKS_HIM), or offers him answers to pick between. Pure. */
export function asksSomething(text: string, choices: readonly string[] = []): boolean {
  return choices.length > 0 || ASKS_HIM.test(text);
}

/**
 * Whether these lines only tell him something: none asks him anything and one clearly reports where something stands.
 * Such a line is never put to him as a call, and its plain words never invent a question it does not ask. Pure.
 */
export function onlyTells(texts: readonly string[], choices: readonly string[] = []): boolean {
  return !texts.some((text) => asksSomething(text, choices)) && texts.some((text) => REPORTS.test(text));
}

// A staff question as George reads it: said to him, once, without the
// machinery around it. Deterministic, so a question whose rewrite never came
// or was not grounded is still never shown in the staff's own words: either
// these rules make it plain, or it is held and its boss is asked to restate it.

/** Work-pipeline words that mean nothing to him. */
const MACHINERY = /\b(?:parked at|finding\(s\)|ask-user|needs-decision|no-mistakes|worktree|wip\/|fm-[a-z]+|crewmate|secondmate|local main|fleet state)\b|\[(?:at|key)=|\brun:\s*[0-9A-Z]{6,}|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b(?=…|\)|\s|$)/i;
/** A file path, a home path or a loopback address. */
const PATH = /(?:https?:\/\/(?:127\.|localhost|0\.0\.)[^\s,;)]*|~?\/(?:Users|tmp|private|var)\/[^\s,;)]*|\b(?:data|bin|state|config|docs|src|cli|lib)\/[\w./-]*|\b[\w.-]+\/[\w.-]+\.(?:md|html|ts|js|json|sh|txt|png|jpg|log)\b)/gi;
/** A task id: lowercase words joined by two or more hyphens, with a digit among them ("cap5-dash-lab-r5-calls"); "end-to-end" is a plain word. */
const TASK_ID = /\b(?=[a-z0-9-]*\d)[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}\b/g;
const ABOUT_HIM = /\bGeorge(?:'s|’s)?\b|\bthe captain(?:'s|’s)?\b/i;

/** The work's own task ids worth looking for: only ones shaped like ids ("pc-setup"), since a one-word id ("review") is also a plain word. */
function idsOf(tasks?: string | readonly string[]): string[] {
  return (typeof tasks === "string" ? [tasks] : tasks ?? []).filter((task) => task.includes("-"));
}
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What his ears do not need: paths, addresses, task ids and pipeline words. */
export function showsMachinery(text: string, tasks?: string | readonly string[]): boolean {
  PATH.lastIndex = 0;
  TASK_ID.lastIndex = 0;
  return MACHINERY.test(text) || PATH.test(text) || TASK_ID.test(text)
    || idsOf(tasks).some((task) => new RegExp(`\\b${escaped(task)}\\b`, "i").test(text)) || ABOUT_HIM.test(text);
}

/** One copy of a passage pasted again and again ("X; due 2026-10-21 X; due 2026-10-21 X; due…"). Pure. */
export function withoutRepeats(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  // The shortest run of words that the whole passage repeats, its last copy perhaps cut short.
  for (let period = 2; period <= words.length / 2; period += 1) {
    const repeats = words.every((word, index) => {
      const expected = words[index % period]!;
      return word === expected || index === words.length - 1 && expected.startsWith(word.replace(/…$/, ""));
    });
    if (repeats) return words.slice(0, period).join(" ");
  }
  // Repeated sentences, each kept once in its first place.
  const seen = new Set<string>();
  return text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter((sentence) => {
    const key = sentence.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" ");
}

/** Said about him, turned to him: "George's three calls" reads "your three calls". */
function toHim(text: string): string {
  return text
    .replace(/\b(?:is|has|does|was) (?:George|the captain)\b(?!['’]s)/gi, (said) => ({ is: "are you", has: "have you", does: "do you", was: "were you" })[said.split(" ")[0]!.toLowerCase()]!)
    .replace(/\b(?:George|the captain)(?:'s|’s)\b/gi, "your")
    .replace(/\b(?:George|the captain) (?:has|needs|wants|must|makes|picks|chooses|decides)\b/gi, (said) => `you ${said.split(" ").pop()!.replace(/^has$/i, "have").replace(/s$/i, "")}`)
    .replace(/\b(?:George|the captain)\b/gi, "you")
    .replace(/\bhis (picks?|calls?|choices?|choice|go-ahead|ok|okay|approval|answers?|decisions?|word|review|look)\b/gi, "your $1");
}

/**
 * The question in plain words to him, or null when no plain question is left
 * once the machinery is gone: then it is held, and its boss restates it. Pure.
 */
export function plainQuestionFor(text: string, tasks?: string | readonly string[]): string | null {
  // "needs-decision [at=…] [key=…]:" is the status file talking; gone first, so the copies after it match the first.
  let said = withoutRepeats(text.replace(/\s+/g, " ").trim()
    .replace(/^\s*(?:needs-decision|blocked|paused|working|done)\s*(?:\[[^\]]*\]\s*)*:\s*/i, "")
    .replace(/\s*\[(?:at|key)=[^\]]*\]/gi, ""));
  for (const task of idsOf(tasks)) said = said.replace(new RegExp(`\\s*\\b(?:recorded |listed |kept )?(?:in|under|on|for|from|see)?\\s*${escaped(task)}\\b`, "gi"), "");
  said = said
    .replace(new RegExp(`\\s*\\b(?:recorded |listed |kept )?(?:in|under|on|see)\\s+${TASK_ID.source}`, "g"), "")
    .replace(TASK_ID, "")
    // "plan: data/…", "(board http://127.0.0.1:…)": the label goes with the path it names.
    .replace(/\b(?:plan|report|board|notes?|at|in|from|to)\s*:?\s+(?=https?:\/\/(?:127\.|localhost|0\.0\.)|~?\/(?:Users|tmp|private|var)\/|\b(?:data|bin|state|config|docs|src|cli|lib)\/|\b[\w.-]+\/[\w.-]+\.(?:md|html|ts|js|json|sh|txt|png|jpg|log)\b)/gi, "")
    .replace(PATH, "");
  said = toHim(said)
    // Brackets and punctuation the cuts left empty or dangling.
    .replace(/\(\s*[;,:]*\s*/g, "(")
    .replace(/\s*[;,:]*\s*\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/\(\s*…?\s*$/, "")
    .replace(/\s+([,;:.?!])/g, "$1")
    .replace(/([,;:])(?=[,;:.?!)])/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:.·-]+|[\s,;:·-]+$/g, "")
    .trim();
  if (said.length < 4 || !/\p{L}{3}/u.test(said) || showsMachinery(said, tasks)) return null;
  return said.charAt(0).toUpperCase() + said.slice(1);
}

// A session's step in a few plain words, for the line under one of George's notes: what a shell command, a file
// edit or a short narration is doing ("Editing the styles", "Taking screenshots", "Putting it live"). Firstmate
// works on most notes in its own session and rarely describes its steps, so the command itself is read for what
// it does. Never returns a command, a path, a tool name or backstage jargon.

/** A line this many words or fewer reads as a glance, not a sentence. */
const FEW_WORDS = 7;
const TRAILING_FILLER = /\s+(?:and|or|the|a|an|to|of|for|with|on|in|at|by|from|then|so|its|his|their)$/i;
const WORDS: Array<[RegExp, string]> = [
  [/\bcss\b/gi, "styles"],
  [/\b(?:html|markup)\b/gi, "page"],
  [/\b(?:js|javascript)\b/gi, "script"],
];

/** Imperative verbs a step may open with, so "Fix the footer" reads as "Fixing the footer". */
const VERBS = new Set(
  (
    "add adjust align apply build capture centre center change check clean compare confirm copy count create cut debug delete deploy " +
    "design diagnose draft drop enlarge export fetch find fix fold get grow hide hook import improve inspect install investigate land " +
    "launch list look make measure merge move nudge open pad preview publish pull push put raise read rebuild recolour redesign " +
    "remove rename render replace research resize restart review rewrite run screenshot set shift ship shoot show shrink sort split " +
    "style swap sync take test tighten trim try tune turn update upload verify widen wire write"
  ).split(" "),
);
const DOUBLED = new Set(["cut", "drop", "get", "put", "run", "set", "ship", "shop", "stop", "swap", "trim", "wrap", "pad"]);

/** "Fix" → "Fixing"; only for verbs a step opens with, so a noun is never turned into one. */
function gerund(word: string): string | undefined {
  const verb = word.toLowerCase();
  if (verb === "screenshot") return "Taking screenshots of";
  if (!VERBS.has(verb)) return undefined;
  const stem = DOUBLED.has(verb) ? verb + verb.at(-1) : /[^e]e$/.test(verb) ? verb.slice(0, -1) : verb;
  return stem[0]!.toUpperCase() + stem.slice(1) + "ing";
}

/** The first clause of a plain line, opening with what is being done, in at most a few words. */
export function fewWords(line: string): string {
  let text = line.split(/\s*(?:[;(]|:\s|\s[—–-]\s|\.\s|,\s+(?:then|and then|so)\s)\s*/)[0]!.trim().replace(/[.,!]+$/, "");
  for (const [word, plain] of WORDS) text = text.replace(word, plain);
  const [first = "", ...rest] = text.split(/\s+/);
  const opening = gerund(first);
  if (opening) text = [opening, ...rest].join(" ");
  const words = text.split(/\s+/);
  if (words.length > FEW_WORDS) {
    text = words.slice(0, FEW_WORDS).join(" ");
    while (TRAILING_FILLER.test(text)) text = text.replace(TRAILING_FILLER, "");
  }
  // A quote the clip cut in half reads as a typo.
  if ((text.match(/["“”]/g) ?? []).length % 2) text = text.replace(/["“”]/g, "");
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

const IMAGE = /\.(?:png|jpe?g|gif|webp)\b/i;
const NOTE = /\/state\/inbox\/(?:handled\/)?[^/\s'"]+\.note\b/;
const MEMORY = /(?:^|\/)(?:MEMORY|USER|TASTE|SOUL)\.md$|\/memory\//;

/** What a file is, as George would name it. */
function areaOf(path: string): string {
  if (/\.(?:css|scss|sass|less)\b/i.test(path)) return "the styles";
  if (/\.(?:html?|php|erb|liquid|twig|tsx|jsx|vue|svelte|astro)\b/i.test(path)) return "the page";
  if (/\.(?:md|mdx|txt)\b/i.test(path)) return "the notes";
  if (/\.(?:sh|zsh)\b/i.test(path)) return "a script";
  if (/\.(?:swift)\b/i.test(path)) return "the app";
  return "the code";
}

/** A file tool's step: an edit named by what it changes, a screenshot looked at, his note read. */
export function fileStep(tool: string, path: string): string | undefined {
  if (!path) return undefined;
  if (tool === "Read") {
    if (NOTE.test(path)) return "Reading your note";
    if (IMAGE.test(path)) return "Looking at the screenshots";
    if (MEMORY.test(path)) return "Checking memory";
    return undefined;
  }
  if (tool === "Edit" || tool === "Write" || tool === "MultiEdit" || tool === "NotebookEdit") {
    return MEMORY.test(path) ? "Saving it to memory" : `Editing ${areaOf(path)}`;
  }
  return undefined;
}

const CODE_FILE = /[\w./$-]+\.(?:css|scss|sass|less|html?|php|erb|liquid|twig|tsx?|jsx?|mjs|cjs|vue|svelte|astro|swift|py|rb|go|rs|sh|md)\b/gi;

/** The command with its shell variables ("G=/path; grep x $G/a.css") spelled out, so paths say whose files they are. */
function expanded(command: string): string {
  let out = command;
  for (const [, name, value] of command.matchAll(/(?:^|[;&\s])(?:export\s+)?([A-Z][A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&]+)/g)) {
    const plain = value!.replace(/^["']|["']$/g, "");
    out = out.replace(new RegExp(`\\$\\{?${name}\\b\\}?`, "g"), () => plain);
  }
  return out;
}

/** What a shell command does, for when it carries no plain description of its own. */
export function commandStep(command: string): string | undefined {
  const c = expanded(command);
  if (/\bdeploy[\w-]*\.sh\b|\brsync\b|\bscp\b|\blftp\b|\bsftp\b|git archive\b[^;&]*\|\s*(?:ssh|tar\b[^;&]*ssh)|\b(?:wrangler|vercel|netlify)\b/.test(c)) return "Putting it live";
  if (/\bssh\b/.test(c)) return /\b(?:php -r|mysql|select|query)\b/i.test(c) ? "Checking the live site" : "Working on the live site";
  if (/\b(?:npm|pnpm|yarn|bun) (?:run )?test\b|\bvitest\b|\bjest\b|\bpytest\b|\bswift test\b|\bmake test\b|\b(?:node|php|python3?) \S*test/.test(c)) return "Running the tests";
  if (/\b(?:npm|pnpm|yarn|bun) run build\b|\bmake (?:install|run|build)\b|\bswift build\b/.test(c)) return "Building it";
  if (/\bsed -i\b|\bperl -pi\b|\bcat >>?|\btee\b|\b(?:echo|printf)\b.*?>>|\.write\(|write_text\(/.test(c)) {
    const target = [...c.matchAll(CODE_FILE)].map((match) => match[0]).find((path) => !/\/(?:firstmate|scratchpad)\//.test(path));
    return target ? `Editing ${areaOf(target)}` : undefined;
  }
  if (/\bgit (?:-C \S+ )?(?:commit|push)\b/.test(c)) return "Saving the change";
  if (/\bchrome-devtools-axi screenshot\b|\bscreencapture\b|\bmagick\b|\bconvert\b[^|;&]*\.png|--screenshot/.test(c)) return "Taking screenshots";
  if (/\bchrome-devtools-axi (?:eval|snapshot)\b/.test(c)) return "Measuring the page";
  if (/\bchrome-devtools-axi (?:open|resize|click|fill)\b/.test(c)) return "Trying the page";
  if (/\bgh(?:-axi)? run\b/.test(c)) return "Checking the build";
  if (/\bgh(?:-axi)? pr\b/.test(c)) return "Checking the pull request";
  if (/\bcurl\b|\bphp -S\b/.test(c)) return "Trying the page";
  if (NOTE.test(c)) return "Reading your note";
  // Anything else touching only firstmate's own records is its bookkeeping, not the work.
  const elsewhere = c.replace(/\S*\/(?:Documents\/firstmate|scratchpad|claude-\d+)(?:[/;]\S*)?/g, "");
  if (/\b(?:grep|rg|sed -n|cat|head|tail|ls|find|wc)\b/.test(c) && /\/(?:Users|home)\/\S+/.test(elsewhere)) return "Looking through the code";
  return undefined;
}

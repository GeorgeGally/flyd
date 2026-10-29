// Titles and lines in the right column are Flyd's own words about the work: no
// backstage framing ("Act on George's answer to:"), no second person naming him
// ("George's", "the captain"), and never the raw question as a heading. A line
// that only names the thing it is about ("The thread itself.") says nothing and
// is dropped rather than shown.

/** Openings that describe the hand-off, not the work. */
const FRAMING = [
  /^act on flyd's note about task\s+\S+[:.]?\s*/i,
  /^(?:george's|the captain's) answer to[:.]?\s*/i,
  /^self-improvement for flyd[:.]?\s*/i,
  /^act on\b[:.]?\s*/i,
];

/** A title built from the captain's own answer, which carries no subject of its own. */
const ANSWERED = /^act on\s+(?:george's|the captain's|his|your)?\s*answer\b/i;

const STOP = new Set((
  "the a an this that these those it its itself is are was were be been being and or but of to in on for with at by from as " +
  "your his her their my our you we i he she they them here there now just also very really more less some any all what which " +
  "who when where how why so then than about into over up out still yet only own same"
).split(" "));

/** Nouns that name the thing already on the card instead of saying anything about it. */
const VAGUE = new Set((
  "thread thing things stuff item items story stories post posts article articles piece pieces link links content information " +
  "info news conversation discussion topic comment comments page"
).split(" "));

function flatten(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** A title in Flyd's words: the work itself, with no framing and nobody spoken of in the third person. */
export function plainTitle(text: string | undefined, project?: string): string {
  const raw = flatten(text ?? "");
  if (!raw) return "";
  if (ANSWERED.test(raw)) {
    const carried = project ? `Carrying out your choice on ${project}` : "Carrying out the choice you made";
    return carried;
  }
  let line = raw;
  for (const frame of FRAMING) {
    const cut = line.replace(frame, "");
    if (cut !== line) {
      line = cut;
      break;
    }
  }
  line = line
    .replace(/\bgeorge's\b/gi, "your")
    .replace(/\bgeorge\b/gi, "you")
    .replace(/\bthe captain's\b/gi, "your")
    .replace(/\bthe captain\b/gi, "you")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!line) return "";
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Whether a line only names the thing it sits under ("The thread itself.") and so says nothing. */
export function saysNothing(text: string | undefined): boolean {
  const words = flatten(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return true;
  return words.every((word) => STOP.has(word) || VAGUE.has(word));
}

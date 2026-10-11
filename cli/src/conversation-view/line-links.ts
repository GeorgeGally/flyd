// A line under a message can carry links: a bare https URL, or a Markdown link "[label](https://…)". The page renders
// both as real links; these keep them whole while the line is flattened and clipped.

/** A Markdown web link, or a bare web address without trailing punctuation. */
export const LINE_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"'`)\]]*[^\s<>"'`)\].,;:!?…]/g;

/** Markdown inline marks dropped and whitespace collapsed; web links kept (a link labelled with its own address becomes the address). */
export function inlineKeepingLinks(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_whole, label: string, href: string) => {
      if (!/^https?:\/\//.test(href)) return label;
      return label.replace(/^https?:\/\//, "").replace(/\/$/, "") === href.replace(/^https?:\/\//, "").replace(/\/$/, "") ? href : `[${label}](${href})`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Clipped at a word to at most about `max` characters, never inside a link. */
export function clipKeepingLinks(text: string, max: number, min: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max).lastIndexOf(" ");
  if (cut < min) cut = max;
  for (const match of text.matchAll(LINE_LINK)) {
    const start = match.index;
    const end = start + match[0].length;
    if (start < cut && cut < end) {
      // A link that starts early enough is kept whole; one that starts late is dropped.
      cut = start >= min ? start : end;
      break;
    }
  }
  const kept = text.slice(0, cut).trimEnd();
  return kept.length < text.length ? `${kept}…` : kept;
}

/** The line as plain words, for places that cannot show links: each Markdown link becomes its label. */
export function plainLinks(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1");
}

import { Marked, type Tokens } from "marked";

// Markdown → HTML for the conversation view. Transcript text is untrusted
// (it quotes web pages, code and tool output), so raw HTML is escaped, links
// keep only web/mail schemes, and images render as their alt text: the page
// never fetches anything a message names.

const SAFE_HREF = /^(https?:|mailto:)/i;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      const label = this.parser.parseInline(token.tokens);
      const href = token.href.trim();
      if (!SAFE_HREF.test(href)) return label;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    image(token: Tokens.Image) {
      return `<span class="pill">${escapeHtml(token.text || "image")}</span>`;
    },
  },
});

/** Claude Code writes pasted screenshots into the prompt as "[Image #12]". */
function markImages(html: string): string {
  return html.replace(/\[Image #(\d+)\]/g, '<span class="pill">image $1</span>');
}

export function renderMarkdown(text: string): string {
  return markImages(marked.parse(text, { async: false }));
}

/** A line that reads as code: indented, or ending in a brace or semicolon, or only closing brackets. */
function codeLike(line: string): boolean {
  return /^(\t| {2,})\S/.test(line) || /[{};]\s*$/.test(line) || /^\s*[}\])]+;?\s*$/.test(line);
}

/**
 * The captain's messages are plain text, often with code pasted straight
 * in. A run of two or more code-like lines (with at least one indented or
 * brace line) becomes a fenced block, so it renders as one preformatted
 * block with its indentation instead of a paragraph of broken lines.
 * Text already inside ``` fences is left alone.
 */
export function fenceCaptainCode(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      const lines = part.split("\n");
      const out: string[] = [];
      for (let i = 0; i < lines.length; ) {
        if (!codeLike(lines[i]!)) {
          out.push(lines[i++]!);
          continue;
        }
        let end = i;
        while (end + 1 < lines.length && (codeLike(lines[end + 1]!) || (lines[end + 1]!.trim() === "" && end + 2 < lines.length && codeLike(lines[end + 2]!)))) end++;
        const run = lines.slice(i, end + 1);
        const structured = run.some((line) => /^(\t| {2,})\S/.test(line) || /[{}]/.test(line));
        if (run.length >= 2 && structured) {
          // "change to @media (…) {": the words before the code stay prose.
          const lead = /^([A-Za-z][A-Za-z ,'’]*?)\s+(?=[@.#<][A-Za-z])/.exec(run[0]!);
          if (lead && /\s/.test(lead[1]!.trim() + " ")) {
            out.push(lead[1]!.trim());
            run[0] = run[0]!.slice(lead[0].length);
          }
          out.push("```", ...run, "```");
        } else {
          out.push(...run);
        }
        i = end + 1;
      }
      return out.join("\n");
    })
    .join("");
}

/** The captain's words: pasted code as code, the rest as Markdown. */
export function renderCaptainMarkdown(text: string): string {
  return renderMarkdown(fenceCaptainCode(text));
}

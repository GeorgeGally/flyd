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

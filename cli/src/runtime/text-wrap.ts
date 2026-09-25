import { stdout } from "process";

export const CHAT_WRAP_WIDTH = 72;

const ART_LINE = /[█╔╚║═┌┐└┘│─]|\u001b\[/;
const LIST_ITEM = /^(\s*)([-*·]|\d+\.)\s+/;
/** Comfortable reading measure — full terminal width is a wall of text. */
export function displayWidth(preferred = CHAT_WRAP_WIDTH): number {
  const cols = stdout.columns ?? preferred;
  return Math.max(40, Math.min(preferred, cols > 2 ? cols - 2 : preferred));
}

/** Word-wrap prose so the terminal does not split tokens mid-word. */
export function wrapDisplayText(text: string, width = displayWidth()): string {
  return text.split("\n").map((line) => wrapOneLine(line, width)).join("\n");
}

/**
 * Format a chat reply for the terminal: short measure, paragraph breaks,
 * hanging list indents. Prefer this over raw wrap for Flyd answers.
 */
export function formatChatReply(text: string, width = displayWidth()): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (!normalized) return "";

  const blocks = splitReplyBlocks(normalized, width);
  const rendered = blocks.map((block) => formatBlock(block, width)).filter(Boolean);
  return rendered.join("\n\n");
}

function splitReplyBlocks(text: string, width: number): string[] {
  const rough = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  const budget = Math.max(120, width * 2);
  for (const chunk of rough) {
    if (isListBlock(chunk) || chunk.includes("\n")) {
      out.push(chunk);
      continue;
    }
    // Break long single-paragraph walls into sentence groups (~2 sentences).
    if (chunk.length <= budget) {
      out.push(chunk);
      continue;
    }
    const sentences = chunk.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [chunk];
    let group = "";
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const next = group ? `${group} ${sentence}` : sentence;
      if (group && next.length > budget) {
        out.push(group);
        group = sentence;
      } else {
        group = next;
      }
    }
    if (group) out.push(group);
  }
  return out;
}

function isListBlock(chunk: string): boolean {
  const lines = chunk.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return LIST_ITEM.test(lines[0] ?? "");
  return lines.filter((l) => LIST_ITEM.test(l)).length >= Math.ceil(lines.length / 2);
}

function formatBlock(block: string, width: number): string {
  const lines = block.split("\n");
  if (isListBlock(block)) {
    return lines.map((line) => wrapListLine(line, width)).join("\n");
  }
  // Collapse soft newlines inside a prose paragraph, then wrap with body indent.
  const prose = lines.map((l) => l.trim()).filter(Boolean).join(" ");
  return wrapOneLine(`  ${prose}`, width);
}

function wrapListLine(line: string, width: number): string {
  const match = line.match(LIST_ITEM);
  if (!match) return wrapOneLine(`  ${line.trim()}`, width);
  const marker = match[2];
  const body = line.slice(match[0].length).trim();
  const prefix = `  ${marker} `;
  const hang = " ".repeat(prefix.length);
  return wrapWithHang(`${prefix}${body}`, prefix, hang, width);
}

function wrapOneLine(line: string, width: number): string {
  if (line.length <= width || ART_LINE.test(line)) return line;
  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch?.[1] ?? "";
  const rest = line.slice(indent.length);
  const list = rest.match(/^([-*·]|\d+\.)\s+/);
  const bullet = list ? list[0] : "";
  const prefix = indent + bullet;
  const hang = indent + (bullet ? " ".repeat(bullet.length) : "");
  return wrapWithHang(line, prefix, hang, width);
}

function wrapWithHang(line: string, prefix: string, hang: string, width: number): string {
  if (ART_LINE.test(line)) return line;
  const body = line.startsWith(prefix) ? line.slice(prefix.length) : line.trimStart();
  const max = Math.max(24, width - prefix.length);
  const words = body.split(/\s+/).filter(Boolean);
  if (!words.length) return prefix.trimEnd();
  const rows: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      rows.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) rows.push(current);
  return rows.map((row, i) => `${i === 0 ? prefix : hang}${row}`).join("\n");
}
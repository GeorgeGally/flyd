import { createInterface } from "readline/promises";
import type { Interface } from "readline/promises";
import { StringDecoder } from "string_decoder";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { stdin, stdout } from "process";
import { FLYD_DIR } from "../lib/config.js";
import {
  BRACKETED_PASTE_DISABLE,
  BRACKETED_PASTE_ENABLE,
  createLineReaderState,
  feedLineReader,
} from "./tty-line-reader.js";

export const DEFAULT_INPUT_HISTORY_SIZE = 100;
export const DEFAULT_INPUT_HISTORY_PATH = join(FLYD_DIR, "cli-input-history");

/** Newest-first list, matching Node readline's history order. */
export function parseInputHistory(raw: string, maxEntries: number): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  return lines.slice(0, Math.max(1, maxEntries));
}

export function loadInputHistory(path: string, maxEntries = DEFAULT_INPUT_HISTORY_SIZE): string[] {
  try {
    if (!existsSync(path)) return [];
    return parseInputHistory(readFileSync(path, "utf8"), maxEntries);
  } catch {
    return [];
  }
}

export function saveInputHistory(path: string, history: string[], maxEntries = DEFAULT_INPUT_HISTORY_SIZE): void {
  const lines = history
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(0, Math.max(1, maxEntries));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
}

/** Record a submitted line into newest-first history (readline-compatible). */
export function rememberInputLine(history: string[], line: string, maxEntries = DEFAULT_INPUT_HISTORY_SIZE): string[] {
  if (line.length === 0) return history;
  return [line, ...history.filter((entry) => entry !== line)].slice(0, Math.max(1, maxEntries));
}

const ART_LINE = /[█╔╚║═┌┐└┘│─]|\u001b\[/;
const LIST_ITEM = /^(\s*)([-*·]|\d+\.)\s+/;
/** Comfortable reading measure — full terminal width is a wall of text. */
export const CHAT_WRAP_WIDTH = 72;

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

export type NodeTerminalOptions = {
  historyPath?: string | null;
  historySize?: number;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

let signalCleanupRegistered = false;

export class NodeTerminal {
  private readonly interface: Interface | null;
  private readonly historyPath: string | null;
  private readonly historySize: number;
  private history: string[];
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private readonly isTty: boolean;
  private pasteEnabled = false;

  constructor(options: NodeTerminalOptions = {}) {
    this.historySize = options.historySize ?? DEFAULT_INPUT_HISTORY_SIZE;
    this.historyPath = options.historyPath === undefined
      ? DEFAULT_INPUT_HISTORY_PATH
      : options.historyPath;
    this.input = options.input ?? stdin;
    this.output = options.output ?? stdout;
    this.history = this.historyPath
      ? loadInputHistory(this.historyPath, this.historySize)
      : [];
    this.isTty = Boolean((this.input as NodeJS.ReadStream).isTTY);

    // Non-TTY (pipes/tests) still use readline.question.
    this.interface = this.isTty
      ? null
      : createInterface({
          input: this.input,
          output: this.output,
          terminal: false,
          history: [...this.history],
          historySize: this.historySize,
          removeHistoryDuplicates: true,
        } as Parameters<typeof createInterface>[0]);

    if (this.isTty && !signalCleanupRegistered) {
      signalCleanupRegistered = true;
      const onSignal = (signal: NodeJS.Signals) => {
        this.disableBracketedPaste();
        try {
          const stream = this.input as NodeJS.ReadStream;
          if (typeof stream.setRawMode === "function") stream.setRawMode(false);
        } catch {
          // ignore
        }
        // Restoring the default handler preserves Node's terminate-on-signal behavior.
        process.on(signal, () => process.exit(signal === "SIGINT" ? 130 : 143));
        process.kill(process.pid, signal);
      };
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
    }
  }

  write(message: string): void {
    this.output.write(message);
  }

  async ask(prompt: string): Promise<string> {
    const answer = this.isTty
      ? await this.askTty(`${prompt} `)
      : await this.interface!.question(`${prompt} `);
    this.history = rememberInputLine(this.history, answer, this.historySize);
    this.persistHistory();
    return answer;
  }

  async confirm(prompt: string): Promise<boolean> {
    const answer = (await this.ask(`${prompt} [y/N]`)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }

  async close(): Promise<void> {
    this.persistHistory();
    this.disableBracketedPaste();
    this.interface?.close();
    try {
      const stream = this.input as NodeJS.ReadStream;
      if (typeof stream.setRawMode === "function" && stream.isTTY) {
        stream.setRawMode(false);
      }
    } catch {
      // ignore
    }
    if (this.input === stdin) stdin.pause();
  }

  private enableBracketedPaste(): void {
    if (this.pasteEnabled) return;
    this.output.write(BRACKETED_PASTE_ENABLE);
    this.pasteEnabled = true;
  }

  private disableBracketedPaste(): void {
    if (!this.pasteEnabled) return;
    this.output.write(BRACKETED_PASTE_DISABLE);
    this.pasteEnabled = false;
  }

  /**
   * TTY input that does not submit on pasted newlines.
   * Terminals wrap paste in ESC[200~ … ESC[201~ when bracketed paste is on.
   */
  private async askTty(prompt: string): Promise<string> {
    const stream = this.input as NodeJS.ReadStream;
    this.output.write(prompt);
    this.enableBracketedPaste();
    if (typeof stream.setRawMode === "function") stream.setRawMode(true);
    stream.resume();

    let state = createLineReaderState();
    const decoder = new StringDecoder("utf8");

    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        stream.off("data", onData);
        stream.off("end", onEnd);
        stream.off("error", onError);
        try {
          if (typeof stream.setRawMode === "function") stream.setRawMode(false);
        } catch {
          // ignore
        }
        this.disableBracketedPaste();
      };

      const onEnd = () => {
        cleanup();
        reject(new Error("Interrupted"));
      };
      const onError = () => {
        cleanup();
        reject(new Error("Interrupted"));
      };

      const onData = (buf: Buffer | string) => {
        const chunk = typeof buf === "string" ? buf : decoder.write(buf);
        const result = feedLineReader(state, chunk, this.history);
        state = result.state;
        if (result.echo) this.output.write(result.echo);
        if (result.pasteEnded) {
          const lines = state.buffer.split("\n").length;
          const preview = state.buffer.split("\n")[0]?.slice(0, 60) ?? "";
          const more = state.buffer.length > 60 || lines > 1 ? "…" : "";
          this.output.write(
            `\n[pasted ${lines} line${lines === 1 ? "" : "s"}, ${state.buffer.length} chars — ${preview}${more}]\n` +
              "(Enter to send, or keep typing)\n",
          );
          this.output.write(state.buffer);
        }
        if (result.redraw !== undefined) {
          // Clear current visual line(s) and rewrite buffer.
          this.output.write(`\r\x1b[2K${prompt}${result.redraw}`);
        }
        if (result.interrupt) {
          cleanup();
          this.output.write("^C\n");
          reject(new Error("Interrupted"));
          return;
        }
        if (result.submit !== undefined) {
          cleanup();
          resolve(result.submit);
        }
      };

      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("error", onError);
    });
  }

  private persistHistory(): void {
    if (!this.historyPath) return;
    try {
      saveInputHistory(this.historyPath, this.history, this.historySize);
    } catch {
      // History is best-effort; never break the prompt loop.
    }
  }
}

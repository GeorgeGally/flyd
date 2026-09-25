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
import { wrapDisplayText } from "./text-wrap.js";
import { renderScreen, screenLayout, transcriptWidth, type ScreenView } from "./screen.js";

export { CHAT_WRAP_WIDTH, displayWidth, wrapDisplayText, formatChatReply } from "./text-wrap.js";

export const DEFAULT_INPUT_HISTORY_SIZE = 100;

const ANSI_RESET = "\u001b[0m";
const ALT_SCREEN_ON = "\u001b[?1049h";
const ALT_SCREEN_OFF = "\u001b[?1049l";
const CURSOR_HIDE = "\u001b[?25l";
const CURSOR_SHOW = "\u001b[?25h";
const USER_BG = "\u001b[43m";
const USER_FG = "\u001b[30m";
const DIM = "\u001b[2m";
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PGUP = "\x1b[5~";
const PGDN = "\x1b[6~";
/** Trackpad/wheel scroll only reaches the app when mouse reporting is on. */
const MOUSE_ON = "\u001b[?1000h\u001b[?1006h";
const MOUSE_OFF = "\u001b[?1000l\u001b[?1006l";
const MOUSE_EVENT = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
const WHEEL_LINES = 3;
const HALF_PAGE = 0.5;
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

export type NodeTerminalOptions = {
  historyPath?: string | null;
  historySize?: number;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Full-screen mode: pinned input, scrolling viewport. Only on a TTY. */
  tui?: boolean;
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
  private readonly tuiMode: boolean;
  private pasteEnabled = false;

  /** Full-screen pinned-input mode — agent-session adapts its framing to it. */
  get tui(): boolean {
    return this.tuiMode;
  }

  // TUI state — the input reader stays live the whole session, so messages
  // can be typed while a turn is streaming and queue behind it.
  private transcript: string[] = [];
  private live = "";
  private inputState = createLineReaderState();
  private prompt = "";
  private echoColor = "";
  private status = "";
  private pending: string[] = [];
  private scroll = 0;
  private busy = false;
  private spinTimer: ReturnType<typeof setInterval> | undefined;
  private spinIdx = 0;
  private turnStartedAt = 0;
  private askResolve: ((text: string) => void) | undefined;
  private submitted: string[] = [];
  private readonly decoder = new StringDecoder("utf8");
  private readonly resizeHandler: (() => void) | null = null;

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
    this.tuiMode = Boolean(options.tui && this.isTty);

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
        if (this.tuiMode) this.output.write(CURSOR_SHOW + ALT_SCREEN_OFF + MOUSE_OFF);
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

    if (this.tuiMode) {
      this.output.write(ALT_SCREEN_ON + CURSOR_HIDE + MOUSE_ON);
      this.enableBracketedPaste();
      const stream = this.input as NodeJS.ReadStream;
      if (typeof stream.setRawMode === "function") stream.setRawMode(true);
      stream.resume();
      stream.on("data", this.onInputData);
      if (this.output === stdout) {
        this.resizeHandler = () => this.render();
        stdout.on("resize", this.resizeHandler);
      }
      this.render();
    }
  }

  write(message: string): void {
    if (!this.tuiMode) {
      this.output.write(message);
      return;
    }
    if (this.live) this.commitLive();
    const width = transcriptWidth(this.size().cols);
    const before = this.transcript.length;
    for (const raw of message.replace(/\r\n/g, "\n").split("\n")) {
      // Callers that pre-color (art, wrapped replies) have pre-wrapped.
      if (raw.includes("\x1b")) {
        this.transcript.push(raw);
        continue;
      }
      for (const line of wrapDisplayText(raw, width).split("\n")) this.transcript.push(line);
    }
    // Keep the reader's place: only follow the tail when already at the bottom.
    if (this.scroll > 0) this.scroll += this.transcript.length - before;
    this.render();
  }

  /** Live assistant streaming; buffered as a block and colored green. */
  stream(token: string): void {
    if (!this.tuiMode) {
      this.output.write(token);
      return;
    }
    const before = this.wrappedLines(this.live);
    this.live += token;
    if (this.scroll > 0) this.scroll += this.wrappedLines(this.live) - before;
    this.render();
  }

  private wrappedLines(text: string): number {
    if (!text) return 0;
    return wrapDisplayText(text, transcriptWidth(this.size().cols)).split("\n").length;
  }

  /** Thinking indicator; TUI renders it in the status line, never in the stream. */
  setBusy(busy: boolean): void {
    if (!this.tuiMode || this.busy === busy) return;
    this.busy = busy;
    if (busy) {
      this.turnStartedAt = Date.now();
      this.spinIdx = 0;
      this.spinTimer = setInterval(() => {
        this.spinIdx = (this.spinIdx + 1) % SPIN.length;
        this.render();
      }, 120);
    } else if (this.spinTimer) {
      clearInterval(this.spinTimer);
      this.spinTimer = undefined;
    }
    this.render();
  }

  /** Messages waiting behind the running turn, shown above the input. */
  setPending(messages: string[]): void {
    if (!this.tuiMode) return;
    this.pending = messages;
    this.render();
  }

  async ask(prompt: string, echoColor?: string): Promise<string> {
    if (this.tuiMode) return this.askTui(prompt, echoColor);
    const answer = this.isTty
      ? await this.askTty(`${prompt} `, echoColor)
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
    if (this.tuiMode) {
      if (this.spinTimer) clearInterval(this.spinTimer);
      this.output.write(CURSOR_SHOW + ALT_SCREEN_OFF + MOUSE_OFF);
      this.disableBracketedPaste();
      const stream = this.input as NodeJS.ReadStream;
      stream.off("data", this.onInputData);
      if (this.resizeHandler && stdout === this.output) stdout.off("resize", this.resizeHandler);
      try {
        if (typeof stream.setRawMode === "function") stream.setRawMode(false);
      } catch {
        // ignore
      }
      if (this.input === stdin) stdin.pause();
      return;
    }
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

  private onInputData = (buf: Buffer | string): void => {
    let chunk = typeof buf === "string" ? buf : this.decoder.write(buf);
    // Viewport scrolling — strip scroll keys and mouse reports before the
    // line reader sees them.
    if (chunk.includes(PGUP)) {
      this.scrollBy(this.halfPage());
      chunk = chunk.split(PGUP).join("");
    }
    if (chunk.includes(PGDN)) {
      this.scrollBy(-this.halfPage());
      chunk = chunk.split(PGDN).join("");
    }
    const wheel = this.takeWheelLines(chunk);
    chunk = wheel.rest;
    if (wheel.lines !== 0) this.scrollBy(wheel.lines);
    if (!chunk) {
      this.render();
      return;
    }

    const result = feedLineReader(this.inputState, chunk, this.history);
    this.inputState = result.state;

    if (result.interrupt) {
      this.close();
      process.exit(130);
    }

    if (result.submit !== undefined) {
      this.history = rememberInputLine(this.history, result.submit, this.historySize);
      this.persistHistory();
      this.commitUserMessage(result.submit);
      this.prompt = "";
      this.inputState = createLineReaderState();
      if (this.askResolve) {
        const resolve = this.askResolve;
        this.askResolve = undefined;
        resolve(result.submit);
      } else {
        this.submitted.push(result.submit);
      }
    }
    this.render();
  };

  private async askTui(prompt: string, echoColor?: string): Promise<string> {
    if (this.live) this.commitLive();
    this.prompt = prompt;
    this.echoColor = echoColor ?? "";
    this.inputState = createLineReaderState();
    this.scroll = 0;
    if (this.submitted.length) {
      const text = this.submitted.shift()!;
      this.prompt = "";
      this.render();
      return text;
    }
    this.render();
    return new Promise<string>((resolve) => {
      this.askResolve = resolve;
    });
  }

  private commitUserMessage(text: string): void {
    const width = transcriptWidth(this.size().cols);
    for (const line of wrapDisplayText(text, width).split("\n")) {
      const body = ` ${line}`;
      const padded = body + " ".repeat(Math.max(0, width - body.length));
      this.transcript.push(`${USER_BG}${USER_FG}${padded}${ANSI_RESET}`);
    }
  }

  private commitLive(): void {
    const width = transcriptWidth(this.size().cols);
    for (const line of wrapDisplayText(this.live, width).split("\n")) {
      this.transcript.push(line);
    }
    this.live = "";
  }

  private halfPage(): number {
    const { viewport } = screenLayout(this.view(), this.size());
    return Math.max(1, Math.floor(viewport * HALF_PAGE));
  }

  /** Positive lines scroll up into history; negative returns to the tail. */
  private scrollBy(lines: number): void {
    const { maxScroll } = screenLayout(this.view(), this.size());
    this.scroll = Math.min(maxScroll, Math.max(0, this.scroll + lines));
  }

  /** Pull wheel reports out of the chunk; SGR button 64/65 is wheel up/down. */
  private takeWheelLines(chunk: string): { rest: string; lines: number } {
    let lines = 0;
    const rest = chunk.replace(MOUSE_EVENT, (_match: string, code: string) => {
      const button = Number(code);
      if ((button & 64) === 0) return "";
      lines += (button & 1) === 0 ? WHEEL_LINES : -WHEEL_LINES;
      return "";
    });
    return { rest, lines };
  }

  private view(): ScreenView {
    return {
      lines: this.transcript,
      live: this.live,
      liveColor: "\u001b[32m",
      input: this.inputState.buffer,
      cursor: this.inputState.cursor,
      prompt: this.prompt,
      inputColor: this.echoColor,
      status: this.statusLine(),
      pending: this.pendingLines(),
      separator: `${DIM}${"\u2500".repeat(Math.max(1, this.size().cols))}${ANSI_RESET}`,
      scroll: this.scroll,
    };
  }

  private statusLine(): string {
    if (!this.busy) return "";
    const seconds = Math.round((Date.now() - this.turnStartedAt) / 1000);
    const elapsed = seconds > 0 ? ` (${seconds}s)` : "";
    return `\u001b[36m${SPIN[this.spinIdx]} Thinking${elapsed}…${ANSI_RESET}`;
  }

  private pendingLines(): string[] {
    const width = Math.max(10, this.size().cols - 14);
    return this.pending.map((text) => {
      const first = text.split("\n")[0] ?? "";
      const clipped = first.length > width ? `${first.slice(0, width - 1)}…` : first;
      return `${DIM}  ⏳ ${clipped}${ANSI_RESET}`;
    });
  }

  private size(): { rows: number; cols: number } {
    const stream = this.output as NodeJS.WriteStream & { rows?: number; columns?: number };
    return { rows: stream.rows ?? 24, cols: stream.columns ?? 80 };
  }

  private render(): void {
    if (!this.tuiMode) return;
    this.output.write(renderScreen(this.view(), this.size()).text);
  }

  private persistHistory(): void {
    if (!this.historyPath) return;
    try {
      saveInputHistory(this.historyPath, this.history, this.historySize);
    } catch {
      // History is best-effort; never break the prompt loop.
    }
  }

  /**
   * TTY input that does not submit on pasted newlines (legacy scrollback mode).
   * Terminals wrap paste in ESC[200~ … ESC[201~ when bracketed paste is on.
   */
  private async askTty(prompt: string, echoColor?: string): Promise<string> {
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
        if (result.echo) this.output.write(colored(result.echo, echoColor));
        if (result.pasteEnded) {
          const lines = state.buffer.split("\n").length;
          const preview = state.buffer.split("\n")[0]?.slice(0, 60) ?? "";
          const more = state.buffer.length > 60 || lines > 1 ? "…" : "";
          this.output.write(
            `\n[pasted ${lines} line${lines === 1 ? "" : "s"}, ${state.buffer.length} chars — ${preview}${more}]\n` +
              "(Enter to send, or keep typing)\n",
          );
          this.output.write(colored(state.buffer, echoColor));
        }
        if (result.redraw !== undefined) {
          // Clear current visual line(s) and rewrite buffer.
          this.output.write(`\r\x1b[2K${prompt}${colored(result.redraw, echoColor)}`);
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
}

function colored(text: string, color?: string): string {
  return color ? `${color}${text}${ANSI_RESET}` : text;
}
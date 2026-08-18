/**
 * Bracketed-paste-aware line reader.
 * Without this, Node readline treats every pasted newline as Enter.
 */

export const BRACKETED_PASTE_ENABLE = "\x1b[?2004h";
export const BRACKETED_PASTE_DISABLE = "\x1b[?2004l";
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export interface LineReaderState {
  buffer: string;
  pasteMode: boolean;
  /** Incomplete escape / paste marker at end of prior chunk. */
  pending: string;
  historyIndex: number;
  stash: string;
}

export function createLineReaderState(): LineReaderState {
  return { buffer: "", pasteMode: false, pending: "", historyIndex: -1, stash: "" };
}

export interface LineReaderResult {
  state: LineReaderState;
  /** Text to write to the terminal (echo). */
  echo: string;
  /** Set when the line is complete (user pressed Enter outside paste). */
  submit?: string;
  /** Ctrl+C */
  interrupt?: boolean;
  /** Clear + redraw the current buffer (history navigation). */
  redraw?: string;
  /** Bracketed paste just ended — show a compact summary instead of dumping text. */
  pasteEnded?: boolean;
}

/**
 * Feed raw stdin bytes. Newlines inside bracketed paste stay in the buffer.
 * Only Enter outside paste submits.
 */
export function feedLineReader(
  state: LineReaderState,
  chunk: string,
  history: string[] = [],
): LineReaderResult {
  let { buffer, pasteMode, pending, historyIndex, stash } = state;
  let echo = "";
  let submit: string | undefined;
  let interrupt = false;
  let redraw: string | undefined;
  let pasteEnded = false;
  const input = pending + chunk;
  pending = "";
  let i = 0;

  while (i < input.length) {
    if (!pasteMode && input.startsWith(PASTE_START, i)) {
      pasteMode = true;
      i += PASTE_START.length;
      continue;
    }
    if (pasteMode && input.startsWith(PASTE_END, i)) {
      pasteMode = false;
      pasteEnded = true;
      i += PASTE_END.length;
      continue;
    }
    // Incomplete paste marker at end of chunk — wait for more bytes.
    if (!pasteMode && isIncompleteMarker(input, i, PASTE_START)) {
      pending = input.slice(i);
      break;
    }
    if (pasteMode && isIncompleteMarker(input, i, PASTE_END)) {
      pending = input.slice(i);
      break;
    }

    const ch = input[i];

    if (pasteMode) {
      // Keep paste in the buffer but do not echo — huge dumps trash the TTY.
      if (ch === "\r") {
        i += 1;
        continue;
      }
      if (ch === "\n") {
        buffer += "\n";
        i += 1;
        continue;
      }
      if (ch === "\x1b") {
        const rest = input.slice(i);
        if (isIncompleteCsi(input, i)) {
          pending = rest;
          break;
        }
        const skipped = skipEscape(input, i);
        i = skipped;
        continue;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    // --- typed input ---
    if (ch === "\x03") {
      interrupt = true;
      break;
    }
    if (ch === "\r" || ch === "\n") {
      submit = buffer;
      echo += "\n";
      buffer = "";
      historyIndex = -1;
      stash = "";
      i += 1;
      // Ignore the rest of a CRLF pair in this chunk after submit.
      if (ch === "\r" && input[i] === "\n") i += 1;
      break;
    }
    if (ch === "\x7f" || ch === "\b") {
      if (buffer.length) {
        const removed = buffer.slice(-1);
        buffer = buffer.slice(0, -1);
        echo += removed === "\n" ? "\x1b[1A\x1b[0K" : "\b \b";
      }
      i += 1;
      continue;
    }
    if (ch === "\x1b") {
      const rest = input.slice(i);
      if (rest === "\x1b" || rest === "\x1b[") {
        pending = rest;
        break;
      }
      // Up / down history
      if (rest.startsWith("\x1b[A")) {
        if (history.length) {
          if (historyIndex < 0) stash = buffer;
          const next = Math.min(history.length - 1, historyIndex + 1);
          historyIndex = next;
          buffer = history[next] ?? buffer;
          redraw = buffer;
        }
        i += 3;
        continue;
      }
      if (rest.startsWith("\x1b[B")) {
        if (historyIndex >= 0) {
          historyIndex -= 1;
          buffer = historyIndex < 0 ? stash : (history[historyIndex] ?? "");
          redraw = buffer;
        }
        i += 3;
        continue;
      }
      if (isIncompleteCsi(input, i)) {
        pending = rest;
        break;
      }
      i = skipEscape(input, i);
      continue;
    }
    // Ignore other controls
    if (ch < " " && ch !== "\t") {
      i += 1;
      continue;
    }
    buffer += ch;
    echo += ch;
    i += 1;
  }

  return {
    state: { buffer, pasteMode, pending, historyIndex, stash },
    echo,
    ...(submit !== undefined ? { submit } : {}),
    ...(interrupt ? { interrupt: true } : {}),
    ...(redraw !== undefined ? { redraw } : {}),
    ...(pasteEnded ? { pasteEnded: true } : {}),
  };
}

function isIncompleteMarker(input: string, index: number, marker: string): boolean {
  const rest = input.slice(index);
  if (!rest.startsWith("\x1b")) return false;
  return marker.startsWith(rest) && rest.length < marker.length;
}

/** CSI sequence (ESC [ ... final letter) cut off at end of chunk — wait for more bytes. */
function isIncompleteCsi(input: string, index: number): boolean {
  const rest = input.slice(index);
  if (!rest.startsWith("\x1b[")) return false;
  for (let j = 2; j < rest.length; j += 1) {
    if (/[A-Za-z~]/.test(rest[j]!)) return false;
  }
  return true;
}

function skipEscape(input: string, index: number): number {
  // Skip CSI sequences: ESC [ ... letter
  if (input[index + 1] === "[") {
    let j = index + 2;
    while (j < input.length && !/[A-Za-z~]/.test(input[j]!)) j += 1;
    return Math.min(input.length, j + 1);
  }
  return Math.min(input.length, index + 2);
}

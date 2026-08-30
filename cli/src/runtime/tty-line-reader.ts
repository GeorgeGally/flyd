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
  /** UTF-16 offset of the edit cursor in buffer. */
  cursor: number;
  pasteMode: boolean;
  /** Incomplete escape / paste marker at end of prior chunk. */
  pending: string;
  historyIndex: number;
  stash: string;
}

export function createLineReaderState(): LineReaderState {
  return { buffer: "", cursor: 0, pasteMode: false, pending: "", historyIndex: -1, stash: "" };
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
  let { buffer, cursor, pasteMode, pending, historyIndex, stash } = state;
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
        buffer = insertAt(buffer, cursor, "\n");
        cursor += 1;
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
      buffer = insertAt(buffer, cursor, ch);
      cursor += ch.length;
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
      cursor = 0;
      historyIndex = -1;
      stash = "";
      i += 1;
      // Ignore the rest of a CRLF pair in this chunk after submit.
      if (ch === "\r" && input[i] === "\n") i += 1;
      break;
    }
    if (ch === "\x7f" || ch === "\b") {
      if (cursor > 0) {
        const removed = buffer[cursor - 1] ?? "";
        buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
        cursor -= 1;
        if (removed === "\n") {
          echo += "\x1b[1A\x1b[0K";
        } else {
          const tail = buffer.slice(cursor);
          echo += tail ? `\b\x1b[0K${tail}\x1b[${tail.length}D` : "\b \b";
        }
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
          cursor = buffer.length;
          redraw = buffer;
        }
        i += 3;
        continue;
      }
      if (rest.startsWith("\x1b[B")) {
        if (historyIndex >= 0) {
          historyIndex -= 1;
          buffer = historyIndex < 0 ? stash : (history[historyIndex] ?? "");
          cursor = buffer.length;
          redraw = buffer;
        }
        i += 3;
        continue;
      }
      // Left / right arrows move the edit cursor.
      if (rest.startsWith("\x1b[D")) {
        if (cursor > 0) {
          cursor -= 1;
          echo += "\x1b[D";
        }
        i += 3;
        continue;
      }
      if (rest.startsWith("\x1b[C")) {
        if (cursor < buffer.length) {
          cursor += 1;
          echo += "\x1b[C";
        }
        i += 3;
        continue;
      }
      // Forward Delete removes the char at the cursor.
      if (rest.startsWith("\x1b[3~")) {
        if (cursor < buffer.length) {
          buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1);
          const tail = buffer.slice(cursor);
          echo += tail ? `\x1b[0K${tail}\x1b[${tail.length}D` : "\x1b[0K";
        }
        i += 4;
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
    buffer = insertAt(buffer, cursor, ch);
    cursor += ch.length;
    const tail = buffer.slice(cursor);
    echo += tail ? `${ch}${tail}\x1b[${tail.length}D` : ch;
    i += 1;
  }

  return {
    state: { buffer, cursor, pasteMode, pending, historyIndex, stash },
    echo,
    ...(submit !== undefined ? { submit } : {}),
    ...(interrupt ? { interrupt: true } : {}),
    ...(redraw !== undefined ? { redraw } : {}),
    ...(pasteEnded ? { pasteEnded: true } : {}),
  };
}

function insertAt(str: string, index: number, ins: string): string {
  return str.slice(0, index) + ins + str.slice(index);
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

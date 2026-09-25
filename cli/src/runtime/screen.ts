import { wrapDisplayText } from "./text-wrap.js";

export interface ScreenSize {
  rows: number;
  cols: number;
}

export interface ScreenView {
  /** Committed transcript lines, already wrapped (and possibly colored). */
  lines: string[];
  /** Streaming assistant text not yet committed. Wrapped and colored here. */
  live: string;
  liveColor: string;
  /** Current input buffer. */
  input: string;
  /** Caret offset within input. */
  cursor: number;
  prompt: string;
  inputColor: string;
  /** Status line content (already colored), empty to omit the row. */
  status: string;
  /** One-line pending entries (already colored). */
  pending: string[];
  separator: string;
  /** Lines scrolled up from the bottom of the transcript. */
  scroll: number;
}

export interface ScreenLayout {
  viewport: number;
  maxScroll: number;
  bottomRows: number;
}

/** Comfortable transcript measure, capped so wide terminals stay readable. */
export function transcriptWidth(cols: number): number {
  return Math.max(20, Math.min(100, cols - 2));
}

export function screenLayout(view: ScreenView, size: ScreenSize): ScreenLayout {
  const inputLines = wrapDisplayText(view.input, inputWidth(size, view)).split("\n");
  const bottomRows = 1 + view.pending.length + inputLines.length + (view.status ? 1 : 0);
  const viewport = Math.max(1, size.rows - bottomRows);
  const liveRows = view.live
    ? wrapDisplayText(view.live, transcriptWidth(size.cols)).split("\n").length
    : 0;
  return { viewport, maxScroll: Math.max(0, view.lines.length + liveRows - viewport), bottomRows };
}

export interface RenderedFrame {
  /** Full escape sequence: home, all rows, cursor placement. */
  text: string;
  cursorRow: number;
  cursorCol: number;
}

/** Build one full-screen frame. Line math stays pure so it is testable. */
export function renderScreen(view: ScreenView, size: ScreenSize): RenderedFrame {
  const { rows, cols } = size;
  const layout = screenLayout(view, size);
  const liveLines = view.live
    ? wrapDisplayText(view.live, transcriptWidth(cols)).split("\n")
        .map((line) => colorize(line, view.liveColor))
    : [];
  const body = [...view.lines, ...liveLines];
  const scroll = Math.min(Math.max(0, view.scroll), layout.maxScroll);
  const end = body.length - scroll;
  const start = Math.max(0, end - layout.viewport);
  const visible = [...body.slice(start, end)];
  while (visible.length < layout.viewport) visible.unshift("");

  const width = inputWidth(size, view);
  const inputLines = wrapDisplayText(view.input, width).split("\n")
    .map((line) => colorize(view.prompt + line, view.inputColor));
  const rowsOut: string[] = [
    ...visible,
    view.separator,
    ...view.pending,
    ...inputLines,
    ...(view.status ? [view.status] : []),
  ];
  // If the terminal shrank below the layout, drop overflow from the viewport.
  const overflow = Math.max(0, rowsOut.length - rows);
  if (overflow) rowsOut.splice(0, overflow);

  const prefixLines = wrapDisplayText(view.input.slice(0, view.cursor), width).split("\n");
  const inputStart = visible.length + 1 + view.pending.length - overflow;
  let cursorRow = Math.min(Math.max(1, inputStart + prefixLines.length), rows);
  let cursorCol = Math.min(
    view.prompt.length + (prefixLines[prefixLines.length - 1]?.length ?? 0) + 1,
    cols,
  );

  const text =
    "\x1b[H" +
    rowsOut.map((line) => line + "\x1b[K").join("\r\n") +
    `\x1b[${cursorRow};${cursorCol}H`;
  return { text, cursorRow, cursorCol };
}

function inputWidth(size: ScreenSize, view: ScreenView): number {
  return Math.max(8, size.cols - view.prompt.length);
}

function colorize(text: string, color: string): string {
  return color ? `${color}${text}\x1b[0m` : text;
}
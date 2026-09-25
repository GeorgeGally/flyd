import { describe, expect, it } from "vitest";
import { renderScreen, screenLayout, type ScreenView } from "../screen.js";

function view(overrides: Partial<ScreenView> = {}): ScreenView {
  return {
    lines: [],
    live: "",
    liveColor: "",
    input: "",
    cursor: 0,
    prompt: "You > ",
    inputColor: "",
    status: "",
    pending: [],
    separator: "",
    scroll: 0,
    ...overrides,
  };
}

describe("screenLayout", () => {
  it("reserves the bottom rows for input and sizes the viewport above", () => {
    const layout = screenLayout(view(), { rows: 24, cols: 80 });
    expect(layout).toEqual({ viewport: 22, bottomRows: 2, maxScroll: 0 });
  });

  it("grows the bottom when messages queue", () => {
    const layout = screenLayout(view({ pending: ["⏳ queued: fix the chat"] }), { rows: 24, cols: 80 });
    expect(layout).toEqual({ viewport: 21, bottomRows: 3, maxScroll: 0 });
  });

  it("caps scroll at the transcript length above the viewport", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const layout = screenLayout(view({ lines }), { rows: 10, cols: 80 });
    expect(layout).toEqual({ viewport: 8, bottomRows: 2, maxScroll: 22 });
  });
});

describe("renderScreen", () => {
  it("pins the input line to the bottom row", () => {
    const frame = renderScreen(view({ lines: ["one", "two"], input: "hi", cursor: 2 }), { rows: 10, cols: 80 });
    const rows = frame.text.split("\r\n");
    expect(rows).toHaveLength(10);
    expect(rows[9]).toContain("You > hi");
    expect(frame.cursorRow).toBe(10);
    expect(frame.cursorCol).toBe(9);
  });

  it("clamps an oversized scroll to the top of the transcript", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const frame = renderScreen(view({ lines, scroll: 999 }), { rows: 10, cols: 80 });
    expect(frame.text).toContain("line 0");
    expect(frame.text).toContain("line 7");
    expect(frame.text).not.toContain("line 22");
  });

  it("scrolls part-way into the transcript", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const frame = renderScreen(view({ lines, scroll: 10 }), { rows: 10, cols: 80 });
    expect(frame.text).toContain("line 12");
    expect(frame.text).toContain("line 19");
    expect(frame.text).not.toContain("line 0");
  });

  it("shows queued messages between the separator and the input", () => {
    const frame = renderScreen(
      view({ pending: ["⏳ queued: fix the chat"], input: "x", cursor: 1 }),
      { rows: 10, cols: 80 },
    );
    const rows = frame.text.split("\r\n");
    expect(rows[8]).toContain("fix the chat");
    expect(rows[9]).toContain("You > x");
  });

  it("wraps a long input and places the cursor on the wrapped line", () => {
    const input = "word ".repeat(20);
    const frame = renderScreen(view({ input, cursor: input.length }), { rows: 12, cols: 40 });
    expect(frame.text.split("\r\n")).toHaveLength(12);
    expect(frame.text).toContain("You > word word");
  });
});
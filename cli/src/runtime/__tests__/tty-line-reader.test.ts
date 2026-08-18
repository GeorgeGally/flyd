import { describe, expect, it } from "vitest";
import {
  createLineReaderState,
  feedLineReader,
} from "../tty-line-reader.js";

describe("feedLineReader / bracketed paste", () => {
  it("does not submit on newlines inside a paste bracket", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "\x1b[200~- one\n- two\n\x1b[201~");
    state = result.state;
    expect(result.submit).toBeUndefined();
    expect(result.pasteEnded).toBe(true);
    expect(result.echo).toBe("");
    expect(state.buffer).toBe("- one\n- two\n");
    expect(state.pasteMode).toBe(false);

    result = feedLineReader(state, "\r");
    expect(result.submit).toBe("- one\n- two\n");
  });

  it("still submits on Enter when typing normally", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "hello");
    state = result.state;
    expect(result.submit).toBeUndefined();
    result = feedLineReader(state, "\n");
    expect(result.submit).toBe("hello");
  });

  it("handles paste markers split across chunks", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "\x1b[20");
    state = result.state;
    expect(state.pending).toBe("\x1b[20");
    result = feedLineReader(state, "0~hello\nworld\x1b[201~");
    state = result.state;
    expect(state.buffer).toBe("hello\nworld");
    expect(result.submit).toBeUndefined();
    result = feedLineReader(state, "\n");
    expect(result.submit).toBe("hello\nworld");
  });

  it("backspaces typed characters", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "ab");
    state = result.state;
    result = feedLineReader(state, "\x7f");
    expect(result.state.buffer).toBe("a");
    expect(result.echo).toBe("\b \b");
  });

  it("keeps a CSI sequence split across chunks intact", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "x\x1b[1");
    state = result.state;
    expect(state.pending).toBe("\x1b[1");
    expect(state.buffer).toBe("x");
    result = feedLineReader(state, ";5Ay");
    expect(result.state.buffer).toBe("xy");
  });

  it("surfaces Ctrl+C as an interrupt", () => {
    let state = createLineReaderState();
    const result = feedLineReader(state, "abc\x03");
    expect(result.interrupt).toBe(true);
  });
});

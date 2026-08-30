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

  it("moves the edit cursor with left and right arrows", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "abc");
    state = result.state;
    expect(state.cursor).toBe(3);

    result = feedLineReader(state, "\x1b[D");
    state = result.state;
    expect(state.cursor).toBe(2);
    expect(result.echo).toBe("\x1b[D");

    result = feedLineReader(state, "\x1b[C");
    state = result.state;
    expect(state.cursor).toBe(3);
    expect(result.echo).toBe("\x1b[C");

    result = feedLineReader(state, "\x1b[D\x1b[D\x1b[D\x1b[D");
    expect(result.state.cursor).toBe(0);
    result = feedLineReader(state, "\x1b[C\x1b[C\x1b[C\x1b[C");
    expect(result.state.cursor).toBe(3);
  });

  it("forward-deletes the character at the edit cursor", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "abc");
    state = result.state;
    result = feedLineReader(state, "\x1b[D\x1b[D");
    state = result.state;
    expect(state.cursor).toBe(1);

    result = feedLineReader(state, "\x1b[3~");
    expect(result.state.buffer).toBe("ac");
    expect(result.state.cursor).toBe(1);
    expect(result.echo).toBe("\x1b[0Kc\x1b[1D");
  });

  it("forward-delete at end of line does nothing", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "ab");
    state = result.state;
    result = feedLineReader(state, "\x1b[3~");
    expect(result.state.buffer).toBe("ab");
    expect(result.state.cursor).toBe(2);
    expect(result.echo).toBe("");
  });

  it("backspaces the character before the edit cursor mid-line", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "abc");
    state = result.state;
    result = feedLineReader(state, "\x1b[D\x1b[D");
    state = result.state;
    expect(state.cursor).toBe(1);

    result = feedLineReader(state, "\x7f");
    expect(result.state.buffer).toBe("bc");
    expect(result.state.cursor).toBe(0);
    expect(result.echo).toBe("\b\x1b[0Kbc\x1b[2D");
  });

  it("backspace at the start of the line does nothing", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "ab");
    state = result.state;
    result = feedLineReader(state, "\x1b[D\x1b[D");
    state = result.state;
    expect(state.cursor).toBe(0);
    result = feedLineReader(state, "\x7f");
    expect(result.state.buffer).toBe("ab");
    expect(result.state.cursor).toBe(0);
  });

  it("inserts typed characters at the edit cursor", () => {
    let state = createLineReaderState();
    let result = feedLineReader(state, "ab");
    state = result.state;
    result = feedLineReader(state, "\x1b[D");
    state = result.state;
    expect(state.cursor).toBe(1);

    result = feedLineReader(state, "X");
    expect(result.state.buffer).toBe("aXb");
    expect(result.state.cursor).toBe(2);
    expect(result.echo).toBe("Xb\x1b[1D");
  });

  it("types at end of line keep the simple append echo", () => {
    let state = createLineReaderState();
    const result = feedLineReader(state, "a");
    expect(result.state.buffer).toBe("a");
    expect(result.state.cursor).toBe(1);
    expect(result.echo).toBe("a");
  });
});

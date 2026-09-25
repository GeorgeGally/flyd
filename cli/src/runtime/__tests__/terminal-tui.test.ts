import { PassThrough } from "stream";
import { describe, expect, it } from "vitest";
import { NodeTerminal } from "../terminal.js";

function tuiTerminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  (input as unknown as { isTTY: boolean }).isTTY = true;
  (output as unknown as { isTTY: boolean }).isTTY = true;
  (output as unknown as { rows: number }).rows = 24;
  (output as unknown as { columns: number }).columns = 80;
  const terminal = new NodeTerminal({ input, output, tui: true, historyPath: null });
  return { terminal, input, output };
}

function drain(stream: PassThrough): string {
  let out = "";
  let chunk: Buffer | null;
  while ((chunk = stream.read()) !== null) out += chunk.toString();
  return out;
}

describe("NodeTerminal TUI mode", () => {
  it("enters the alternate screen and keeps the reader live while output streams", async () => {
    const { terminal, input, output } = tuiTerminal();
    const askPromise = terminal.ask("You > ", "\u001b[36m");
    terminal.stream("Hello ");
    terminal.stream("back.");
    input.write("next message\r");
    await expect(askPromise).resolves.toBe("next message");
    const out = drain(output);
    expect(out).toContain("\x1b[?1049h");
    expect(out).toContain("\u001b[32mHello back.\u001b[0m");
    await terminal.close();
  });

  it("commits a submitted line as a highlighted user block", async () => {
    const { terminal, input, output } = tuiTerminal();
    const askPromise = terminal.ask("You > ", "\u001b[36m");
    input.write("fix the chat\r");
    await expect(askPromise).resolves.toBe("fix the chat");
    const out = drain(output);
    expect(out).toContain("\x1b[43m"); // solid yellow background
    expect(out).toContain("fix the chat");
    await terminal.close();
  });

  it("buffers a submit that lands before the next ask", async () => {
    const { terminal, input, output } = tuiTerminal();
    input.write("early\r");
    await expect(terminal.ask("You > ", "\u001b[36m")).resolves.toBe("early");
    await terminal.close();
    drain(output);
  });

  it("drives the busy indicator through the status line, not the transcript", async () => {
    const { terminal, input, output } = tuiTerminal();
    const askPromise = terminal.ask("You > ", "\u001b[36m");
    terminal.setBusy(true);
    terminal.setBusy(false);
    input.write("done\r");
    await expect(askPromise).resolves.toBe("done");
    const out = drain(output);
    expect(out).toContain("Thinking");
    await terminal.close();
  });

  it("restores the alternate screen on close", async () => {
    const { terminal, output } = tuiTerminal();
    await terminal.close();
    expect(drain(output)).toContain("\x1b[?1049l");
  });

  it("scrolls the viewport with the mouse wheel without leaking into input", async () => {
    const { terminal, input, output } = tuiTerminal();
    terminal.write(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    const askPromise = terminal.ask("You > ", "\u001b[36m");
    drain(output);
    input.write("\x1b[<64;10;10M"); // wheel up
    const scrolled = drain(output);
    expect(scrolled).toContain("line 15");
    expect(scrolled).not.toContain("line 39");
    input.write("abc\r");
    await expect(askPromise).resolves.toBe("abc");
    await terminal.close();
  });

  it("stays anchored when output arrives while scrolled up", async () => {
    const { terminal, input, output } = tuiTerminal();
    terminal.write(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    const askPromise = terminal.ask("You > ", "\u001b[36m");
    input.write("\x1b[<64;10;10M"); // wheel up
    drain(output);
    terminal.write("new line");
    const after = drain(output);
    expect(after).toContain("line 15");
    expect(after).not.toContain("new line");
    input.write("x\r");
    await expect(askPromise).resolves.toBe("x");
    await terminal.close();
  });
});
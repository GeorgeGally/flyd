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
  it("answers a mid-turn confirmation without stealing the pending chat prompt", async () => {
    const { terminal, input, output } = tuiTerminal();
    let chatLine: string | null = null;
    const pending = terminal.ask("You > ", "\u001b[36m").then((line) => { chatLine = line; });
    const approval = terminal.confirm("Flyd wants to run: git commit -m wip. Allow?");
    input.write("y\r");
    await expect(approval).resolves.toBe(true);
    expect(chatLine).toBeNull();
    input.write("next question\r");
    await pending;
    expect(chatLine).toBe("next question");
    expect(drain(output)).toContain("Allow? [y/N] y");
    await terminal.close();
  });

  it("offers 'always' on approvals but not on plain confirms", async () => {
    const { terminal, input, output } = tuiTerminal();
    const approval = terminal.approve("Flyd wants to run: git push. Allow?");
    input.write("a\r");
    await expect(approval).resolves.toBe("always");
    const plain = terminal.confirm("Answer anyway?");
    input.write("a\r");
    await expect(plain).resolves.toBe(false);
    expect(drain(output)).toContain("[y/a(lways)/N]");
    await terminal.close();
  });

  it("treats anything but y as a refusal", async () => {
    const { terminal, input, output } = tuiTerminal();
    const approval = terminal.confirm("Allow?");
    input.write("\r");
    await expect(approval).resolves.toBe(false);
    await terminal.close();
    drain(output);
  });

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
    expect(out).toContain("\x1b[42m"); // solid green background
    expect(out).toContain("fix the chat");
    await terminal.close();
  });

  it("captures the mouse by default, so an arrow is always a key and the wheel always scrolls", async () => {
    const { terminal, input, output } = tuiTerminal();
    for (let index = 0; index < 60; index += 1) terminal.write(`line ${index}`);
    expect(drain(output)).toContain("\x1b[?1000h\x1b[?1006h");
    const first = terminal.ask("You > ");
    input.write("hello\r");
    await first;
    const second = terminal.ask("You > ");
    drain(output);
    // A slow trackpad used to send lone arrows that recalled history; now it sends wheel events.
    input.write("\x1b[<64;10;10M");
    const scrolled = drain(output);
    expect(scrolled).toContain("line 45");
    expect(scrolled).not.toContain("You > hello");
    input.write("\x1b[<65;10;10M");
    drain(output);
    input.write("\x1b[A");
    expect(drain(output)).toContain("You > hello");
    input.write("\r");
    await second;
    await terminal.close();
  });

  it("with mouse capture off, scrolls on a wheel burst of arrows but recalls history on a single arrow press", async () => {
    const { terminal, input, output } = tuiTerminal();
    expect(terminal.toggleMouse()).toBe(false);
    for (let index = 0; index < 60; index += 1) terminal.write(`line ${index}`);
    const first = terminal.ask("You > ");
    input.write("hello\r");
    await first;
    const second = terminal.ask("You > ");
    drain(output);
    input.write("\x1bOA\x1bOA\x1bOA");
    const scrolled = drain(output);
    expect(scrolled).not.toContain("You > hello");
    expect(scrolled).toContain("line 5");
    input.write("\x1b[B\x1b[B\x1b[B");
    drain(output);
    await new Promise((resolve) => setTimeout(resolve, 120));
    input.write("\x1b[A");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(drain(output)).toContain("You > hello");
    input.write("\r");
    await second;
    await terminal.close();
  });

  it("paints user lines on green", async () => {
    const { terminal, input, output } = tuiTerminal();
    const line = terminal.ask("You > ");
    input.write("hi there\r");
    await line;
    expect(drain(output)).toContain("\u001b[42m\u001b[30m hi there");
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
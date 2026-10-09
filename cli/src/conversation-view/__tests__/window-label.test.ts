import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import { renderPage } from "../page.js";

// The window the captain reads is Flyd's, whatever transcript directory it
// reads; a caller that wants another label still passes one explicitly.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-view-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("conversation window label", () => {
  it("names Flyd in the title, header and composer for firstmate's own directory", () => {
    const projectDir = join(dir, "-Users-someone-Documents-firstmate");
    const source = new ClaudeCodeTranscriptSource({ projectDir });
    expect(source.assistantLabel).toBe("Flyd");

    const html = renderPage({ assistantLabel: source.assistantLabel, sendToken: "a".repeat(48) });
    expect(html).toContain("<title>Flyd</title>");
    expect(html).toContain('class="who">Flyd');
    expect(html).toContain('placeholder="Message Flyd"');
    expect(html).toContain('aria-label="Send to Flyd"');
  });

  it("names Flyd regardless of the transcript directory it reads", () => {
    expect(new ClaudeCodeTranscriptSource({ projectDir: join(dir, "some-other-project") }).assistantLabel).toBe("Flyd");
  });

  it("still honours an explicit label", () => {
    expect(new ClaudeCodeTranscriptSource({ projectDir: join(dir, "some-other-project"), assistantLabel: "Claude" }).assistantLabel).toBe("Claude");
  });
});

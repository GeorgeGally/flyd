import { readFile } from "fs/promises";
import { join } from "path";
import { transformWithEsbuild } from "vite";
import { describe, expect, it } from "vitest";

describe("OpenCode Flyd capture plugin", () => {
  it("is valid TypeScript and sends direct user feedback to the local Core", async () => {
    const source = await readFile(join(process.cwd(), "plugins", "flyd-capture.ts"), "utf8");
    await expect(transformWithEsbuild(source, "flyd-capture.ts", { loader: "ts" })).resolves.toBeDefined();
    expect(source).toContain('authorship: "direct_input"');
    expect(source).toContain('/foreground-feedback');
    expect(source).toContain('configuredValue("FLYD_MODEL")');
    expect(source).not.toMatch(/model:\s*["']gpt-4o-mini["']/);
  });
  it("exports attributed conversation turns without inferring project scope or promoting assistant claims", async () => {
    const source = await readFile(join(process.cwd(), "plugins", "flyd-capture.ts"), "utf8");
    const compiled = await transformWithEsbuild(source, "flyd-capture.ts", { loader: "ts", format: "esm" });
    const uri = "data:text/javascript;base64," + Buffer.from(compiled.code).toString("base64");
    const plugin = await import(uri);
    const payload = plugin.buildConversationLearningPayload({
      sessionID: "s1", userMessageID: "m1", userText: "Upload is still broken.",
    }, "I deployed everything.");
    expect(payload.turns).toEqual([{
      sessionId: "opencode:s1", messageId: "m1", user: "Upload is still broken.",
      assistant: "I deployed everything.", projectIds: [], truncated: false,
    }]);
    const bounded = plugin.buildConversationLearningPayload({ sessionID: "s", userMessageID: "m", userText: "x".repeat(13000) }, "");
    expect(bounded.turns[0].user).toHaveLength(12000);
    expect(bounded.turns[0].truncated).toBe(true);
  });
});

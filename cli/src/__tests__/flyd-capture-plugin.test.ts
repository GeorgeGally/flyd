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
});

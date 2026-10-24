import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { personalPromptBlocks } from "../context-compiler.js";
import { readUserProfile } from "../../lib/user-profile.js";
import { MEMORY_SECTIONS, memoryPaths, memoryPromptText } from "../../council/memory-store.js";

// The compiled prompt must carry every section George wrote in USER.md and
// every section of MEMORY.md, not a prefix of them.
describe("personal prompt blocks", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-personal-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const profileSections = ["About me", "Work", "People", "Preferences", "Routines", "Goals", "Constraints", "Learned in conversation", "How to be with me"];

  it("every USER.md and MEMORY.md section of real-sized files reaches the compiled prompt", () => {
    const userPath = join(dir, "USER.md");
    writeFileSync(userPath, `# George\n\n${profileSections.map((section) => `## ${section}\n${Array.from({ length: 26 }, (_, index) => `- ${section} fact ${index}: something George actually said about himself and wants kept`).join("\n")}\n`).join("\n")}`);
    const paths = memoryPaths(dir);
    writeFileSync(paths.memory, ["# Flyd memory", "", ...MEMORY_SECTIONS.flatMap((section) => [
      `## ${section}`,
      ...Array.from({ length: 16 }, (_, index) => `- ${section} memory ${index} with a sentence long enough to look like a real curated entry <!--a:2026-10-${String(index + 1).padStart(2, "0")}-->`),
      "",
    ])].join("\n"));
    const profile = readUserProfile(userPath);
    expect(profile!.length).toBeGreaterThan(19_000);
    const prompt = personalPromptBlocks(profile, memoryPromptText(paths, new Date("2026-10-20T12:00:00")));
    for (const section of profileSections) expect(prompt).toContain(`## ${section}\n`);
    for (const section of MEMORY_SECTIONS) expect(prompt).toContain(`## ${section}\n`);
    expect(prompt).not.toMatch(/…\((trimmed|truncated)\)/);
    expect(prompt).not.toContain("in MEMORY.md)");
  });
});

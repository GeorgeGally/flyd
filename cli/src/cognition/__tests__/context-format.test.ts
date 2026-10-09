import { describe, expect, it } from "vitest";
import { formatCompiledContext } from "../context-format.js";
import type { CompiledContext } from "../types.js";

const context = {
  user: { profile: "## George's own profile\nLives in Cape Town.", taste: "George's taste:\n\nEverywhere:\n- No shadows on icon boxes.", autonomy: [], communication: [] },
  present: { projection: "", activeProjects: [], gaps: [] },
  projects: [],
  conversation: { recap: "", referents: {} },
  memory: { current: [], relevant: [], historical: [], conflicts: [], gaps: [] },
} as unknown as CompiledContext;

describe("formatCompiledContext taste", () => {
  it("gives George's taste to design, code and work turns only, after his profile", () => {
    const work = formatCompiledContext(context, { includeTaste: true });
    expect(work).toContain("- No shadows on icon boxes.");
    expect(work.indexOf("Lives in Cape Town.")).toBeLessThan(work.indexOf("No shadows on icon boxes."));
    for (const other of [formatCompiledContext(context), formatCompiledContext(context, { includeProjects: false })]) {
      expect(other).toContain("Lives in Cape Town.");
      expect(other).not.toContain("No shadows on icon boxes.");
    }
  });
});

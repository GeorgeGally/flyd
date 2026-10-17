import { describe, expect, it } from "vitest";
import { boundNowProjection, clampText, formatCompiledContext } from "../context-format.js";
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

describe("bounded NOW projection", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const nowFile = [
    "# NOW", "", "Generated: 2026-10-17T03:23:27.599Z", "",
    "## Active now",
    "- [observed; current observed 2026-09-26; evidence:31814] project:app · branch: master",
    "- [observed; current observed 2026-10-16; evidence:40001] project:flyd · branch: main",
    "- [observed; current observed 2026-09-01; evidence:2] preference:coffee · drink: flat white",
    "",
    "## Recently completed / expired",
    "- [observed; completed observed 2026-10-15; evidence:9] task:ship · state: done",
    "",
    "## Conflicts",
    "- topic:650445 · decision: use read_url on http://127.0.0.1:4815/health ↔ use read_url on https://example.com",
  ].join("\n");

  it("drops stale repo state, evidence ids and the conflicts list, keeping fresh and non-repo claims", () => {
    const bounded = boundNowProjection(nowFile, now);
    expect(bounded).not.toContain("project:app");
    expect(bounded).not.toContain("evidence:");
    expect(bounded).not.toContain("Conflicts");
    expect(bounded).not.toContain("read_url");
    expect(bounded).toContain("project:flyd · branch: main");
    expect(bounded).toContain("preference:coffee · drink: flat white");
    expect(bounded).toContain("task:ship · state: done");
  });

  it("caps a huge projection", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `- [observed; current observed 2026-10-16; evidence:${i}] fact:${i} · note: ${"x".repeat(900)}`);
    const bounded = boundNowProjection(["## Active now", ...lines].join("\n"), now);
    expect(bounded.length).toBeLessThanOrEqual(4100);
    expect(bounded.split("\n").filter((l) => l.startsWith("- ")).length).toBeLessThanOrEqual(25);
  });

  it("formats context with the bounded view", () => {
    const withNow = { ...context, present: { projection: nowFile, activeProjects: [], gaps: [] } } as unknown as CompiledContext;
    const text = formatCompiledContext(withNow, { now });
    expect(text).toContain("project:flyd · branch: main");
    expect(text).not.toContain("project:app");
    expect(text).not.toContain("Conflicts");
  });

  it("keeps stale repo claims out of the current list", () => {
    const claim = (entityId: string, observedAt: string) => ({ temporalStatus: "current", authority: "observed", entityId, attribute: "branch", value: "main", observedAt });
    const withClaims = {
      ...context,
      memory: { ...context.memory, current: [claim("project:old", "2026-09-26T00:00:00Z"), claim("project:fresh", "2026-10-16T00:00:00Z")] },
    } as unknown as CompiledContext;
    const text = formatCompiledContext(withClaims, { now });
    expect(text).toContain("project:fresh");
    expect(text).not.toContain("project:old");
  });

  it("clamps on a line boundary and says so", () => {
    const clamped = clampText(Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"), 100);
    expect(clamped.endsWith("…(trimmed)")).toBe(true);
    expect(clamped.length).toBeLessThan(120);
    expect(clampText("short", 100)).toBe("short");
  });
});

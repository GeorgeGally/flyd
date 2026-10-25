import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recall = vi.hoisted(() => vi.fn(async () => ({
  version: "1.0", source: "flyd-cli", query: "", generatedAt: "",
  sufficiency: { verdict: "partial", reason: "" },
  matches: [],
})));
vi.mock("../../lib/brain-retrieval.js", () => ({ retrieveLiveBrainEvidence: recall }));

import { compileContext } from "../context-compiler.js";
import { clearSharedRecalls, queryMemory } from "../memory.js";

const flydDir = process.env.FLYD_DIR!;

beforeEach(() => {
  recall.mockClear();
  clearSharedRecalls();
});

describe("what a chat turn reads", () => {
  it("shares one archive recall between the two memory asks of a turn", async () => {
    await queryMemory({ text: "what did GNM still owe me", temporalFrame: "mixed", includeHistorical: true, limit: 6, useJev: false });
    await queryMemory({ text: "what did GNM still owe me", temporalFrame: "present", limit: 8, useJev: false });
    expect(recall).toHaveBeenCalledTimes(1);
    await queryMemory({ text: "something else entirely", useJev: false });
    expect(recall).toHaveBeenCalledTimes(2);
  });

  it("leaves the frozen legacy context bundles and an empty PROFILE projection out of the context", async () => {
    const context = join(flydDir, "context");
    mkdirSync(context, { recursive: true });
    const bundle = (title: string, body: string) => `---\ngenerated: 2026-07-28T03:35:33Z\n---\n\n# ${title}\n\n${body}\n`;
    writeFileSync(join(context, "current_identity.md"), bundle("Current Identity", "- July identity snapshot ZEBRA"));
    writeFileSync(join(context, "active_projects.md"), bundle("Active Projects", "- July project list ZEBRA"));
    const knowledge = join(flydDir, "knowledge");
    mkdirSync(knowledge, { recursive: true });
    writeFileSync(join(knowledge, "PROFILE.md"), "# PROFILE\n\nGenerated: 2026-10-24\n\n## Durable context\n- No canonical profile claims yet.\n");
    writeFileSync(join(knowledge, "NOW.md"), "# NOW\n\n## Active now\n- No canonical active claims.\n");

    const compiled = await compileContext({ intent: "what am I working on", conversation: [] });

    expect(JSON.stringify(compiled)).not.toContain("ZEBRA");
    expect(compiled.projects.map((project) => project.id)).not.toContain("legacy:active-work");
    expect(compiled.user.profile).not.toContain("No canonical profile claims");
    expect(compiled.trace.sources).not.toContain("legacy-context-bundles");
    expect(compiled.trace.sources).not.toContain("PROFILE");
    expect(compiled.trace.omissions).toContain("profile_projection_empty");
  });
});

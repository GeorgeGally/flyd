import { describe, expect, it } from "vitest";
import { buildPrompt, type RetrievedEntry } from "../ask.js";
import type { RecallIntent } from "../../lib/recall-intent.js";
import type { PresentModel } from "../../lib/present-model.js";

function entry(overrides: Partial<RetrievedEntry> & Pick<RetrievedEntry, "path" | "body">): RetrievedEntry {
  return {
    source: "wiki",
    score: 80,
    metadata: {},
    fullPath: `/tmp/${overrides.path}`,
    staleness: null,
    ...overrides,
  };
}

const currentStateIntent: RecallIntent = { kind: "current_state", confidence: 0.9, reasons: [] };
const generalIntent: RecallIntent = { kind: "general", confidence: 0.5, reasons: [] };

describe("ask.ts buildPrompt", () => {
  it("puts isCurrent entries in a Currently Active section, separate from background evidence", () => {
    const current = entry({ path: "wiki/projects/flyd.md", body: "flyd memory work", isCurrent: true });
    const old = entry({ path: "wiki/projects/nimbus-2024.md", body: "old nimbus project" });

    const prompt = buildPrompt("what am I working on", [current, old], undefined, currentStateIntent, null);

    expect(prompt).toContain("## Currently Active");
    const currentSectionIndex = prompt.indexOf("## Currently Active");
    const evidenceSectionIndex = prompt.indexOf("## Evidence");
    expect(prompt.slice(currentSectionIndex, evidenceSectionIndex)).toContain("flyd memory work");
    expect(prompt.slice(evidenceSectionIndex)).toContain("old nimbus project");
    expect(prompt.slice(evidenceSectionIndex)).not.toContain("flyd memory work");
  });

  it("names unavailable signals instead of silently answering from background evidence", () => {
    const old = entry({ path: "wiki/projects/nimbus-2024.md", body: "old nimbus project" });
    const presentModel: PresentModel = {
      generatedAt: "now",
      repository: null,
      activeTask: null,
      gaps: ["repository_state_unavailable", "task_state_unavailable"],
    };

    const prompt = buildPrompt("what am I working on", [old], undefined, currentStateIntent, presentModel);

    expect(prompt).toContain("No evidence was corroborated as currently active");
    expect(prompt).toContain("repository_state_unavailable");
    expect(prompt).toContain("Do not present background evidence below as current work");
  });

  it("omits the Currently Active section entirely for non current_state intents", () => {
    const old = entry({ path: "wiki/projects/nimbus-2024.md", body: "old nimbus project" });
    const prompt = buildPrompt("what did we decide about memory?", [old], undefined, generalIntent, null);
    expect(prompt).not.toContain("## Currently Active");
  });
});

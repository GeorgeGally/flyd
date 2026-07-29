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
const taskResumeIntent: RecallIntent = { kind: "task_resume", confidence: 0.85, reasons: [] };
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
    expect(prompt.slice(evidenceSectionIndex)).not.toContain("flyd memory work");
  });

  it("omits background evidence entirely for current_state when corroborated current evidence exists", () => {
    // A semantically strong old match (e.g. a conversation transcript) wins
    // out over meta-instructions in practice — verified live against a real
    // model. Omitting it is the reliable fix, not stronger wording.
    const current = entry({ path: "wiki/projects/flyd.md", body: "flyd memory work", isCurrent: true });
    const old = entry({ path: "wiki/projects/nimbus-2024.md", body: "old nimbus project" });

    const prompt = buildPrompt("what am I working on", [current, old], undefined, currentStateIntent, null);
    const evidenceSectionIndex = prompt.indexOf("## Evidence");

    expect(prompt.slice(evidenceSectionIndex)).not.toContain("old nimbus project");
    expect(prompt.slice(evidenceSectionIndex)).toContain("omitted");
  });

  it("also omits background evidence for task_resume when current entries exist", () => {
    // Originally kept background for resume on the theory that it adds
    // useful context. Live testing disproved that — unrelated old evidence
    // hijacked the answer instead of supplementing it, same as current_state.
    const current = entry({ path: "git:commit:abc", body: "fix(memory): gate currentness", isCurrent: true });
    const old = entry({ path: "wiki/projects/nimbus-2024.md", body: "old nimbus project" });

    const prompt = buildPrompt("where were we?", [current, old], undefined, taskResumeIntent, null);
    const evidenceSectionIndex = prompt.indexOf("## Evidence");

    expect(prompt.slice(evidenceSectionIndex)).not.toContain("old nimbus project");
  });

  it("names unavailable signals instead of silently answering from background evidence", () => {
    const old = entry({ path: "wiki/projects/nimbus-2024.md", body: "old nimbus project" });
    const presentModel: PresentModel = {
      generatedAt: "now",
      repository: null,
      activeTask: null,
      recentCommits: [],
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

  it("uses Continuing From framing for task_resume instead of Currently Active", () => {
    const current = entry({ path: "git:commit:abc", body: "fix(memory): gate currentness", isCurrent: true });
    const prompt = buildPrompt("where were we?", [current], undefined, taskResumeIntent, null);

    expect(prompt).toContain("## Continuing From");
    expect(prompt).not.toContain("## Currently Active");
    expect(prompt).toContain("where the work left off");
  });

  it("uses resume-appropriate fallback wording when nothing was corroborated", () => {
    const presentModel: PresentModel = {
      generatedAt: "now",
      repository: null,
      activeTask: null,
      recentCommits: [],
      gaps: ["repository_state_unavailable"],
    };
    const old = entry({ path: "wiki/projects/nimbus-2024.md", body: "old nimbus project" });
    const prompt = buildPrompt("where were we?", [old], undefined, taskResumeIntent, presentModel);

    expect(prompt).toContain("No evidence was corroborated as resuming from");
  });
});

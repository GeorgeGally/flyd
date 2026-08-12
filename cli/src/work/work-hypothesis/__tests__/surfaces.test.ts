import { describe, expect, it } from "vitest";
import { buildConversationPrompt } from "../../../runtime/conversation-responder.js";
import { projectHypothesisLine } from "../store.js";

describe("present model surfaces", () => {
  it("current-work prompts use Present Model and omit catalog dump", () => {
    const hypothesis =
      "Good Neighbours · CleanX look like tonight's active threads.";
    const { prompt, system } = buildConversationPrompt({
      message: "what am I working on?",
      history: [],
      memory: { verdict: "insufficient", matches: [] },
      situation: {
        project: "flyd",
        branch: "main",
        head: "abc",
        dirty: true,
        changedFiles: 3,
        latestCommit: "wip",
        outcome: null,
        status: null,
        nextAction: null,
      },
      crossRepo: [
        {
          root: "/tmp/aigc",
          name: "aigc",
          branch: "main",
          dirty: true,
          lastCommitRelative: "11 months ago",
          isForeground: false,
        },
      ],
      presentHypothesis: `  ${hypothesis}`,
    });

    expect(prompt).toContain(hypothesis);
    expect(prompt).toContain("<present-model>");
    expect(prompt).not.toContain("aigc");
    expect(system).toMatch(/Present Model/);
  });

  it("projectHypothesisLine renders gap copy for null", () => {
    expect(projectHypothesisLine(null)).toMatch(/unknown|gap/i);
  });
});

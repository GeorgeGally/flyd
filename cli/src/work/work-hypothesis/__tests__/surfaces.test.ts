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

  it("keeps Documents/git visibility when Present Model is set but the question is about a named project", () => {
    const { prompt } = buildConversationPrompt({
      message: "what needs to be done on DIR?",
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
          root: "/Users/radarboy3000/Documents/dead-internet-radio",
          name: "dead-internet-radio",
          branch: "main",
          dirty: true,
          lastCommitRelative: "5 weeks ago",
          isForeground: false,
        },
        {
          root: "/Users/radarboy3000/Documents/cleanx",
          name: "cleanx",
          branch: "main",
          dirty: false,
          lastCommitRelative: "2 days ago",
          isForeground: false,
        },
      ],
      presentHypothesis: "  Dead Internet Radio is first today.",
    });

    expect(prompt).toContain("George's repositories:");
    expect(prompt).toContain("dead-internet-radio");
    expect(prompt).toContain("/Users/radarboy3000/Documents/dead-internet-radio");
  });

  it("answers current-work questions from Present Model without LLM catalog synthesis", async () => {
    const { presentModelReply } = await import("../../../runtime/conversation-responder.js");
    const answer = presentModelReply(
      "what am i working on?",
      "  Good Neighbours · CleanX look like tonight's active threads.",
    );
    expect(answer).toContain("Good Neighbours");
    expect(answer).toContain("CleanX");
    expect(presentModelReply("how is the weather", "  Good Neighbours")).toBeNull();
  });
});
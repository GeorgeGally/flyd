import { describe, expect, it } from "vitest";
import { buildConversationPrompt } from "../../../runtime/conversation-responder.js";
import { projectHypothesisLine } from "../store.js";

describe("present model surfaces", () => {
  it("current-work prompts surface repo paths for inspection and forbid catalog synthesis", () => {
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
        {
          root: "/tmp/cleanx",
          name: "cleanx",
          branch: "main",
          dirty: false,
          lastCommitRelative: "2 days ago",
          isForeground: false,
        },
      ],
      presentHypothesis: `  ${hypothesis}`,
    });

    expect(prompt).toContain(hypothesis);
    expect(prompt).toContain("<present-model>");
    expect(prompt).toContain("aigc");
    expect(prompt).toContain("/tmp/aigc");
    expect(system).toMatch(/inspect the named projects' actual current state/);
    expect(system).toMatch(/Do not synthesize a ranked repo catalog/);
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

  it("ignores 'active projects' buried inside a long memory paste", async () => {
    const { presentModelReply } = await import("../../../runtime/conversation-responder.js");
    const paste = [
      "add these to memories. this is extracted memories from chatgpt:",
      "[2025-09-01] - Context at this point treated Koko and Museq1 as active projects.",
      "x".repeat(500),
    ].join("\n");
    expect(
      presentModelReply(paste, "Get GNM sponsor outreach moving is first — due 5 September."),
    ).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { retrieveAgentMemory } from "../code.js";

describe("primary agent memory", () => {
  it("uses the filesystem conversation and authoritative archive instead of retired Rails memory", async () => {
    const retrieveConversation = vi.fn(async () => ({
      verdict: "partial" as const,
      matches: [{
        id: "conversation",
        path: "conversations/1",
        excerpt: "George: Flyd should be my daily driver.",
        stale: false,
        kind: "conversation" as const,
        authority: "user_observation" as const,
      }],
    }));
    const retrieveArchive = vi.fn(async () => ({
      verdict: "sufficient" as const,
      matches: [{
        id: "confirmed",
        path: "corrections/model.md",
        excerpt: "Use the configured primary model.",
        stale: false,
        kind: "archive" as const,
        authority: "user_confirmed" as const,
      }],
    }));

    const result = await retrieveAgentMemory("How should Flyd work?", {
      excludeConversationSessionId: "current",
      retrieveConversation,
      retrieveArchive,
    });

    expect(retrieveConversation).toHaveBeenCalledOnce();
    expect(retrieveArchive).toHaveBeenCalledOnce();
    expect(result.matches.map((match) => match.id)).toEqual(["conversation", "confirmed"]);
    expect(result.verdict).toBe("sufficient");
  });
});

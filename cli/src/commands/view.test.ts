import { describe, expect, it, vi } from "vitest";

const respondToConversation = vi.fn(async () => "answer");
const retrieveAgentMemory = vi.fn(async () => ({ verdict: "insufficient" as const, matches: [] }));
const loadAgentSituation = vi.fn(async () => null);
const refreshRepoRegistry = vi.fn(async () => []);

vi.mock("../runtime/conversation-responder.js", () => ({ respondToConversation }));
vi.mock("./code.js", () => ({ retrieveAgentMemory, loadAgentSituation }));
vi.mock("../runtime/repo-registry.js", () => ({ refreshRepoRegistry }));

import { answerAsFlyd } from "./view.js";

describe("answerAsFlyd", () => {
  it("supplies the turn number needed to persist a view turn receipt", async () => {
    const turn = {
      source: { turnId: "ask:2", sessionId: "view:session", surface: "view" as const, text: "second question", revision: 1, consentRef: "view", final: true as const, retention: "local_default" as const },
      onPreparation: () => undefined,
      onInteraction: () => undefined,
      onUnderstanding: () => undefined,
      onArtefact: () => undefined,
    };
    const history = [
      { role: "user" as const, content: "first question" },
      { role: "assistant" as const, content: "first answer" },
    ];

    await answerAsFlyd("second question", history, undefined, turn);

    expect(respondToConversation).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "view:session",
      turnNumber: 2,
    }));
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { checkerModelChain } from "../../lib/config.js";
import { modelFamily, setModelRouting } from "../model-routing.js";

afterEach(() => setModelRouting(null));

describe("the checker is another model family than the builder", () => {
  it("names families across providers", () => {
    expect(modelFamily("anthropic:claude-sonnet-5-5")).toBe("claude");
    expect(modelFamily("claude/default")).toBe("claude");
    expect(modelFamily("openrouter:anthropic/claude-haiku-5-5")).toBe("claude");
    expect(modelFamily("openai:gpt-5.5")).toBe("openai");
    expect(modelFamily("openrouter:google/gemini-3-pro")).toBe("gemini");
    expect(modelFamily("cursor/auto")).toBe("cursor");
  });

  it("picks a configured model of another family, the checker job's first", () => {
    setModelRouting({ jobs: { chat: [{ provider: "openai", model: "gpt-5.5" }], quick: [{ provider: "anthropic", model: "claude-haiku-5-5" }], background: [{ provider: "anthropic", model: "claude-haiku-5-5" }] } });
    expect(checkerModelChain(["anthropic:claude-sonnet-5-5"], () => ["fallback"])).toEqual(["openai:gpt-5.5"]);
    setModelRouting({ jobs: { chat: [{ provider: "openai", model: "gpt-5.5" }], checker: [{ provider: "openrouter", model: "google/gemini-3-pro" }, { provider: "openrouter", model: "openai/gpt-5.5" }] } });
    expect(checkerModelChain(["claude/default"], () => ["fallback"])).toEqual(["openrouter:google/gemini-3-pro", "openrouter:openai/gpt-5.5"]);
    expect(checkerModelChain(["openai:gpt-5.5"], () => ["fallback"])).toEqual(["openrouter:google/gemini-3-pro"]);
  });

  it("falls back to the model it ran on before when no other family is configured", () => {
    setModelRouting({ jobs: { chat: [{ provider: "openai", model: "gpt-5.5" }], quick: [{ provider: "openai", model: "gpt-5.5-mini" }], background: [{ provider: "openai", model: "gpt-5.5-mini" }] } });
    expect(checkerModelChain(["openai:gpt-5.5"], () => ["openai:gpt-5.5-mini"])).toEqual(["openai:gpt-5.5-mini"]);
  });
});

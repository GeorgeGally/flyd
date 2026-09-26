import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatModelChain, resolveModelConnection, usesOpenAITransport } from "../config.js";
import { openAIAgentTransport, resetProviderCooldowns, runWithModelFailover } from "../llm.js";
import { commandCodeModelId } from "../../runtime/flyd-worker-config.js";

function providerError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe("provider-qualified models", () => {
  beforeEach(() => {
    vi.stubEnv("FLYD_PROVIDER", "opencode-go");
    vi.stubEnv("FLYD_MODEL_API_KEY", "");
    vi.stubEnv("COMMANDCODE_API_KEY", "cc-key");
    vi.stubEnv("OPENAI_API_KEY", "oa-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("routes commandcode: models to CommandCode regardless of FLYD_PROVIDER", () => {
    const connection = resolveModelConnection("commandcode:deepseek/deepseek-v4-flash");
    expect(connection.apiKey).toBe("cc-key");
    expect(connection.baseURL).toBe("https://api.commandcode.ai/provider/v1");
    expect(connection.providerIdentity).toBe("api.commandcode.ai/deepseek/deepseek-v4-flash");
    expect(usesOpenAITransport("commandcode:claude-sonnet-5")).toBe(true);
  });

  it("routes openai: models to OpenAI with the Responses transport", () => {
    const connection = resolveModelConnection("openai:gpt-5.6-luna");
    expect(connection.apiKey).toBe("oa-key");
    expect(connection.baseURL).toBeUndefined();
    expect(openAIAgentTransport("openai:gpt-5.6-luna")).toBe("responses");
    expect(usesOpenAITransport("anthropic:claude-sonnet-5")).toBe(false);
  });

  it("normalizes OpenCode-style ids to CommandCode's vendor/model form", () => {
    expect(commandCodeModelId("opencode-go/deepseek-v4.1-flash")).toBe("deepseek/deepseek-v4.1-flash");
    expect(commandCodeModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(commandCodeModelId(undefined)).toBe("deepseek/deepseek-v4-flash");
  });

  it("builds the chat chain: primary, configured fallbacks, then CommandCode", () => {
    vi.stubEnv("FLYD_CHAT_MODEL", "opencode-go/deepseek-v4.1-flash");
    vi.stubEnv("FLYD_CHAT_FALLBACK_MODELS", "openai:gpt-5.6-luna, ");
    vi.stubEnv("COMMANDCODE_API_KEY_MODEL", "opencode-go/deepseek-v4.1-flash");
    expect(chatModelChain()).toEqual([
      "opencode-go/deepseek-v4.1-flash",
      "openai:gpt-5.6-luna",
      "commandcode:deepseek/deepseek-v4.1-flash",
    ]);
  });
});

describe("runWithModelFailover", () => {
  beforeEach(() => resetProviderCooldowns());

  it("fails over on a quota error and skips the cooled-down provider next time", async () => {
    const attempts: string[] = [];
    const attempt = async (model: string) => {
      attempts.push(model);
      if (model === "primary") throw providerError(429, "Go usage limit exceeded");
      return `answer from ${model}`;
    };
    const failovers: string[] = [];
    const first = await runWithModelFailover(["primary", "backup"], attempt, {
      onFailover: ({ from, to }) => failovers.push(`${from}->${to}`),
    });
    expect(first).toEqual({ result: "answer from backup", model: "backup" });
    expect(failovers).toEqual(["primary->backup"]);

    attempts.length = 0;
    const second = await runWithModelFailover(["primary", "backup"], attempt);
    expect(second.model).toBe("backup");
    expect(attempts).toEqual(["backup"]);
  });

  it("does not replay an attempt that already changed something", async () => {
    await expect(runWithModelFailover(
      ["primary", "backup"],
      async (model) => {
        if (model === "primary") throw providerError(500, "server error after an edit");
        return "should not run";
      },
      { canFailOver: () => false },
    )).rejects.toThrow("server error after an edit");
  });

  it("never fails over a cancelled turn", async () => {
    const controller = new AbortController();
    controller.abort();
    const backup = vi.fn(async () => "backup");
    await expect(runWithModelFailover(
      ["primary", "backup"],
      async (model) => {
        if (model === "backup") return backup();
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
      { signal: controller.signal },
    )).rejects.toThrow("aborted");
    expect(backup).not.toHaveBeenCalled();
  });

  it("surfaces the last error when every provider fails", async () => {
    await expect(runWithModelFailover(["a", "b"], async (model) => {
      throw providerError(503, `${model} down`);
    })).rejects.toThrow("b down");
  });
});

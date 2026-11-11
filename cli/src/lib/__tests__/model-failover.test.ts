import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatModelChain, oneShotModelChain, resolveModelConnection, usesOpenAITransport } from "../config.js";
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
    expect(usesOpenAITransport("commandcode:deepseek/deepseek-v4-flash")).toBe(true);
    // Claude on CommandCode only speaks the Anthropic Messages shape.
    expect(usesOpenAITransport("commandcode:claude-sonnet-5")).toBe(false);
    expect(resolveModelConnection("commandcode:claude-sonnet-5").baseURL).toBe("https://api.commandcode.ai/provider");
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

describe("one-shot model chain", () => {
  beforeEach(() => {
    // George's live shape: every configured model on one OpenCode Go account.
    vi.stubEnv("FLYD_MODEL", "opencode-go/deepseek-v4.1-flash");
    vi.stubEnv("FLYD_CHAT_FALLBACK_MODELS", "opencode-go/deepseek-v4-pro");
    vi.stubEnv("COMMANDCODE_API_KEY", "");
    vi.stubEnv("CMD_API_KEY", "");
    vi.stubEnv("FLYD_ONE_SHOT_BACKUP_MODELS", "");
    vi.stubEnv("OPENAI_API_KEY", "oa-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ends on another provider, so one empty account cannot silence the news and the council", () => {
    expect(oneShotModelChain()).toEqual([
      "opencode-go/deepseek-v4.1-flash",
      "opencode-go/deepseek-v4-pro",
      "openai:gpt-5.4-mini",
    ]);
  });

  it("takes the backup from FLYD_ONE_SHOT_BACKUP_MODELS, and none turns it off", () => {
    vi.stubEnv("FLYD_ONE_SHOT_BACKUP_MODELS", "openrouter:google/gemini-2.5-flash, openai:gpt-5.6-luna");
    expect(oneShotModelChain().slice(2)).toEqual(["openrouter:google/gemini-2.5-flash", "openai:gpt-5.6-luna"]);
    vi.stubEnv("FLYD_ONE_SHOT_BACKUP_MODELS", "none");
    expect(oneShotModelChain()).toEqual(["opencode-go/deepseek-v4.1-flash", "opencode-go/deepseek-v4-pro"]);
  });

  it("adds no OpenAI backup without an OpenAI key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(oneShotModelChain()).toEqual(["opencode-go/deepseek-v4.1-flash", "opencode-go/deepseek-v4-pro"]);
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

  it("reaches the backup past an account out of credit, and skips that account next time", async () => {
    const attempts: string[] = [];
    const attempt = async (model: string) => {
      attempts.push(model);
      if (model.startsWith("opencode-go/")) throw providerError(402, "Insufficient balance. Top up at https://opencode.ai/console");
      return `answer from ${model}`;
    };
    const chain = ["opencode-go/deepseek-v4.1-flash", "opencode-go/deepseek-v4-pro", "openai:gpt-5.4-mini"];
    expect((await runWithModelFailover(chain, attempt)).model).toBe("openai:gpt-5.4-mini");

    attempts.length = 0;
    await runWithModelFailover(chain, attempt);
    expect(attempts).toEqual(["openai:gpt-5.4-mini"]);
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

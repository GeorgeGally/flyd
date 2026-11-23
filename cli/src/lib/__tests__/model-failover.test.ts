import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatModelChain, oneShotModelChain, resolveModelConnection, usesOpenAITransport } from "../config.js";
import { openAIAgentTransport, resetProviderCooldowns, runWithModelFailover } from "../llm.js";
import { setModelRouting } from "../../runtime/model-routing.js";

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
  afterEach(() => {
    setModelRouting(null);
    vi.unstubAllEnvs();
  });

  it("routes commandcode: models to CommandCode regardless of FLYD_PROVIDER", () => {
    const connection = resolveModelConnection("commandcode:moonshot/kimi-k3");
    expect(connection.apiKey).toBe("cc-key");
    expect(connection.baseURL).toBe("https://api.commandcode.ai/provider/v1");
    expect(connection.providerIdentity).toBe("api.commandcode.ai/moonshot/kimi-k3");
    expect(usesOpenAITransport("commandcode:moonshot/kimi-k3")).toBe(true);
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

  it("builds the chat chain from the model config, in its order", () => {
    setModelRouting({ jobs: { chat: [
      { provider: "openai", model: "gpt-5.6-sol" },
      { provider: "openai", model: "gpt-5.6-luna" },
      { provider: "commandcode", model: "moonshot/kimi-k3" },
    ] } });
    expect(chatModelChain()).toEqual([
      "openai:gpt-5.6-sol",
      "openai:gpt-5.6-luna",
      "commandcode:moonshot/kimi-k3",
    ]);
  });
});

describe("one-shot model chain", () => {
  let spendDir: string;
  beforeEach(() => {
    spendDir = mkdtempSync(join(tmpdir(), "flyd-one-shot-"));
    vi.stubEnv("FLYD_CLAUDE_SPEND_FILE", join(spendDir, "spend.json"));
    vi.stubEnv("FLYD_CLAUDE_MONTHLY_CAP_USD", "");
    vi.stubEnv("FLYD_CLAUDE", "1");
    vi.stubEnv("CLAUDE_API_KEY", "claude-key");
    setModelRouting({});
    vi.stubEnv("COMMANDCODE_API_KEY", "");
    vi.stubEnv("CMD_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "oa-key");
  });
  afterEach(() => {
    setModelRouting(null);
    vi.unstubAllEnvs();
    rmSync(spendDir, { recursive: true, force: true });
  });

  it("runs on OpenCode Go by default", () => {
    expect(oneShotModelChain()).toEqual(["opencode-go:gpt-6-luna"]);
  });

  it("follows the config's order, and drops Claude while it is off and CommandCode without its key", () => {
    setModelRouting({ jobs: { background: [{ provider: "commandcode", model: "moonshot/kimi-k3" }, { provider: "anthropic", model: "claude-haiku-5-5" }] } });
    vi.stubEnv("COMMANDCODE_API_KEY", "cc-key");
    expect(oneShotModelChain()).toEqual(["commandcode:moonshot/kimi-k3", "anthropic:claude-haiku-5-5"]);
    vi.stubEnv("FLYD_CLAUDE", "0");
    expect(oneShotModelChain()).toEqual(["commandcode:moonshot/kimi-k3"]);
    vi.stubEnv("COMMANDCODE_API_KEY", "");
    expect(() => oneShotModelChain()).toThrow(/No model can do Flyd's background jobs/);
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
    const chain = ["opencode-go/deepseek-v4.1-flash", "opencode-go/deepseek-v4-pro", "anthropic:claude-haiku-5-5"];
    expect((await runWithModelFailover(chain, attempt)).model).toBe("anthropic:claude-haiku-5-5");

    attempts.length = 0;
    await runWithModelFailover(chain, attempt);
    expect(attempts).toEqual(["anthropic:claude-haiku-5-5"]);
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

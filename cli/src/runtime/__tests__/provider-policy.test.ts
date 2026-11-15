import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatModelChain, defaultModel, oneShotModelChain, quickModelChain, resolveModelConnection } from "../../lib/config.js";
import { crewBackupModels, crewClaudeArgs, crewModel, DEFAULT_CREW_MODEL, launchCrewmate, type CrewTask } from "../../crew/crew.js";
import { loadFlydWorkerConfigs } from "../flyd-worker-config.js";
import { completionClient } from "../flyd-worker-process.js";
import { routeWorker } from "../worker-router.js";
import type { WorkerHealth } from "../worker-adapter.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-provider-policy-"));
  vi.stubEnv("FLYD_CLAUDE_SPEND_FILE", join(dir, "spend.json"));
  vi.stubEnv("FLYD_CLAUDE", "1");
  vi.stubEnv("CLAUDE_API_KEY", "claude-key");
  // George's live .env on 2026-11-15: every model on OpenCode Go's DeepSeek.
  vi.stubEnv("FLYD_PROVIDER", "opencode-go");
  vi.stubEnv("FLYD_MODEL", "opencode-go/deepseek-v4.1-flash");
  vi.stubEnv("FLYD_CHAT_MODEL", "opencode-go/deepseek-v4.1-flash");
  vi.stubEnv("FLYD_CHAT_FALLBACK_MODELS", "opencode-go/deepseek-v4-pro,commandcode:deepseek/deepseek-v4-flash,openai/gpt-5.6-luna");
  vi.stubEnv("OPENCODE_API_KEY", "opencode-key");
  vi.stubEnv("OPENCODE_MODEL", "opencode-go/deepseek-v4.1-flash");
  vi.stubEnv("COMMANDCODE_API_KEY", "");
  vi.stubEnv("FLYD_MODEL_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("FLYD_CREW_MODEL", "opencode-go/gpt-6-luna");
  vi.stubEnv("FLYD_CREW_BACKUP_MODELS", "opencode-go/kimi-k3,codex,openai/gpt-6.1-sol,cursor/auto");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function health(name: string): WorkerHealth {
  return { name, executable: `/bin/${name}`, version: "1", healthy: true, capabilities: ["analysis", "implementation", "review", "testing"] };
}

describe("provider policy: Claude for text and code, ChatGPT/Codex only for images, never OpenCode or DeepSeek", () => {
  it("keeps every text, code, review and chat path off OpenCode, DeepSeek and the ChatGPT allowance", () => {
    // Model chains: Claude only, with no silent hop to a retired provider.
    expect(chatModelChain()).toEqual(["anthropic:claude-sonnet-5-5"]);
    expect(quickModelChain()).toEqual(["anthropic:claude-haiku-5-5"]);
    expect(oneShotModelChain()).toEqual(["anthropic:claude-haiku-5-5"]);
    expect(defaultModel()).toBe("anthropic:claude-haiku-5-5");
    for (const model of ["opencode-go/deepseek-v4.1-flash", "opencode-go:gpt-6-luna", "commandcode:deepseek/deepseek-v4-flash", "gpt-6-luna", "codex"]) {
      expect(() => resolveModelConnection(model), model).toThrow(/no longer uses|images only/);
    }
    // With Claude at its cap there is nothing left, and Flyd says so rather than falling back.
    vi.stubEnv("FLYD_CLAUDE", "0");
    expect(() => defaultModel()).toThrow("no longer uses");
    expect(() => quickModelChain()).toThrow("no longer uses");
    vi.stubEnv("FLYD_CLAUDE", "1");

    // Worker routing and Flyd's own coding worker.
    for (const requirement of ["implementation", "review", "analysis"] as const) {
      const allowance = [health("codex"), health("opencode"), health("openai/gpt-5.6-luna"), health("opencode-go/deepseek-v4-pro")];
      expect(routeWorker({ requirements: [requirement], adapters: [...allowance, health("claude")], activeCounts: { claude: 9 }, excludedAdapters: [] }).name).toBe("claude");
      expect(() => routeWorker({ requirements: [requirement], adapters: allowance, activeCounts: {}, excludedAdapters: [] })).toThrow("No healthy worker satisfies");
    }
    // The overlay, /manifest and `flyd code` worker lands on Claude Sonnet through Anthropic's OpenAI-compatible API.
    expect(loadFlydWorkerConfigs({ envFileText: "" })).toEqual([{
      apiKey: "claude-key",
      model: "claude-sonnet-5-5",
      baseURL: "https://api.anthropic.com/v1",
      providerIdentity: "api.anthropic.com/claude-sonnet-5-5",
    }]);
    vi.stubEnv("FLYD_CLAUDE", "0");
    expect(() => loadFlydWorkerConfigs({ envFileText: "" })).toThrow("Flyd coding model is not configured");
    vi.stubEnv("FLYD_CLAUDE", "1");

    // Crew: Claude Code on the subscription, retired models ignored, no backup onto them.
    expect(crewModel()).toBe(DEFAULT_CREW_MODEL);
    expect(crewBackupModels()).toEqual(["cursor/auto"]);
    expect(crewClaudeArgs(DEFAULT_CREW_MODEL, "brief")).not.toContain("--model");
    expect(crewClaudeArgs(DEFAULT_CREW_MODEL, "brief")).toEqual(expect.arrayContaining(["Bash(git push:*)", "Bash(rm -rf:*)"]));
    for (const model of ["opencode-go/gpt-6-luna", "openai/gpt-6.1-sol", "codex", "opencode-go/deepseek-v4-pro"]) {
      expect(() => launchCrewmate({ model } as CrewTask, "brief"), model).toThrow(/no longer uses|images only/);
    }
  });
});

describe("the Claude coding worker counts against Flyd's monthly Claude cap", () => {
  it("stops choosing Claude once worker completions on Anthropic's endpoint have spent the month's cap", async () => {
    const configs = loadFlydWorkerConfigs({ envFileText: "" });
    expect(configs.map((config) => config.baseURL)).toEqual(["https://api.anthropic.com/v1"]);
    // 100M input tokens is far past the default $100 cap at any published Sonnet price.
    const client = completionClient(configs, undefined, async () => ({
      choices: [{ message: { content: "done" } }],
      usage: { prompt_tokens: 100_000_000, completion_tokens: 1_000 },
    }));
    await client.complete({ messages: [{ role: "user", content: "plan" }], tools: [] });
    expect(() => loadFlydWorkerConfigs({ envFileText: "" })).toThrow("Flyd coding model is not configured");
  });

  it("leaves the cap alone for a worker on another provider", async () => {
    const configs = [{ apiKey: "k", model: "some-model", baseURL: "https://openrouter.ai/api/v1", providerIdentity: "openrouter.ai/some-model" }];
    const client = completionClient(configs, undefined, async () => ({
      choices: [{ message: { content: "done" } }],
      usage: { prompt_tokens: 100_000_000, completion_tokens: 1_000 },
    }));
    await client.complete({ messages: [{ role: "user", content: "plan" }], tools: [] });
    expect(loadFlydWorkerConfigs({ envFileText: "" })[0].baseURL).toBe("https://api.anthropic.com/v1");
  });
});

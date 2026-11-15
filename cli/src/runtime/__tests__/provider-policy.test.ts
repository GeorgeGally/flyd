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
import { designModel } from "../../command/design-claude.js";
import { DEFAULT_MODEL_ROUTING, modelRoutes, setModelRouting, type ModelRoute } from "../model-routing.js";

const claudeThen = (claude: string, ...rest: ModelRoute[]): ModelRoute[] => [{ provider: "anthropic", model: claude }, ...rest];
// George's live setup on 2026-11-15 moved into the one config: DeepSeek, OpenCode and the ChatGPT login listed in every job.
const RETIRED: ModelRoute[] = [
  { provider: "opencode-go", model: "deepseek-v4.1-flash" },
  { provider: "commandcode", model: "deepseek/deepseek-v4-flash" },
  { provider: "codex", model: "gpt-5.6-luna" },
];

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-provider-policy-"));
  vi.stubEnv("FLYD_CLAUDE_SPEND_FILE", join(dir, "spend.json"));
  vi.stubEnv("FLYD_CLAUDE", "1");
  vi.stubEnv("CLAUDE_API_KEY", "claude-key");
  vi.stubEnv("FLYD_PROVIDER", "opencode-go");
  vi.stubEnv("OPENCODE_API_KEY", "opencode-key");
  vi.stubEnv("COMMANDCODE_API_KEY", "cc-key");
  vi.stubEnv("FLYD_MODEL_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  setModelRouting({ jobs: {
    chat: [...RETIRED, ...claudeThen("claude-sonnet-5-5")],
    quick: [...RETIRED, ...claudeThen("claude-haiku-5-5")],
    background: [...RETIRED, ...claudeThen("claude-haiku-5-5")],
    worker: [...RETIRED, ...claudeThen("claude-sonnet-5-5")],
    crew: [{ provider: "opencode-go", model: "gpt-6-luna" }, { provider: "claude", model: "default" }, { provider: "codex", model: "default" }, { provider: "openai", model: "gpt-6.1-sol" }, { provider: "cursor", model: "auto" }],
    design: [{ provider: "opencode", model: "deepseek-v4-pro" }, { provider: "claude", model: "sonnet" }],
  } });
});

afterEach(() => {
  setModelRouting(null);
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
    expect(() => defaultModel()).toThrow("No model can do Flyd's background jobs");
    expect(() => quickModelChain()).toThrow("No model can do Flyd's quick jobs");
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
    expect(() => loadFlydWorkerConfigs({ envFileText: "" })).toThrow("No coding model is available");
    vi.stubEnv("FLYD_CLAUDE", "1");

    // Crew: Claude Code on the subscription, retired models ignored, no backup onto them.
    expect(crewModel()).toBe(DEFAULT_CREW_MODEL);
    expect(crewBackupModels()).toEqual(["cursor/auto"]);
    // Design: the first allowed Claude Code entry.
    expect(designModel()).toBe("sonnet");
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
    expect(() => loadFlydWorkerConfigs({ envFileText: "" })).toThrow("No coding model is available");
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

describe("one model config", () => {
  it("keeps today's behaviour by default: Claude for text and code, Codex only for images", () => {
    setModelRouting(null);
    expect(DEFAULT_MODEL_ROUTING.banned).toEqual(["opencode", "deepseek"]);
    expect(modelRoutes("images", DEFAULT_MODEL_ROUTING)).toEqual([{ provider: "codex", model: "default" }]);
    expect(modelRoutes("crew", DEFAULT_MODEL_ROUTING)).toEqual([{ provider: "claude", model: "default" }]);
    expect(modelRoutes("design", DEFAULT_MODEL_ROUTING)).toEqual([{ provider: "claude", model: "opus" }]);
  });

  it("swaps a model with one edit, and bans a provider everywhere with one more", () => {
    setModelRouting({ jobs: { chat: [{ provider: "openai", model: "gpt-5.6-luna" }, ...claudeThen("claude-sonnet-5-5")] } });
    expect(chatModelChain()).toEqual(["openai:gpt-5.6-luna", "anthropic:claude-sonnet-5-5"]);
    setModelRouting({ banned: ["opencode", "deepseek", "openai"], jobs: { chat: [{ provider: "openai", model: "gpt-5.6-luna" }, ...claudeThen("claude-sonnet-5-5")] } });
    expect(chatModelChain()).toEqual(["anthropic:claude-sonnet-5-5"]);
    expect(() => resolveModelConnection("openai:gpt-5.6-luna")).toThrow(/no longer uses/);
  });

  it("reads ~/.flyd/models.json, and falls back to the defaults when it is broken", async () => {
    setModelRouting(null);
    const { writeFileSync } = await import("node:fs");
    const path = join(dir, "models.json");
    vi.stubEnv("FLYD_MODELS_PATH", path);
    writeFileSync(path, JSON.stringify({ jobs: { quick: [{ provider: "anthropic", model: "claude-sonnet-5-5" }] } }));
    expect(quickModelChain()).toEqual(["anthropic:claude-sonnet-5-5"]);
    expect(chatModelChain()).toEqual(["anthropic:claude-sonnet-5-5"]);
    writeFileSync(path, "{ not json");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(quickModelChain()).toEqual(["anthropic:claude-haiku-5-5"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

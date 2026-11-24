import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("OpenCode Go model routing", () => {
  it("uses OpenCode Go defaults and resolves its API connection, with Claude as fallback", async () => {
    vi.stubEnv("FLYD_PROVIDER", "");
    vi.stubEnv("FLYD_MODELS_PATH", "");
    vi.stubEnv("OPENCODE_API_KEY", "opencode-key");
    vi.stubEnv("CLAUDE_API_KEY", "claude-key");
    vi.stubEnv("FLYD_CLAUDE", "1");
    vi.resetModules();

    const routing = await import("../model-routing.js");
    const config = await import("../../lib/config.js");
    const worker = await import("../flyd-worker-config.js");

    expect(routing.modelRoutes("chat")).toEqual([
      { provider: "opencode-go", model: "gpt-6-luna" },
      { provider: "anthropic", model: "claude-sonnet-5-5" },
    ]);
    expect(config.chatModelChain()).toEqual([
      "opencode-go:gpt-6-luna",
      "anthropic:claude-sonnet-5-5",
    ]);
    expect(routing.modelRoutes("quick")).toEqual([{ provider: "opencode-go", model: "gpt-6-luna" }, { provider: "anthropic", model: "claude-haiku-5-5" }]);
    expect(routing.modelRoutes("background")).toEqual([{ provider: "opencode-go", model: "gpt-6-luna" }, { provider: "anthropic", model: "claude-haiku-5-5" }]);
    expect(config.resolveModelConnection("opencode-go:gpt-6-luna")).toEqual({
      model: "opencode-go:gpt-6-luna",
      apiKey: "opencode-key",
      baseURL: "https://opencode.ai/inference/go/v1",
      providerIdentity: "opencode.ai/gpt-6-luna",
    });
    expect(worker.loadFlydWorkerConfigs({
      environment: { OPENCODE_API_KEY: "opencode-key" },
      routing: routing.DEFAULT_MODEL_ROUTING,
    })).toEqual([{
      apiKey: "opencode-key",
      model: "gpt-6-luna",
      baseURL: "https://opencode.ai/inference/go/v1",
      providerIdentity: "opencode.ai/gpt-6-luna",
    }]);
  });
});

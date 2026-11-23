import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolve } from "path";

describe("Flyd directory configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("honors FLYD_DIR for shared Rails and CLI state", async () => {
    vi.stubEnv("FLYD_DIR", "/tmp/flyd-shared-state");
    vi.resetModules();

    const config = await import("../config.js");

    expect(config.FLYD_DIR).toBe(resolve("/tmp/flyd-shared-state"));
    expect(config.RAW_DIR).toBe(resolve("/tmp/flyd-shared-state/raw"));
  });

  it("fails loudly rather than downgrading when no listed chat model is available", async () => {
    vi.stubEnv("FLYD_CLAUDE", "0");
    vi.resetModules();

    const config = await import("../config.js");
    const routing = await import("../../runtime/model-routing.js");
    routing.setModelRouting({ jobs: { chat: [{ provider: "anthropic", model: "claude-sonnet-5-5" }] } });

    expect(() => config.defaultChatModel()).toThrow("No model can do Flyd's chat jobs");
  });

  it("loads canonical model settings from the project .env without overriding the shell", async () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-config-"));
    writeFileSync(join(root, ".env"), [
      "FLYD_MODEL=gpt-4.6",
      "FLYD_MODEL_API_KEY=project-key",
      "FLYD_MODEL_BASE_URL=https://models.example.test/v1",
    ].join("\n"));
    const environment: NodeJS.ProcessEnv = { FLYD_MODEL: "shell-model" };

    try {
      const config = await import("../config.js");
      config.loadFlydEnvironment(root, environment);

      expect(environment).toMatchObject({
        FLYD_MODEL: "shell-model",
        FLYD_MODEL_API_KEY: "project-key",
        FLYD_MODEL_BASE_URL: "https://models.example.test/v1",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves chat through the canonical Flyd model connection", async () => {
    vi.stubEnv("FLYD_MODEL_API_KEY", "flyd-key");
    vi.stubEnv("FLYD_MODEL_BASE_URL", "https://models.example.test/v1/");
    vi.stubEnv("OPENAI_API_KEY", "wrong-key");
    vi.resetModules();

    const config = await import("../config.js");

    expect(config.resolveModelConnection("gpt-4.6")).toEqual({
      model: "gpt-4.6",
      apiKey: "flyd-key",
      baseURL: "https://models.example.test/v1",
      providerIdentity: "models.example.test/gpt-4.6",
    });
  });

  it("resolves OpenCode Go and still refuses DeepSeek, bare under FLYD_PROVIDER or prefixed", async () => {
    vi.stubEnv("FLYD_PROVIDER", "opencode-go");
    vi.stubEnv("OPENCODE_API_KEY", "opencode-key");
    vi.stubEnv("FLYD_CLAUDE", "0");
    vi.resetModules();

    const config = await import("../config.js");

    expect(config.resolveModelConnection("gpt-6-luna")).toMatchObject({
      apiKey: "opencode-key",
      baseURL: "https://opencode.ai/zen/go/v1",
      providerIdentity: "opencode.ai/gpt-6-luna",
    });
    expect(config.resolveModelConnection("opencode:kimi-k3")).toMatchObject({
      apiKey: "opencode-key",
      baseURL: "https://opencode.ai/zen/v1",
    });
    expect(() => config.resolveModelConnection("opencode-go/deepseek-v4-flash")).toThrow(/no longer uses/);
    const routing = await import("../../runtime/model-routing.js");
    routing.setModelRouting({ jobs: { chat: [{ provider: "opencode-go", model: "deepseek-v4-flash" }] } });
    expect(() => config.resolveModelConnection()).toThrow(/No model can do Flyd's chat jobs/);
  });

  it("resolves a bare model under FLYD_PROVIDER=commandcode to CommandCode, keeping the same model", async () => {
    vi.stubEnv("FLYD_PROVIDER", "commandcode");
    vi.stubEnv("COMMANDCODE_API_KEY", "cc-key");
    vi.stubEnv("FLYD_MODEL_API_KEY", "");
    vi.stubEnv("FLYD_MODEL_BASE_URL", "");
    vi.resetModules();

    const config = await import("../config.js");
    const connection = config.resolveModelConnection("moonshot/kimi-k3");

    expect(connection.model).toBe("moonshot/kimi-k3");
    expect(connection.apiKey).toBe("cc-key");
    expect(connection.baseURL).toBe("https://api.commandcode.ai/provider/v1");
    expect(config.usesOpenAITransport("moonshot/kimi-k3")).toBe(true);
    expect(config.hasApiKey("moonshot/kimi-k3")).toBe(true);
  });

  it("hasApiKey follows provider-qualified models and missing keys", async () => {
    vi.stubEnv("FLYD_PROVIDER", "");
    vi.stubEnv("FLYD_MODEL_API_KEY", "");
    vi.stubEnv("COMMANDCODE_API_KEY", "cc-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.resetModules();

    const config = await import("../config.js");

    expect(config.hasApiKey("commandcode:moonshot/kimi-k3")).toBe(true);
    expect(config.hasApiKey("openai:gpt-5.6-luna")).toBe(false);
  });

  it("fails loudly for an unsupported provider instead of reaching for Anthropic", async () => {
    vi.stubEnv("FLYD_PROVIDER", "google");
    vi.stubEnv("ANTHROPIC_API_KEY", "wrong-key");
    vi.resetModules();

    const config = await import("../config.js");

    expect(() => config.resolveModelConnection("some-model")).toThrow(/not supported/);
  });

  it("routes an openrouter: model to OpenRouter with its own key and the bare model id", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "router-key");
    vi.stubEnv("FLYD_MODEL_API_KEY", "wrong-key");
    vi.resetModules();

    const config = await import("../config.js");

    expect(config.apiModelId("openrouter:x-ai/grok-4.3")).toBe("x-ai/grok-4.3");
    expect(config.usesOpenAITransport("openrouter:x-ai/grok-4.3")).toBe(true);
    expect(config.resolveModelConnection("openrouter:x-ai/grok-4.3")).toEqual({
      model: "openrouter:x-ai/grok-4.3",
      apiKey: "router-key",
      baseURL: "https://openrouter.ai/api/v1",
      providerIdentity: "openrouter.ai/x-ai/grok-4.3",
    });
  });
});

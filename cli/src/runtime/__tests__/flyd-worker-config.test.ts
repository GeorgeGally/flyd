import { describe, expect, it } from "vitest";
import { loadFlydWorkerConfig, loadFlydWorkerConfigs, parseEnvFile } from "../flyd-worker-config.js";
import { DEFAULT_MODEL_ROUTING, type ModelRoute, type ModelRouting } from "../model-routing.js";

const worker = (...routes: ModelRoute[]): ModelRouting => ({ ...DEFAULT_MODEL_ROUTING, jobs: { ...DEFAULT_MODEL_ROUTING.jobs, worker: routes } });

describe("Flyd worker configuration", () => {
  it("loads the configured model without exposing the credential in its identity", () => {
    const config = loadFlydWorkerConfig({
      environment: {},
      envFileText: "OPENROUTER_API_KEY=secret-provider-key\nOPENROUTER_BASE_URL=https://models.example.test/v1",
      routing: worker({ provider: "openrouter", model: "custom-model" }),
    });

    expect(config).toMatchObject({
      apiKey: "secret-provider-key",
      model: "custom-model",
      baseURL: "https://models.example.test/v1",
    });
    expect(config.providerIdentity).toBe("models.example.test/custom-model");
    expect(JSON.stringify({ ...config, apiKey: "[REDACTED]" })).not.toContain("secret-provider-key");
  });

  it("never uses a banned provider, by model or endpoint, even with its key set", () => {
    const environment = { OPENCODE_API_KEY: "opencode-key", COMMANDCODE_API_KEY: "cc-key", OPENROUTER_API_KEY: "router-key" };
    const routing = worker(
      { provider: "opencode-go", model: "deepseek-v4.1-flash" },
      { provider: "commandcode", model: "deepseek/deepseek-v4-flash" },
      { provider: "openrouter", model: "moonshot/kimi-k3" },
    );
    expect(loadFlydWorkerConfigs({ environment, routing })).toEqual([{
      apiKey: "router-key",
      model: "moonshot/kimi-k3",
      baseURL: "https://openrouter.ai/api/v1",
      providerIdentity: "openrouter.ai/moonshot/kimi-k3",
    }]);
    expect(() => loadFlydWorkerConfigs({ environment: { ...environment, OPENROUTER_BASE_URL: "https://opencode.ai/zen/go/v1" }, routing }))
      .toThrow("No coding model is available");
  });

  it("follows a swap in the config, and drops /free when a paid model exists", () => {
    const environment = { OPENAI_API_KEY: "openai-key", OPENROUTER_API_KEY: "router-key" };
    const configs = loadFlydWorkerConfigs({
      environment,
      routing: worker({ provider: "openai", model: "gpt-5.6-luna" }, { provider: "openrouter", model: "openrouter/free" }),
    });
    expect(configs).toEqual([{
      apiKey: "openai-key",
      model: "gpt-5.6-luna",
      baseURL: "https://api.openai.com/v1",
      providerIdentity: "api.openai.com/gpt-5.6-luna",
    }]);
    expect(loadFlydWorkerConfig({ environment, routing: worker({ provider: "openrouter", model: "moonshot/kimi-k3" }) }).model).toBe("moonshot/kimi-k3");
  });

  it("parses quoted dotenv values and ignores comments", () => {
    expect(parseEnvFile('export FLYD_MODEL="model one"\n# comment\nEMPTY=\n')).toEqual({
      FLYD_MODEL: "model one",
      EMPTY: "",
    });
  });

  it("fails with a Flyd-specific message when no listed model has a key", () => {
    expect(() => loadFlydWorkerConfig({ environment: {}, routing: DEFAULT_MODEL_ROUTING })).toThrow("No coding model is available");
  });
});

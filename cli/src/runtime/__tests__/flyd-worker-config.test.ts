import { describe, expect, it } from "vitest";
import { loadFlydWorkerConfig, loadFlydWorkerConfigs, parseEnvFile } from "../flyd-worker-config.js";

describe("Flyd worker configuration", () => {
  it("loads the configured model without exposing the credential in its identity", () => {
    const config = loadFlydWorkerConfig({
      environment: {},
      envFileText: [
        "OPENCODE_API=secret-provider-key",
        "OPENCODE_MODEL=deepseekv4",
      ].join("\n"),
    });

    expect(config).toMatchObject({
      apiKey: "secret-provider-key",
      model: "deepseek-v4-pro",
      baseURL: "https://opencode.ai/zen/v1",
    });
    expect(config.providerIdentity).toBe("opencode.ai/deepseek-v4-pro");
    expect(JSON.stringify({ ...config, apiKey: "[REDACTED]" })).not.toContain("secret-provider-key");
  });

  it("prefers canonical Flyd settings over compatibility settings", () => {
    const config = loadFlydWorkerConfig({
      environment: {
        FLYD_MODEL_API_KEY: "flyd-key",
        FLYD_MODEL: "custom-model",
        FLYD_MODEL_BASE_URL: "https://models.example.test/v1/",
        OPENCODE_API: "legacy-key",
        OPENCODE_MODEL: "legacy-model",
      },
    });

    expect(config).toMatchObject({
      apiKey: "flyd-key",
      model: "custom-model",
      baseURL: "https://models.example.test/v1",
      providerIdentity: "models.example.test/custom-model",
    });
  });

  it("uses the configured OpenCode model and drops OpenRouter /free when a paid model exists", () => {
    const configs = loadFlydWorkerConfigs({
      environment: {
        OPENROUTER_API_KEY: "router-key",
        OPENROUTER_MODEL: "openrouter/free",
        OPENCODE_API: "legacy-key",
        OPENCODE_MODEL: "deepseekv4",
      },
    });

    expect(configs).toMatchObject([
      {
        apiKey: "legacy-key",
        model: "deepseek-v4-pro",
        baseURL: "https://opencode.ai/zen/v1",
        providerIdentity: "opencode.ai/deepseek-v4-pro",
      },
    ]);
    expect(loadFlydWorkerConfig({
      environment: {
        OPENROUTER_API_KEY: "router-key",
        OPENROUTER_MODEL: "openrouter/free",
        OPENCODE_API: "legacy-key",
        OPENCODE_MODEL: "deepseekv4",
      },
    })).toEqual(configs[0]);
  });

  it("pairs FLYD_MODEL with OPENAI_API_KEY and drops /free when a paid model exists", () => {
    const configs = loadFlydWorkerConfigs({
      environment: {
        FLYD_MODEL: "gpt-5.6-luna",
        FLYD_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        OPENROUTER_API_KEY: "router-key",
        OPENROUTER_MODEL: "openrouter/free",
      },
    });

    expect(configs).toEqual([
      {
        apiKey: "openai-key",
        model: "gpt-5.6-luna",
        baseURL: "https://api.openai.com/v1",
        providerIdentity: "api.openai.com/gpt-5.6-luna",
      },
    ]);
  });

  it("accepts the OPENOCE_MODEL typo as an OpenCode model alias", () => {
    const config = loadFlydWorkerConfig({
      environment: {
        OPENCODE_API_KEY: "opencode-key",
        OPENOCE_MODEL: "deepseekv4",
      },
    });

    expect(config).toMatchObject({
      apiKey: "opencode-key",
      model: "deepseek-v4-pro",
      baseURL: "https://opencode.ai/zen/v1",
      providerIdentity: "opencode.ai/deepseek-v4-pro",
    });
  });

  it("parses quoted dotenv values and ignores comments", () => {
    expect(parseEnvFile('export FLYD_MODEL="model one"\n# comment\nEMPTY=\n')).toEqual({
      FLYD_MODEL: "model one",
      EMPTY: "",
    });
  });

  it("fails with a Flyd-specific message when the model is not configured", () => {
    expect(() => loadFlydWorkerConfig({ environment: {} })).toThrow(
      "Flyd coding model is not configured",
    );
  });
});

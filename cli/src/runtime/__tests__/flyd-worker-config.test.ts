import { describe, expect, it } from "vitest";
import { loadFlydWorkerConfig, loadFlydWorkerConfigs, parseEnvFile } from "../flyd-worker-config.js";

describe("Flyd worker configuration", () => {
  it("loads the configured model without exposing the credential in its identity", () => {
    const config = loadFlydWorkerConfig({
      environment: {},
      envFileText: [
        "FLYD_MODEL_API_KEY=secret-provider-key",
        "FLYD_MODEL=custom-model",
        "FLYD_MODEL_BASE_URL=https://models.example.test/v1",
      ].join("\n"),
    });

    expect(config).toMatchObject({
      apiKey: "secret-provider-key",
      model: "custom-model",
      baseURL: "https://models.example.test/v1",
    });
    expect(config.providerIdentity).toBe("models.example.test/custom-model");
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

  it("never uses OpenCode, OpenCode Go or DeepSeek, by model or endpoint, even with their key set", () => {
    const environment = {
      FLYD_PROVIDER: "opencode-go",
      FLYD_MODEL: "opencode-go/deepseek-v4.1-flash",
      OPENCODE_API_KEY: "opencode-key",
      OPENCODE_MODEL: "deepseekv4",
      OPENROUTER_API_KEY: "router-key",
      OPENROUTER_MODEL: "openrouter/free",
    };
    expect(loadFlydWorkerConfigs({ environment })).toEqual([{
      apiKey: "router-key",
      model: "openrouter/free",
      baseURL: "https://openrouter.ai/api/v1",
      providerIdentity: "openrouter.ai/openrouter/free",
    }]);
    expect(() => loadFlydWorkerConfigs({ environment: { ...environment, OPENROUTER_API_KEY: "" } })).toThrow("Flyd coding model is not configured");
    expect(() => loadFlydWorkerConfigs({ environment: { FLYD_MODEL_API_KEY: "k", FLYD_MODEL: "custom", FLYD_MODEL_BASE_URL: "https://opencode.ai/zen/go/v1" } })).toThrow("not configured");
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

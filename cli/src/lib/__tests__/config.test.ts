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

  it("refuses to silently downgrade chat to gpt-4o-mini", async () => {
    vi.stubEnv("FLYD_MODEL", "");
    vi.stubEnv("FLYD_CHAT_MODEL", "");
    vi.resetModules();

    const config = await import("../config.js");

    expect(() => config.defaultChatModel()).toThrow(
      "Flyd chat model is not configured",
    );
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
    vi.stubEnv("FLYD_MODEL", "gpt-4.6");
    vi.stubEnv("FLYD_CHAT_MODEL", "");
    vi.stubEnv("FLYD_MODEL_API_KEY", "flyd-key");
    vi.stubEnv("FLYD_MODEL_BASE_URL", "https://models.example.test/v1/");
    vi.stubEnv("OPENAI_API_KEY", "wrong-key");
    vi.resetModules();

    const config = await import("../config.js");

    expect(config.resolveModelConnection()).toEqual({
      model: "gpt-4.6",
      apiKey: "flyd-key",
      baseURL: "https://models.example.test/v1",
      providerIdentity: "models.example.test/gpt-4.6",
    });
  });
});

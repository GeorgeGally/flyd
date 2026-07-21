import { describe, expect, it, vi } from "vitest";
import { completionClient } from "../flyd-worker-process.js";

describe("Flyd worker model fallback", () => {
  it("tries the configured OpenCode model first and stays on the fallback after failover", async () => {
    const primary = {
      apiKey: "primary-secret", model: "deepseek-v4-pro",
      baseURL: "https://opencode.ai/zen/v1", providerIdentity: "opencode.ai/deepseek-v4-pro",
    };
    const fallback = {
      apiKey: "fallback-secret", model: "openrouter/free",
      baseURL: "https://openrouter.ai/api/v1", providerIdentity: "openrouter.ai/openrouter/free",
    };
    const request = vi.fn(async (config: typeof primary) => {
      if (config.providerIdentity === primary.providerIdentity) throw new Error("unavailable");
      return { choices: [ { message: { content: "done", tool_calls: [] } } ] };
    });
    const onFallback = vi.fn();
    const client = completionClient([ primary, fallback ], onFallback, request);

    await expect(client.complete({ messages: [], tools: [] })).resolves.toMatchObject({ content: "done" });
    await expect(client.complete({ messages: [], tools: [] })).resolves.toMatchObject({ content: "done" });

    expect(request.mock.calls.map(([ config ]) => config.providerIdentity)).toEqual([
      primary.providerIdentity, fallback.providerIdentity, fallback.providerIdentity,
    ]);
    expect(onFallback).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith(fallback.providerIdentity);
  });

  it("reports provider identities without leaking request errors or credentials", async () => {
    const config = {
      apiKey: "provider-secret", model: "broken-model",
      baseURL: "https://models.example.test/v1", providerIdentity: "models.example.test/broken-model",
    };
    const client = completionClient([ config ], undefined, async () => {
      throw new Error("response contains provider-secret");
    });

    await expect(client.complete({ messages: [], tools: [] })).rejects.toThrow(
      "Flyd coding model request failed for models.example.test/broken-model",
    );
  });

});

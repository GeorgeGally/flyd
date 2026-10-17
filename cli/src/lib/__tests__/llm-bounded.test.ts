import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), constructor: vi.fn(), anthropicCreate: vi.fn(), anthropicConstructor: vi.fn() }));
vi.mock("openai", () => ({ default: class { constructor(options: unknown) { mocks.constructor(options); } chat = { completions: { create: mocks.create } }; } }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { constructor(options: unknown) { mocks.anthropicConstructor(options); } messages = { create: mocks.anthropicCreate }; } }));
vi.mock("../config.js", () => ({
  usesOpenAITransport: (model: string) => !model.startsWith("anthropic:"),
  apiModelId: (model: string) => model.split(":").pop(),
  resolveModelConnection: () => ({ apiKey: "test-key", baseURL: "https://pinned.example/v1", providerIdentity: "pinned/test" }),
}));
vi.mock("../claude-spend.js", () => ({ claudeHeaders: () => ({}), recordClaudeUsage: vi.fn() }));
import { boundedQuery } from "../llm.js";
const signal = new AbortController().signal;
const request = { prompt: "Only this context", model: "openai:test", providerIdentity: "pinned/test", maxTokens: 400, signal };
beforeEach(() => vi.clearAllMocks());
describe("bounded preparation transport", () => {
  it("sends only supplied text with a hard output bound, signal, and zero retries", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: "draft" }, finish_reason: "stop" }] });
    expect(await boundedQuery(request)).toBe("draft");
    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://pinned.example/v1", maxRetries: 0 }));
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ model: "test", max_completion_tokens: 400, messages: [{ role: "user", content: "Only this context" }] }, { signal });
  });
  it("never retries a truncated response", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: "" }, finish_reason: "length" }] });
    await expect(boundedQuery(request)).rejects.toThrow("incomplete");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("rejects destination mismatch before constructing transport", async () => {
    await expect(boundedQuery({ ...request, providerIdentity: "other" })).rejects.toThrow("provider changed");
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it("bounds Anthropic without adding tools or ambient context", async () => {
    mocks.anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "draft" }], usage: {}, stop_reason: "end_turn" });
    expect(await boundedQuery({ ...request, model: "anthropic:test" })).toBe("draft");
    expect(mocks.anthropicConstructor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
    expect(mocks.anthropicCreate).toHaveBeenCalledExactlyOnceWith({ model: "test", max_tokens: 400, messages: [{ role: "user", content: "Only this context" }] }, { signal, headers: {} });
  });
  it("keeps Sonnet 5.5 checker output available inside a small hard ceiling", async () => {
    mocks.anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "MET 1: verified" }], usage: {}, stop_reason: "end_turn" });
    await boundedQuery({ ...request, model: "anthropic:claude-sonnet-5-5" });
    expect(mocks.anthropicCreate).toHaveBeenCalledWith(expect.objectContaining({ thinking: { type: "between_tools" }, output_config: { effort: "low" }, max_tokens: 400 }), expect.objectContaining({ signal }));
  });
});

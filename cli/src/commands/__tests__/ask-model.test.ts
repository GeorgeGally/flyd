import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../lib/llm.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/llm.js")>()), query }));
vi.mock("../../cognition/context-compiler.js", () => ({
  compileContext: vi.fn(async () => ({
    user: { profile: "George lives in Cape Town.", autonomy: [], communication: [] },
    present: { projection: "", activeProjects: [], gaps: [] },
    projects: [],
    conversation: { recap: "", referents: {} },
    memory: {
      current: [{ entityId: "person:george", attribute: "city", value: "Cape Town", authority: "stated" }],
      relevant: [],
      historical: [],
      conflicts: [{ entityId: "topic:x", attribute: "decision", claims: ["a", "b"] }],
      gaps: [],
    },
  })),
}));

const { askFlyd, runAsk } = await import("../ask.js");

describe("flyd ask", () => {
  beforeEach(() => {
    query.mockReset();
    vi.stubEnv("FLYD_PROVIDER", "commandcode");
    vi.stubEnv("FLYD_MODEL", "deepseek/deepseek-v4.1-flash");
    vi.stubEnv("FLYD_CHAT_MODEL", "");
    vi.stubEnv("FLYD_CHAT_FALLBACK_MODELS", "");
    vi.stubEnv("COMMANDCODE_API_KEY", "cc-key");
  });
  afterEach(() => { vi.unstubAllEnvs(); process.exitCode = undefined; });

  it("answers with a model call over the chat chain, carrying the compiled context", async () => {
    query.mockResolvedValue("You live in Cape Town.");
    const result = await askFlyd("where do I live?");

    expect(result.answer).toBe("You live in Cape Town.");
    const [prompt, , , , , options] = query.mock.calls[0];
    expect(prompt).toContain("George lives in Cape Town.");
    expect(prompt).toContain("where do I live?");
    expect(options.chain).toContain("deepseek/deepseek-v4.1-flash");
    expect(result.evidence).toContain("person:george");
    expect(result.evidence).not.toContain("[conflict]");
  });

  it("uses exactly the model the caller names", async () => {
    query.mockResolvedValue("ok");
    await askFlyd("hi", { model: "openai:gpt-5.6-luna" });
    expect(query.mock.calls[0][5].chain).toEqual(["openai:gpt-5.6-luna"]);
  });

  it("fails loudly instead of printing context when no model answers", async () => {
    query.mockRejectedValue(new Error("429 Go usage limit exceeded"));
    await expect(askFlyd("hi")).rejects.toThrow(/No model answered.*429/);

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    await runAsk("hi");
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("flyd ask failed"));
    expect(logs).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    errors.mockRestore();
    logs.mockRestore();
  });

  it("treats an empty answer as a failure", async () => {
    query.mockResolvedValue("  ");
    await expect(askFlyd("hi")).rejects.toThrow(/empty answer/);
  });
});

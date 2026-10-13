import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respondToConversation } from "../conversation-responder.js";

// George asked Flyd's window "what models is flyd using?" and got: "The one I'm
// sure of is the one writing this … The rest I'd be guessing at … Want me to
// open the repo and give you the full list?" Jev routed it as an answer that
// needs no code, so the code tools were out of reach, nothing in memory or the
// prompt named Flyd's models, and the answer route said to offer instead of
// look. These turns run that exact route.

const LOGGED_REPLY = "The one I'm sure of is the one writing this: opencode-go/deepseek-v4.1-flash. That's what Flyd's chat runs on.\n\nThe rest I'd be guessing at. Search rewrites go through a configured LLM with a local fallback, and the background jobs (memory curation, news, the coding crew) each have their own model wired in, but I can't name those from memory without reading the config.\n\nWant me to open the repo and give you the full list, model by model and what each one does?";

const CONFIGURED = {
  FLYD_MODEL: "opencode-go/deepseek-v4.1-flash",
  FLYD_CHAT_MODEL: "opencode-go/deepseek-v4.1-flash",
  FLYD_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe-2025-12-15",
  FLYD_DICTATE_MODEL: "openrouter:x-ai/grok-4.3",
  FLYD_REALTIME_MODEL: "gpt-realtime-2.1",
  FLYD_TTS_MODEL: "gpt-4o-mini-tts-2025-12-15",
  FLYD_WEB_SEARCH_MODEL: "gpt-5.6-luna",
  FLYD_PREDICTION_MODEL: "openrouter:inception/mercury-2.5",
  FLYD_VIEW_XAI_MODEL: "grok-4-fast-non-reasoning",
};
const SECRETS = { OPENAI_API_KEY: "sk-proj-Zx81testsecretvalue000111222", XAI_API_KEY: "xai-testsecret-aabbccddeeff00112233", OPENCODE_API_KEY: "oc_live_testsecret_9f8e7d6c5b4a" };

beforeEach(() => {
  for (const [name, value] of Object.entries({ ...CONFIGURED, ...SECRETS })) vi.stubEnv(name, value);
});
afterEach(() => vi.unstubAllEnvs());
vi.setConfig({ testTimeout: 20_000 });

/**
 * A model that answers from what it was given: the setup when the turn holds
 * it, else what the logged turn said. It stands in for the real model so the
 * test holds the harness to its part: the whole answer is in the turn.
 */
async function ask(message: string, history: Array<{ role: "user" | "assistant"; content: string }> = []) {
  let offered: string[] = [];
  let given = "";
  const steps: string[] = [];
  const answer = await respondToConversation({
    sessionId: "self-knowledge", turnNumber: 1, message, history,
    memory: { verdict: "insufficient", matches: [] }, situation: null,
    onToken: () => undefined,
    onActivity: (step) => steps.push(step),
  }, {
    // The logged reading: a confident answer that needs no code.
    routeTurn: async () => ({ route: "answer", confidence: 0.99, source: "jev", decided: true, domain: null, needsCode: false }),
    resolveConnection: () => ({ model: "opencode-go/deepseek-v4.1-flash", apiKey: "test-key", providerIdentity: "opencode.ai/deepseek-v4.1-flash" }),
    runAgentLoop: async (system, prompt, tools) => {
      offered = tools.map((tool) => tool.name);
      given = `${system}\n${prompt}`;
      const models = given.split("Models, by job:\n")[1]?.split("\n\n")[0];
      return `<final>${models ?? LOGGED_REPLY}</final>`;
    },
    persistReceipt: async (input) => input as never,
    rewrite: async () => "",
  });
  return { answer, offered, given, steps };
}

describe("Flyd asked about its own setup", () => {
  it("answers 'what models is flyd using?' completely and specifically, never with an offer to look", async () => {
    const { answer, offered, steps } = await ask("what models is flyd using?");
    for (const model of new Set(Object.values(CONFIGURED))) expect(answer).toContain(model);
    for (const job of ["Chat", "One-shot thinking", "Deciding who answers", "Web search", "Searching George's memory", "Summaries", "Transcribing", "dictation", "LIVE voice", "Speaking replies aloud", "Coding crewmates"]) {
      expect(answer).toContain(job);
    }
    expect(answer).not.toMatch(/want me to|guessing|can't name|without reading the config/i);
    for (const secret of Object.values(SECRETS)) expect(answer).not.toContain(secret);
    // Its own setup is a tool away on any turn, its own code is open to it, and what it can't answer it passes on.
    expect(offered).toEqual(expect.arrayContaining(["flyd", "read_file", "grep", "pass_on_question"]));
    expect(offered).not.toContain("start_coding_task");
    expect(steps).toContain("Checking my own setup");
  });

  it("looks itself up for the follow-up too", async () => {
    const { given } = await ask("well why didn't u read the config? and why isn't this in memory?", [
      { role: "user", content: "what models is flyd using?" },
      { role: "assistant", content: LOGGED_REPLY },
    ]);
    expect(given).toContain("This is your own setup, looked up live from your configuration just now");
    expect(given).toContain("gpt-realtime-2.1");
  });

  it("keeps its setup out of turns that aren't about itself, and still passes on what it can't answer", async () => {
    const { given, offered } = await ask("what's the weather in bangkok tonight");
    expect(given).not.toContain("Models, by job:");
    expect(given).toContain("pass it on in this turn with pass_on_question");
    expect(offered).toContain("pass_on_question");
    expect(offered).not.toContain("read_file");
  });
});

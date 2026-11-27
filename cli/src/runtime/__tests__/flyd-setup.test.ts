import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flydModelAssignments, flydSetupReport, isFlydSetupQuestion, redactSecrets } from "../flyd-setup.js";

/** George's models.json for the API jobs and the crew. */
const MODELS_PATH = join(mkdtempSync(join(tmpdir(), "flyd-setup-models-")), "models.json");
const sol = { provider: "openai", model: "gpt-5.6-sol" };
const claude = (model: string) => ({ provider: "anthropic", model });
function writeModels(chatFirst = sol): void {
  writeFileSync(MODELS_PATH, JSON.stringify({ jobs: {
    chat: [claude("claude-sonnet-5-5"), chatFirst, { provider: "openai", model: "gpt-5.6-luna" }, { provider: "commandcode", model: "moonshot/kimi-k3" }],
    quick: [claude("claude-haiku-5-5"), sol],
    background: [claude("claude-haiku-5-5"), sol],
    crew: [{ provider: "claude", model: "opus" }],
  } }));
}

/** The settings George sets for Flyd's other models, all at once, as his .env would. */
const CONFIGURED = {
  FLYD_MODELS_PATH: MODELS_PATH,
  FLYD_ROUTING_FALLBACK_MODEL: "openai:gpt-5.6-mini",
  FLYD_JEV_MODEL: "jev-1.13.0",
  FLYD_WEB_SEARCH_MODEL: "gpt-5.6-luna",
  FLYD_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe-2025-12-15",
  FLYD_DICTATE_MODEL: "openrouter:x-ai/grok-4.3",
  FLYD_CONVERSATION_LEARN_MODEL: "openrouter:x-ai/grok-4.3-mini",
  FLYD_REALTIME_MODEL: "gpt-realtime-2.1",
  FLYD_TTS_MODEL: "gpt-4o-mini-tts-2025-12-15",
  FLYD_PREDICTION_MODEL: "openrouter:inception/mercury-2.5",
  FLYD_PROFILE_LEARN_MODEL: "openai:gpt-5.6-nano",
  FLYD_PROFILE_MODEL: "openai:gpt-5.6-sol",
  FLYD_VIEW_XAI_MODEL: "grok-4-fast-non-reasoning",
};

const SECRETS = {
  OPENAI_API_KEY: "sk-proj-Zx81testsecretvalue000111222",
  OPENCODE_API_KEY: "oc_live_testsecret_9f8e7d6c5b4a",
  COMMANDCODE_API_KEY: "cmd-test-secret-4455667788",
  XAI_API_KEY: "xai-testsecret-aabbccddeeff00112233",
  TYPESAFE_API_KEY: "tsk_testsecret_123456789",
  BRAVE_SEARCH_API_KEY: "BSAtestsecret0987654321",
};

function configure(values: Record<string, string>): void {
  writeModels();
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

afterEach(() => vi.unstubAllEnvs());

describe("Flyd's own setup", () => {
  it("names the model doing every job, from the live configuration, with what set it", async () => {
    configure({ ...CONFIGURED, ...SECRETS });
    const report = await flydSetupReport();
    expect(report).not.toContain("Learning facts George states about himself into USER.md");
    for (const model of new Set(Object.entries(CONFIGURED).filter(([key]) => key !== "FLYD_PROFILE_LEARN_MODEL" && key !== "FLYD_MODELS_PATH").map(([, value]) => value))) expect(report).toContain(model);
    expect(report).toMatch(/Chat: [^\n]*openai:gpt-5\.6-sol \[[^\]]*models\.json jobs\.chat\]; if it fails: openai:gpt-5\.6-luna, then commandcode:moonshot\/kimi-k3/);
    expect(report).toMatch(/Reading the room[^\n]*openai:gpt-5\.6-mini \[FLYD_ROUTING_FALLBACK_MODEL\]/);
    expect(report).toMatch(/Deciding who answers[^\n]*openai:gpt-5\.6-sol \[[^\]]*models\.json jobs\.quick\]/);
    expect(report).toMatch(/Speaking replies aloud: gpt-4o-mini-tts-2025-12-15 \[FLYD_TTS_MODEL\]/);
    expect(report).toMatch(/LIVE voice sessions[^\n]*gpt-realtime-2\.1, transcribing George with gpt-realtime-whisper/);
    expect(report).toMatch(/Web search: Brave Search, then OpenAI web search on gpt-5\.6-luna/);
    expect(report).toMatch(/Summaries of long replies[^\n]*grok-4-fast-non-reasoning/);
    expect(report).toContain("Coding crewmates");
    expect(report).toMatch(/claude\/opus \[[^\]]*models\.json jobs\.crew\]/);
    expect(report).toMatch(/Provider keys present \(names only\): [^\n]*OPENAI_API_KEY/);
  });

  it("follows a change to the configuration the next time it is asked, never a stale copy", async () => {
    configure({ ...CONFIGURED, FLYD_TTS_MODEL: "gpt-4o-mini-tts" });
    expect(await flydSetupReport()).toContain("Speaking replies aloud: gpt-4o-mini-tts [FLYD_TTS_MODEL]");
    vi.stubEnv("FLYD_TTS_MODEL", "gpt-5-tts");
    writeModels({ provider: "openai", model: "gpt-5.6-terra" });
    const changed = await flydSetupReport();
    expect(changed).toContain("Speaking replies aloud: gpt-5-tts [FLYD_TTS_MODEL]");
    expect(changed).toMatch(/Chat: [^\n]*openai:gpt-5\.6-terra \[[^\]]*models\.json jobs\.chat\]/);
    vi.stubEnv("FLYD_TTS_MODEL", "");
    expect(await flydSetupReport()).toContain("Speaking replies aloud: gpt-4o-mini-tts [code default]");
  });

  it("names Claude where it leads, and this month's Claude spend against the cap", async () => {
    configure({ ...CONFIGURED, XAI_API_KEY: SECRETS.XAI_API_KEY, FLYD_PREDICTION_MODEL: "", FLYD_ROUTING_FALLBACK_MODEL: "", FLYD_CLAUDE: "1", CLAUDE_API_KEY: "sk-ant-api03-testsecretvalue000111222" });
    const report = await flydSetupReport();
    expect(report).toMatch(/Chat: [^\n]*anthropic:claude-sonnet-5-5 \[[^\]]*models\.json jobs\.chat\]; if it fails: openai:gpt-5\.6-sol/);
    expect(report).toMatch(/Deciding who answers[^\n]*anthropic:claude-haiku-5-5 \[[^\]]*models\.json jobs\.quick/);
    expect(report).toMatch(/Typing suggestions[^\n]*anthropic:claude-haiku-5-5/);
    expect(report).toMatch(/Summaries of long replies[^\n]*claude-haiku-5-5 \[code default\]; if it fails: grok-4-fast-non-reasoning/);
    expect(report).toMatch(/Coding crewmates[^\n]*claude\/opus/);
    expect(report).toMatch(/Claude spend for \d{4}-\d{2}: \$\d+\.\d{2} of a \$100 monthly cap/);
    expect(report).toMatch(/Provider keys present \(names only\): [^\n]*CLAUDE_API_KEY/);
    expect(report).not.toContain("sk-ant-api03-testsecretvalue000111222");
  });

  it("never shows a key, token or secret, only which ones are present", async () => {
    configure({ ...CONFIGURED, ...SECRETS, GITHUB_TOKEN: "ghp_testsecretvalue1234567890abcdef" });
    const report = await flydSetupReport();
    for (const secret of [...Object.values(SECRETS), "ghp_testsecretvalue1234567890abcdef"]) expect(report).not.toContain(secret);
    expect(report).toContain("moonshot/kimi-k3");
    expect(report).toContain("GITHUB_TOKEN");
    expect(redactSecrets("key sk-proj-abcdefghijklmnop1234 and a model gpt-5.6-luna", {})).toBe("key [hidden] and a model gpt-5.6-luna");
  });

  /** What a setting needs before the job reads it. */
  const NEEDS: Record<string, Record<string, string | undefined>> = {
    BEACON_JEV_MODEL: { FLYD_JEV_MODEL: undefined },
    // CommandCode's default model is DeepSeek, which Flyd no longer uses, so the classifier needs its own key.
    FLYD_ROUTER_MODEL: { FLYD_ROUTER_API_KEY: "or-testsecret-0011223344", FLYD_ROUTER_BASE_URL: "https://openrouter.ai/api/v1" },
    FLYD_VIEW_ANTHROPIC_MODEL: { ANTHROPIC_API_KEY: "ant-testsecret-5566778899" },
  };

  it("shows the model each listed setting names, whichever one is set", async () => {
    // Environment model settings only (API keys name no model): "models.json jobs.<job>" entries are covered by the tests above.
    const settings = [...new Set((await flydModelAssignments()).flatMap((assignment) => assignment.settings))].filter((name) => !name.includes(" ") && !name.endsWith("_API_KEY"));
    const missing: string[] = [];
    for (const name of settings) {
      vi.unstubAllEnvs();
      for (const other of settings) vi.stubEnv(other, "");
      configure(SECRETS);
      for (const [needed, value] of Object.entries(NEEDS[name] ?? {})) vi.stubEnv(needed, value);
      const model = `probe-${name.toLowerCase().replaceAll("_", "-")}`;
      vi.stubEnv(name, model);
      if (!(await flydSetupReport()).includes(model)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it("knows a question about itself when it hears one", () => {
    for (const question of [
      "what models is flyd using?",
      "well why didn't u read the config? and why isn't this in memory?",
      "which model do you use for transcription",
      "what features do you have",
      "what's your configuration",
      "what LLM are you running on",
      "which model are you using",
      "what are you running on",
      "show me your settings",
      "what config do you have?",
      "which providers do you have configured",
      "is your chief of staff running?",
      "what is the chain of command between Flyd and Firstmate?",
    ]) expect(isFlydSetupQuestion(question), question).toBe(true);
    for (const message of [
      "what's the weather in bangkok tonight",
      "how can flyd improve",
      "fix the footer on GNM",
      "remind me at 5 to call the bank",
      "can you check my iPhone settings",
      "what features should the GNM app have, what do you think?",
      "which model of bike should you recommend",
      "what features do you think the GNM app should have",
      "what settings do you recommend for my camera",
      "which model do you think I should buy",
      "which settings do you suggest for the export",
      "can you use the settings from my last project",
      "what model do you have in mind for this",
      "what features do you have planned for gnm",
    ]) {
      expect(isFlydSetupQuestion(message), message).toBe(false);
    }
  });

  it("reports the chief of staff's actual state and role", async () => {
    vi.stubEnv("FLYD_COS", "0");
    expect(await flydSetupReport()).toContain("Chief of Staff: disabled");
    vi.stubEnv("FLYD_COS", "1");
    const report = await flydSetupReport();
    expect(report).toContain("Chief of Staff: enabled");
    expect(report).toContain("Flyd → Chief of Staff → domain bosses");
    expect(report).toContain("personal assistant, CEO, life coach, guru and mentor in one");
  });
});

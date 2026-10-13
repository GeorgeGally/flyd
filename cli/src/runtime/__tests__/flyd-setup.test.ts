import { afterEach, describe, expect, it, vi } from "vitest";
import { flydModelAssignments, flydSetupReport, isFlydSetupQuestion, redactSecrets } from "../flyd-setup.js";

/** The settings George sets for Flyd's models, all at once, as his .env would. */
const CONFIGURED = {
  FLYD_MODEL: "opencode-go/deepseek-v4.1-flash",
  FLYD_CHAT_MODEL: "opencode-go/deepseek-v4.1-flash",
  FLYD_CHAT_FALLBACK_MODELS: "openai:gpt-5.6-luna",
  FLYD_ROUTING_FALLBACK_MODEL: "openai:gpt-5.6-mini",
  FLYD_JEV_MODEL: "jev-1.13.0",
  FLYD_CREW_MODEL: "opencode-go/kimi-k3",
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
  // A model setting whose name holds "KEY": a model id, never a secret.
  COMMANDCODE_API_KEY_MODEL: "deepseek/deepseek-v4.1-flash",
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
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

afterEach(() => vi.unstubAllEnvs());

describe("Flyd's own setup", () => {
  it("names the model doing every job, from the live configuration, with what set it", async () => {
    configure({ ...CONFIGURED, ...SECRETS });
    const report = await flydSetupReport();
    for (const model of new Set(Object.values(CONFIGURED).filter((value) => !value.startsWith("deepseek/")))) expect(report).toContain(model);
    expect(report).toMatch(/Chat: [^\n]*opencode-go\/deepseek-v4\.1-flash \[FLYD_CHAT_MODEL\]; if it fails: openai:gpt-5\.6-luna, then commandcode:deepseek\/deepseek-v4\.1-flash/);
    expect(report).toMatch(/Deciding who answers[^\n]*openai:gpt-5\.6-mini \[FLYD_ROUTING_FALLBACK_MODEL\]/);
    expect(report).toMatch(/Speaking replies aloud: gpt-4o-mini-tts-2025-12-15 \[FLYD_TTS_MODEL\]/);
    expect(report).toMatch(/LIVE voice sessions[^\n]*gpt-realtime-2\.1, transcribing George with gpt-realtime-whisper/);
    expect(report).toMatch(/Web search: Brave Search, then OpenAI web search on gpt-5\.6-luna/);
    expect(report).toMatch(/Summaries of long replies[^\n]*grok-4-fast-non-reasoning/);
    expect(report).toContain("Coding crewmates");
    expect(report).toContain("opencode-go/kimi-k3 [FLYD_CREW_MODEL]");
    expect(report).toMatch(/Provider keys present \(names only\): [^\n]*OPENAI_API_KEY/);
  });

  it("follows a change to the configuration the next time it is asked, never a stale copy", async () => {
    configure({ ...CONFIGURED, FLYD_TTS_MODEL: "gpt-4o-mini-tts" });
    expect(await flydSetupReport()).toContain("Speaking replies aloud: gpt-4o-mini-tts [FLYD_TTS_MODEL]");
    vi.stubEnv("FLYD_TTS_MODEL", "gpt-5-tts");
    vi.stubEnv("FLYD_CHAT_MODEL", "anthropic:claude-sonnet-5-5");
    const changed = await flydSetupReport();
    expect(changed).toContain("Speaking replies aloud: gpt-5-tts [FLYD_TTS_MODEL]");
    expect(changed).toMatch(/Chat: [^\n]*anthropic:claude-sonnet-5-5 \[FLYD_CHAT_MODEL\]/);
    vi.stubEnv("FLYD_TTS_MODEL", "");
    expect(await flydSetupReport()).toContain("Speaking replies aloud: gpt-4o-mini-tts [code default]");
  });

  it("never shows a key, token or secret, only which ones are present", async () => {
    configure({ ...CONFIGURED, ...SECRETS, GITHUB_TOKEN: "ghp_testsecretvalue1234567890abcdef" });
    const report = await flydSetupReport();
    for (const secret of [...Object.values(SECRETS), "ghp_testsecretvalue1234567890abcdef"]) expect(report).not.toContain(secret);
    expect(report).toContain("deepseek/deepseek-v4.1-flash");
    expect(report).toContain("GITHUB_TOKEN");
    expect(redactSecrets("key sk-proj-abcdefghijklmnop1234 and a model gpt-5.6-luna", {})).toBe("key [hidden] and a model gpt-5.6-luna");
  });

  /** What a setting needs before the job reads it. */
  const NEEDS: Record<string, Record<string, string | undefined>> = {
    BEACON_JEV_MODEL: { FLYD_JEV_MODEL: undefined },
    OPENROUTER_MODEL: { OPENROUTER_API_KEY: "or-testsecret-0011223344" },
    FLYD_VIEW_ANTHROPIC_MODEL: { ANTHROPIC_API_KEY: "ant-testsecret-5566778899" },
  };

  it("shows the model each listed setting names, whichever one is set", async () => {
    const settings = [...new Set((await flydModelAssignments()).flatMap((assignment) => assignment.settings))];
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
    ]) {
      expect(isFlydSetupQuestion(message), message).toBe(false);
    }
  });
});

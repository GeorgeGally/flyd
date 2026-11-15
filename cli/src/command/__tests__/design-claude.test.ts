import { describe, expect, it } from "vitest";
import { claudeArgs, claudeBinary, claudeMessage, classifyClaudeFailure, completeWithClaude, DesignModelError, designModel, makeWithClaude, subscriptionEnv, type SpawnClaude } from "../design-claude.js";

// The design team on Claude Opus through George's subscription (the claude CLI), never the metered API key.

/** A fake CLI that prints the given stream-json events, then exits. */
function cli(events: unknown[], seen: { args?: string[]; env?: NodeJS.ProcessEnv; stdin?: string; killed?: boolean } = {}): SpawnClaude {
  return (_binary, args, options) => {
    seen.args = args;
    seen.env = options.env;
    let onLine: (line: string) => void = () => undefined;
    let onExit: (code: number | null, stderr: string) => void = () => undefined;
    return {
      stdin: { end: (text) => {
        seen.stdin = text;
        setTimeout(() => {
          for (const event of events) { onLine(JSON.stringify(event)); if (seen.killed) break; }
          onExit(0, "");
        }, 0);
      } },
      onLine: (handler) => { onLine = handler; },
      onExit: (handler) => { onExit = handler; },
      kill: () => { seen.killed = true; },
    };
  };
}

const INIT = { type: "system", subtype: "init", apiKeySource: "none", model: "claude-opus-5-5" };
const STARTED = { type: "stream_event", event: { type: "message_start" } };

describe("the design team's Claude", () => {
  it("runs on Opus through the subscription: no API key reaches the CLI, and his settings and hooks are not loaded", () => {
    expect(designModel()).toBe("opus");
    const env = subscriptionEnv({ HOME: "/h", ANTHROPIC_API_KEY: "sk", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "u", CLAUDE_API_KEY: "c" }, { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000" });
    expect(env).toEqual({ HOME: "/h", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000" });
    const args = claudeArgs("opus");
    expect(args.slice(0, 3)).toEqual(["-p", "--model", "opus"]);
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(args).not.toContain("--bare");
  });

  it("finds claude where a GUI launch can't, before PATH", () => {
    const found = new Set(["/h/.local/bin/claude", "/usr/bin/claude"]);
    expect(claudeBinary({ HOME: "/h", PATH: "/usr/bin" }, (path) => found.has(path))).toBe("/h/.local/bin/claude");
    expect(claudeBinary({ HOME: "/x", PATH: "/usr/bin" }, (path) => found.has(path))).toBe("/usr/bin/claude");
    expect(claudeBinary({ HOME: "/x", PATH: "" }, () => false)).toBeNull();
    expect(claudeBinary({ FLYD_CLAUDE_BIN: "/own/claude" }, (path) => path === "/own/claude")).toBe("/own/claude");
  });

  it("sends the screenshots first, then the words", () => {
    const message = JSON.parse(claudeMessage("Judge it.", ["data:image/png;base64,AAAA", "not an image"])) as { message: { content: Array<Record<string, unknown>> } };
    expect(message.message.content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      { type: "text", text: "Judge it." },
    ]);
  });

  it("answers with the reply, and says when the model started answering", async () => {
    let started = 0;
    const seen: { stdin?: string } = {};
    const reply = await completeWithClaude("Brief it.", {
      binary: "/bin/claude", env: { ANTHROPIC_API_KEY: "sk" }, onStarted: () => { started++; },
      spawnClaude: cli([INIT, STARTED, STARTED, { type: "result", subtype: "success", is_error: false, result: "{\"brief\":\"x\"}" }], seen),
    });
    expect(reply).toBe("{\"brief\":\"x\"}");
    expect(started).toBe(1);
    expect(seen.stdin).toContain("Brief it.");
  });

  it("reads a plan limit, a lost login and a missing CLI as plain causes no retry will fix", async () => {
    const limit = await completeWithClaude("x", { binary: "/bin/claude", env: {}, spawnClaude: cli([INIT, { type: "result", subtype: "success", is_error: true, result: "You've hit your limit · resets 9pm (Asia/Singapore)" }]) }).catch((error: unknown) => error);
    expect(limit).toBeInstanceOf(DesignModelError);
    expect((limit as DesignModelError).kind).toBe("limit");
    expect((limit as DesignModelError).plain).toBe("your Claude plan has hit its usage limit; it resets 9pm");
    expect((limit as DesignModelError).retryable).toBe(false);

    expect(classifyClaudeFailure("Claude AI usage limit reached|1794700000").plain).toMatch(/^your Claude plan has hit its usage limit; it resets /);
    expect(classifyClaudeFailure("Invalid API key · Please run /login").kind).toBe("auth");
    expect(classifyClaudeFailure("Credit balance is too low").kind).toBe("paid");
    const dropped = classifyClaudeFailure("socket hang up");
    expect(dropped.kind).toBe("failed");
    expect(dropped.retryable).toBe(true);

    const missing = await completeWithClaude("x", { binary: null, env: {} }).catch((error: unknown) => error);
    expect((missing as DesignModelError).kind).toBe("missing");
  });

  it("stops a session that would bill per call instead of the plan", async () => {
    const seen: { killed?: boolean } = {};
    const paid = await completeWithClaude("x", {
      binary: "/bin/claude", env: {},
      spawnClaude: cli([{ ...INIT, apiKeySource: "ANTHROPIC_API_KEY" }, STARTED, { type: "result", subtype: "success", is_error: false, result: "billed" }], seen),
    }).catch((error: unknown) => error);
    expect(seen.killed).toBe(true);
    expect((paid as DesignModelError).kind).toBe("paid");
  });

  it("stops a Console login, which bills per call, and runs on the plan", async () => {
    const seen: { killed?: boolean } = {};
    const paid = await completeWithClaude("x", {
      binary: "/bin/claude", env: {},
      spawnClaude: cli([{ ...INIT, apiKeySource: "/login managed key" }, STARTED, { type: "result", subtype: "success", is_error: false, result: "billed" }], seen),
    }).catch((error: unknown) => error);
    expect(seen.killed).toBe(true);
    expect((paid as DesignModelError).kind).toBe("paid");
  });

  it("stops the build Designer on a session that bills per call, and lets a plan session build", async () => {
    const seen: { killed?: boolean; args?: string[]; env?: NodeJS.ProcessEnv } = {};
    const paid = await makeWithClaude("/site", "Build V2.", {
      binary: "/bin/claude", env: { ANTHROPIC_API_KEY: "sk" },
      spawnClaude: cli([{ ...INIT, apiKeySource: "/login managed key" }, { type: "result", subtype: "success", is_error: false, result: "built" }], seen),
    }).catch((error: unknown) => error);
    expect(seen.killed).toBe(true);
    expect((paid as DesignModelError).kind).toBe("paid");

    const ok: { killed?: boolean; args?: string[]; env?: NodeJS.ProcessEnv } = {};
    const built = await makeWithClaude("/site", "Build V2.", {
      binary: "/bin/claude", env: { ANTHROPIC_API_KEY: "sk" },
      spawnClaude: cli([INIT, { type: "assistant" }, { type: "result", subtype: "success", is_error: false, result: "built the hero" }], ok),
    });
    expect(built).toBe("built the hero");
    expect(ok.killed).toBeUndefined();
    expect(ok.args).toContain("Build V2.");
    expect(ok.env?.ANTHROPIC_API_KEY).toBeUndefined();

    const limit = await makeWithClaude("/site", "Build V2.", {
      binary: "/bin/claude", env: {},
      spawnClaude: cli([INIT, { type: "result", subtype: "success", is_error: true, result: "You've hit your limit · resets 9pm (Asia/Singapore)" }]),
    }).catch((error: unknown) => error);
    expect((limit as DesignModelError).kind).toBe("limit");
  });

  it("never calls the real CLI under tests", async () => {
    await expect(makeWithClaude("/site", "x", { env: { VITEST: "1" } })).rejects.toThrow(/under tests/);
    await expect(completeWithClaude("x", { binary: "/bin/claude", env: { VITEST: "1" } })).rejects.toThrow(/under tests/);
  });
});

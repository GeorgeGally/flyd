import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// The design team runs on Claude Opus through George's Claude subscription: the `claude` CLI, never Flyd's
// metered API key. 88a96085 put the team on Flyd's pay-as-you-go Claude chain and George had it reverted the
// same hour (b5ac2e25): he pays for a subscription and never wants per-call billing unless he says so. So
// every call here drops the API key variables from the child's environment and stops a session that reports
// an API key as its credential. Before this the team ran on Flyd's default chain (DeepSeek through
// OpenCode Go) and half its labs died on that account's credit.

/** The model the whole team (Creative Director, Flyd's review, Designers) works on; FLYD_DESIGN_MODEL overrides. */
export function designModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.FLYD_DESIGN_MODEL?.trim() || "opus";
}

/** Variables that would switch the CLI from George's subscription to metered billing. */
const PAID_API_ENV_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_API_KEY"];

/** The child's environment: George's own, minus anything that bills per call. */
export function subscriptionEnv(env: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { ...env, ...extra };
  for (const name of PAID_API_ENV_VARS) delete child[name];
  return child;
}

/**
 * The `claude` binary. A GUI-launched Core has a minimal PATH, so the usual install places are looked at
 * first, then PATH. FLYD_CLAUDE_BIN overrides. Null when there is none.
 */
export function claudeBinary(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string | null {
  const own = env.FLYD_CLAUDE_BIN?.trim();
  if (own) return exists(own) ? own : null;
  const home = env.HOME?.trim() || homedir();
  const places = [
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    ...(env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "claude")),
  ];
  return places.find((path) => exists(path)) ?? null;
}

export type DesignModelFailure = "missing" | "limit" | "auth" | "paid" | "timeout" | "failed";

/** A model call that failed, with what George should be told in plain words. Only some kinds are worth a retry. */
export class DesignModelError extends Error {
  constructor(readonly kind: DesignModelFailure, readonly plain: string, detail = plain) {
    super(detail);
    this.name = "DesignModelError";
  }

  /** A dropped call or a slow one may go through on a second try; a plan limit or a missing login will not. */
  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "failed";
  }
}

/** When a plan limit lifts, from the CLI's message: "resets 9pm (Asia/Singapore)" or "…|1794700000". */
function resetOf(text: string): string | undefined {
  const said = text.match(/resets?\s+(?:at\s+)?([^·.|\n]+?)(?:\s*\(|[·.|\n]|$)/i)?.[1]?.trim();
  if (said) return said;
  const epoch = Number(text.match(/\|(\d{10})\b/)?.[1]);
  if (!Number.isFinite(epoch) || epoch <= 0) return undefined;
  return new Date(epoch * 1000).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
}

/** A failed Claude call read as one of a few plain causes. Pure. */
export function classifyClaudeFailure(text: string, status?: number | null): DesignModelError {
  const said = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (status === 429 || /usage limit|hit your (?:usage )?limit|limit reached|out of (?:extra )?usage|rate.?limit/i.test(said)) {
    const reset = resetOf(text);
    return new DesignModelError("limit", `your Claude plan has hit its usage limit${reset ? `; it resets ${reset}` : ""}`, said);
  }
  if (status === 401 || status === 403 || /not logged in|please run \/login|log ?in again|invalid (?:api key|token|credentials)|authenticat|oauth/i.test(said)) {
    return new DesignModelError("auth", "Claude Code on this Mac is not logged in to your Claude plan", said);
  }
  if (status === 402 || /credit balance|insufficient (?:balance|funds|credit)|billing/i.test(said)) {
    return new DesignModelError("paid", "Claude asked for paid credit, which the design team never uses", said);
  }
  return new DesignModelError("failed", `Claude stopped with "${said || "no answer"}"`, said);
}

export interface ClaudeCallOptions {
  /** Pictures to look at: data URLs (data:image/png;base64,…). */
  images?: string[];
  /** Room for a long answer, such as a whole page. */
  maxTokens?: number;
  /** Called once, as soon as the model starts answering: the call is really under way. */
  onStarted?: () => void;
  timeoutMs?: number;
  /** For tests: the binary, the environment and the spawn. */
  binary?: string | null;
  env?: NodeJS.ProcessEnv;
  spawnClaude?: SpawnClaude;
}

/** A started CLI: its stdout lines, its stdin, and how it ended. Injectable for tests. */
export type SpawnClaude = (binary: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
  stdin: { end(chunk: string): void };
  onLine(handler: (line: string) => void): void;
  onExit(handler: (code: number | null, stderr: string) => void): void;
  kill(): void;
};

const spawnClaudeProcess: SpawnClaude = (binary, args, options) => {
  const child = spawn(binary, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  let stderr = "";
  const lineHandlers: Array<(line: string) => void> = [];
  const exitHandlers: Array<(code: number | null, stderr: string) => void> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      for (const handler of lineHandlers) handler(line);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4000); });
  child.on("error", (error) => { stderr = `${stderr}${error.message}`; });
  child.on("close", (code) => {
    if (buffer.trim()) for (const handler of lineHandlers) handler(buffer);
    for (const handler of exitHandlers) handler(code, stderr);
  });
  return {
    stdin: { end: (text) => { child.stdin.on("error", () => undefined); child.stdin.end(text); } },
    onLine: (handler) => { lineHandlers.push(handler); },
    onExit: (handler) => { exitHandlers.push(handler); },
    kill: () => { child.kill("SIGKILL"); },
  };
};

/** One user message for the CLI's stream-json input: the pictures first, then the words. */
export function claudeMessage(prompt: string, images: string[] = []): string {
  const pictures = images.flatMap((url) => {
    const found = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(url);
    return found ? [{ type: "image", source: { type: "base64", media_type: found[1], data: found[2] } }] : [];
  });
  return `${JSON.stringify({ type: "user", message: { role: "user", content: [...pictures, { type: "text", text: prompt }] } })}\n`;
}

/** The CLI arguments for one plain answer: no tools, no settings or hooks, no saved session. */
export function claudeArgs(model = designModel()): string[] {
  return [
    "-p", "--model", model,
    // His settings carry hooks and plugins (a terse speaking style, say) that would change how the team writes.
    "--setting-sources", "",
    "--tools", "",
    "--no-session-persistence",
    "--system-prompt", "You work on George's design team. Do exactly what the message asks and answer in the form it asks for.",
    "--input-format", "stream-json",
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
  ];
}

const CALL_TIMEOUT_MS = 20 * 60_000;

/**
 * One answer from Claude on George's subscription. Resolves with the reply text; rejects with a
 * DesignModelError that says in plain words what went wrong.
 */
export function completeWithClaude(prompt: string, options: ClaudeCallOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const binary = options.binary !== undefined ? options.binary : claudeBinary(env);
  if (!binary) return Promise.reject(new DesignModelError("missing", "Claude Code is not installed on this Mac"));
  if (env.VITEST && !options.spawnClaude) return Promise.reject(new Error("refusing to call Claude under tests"));
  const cwd = mkdtempSync(join(tmpdir(), "flyd-design-"));
  const extra: Record<string, string> = options.maxTokens ? { CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(options.maxTokens) } : {};
  const child = (options.spawnClaude ?? spawnClaudeProcess)(binary, claudeArgs(designModel(env)), { cwd, env: subscriptionEnv(env, extra) });
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let started = false;
    let result: { text: string; error?: DesignModelError } | undefined;
    const finish = (outcome: { text: string } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmSync(cwd, { recursive: true, force: true });
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.text);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ error: new DesignModelError("timeout", "Claude took too long to answer and was stopped") });
    }, options.timeoutMs ?? CALL_TIMEOUT_MS);
    timer.unref?.();
    child.onLine((line) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(line) as Record<string, unknown>; } catch { return; }
      if (event.type === "system" && event.subtype === "init") {
        const source = String(event.apiKeySource ?? "none");
        if (/api.?key|helper/i.test(source) && source !== "none") {
          child.kill();
          finish({ error: new DesignModelError("paid", "Claude was set to bill per call instead of your plan, so the call was stopped", `apiKeySource=${source}`) });
        }
        return;
      }
      if (event.type === "stream_event" || event.type === "assistant") {
        if (!started) {
          started = true;
          try { options.onStarted?.(); } catch { /* A watcher's failure never stops the call. */ }
        }
        return;
      }
      if (event.type === "result") {
        const text = typeof event.result === "string" ? event.result : "";
        const failed = event.is_error === true || (typeof event.subtype === "string" && event.subtype !== "success");
        const status = typeof event.api_error_status === "number" ? event.api_error_status : null;
        result = failed ? { text, error: classifyClaudeFailure(text || String(event.subtype ?? ""), status) } : { text };
      }
    });
    child.onExit((code, stderr) => {
      if (result?.error) finish({ error: result.error });
      else if (result) finish({ text: result.text });
      else finish({ error: classifyClaudeFailure(stderr.trim() || `Claude Code exited (${code ?? "killed"}) without an answer`) });
    });
    child.stdin.end(claudeMessage(prompt, options.images));
  });
}

/** The CLI's one JSON reply (--output-format json), or null. */
function parseReply(text: string): { result?: string; is_error?: boolean; api_error_status?: number | null } | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? parsed as { result?: string; is_error?: boolean; api_error_status?: number | null } : null;
  } catch {
    return null;
  }
}

/**
 * A Designer that edits a real project: Claude Code on George's subscription, working in that folder with
 * its own tools, as firstmate's sessions do. Resolves with what it says it did.
 */
export function makeWithClaude(cwd: string, prompt: string, options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const env = options.env ?? process.env;
  if (env.VITEST) return Promise.reject(new Error("refusing to launch a real designer under tests"));
  const binary = claudeBinary(env);
  if (!binary) return Promise.reject(new DesignModelError("missing", "Claude Code is not installed on this Mac"));
  return new Promise((resolve, reject) => {
    // "auto" runs routine commands and still blocks risky ones; nobody is there to approve a prompt.
    const child = spawn(binary, ["-p", "--model", designModel(env), "--permission-mode", "auto", "--output-format", "json", prompt], {
      cwd, env: subscriptionEnv(env), stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { err = (err + chunk.toString("utf8")).slice(-4000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 45 * 60_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const reply = parseReply(out);
      if (reply && !reply.is_error && typeof reply.result === "string") { resolve(reply.result); return; }
      reject(classifyClaudeFailure(reply?.result || err.trim() || `The designer stopped (exit ${code ?? "killed"})`, reply?.api_error_status ?? null));
    });
  });
}

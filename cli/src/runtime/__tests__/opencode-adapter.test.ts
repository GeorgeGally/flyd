import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { describe, expect, it, vi } from "vitest";
import {
  buildOpenCodeArgs,
  buildOpenCodePermissionConfig,
  parseOpenCodeEvent,
  runOpenCode,
  sanitizeWorkerEnvironment,
} from "../opencode-adapter.js";

describe("OpenCode adapter", () => {
  it("builds a structured approved command for a new task", () => {
    expect(buildOpenCodeArgs({ assignment: "Implement continuity", contextPath: "/tmp/context.md", projectRoot: "/work/flyd", taskKey: "task-1" })).toEqual([
      "run", "Implement continuity", "-f", "/tmp/context.md", "--format", "json", "--dir", "/work/flyd", "--title", "flyd:task-1", "--auto",
    ]);
  });

  it("builds a session resume command without replaying the full context", () => {
    expect(buildOpenCodeArgs({ assignment: "Continue from the failing test", projectRoot: "/work/flyd", taskKey: "task-1", externalSessionId: "ses_1" })).toEqual([
      "run", "Continue from the failing test", "--session", "ses_1", "--format", "json", "--dir", "/work/flyd", "--auto",
    ]);
  });

  it("extracts session identity and visible text without retaining reasoning", () => {
    expect(parseOpenCodeEvent(JSON.stringify({ type: "text", sessionID: "ses_1", part: { text: "Done" }, reasoning: "private" }))).toEqual({
      type: "text", sessionId: "ses_1", text: "Done",
    });
  });

  it("passes only non-secret process settings to the worker", () => {
    const env = sanitizeWorkerEnvironment({
      PATH: "/bin", HOME: "/home/me", OPENAI_API_KEY: "remove",
      GITHUB_TOKEN: "remove", RANDOM_SECRET: "remove",
      DATABASE_URL: "remove", FLYD_DATABASE_URL: "remove", PGPASSWORD: "remove",
      OPENCODE_API_KEY: "remove", SSH_AUTH_SOCK: "/tmp/agent.sock",
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/home/me" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.RANDOM_SECRET).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.FLYD_DATABASE_URL).toBeUndefined();
    expect(env.PGPASSWORD).toBeUndefined();
    expect(env.OPENCODE_API_KEY).toBeUndefined();
    expect(env.SSH_AUTH_SOCK).toBeUndefined();
  });

  it("turns the task grant into deny-by-default OpenCode permissions", () => {
    const config = buildOpenCodePermissionConfig({
      fileOperations: ["read", "write"],
      commandClasses: ["inspect", "test", "git_status"],
    });

    expect(config.permission).toMatchObject({
      "*": "deny",
      read: "allow",
      edit: "allow",
      external_directory: "deny",
      task: "deny",
      webfetch: "deny",
    });
    expect(config.permission.bash).toMatchObject({
      "*": "deny",
      "bin/rails test*": "allow",
      "git status*": "allow",
    });
  });

  it("streams text and returns the external session id", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; kill: (signal?: NodeJS.Signals) => boolean };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 42;
    child.kill = vi.fn(() => true);
    const spawn = vi.fn(() => child);
    const onEvent = vi.fn();

    const resultPromise = runOpenCode({ executable: "/bin/opencode", args: ["run"], cwd: "/work/flyd", timeoutMs: 1_000, spawn, onEvent });
    child.stdout.write(`${JSON.stringify({ type: "text", sessionID: "ses_1", part: { text: "Built it" } })}\n`);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);

    await expect(resultPromise).resolves.toMatchObject({ exitStatus: 0, externalSessionId: "ses_1", output: "Built it" });
    expect(onEvent).toHaveBeenCalledWith({ type: "text", sessionId: "ses_1", text: "Built it" });
  });

  it("pauses the worker until its process identity is durably recorded", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; kill: (signal?: NodeJS.Signals) => boolean };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 42;
    child.kill = vi.fn(() => true);
    const calls: string[] = [];
    const onStart = vi.fn(async () => {
      calls.push("journaled");
    });

    const resultPromise = runOpenCode({
      executable: "/bin/opencode", args: ["run"], cwd: "/work/flyd", timeoutMs: 1_000,
      spawn: vi.fn(() => child), onStart,
    });
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith("SIGCONT"));
    calls.push("continued");
    child.emit("close", 0);
    await resultPromise;

    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGSTOP");
    expect(onStart).toHaveBeenCalledWith(42);
    expect(calls).toEqual(["journaled", "continued"]);
  });

  it("returns an explicit timeout failure after terminating the worker", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; kill: (signal?: NodeJS.Signals) => boolean };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 42;
    child.kill = vi.fn((signal?: NodeJS.Signals) => {
      if (signal === "SIGTERM") queueMicrotask(() => child.emit("close", null));
      return true;
    });

    const result = await runOpenCode({
      executable: "/bin/opencode", args: ["run"], cwd: "/work/flyd", timeoutMs: 1,
      spawn: vi.fn(() => child),
    });

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result).toMatchObject({ exitStatus: 1 });
    expect(result.error).toContain("timed out");
  });

  it("forces termination and resolves when a worker ignores SIGTERM", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; kill: (signal?: NodeJS.Signals) => boolean };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 42;
    child.kill = vi.fn(() => true);

    const result = await runOpenCode({
      executable: "/bin/opencode", args: ["run"], cwd: "/work/flyd",
      timeoutMs: 1, killGraceMs: 2, spawn: vi.fn(() => child),
    });

    expect(child.kill).toHaveBeenNthCalledWith(3, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(4, "SIGKILL");
    expect(result.error).toContain("forced termination");
  });
});

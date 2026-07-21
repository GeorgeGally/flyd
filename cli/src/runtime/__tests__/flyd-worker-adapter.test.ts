import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { describe, expect, it, vi } from "vitest";
import { createFlydWorkerAdapter, parseFlydWorkerEvent } from "../flyd-worker-adapter.js";

describe("Flyd native worker adapter", () => {
  const config = {
    apiKey: "provider-secret",
    model: "deepseek-v4-pro",
    baseURL: "https://opencode.ai/zen/v1",
    providerIdentity: "opencode.ai/deepseek-v4-pro",
  };
  const fallbackConfig = {
    apiKey: "fallback-secret",
    model: "openrouter/free",
    baseURL: "https://openrouter.ai/api/v1",
    providerIdentity: "openrouter.ai/openrouter/free",
  };

  it("reports Flyd itself as the coding worker", async () => {
    const adapter = createFlydWorkerAdapter({
      config,
      sessionRoot: "/tmp/flyd-sessions",
      workerScriptPath: "/app/flyd-worker-process.js",
    });

    await expect(adapter.detect()).resolves.toMatchObject({
      name: "flyd",
      executable: process.execPath,
      healthy: true,
      capabilities: [ "analysis", "implementation", "review", "testing", "resume" ],
    });
  });

  it("builds a Flyd worker command that preserves an exact resume session", () => {
    const adapter = createFlydWorkerAdapter({
      config,
      sessionRoot: "/tmp/flyd-sessions",
      workerScriptPath: "/app/flyd-worker-process.js",
    });

    expect(adapter.buildArgs({
      assignment: "Continue from the failing test",
      projectRoot: "/work/flyd",
      taskKey: "task-1",
      contextPath: "/tmp/context.md",
      externalSessionId: "flyd-session-1",
    })).toEqual([
      "/app/flyd-worker-process.js",
      "--assignment-base64", Buffer.from("Continue from the failing test").toString("base64url"),
      "--project-root", "/work/flyd",
      "--task-key", "task-1",
      "--context-path", "/tmp/context.md",
      "--session-root", "/tmp/flyd-sessions",
      "--session", "flyd-session-1",
    ]);
  });

  it("marks review assignments read-only for the native process", () => {
    const adapter = createFlydWorkerAdapter({
      config,
      sessionRoot: "/tmp/flyd-sessions",
      workerScriptPath: "/app/flyd-worker-process.js",
    });

    expect(adapter.buildArgs({
      assignment: "Review the implementation",
      projectRoot: "/work/flyd",
      taskKey: "task-1",
      readOnly: true,
    })).toContain("--read-only");
  });

  it("passes the model credential only to the Flyd worker process", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number;
      kill: (signal?: NodeJS.Signals) => boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 90;
    child.kill = vi.fn(() => true);
    const spawn = vi.fn(() => child);
    const adapter = createFlydWorkerAdapter({
      config,
      fallbackConfigs: [ fallbackConfig ],
      sessionRoot: "/tmp/flyd-sessions",
      workerScriptPath: "/app/flyd-worker-process.js",
      spawn,
    });
    const resultPromise = adapter.run({
      executable: process.execPath,
      args: [ "/app/flyd-worker-process.js" ],
      cwd: "/work/flyd",
      timeoutMs: 1_000,
    });
    await Promise.resolve();
    child.stdout.write('{"type":"agent_message","sessionId":"flyd-1","text":"done"}\n');
    child.emit("close", 0);

    await expect(resultPromise).resolves.toMatchObject({ output: "done", externalSessionId: "flyd-1" });
    const environment = (spawn.mock.calls as unknown as Array<[string, string[], { env: NodeJS.ProcessEnv }]>)
      [0][2].env;
    expect(environment.FLYD_WORKER_API_KEY).toBe("provider-secret");
    expect(JSON.parse(environment.FLYD_WORKER_FALLBACK_PROVIDERS ?? "[]")).toEqual([ fallbackConfig ]);
    expect(environment.OPENCODE_API).toBeUndefined();
    expect(environment.OPENROUTER_API_KEY).toBeUndefined();
  });

  it("parses only structured Flyd events", () => {
    expect(parseFlydWorkerEvent('{"type":"tool.completed","sessionId":"flyd-1","text":"read_file"}')).toEqual({
      type: "tool.completed", sessionId: "flyd-1", text: "read_file",
    });
    expect(parseFlydWorkerEvent("not json")).toBeNull();
  });
});

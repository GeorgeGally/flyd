import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { describe, expect, it, vi } from "vitest";
import {
  runJsonWorkerProcess,
  sanitizeWorkerEnvironment,
  type WorkerAdapter,
} from "../worker-adapter.js";

describe("worker adapter contract", () => {
  it("describes provider health and supported operations without branding the assignment", async () => {
    const adapter: WorkerAdapter = {
      name: "test",
      capabilities: ["analysis", "implementation", "testing", "resume"],
      detect: async () => ({ name: "test", executable: "/bin/test", version: "1.0.0", healthy: true, capabilities: ["analysis"] }),
      buildArgs: () => ["run"],
      parseEvent: () => null,
      run: async () => ({ exitStatus: 0, externalSessionId: null, output: "", error: "" }),
    };

    await expect(adapter.detect()).resolves.toMatchObject({ healthy: true, executable: "/bin/test" });
    expect(adapter.capabilities).toContain("implementation");
  });

  it("passes only non-secret process settings to workers", () => {
    const env = sanitizeWorkerEnvironment({
      PATH: "/bin", HOME: "/home/me", USER: "me",
      OPENAI_API_KEY: "remove", ANTHROPIC_API_KEY: "remove",
      GITHUB_TOKEN: "remove", DATABASE_URL: "remove",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
    });

    expect(env).toEqual({ PATH: "/bin", HOME: "/home/me", USER: "me" });
  });

  it("journals a process before continuing it and parses JSONL events", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      pid: number;
      kill: (signal?: NodeJS.Signals) => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 73;
    child.kill = vi.fn(() => true);
    const onStart = vi.fn(async () => undefined);
    const onEvent = vi.fn();
    const resultPromise = runJsonWorkerProcess({
      executable: "/bin/worker",
      args: ["run"],
      cwd: "/work/flyd",
      timeoutMs: 1_000,
      label: "Test worker",
      spawn: vi.fn(() => child),
      parseEvent: (line) => {
        const event = JSON.parse(line) as { session: string; text: string };
        return { type: "message", sessionId: event.session, text: event.text };
      },
      onStart,
      onEvent,
    });

    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith("SIGCONT"));
    child.stdout.write(`${JSON.stringify({ session: "session-1", text: "Done" })}\n`);
    child.emit("close", 0);

    await expect(resultPromise).resolves.toMatchObject({
      exitStatus: 0,
      externalSessionId: "session-1",
      output: "Done",
    });
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGSTOP");
    expect(onStart).toHaveBeenCalledWith(73);
    expect(onEvent).toHaveBeenCalledWith({ type: "message", sessionId: "session-1", text: "Done" });
  });

  it("terminates and then kills a timed-out worker", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      pid: number;
      kill: (signal?: NodeJS.Signals) => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 73;
    child.kill = vi.fn(() => true);
    const onTimeout = vi.fn(async () => {
      expect(child.kill).not.toHaveBeenCalledWith("SIGTERM");
    });

    const result = await runJsonWorkerProcess({
      executable: "/bin/worker",
      args: ["run"],
      cwd: "/work/flyd",
      timeoutMs: 1,
      killGraceMs: 2,
      label: "Test worker",
      spawn: vi.fn(() => child),
      parseEvent: () => null,
      onTimeout,
    });

    expect(onTimeout).toHaveBeenCalledWith("runtime");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(result.error).toContain("Test worker timed out");
  });

  it("resets inactivity on worker output without extending the absolute runtime", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        pid: number;
        kill: (signal?: NodeJS.Signals) => boolean;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.pid = 74;
      child.kill = vi.fn(() => true);
      const onActivity = vi.fn();
      const onTimeout = vi.fn();
      const resultPromise = runJsonWorkerProcess({
        executable: "/bin/worker",
        args: ["run"],
        cwd: "/work/flyd",
        timeoutMs: 100,
        inactivityTimeoutMs: 20,
        label: "Active worker",
        spawn: vi.fn(() => child),
        parseEvent: () => null,
        onActivity,
        onTimeout,
      });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(15);
      child.stdout.write("still working\n");
      await vi.advanceTimersByTimeAsync(15);
      child.stderr.write("progress");
      await vi.advanceTimersByTimeAsync(15);
      child.emit("close", 0);

      await expect(resultPromise).resolves.toMatchObject({ exitStatus: 0 });
      expect(onActivity).toHaveBeenCalledTimes(2);
      expect(onTimeout).not.toHaveBeenCalled();
      expect(child.kill).not.toHaveBeenCalledWith("SIGTERM");
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates a silent worker at the inactivity threshold", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        pid: number;
        kill: (signal?: NodeJS.Signals) => boolean;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.pid = 75;
      child.kill = vi.fn(() => true);
      const onTimeout = vi.fn();
      const resultPromise = runJsonWorkerProcess({
        executable: "/bin/worker",
        args: ["run"],
        cwd: "/work/flyd",
        timeoutMs: 100,
        inactivityTimeoutMs: 10,
        killGraceMs: 2,
        label: "Silent worker",
        spawn: vi.fn(() => child),
        parseEvent: () => null,
        onTimeout,
      });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(12);
      await vi.advanceTimersByTimeAsync(2);

      await expect(resultPromise).resolves.toMatchObject({
        exitStatus: 1,
        error: expect.stringContaining("inactive"),
      });
      expect(onTimeout).toHaveBeenCalledWith("inactive");
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});

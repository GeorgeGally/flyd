import { describe, expect, it, vi } from "vitest";
import {
  buildCodexArgs,
  detectCodex,
  isTestedCodexVersion,
  parseCodexEvent,
} from "../codex-adapter.js";

describe("Codex adapter", () => {
  it("builds a strict workspace-scoped JSON command", () => {
    expect(buildCodexArgs({
      assignment: "Implement the adapter",
      projectRoot: "/work/flyd",
      taskKey: "task-1",
      contextPath: "/tmp/context.md",
    })).toEqual([
      "exec",
      "--json",
      "--strict-config",
      "--ignore-user-config",
      "--ignore-rules",
      "-c", 'approval_policy="never"',
      "-c", 'sandbox_mode="workspace-write"',
      "-c", "sandbox_workspace_write.network_access=false",
      "-c", 'shell_environment_policy.inherit="core"',
      "-C", "/work/flyd",
      "Implement the adapter\n\nFlyd context: /tmp/context.md\nFlyd task: task-1",
    ]);
  });

  it("resumes the exact Codex thread without replaying full context", () => {
    expect(buildCodexArgs({
      assignment: "Continue from the failing test",
      projectRoot: "/work/flyd",
      taskKey: "task-1",
      externalSessionId: "019f-thread",
    })).toEqual([
      "exec",
      "resume",
      "--json",
      "--strict-config",
      "--ignore-user-config",
      "--ignore-rules",
      "-c", 'approval_policy="never"',
      "-c", 'sandbox_mode="workspace-write"',
      "-c", "sandbox_workspace_write.network_access=false",
      "-c", 'shell_environment_policy.inherit="core"',
      "019f-thread",
      "Continue from the failing test",
    ]);
  });

  it("extracts thread identity and visible agent messages only", () => {
    expect(parseCodexEvent(JSON.stringify({
      type: "thread.started",
      thread_id: "019f-thread",
    }))).toEqual({ type: "thread.started", sessionId: "019f-thread", text: null });

    expect(parseCodexEvent(JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Implemented and verified" },
      private_reasoning: "omit",
    }))).toEqual({ type: "item.completed", sessionId: null, text: "Implemented and verified" });
  });

  it("pins the supported Codex release line", () => {
    expect(isTestedCodexVersion("codex-cli 0.144.2")).toBe(true);
    expect(isTestedCodexVersion("codex-cli 0.145.0")).toBe(false);
    expect(isTestedCodexVersion("unknown")).toBe(false);
  });

  it("skips a broken PATH shim and selects the working app binary", async () => {
    const execFile = vi.fn(async (candidate: string) => {
      if (candidate === "/broken/codex") throw new Error("ENOENT");
      return { stdout: "codex-cli 0.144.2\n", stderr: "" };
    });

    await expect(detectCodex({
      candidates: ["/broken/codex", "/Applications/Codex.app/Contents/Resources/codex"],
      execFile,
    })).resolves.toMatchObject({
      executable: "/Applications/Codex.app/Contents/Resources/codex",
      version: "codex-cli 0.144.2",
    });
  });

  it("fails closed when no candidate is healthy and tested", async () => {
    const execFile = vi.fn(async () => ({ stdout: "codex-cli 0.145.0\n", stderr: "" }));

    await expect(detectCodex({ candidates: ["/bin/codex"], execFile }))
      .rejects.toThrow("No healthy Codex 0.144.x executable");
  });
});

import { mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { runFlydWorkerLoop, type FlydCompletionClient } from "../flyd-worker-loop.js";

describe("Flyd native worker loop", () => {
  it("executes Flyd tools and persists a resumable session", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-session-"));
    const complete = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "tool-1", name: "write_file", arguments: { path: "result.txt", content: "done\n" } }],
      })
      .mockResolvedValueOnce({ content: "Implemented and verified.", toolCalls: [] });
    const execute = vi.fn(async () => "Wrote result.txt");
    const events: Array<Record<string, unknown>> = [];

    const result = await runFlydWorkerLoop({
      assignment: "Implement the requested change",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete } satisfies FlydCompletionClient,
      tools: { definitions: [], execute },
      emit: (event) => events.push(event),
      sessionId: "flyd-session-1",
    });

    expect(result).toEqual({ sessionId: "flyd-session-1", output: "Implemented and verified." });
    expect(execute).toHaveBeenCalledWith("write_file", { path: "result.txt", content: "done\n" });
    expect(events[0]).toMatchObject({ type: "session.started", sessionId: "flyd-session-1" });
    expect(events.at(-1)).toMatchObject({ type: "agent_message", text: "Implemented and verified." });
    const state = JSON.parse(await readFile(join(sessionRoot, "flyd-session-1.json"), "utf8"));
    expect(state.messages).toHaveLength(4);
  });

  it("resumes the exact Flyd session and appends the new assignment", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-resume-"));
    const firstClient: FlydCompletionClient = {
      complete: vi.fn(async () => ({ content: "First result", toolCalls: [] })),
    };
    await runFlydWorkerLoop({
      assignment: "First assignment",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: firstClient,
      tools: { definitions: [], execute: vi.fn() },
      emit: () => undefined,
      sessionId: "flyd-session-resume",
    });
    const complete = vi.fn(async () => ({ content: "Second result", toolCalls: [] }));

    await runFlydWorkerLoop({
      assignment: "Continue with the failing test",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete },
      tools: { definitions: [], execute: vi.fn() },
      emit: () => undefined,
      sessionId: "flyd-session-resume",
      resume: true,
    });

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "First result" }),
        expect.objectContaining({ role: "user", content: expect.stringContaining("Continue with the failing test") }),
      ]),
    }));
  });

  it("rejects an ungrounded final answer until the worker uses an approved tool", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-grounding-"));
    const complete = vi.fn()
      .mockResolvedValueOnce({ content: "I reviewed the repository.", toolCalls: [] })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "tool-1", name: "read_file", arguments: { path: "AGENTS.md" } }],
      })
      .mockResolvedValueOnce({ content: "The repository uses main as its source of truth.", toolCalls: [] });
    const execute = vi.fn(async () => "main is the working branch and source of truth");

    const result = await runFlydWorkerLoop({
      assignment: "Read the repository workflow",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete },
      tools: {
        definitions: [ { type: "function", function: { name: "read_file", description: "Read", parameters: {} } } ],
        execute,
      },
      emit: () => undefined,
      sessionId: "flyd-session-grounded",
    });

    expect(result.output).toBe("The repository uses main as its source of truth.");
    expect(execute).toHaveBeenCalledOnce();
    expect(complete.mock.calls[1][0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("not inspected the repository"),
      }),
    ]));
  });

  it("rejects a resume ID that could escape the session store", async () => {
    await expect(runFlydWorkerLoop({
      assignment: "Continue",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot: "/tmp/flyd-sessions",
      client: { complete: vi.fn() },
      tools: { definitions: [], execute: vi.fn() },
      emit: () => undefined,
      sessionId: "../../outside",
      resume: true,
    })).rejects.toThrow("Invalid Flyd session ID");
  });
});

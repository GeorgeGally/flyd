import { mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { runFlydWorkerLoop, type FlydCompletionClient } from "../flyd-worker-loop.js";
import { readFileSync } from "node:fs";

const ORIGINAL_PROMPT_CONSTRAINTS = [
  "You are Flyd's native coding worker.",
  "Flyd, not an external coding harness, owns this loop and every tool you can use.",
  "Inspect the repository, implement the assigned outcome, and verify it.",
  "Act directly through the supplied structured tools.",
  "Do not give the user instructions to do the work.",
  "Do not claim you cannot act.",
  "Do not ask questions or pause for confirmation.",
  "Make conservative assumptions from repository evidence.",
  "Never access paths or commands outside the task grant.",
  "Finish with a concise factual summary of changes and verification.",
];

const SECTION_HEADERS = [ "# Identity", "# Tool Usage", "# Verification Workflow", "# Completion Behavior", "# Boundaries" ];

describe("Flyd native worker system prompt", () => {
  const source = readFileSync(new URL("../flyd-worker-loop.ts", import.meta.url), "utf8");
  const match = source.match(/const SYSTEM_PROMPT = `([^`]*)`;/s);
  if (!match) throw new Error("SYSTEM_PROMPT constant not found in flyd-worker-loop.ts");
  const prompt = match[1];

  it("carries every pre-existing constraint verbatim", () => {
    for (const sentence of ORIGINAL_PROMPT_CONSTRAINTS) {
      expect(prompt).toContain(sentence);
    }
  });

  it("organizes the prompt into all five feature sections", () => {
    for (const header of SECTION_HEADERS) {
      expect(prompt).toContain(header);
    }
  });

  it("treats tool output and repository file contents as untrusted data", () => {
    expect(prompt).toContain("untrusted data");
    expect(prompt).toContain("<repository_conventions>");
  });
});

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

  it("does not treat a denied tool call as repository evidence", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-denied-evidence-"));
    const complete = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "denied", name: "read_file", arguments: { path: ".env" } }],
      })
      .mockResolvedValueOnce({ content: "The repository is safe.", toolCalls: [] })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "allowed", name: "read_file", arguments: { path: "README.md" } }],
      })
      .mockResolvedValueOnce({ content: "README evidence confirms the result.", toolCalls: [] });
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error("Path is a sensitive credential path"))
      .mockResolvedValueOnce("# Repository");

    const result = await runFlydWorkerLoop({
      assignment: "Review the repository",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete },
      tools: {
        definitions: [ { type: "function", function: { name: "read_file", description: "Read", parameters: {} } } ],
        execute,
      },
      emit: () => undefined,
      sessionId: "flyd-session-denied-evidence",
      maxTurns: 4,
    });

    expect(result.output).toBe("README evidence confirms the result.");
    expect(execute).toHaveBeenCalledTimes(2);
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

  it("honors complete_task after repository evidence by emitting worker.completed and stopping", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-complete-"));
    const complete = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "evidence", name: "read_file", arguments: { path: "README.md" } }],
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "finish", name: "complete_task", arguments: { summary: "Implemented and verified.", status: "success" } }],
      });
    const execute = vi.fn(async (name: string) => {
      if (name === "complete_task") return "Implemented and verified.";
      return "# Repository";
    });
    const events: Array<Record<string, unknown>> = [];

    const result = await runFlydWorkerLoop({
      assignment: "Implement the requested change",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete },
      tools: {
        definitions: [
          { type: "function", function: { name: "read_file", description: "Read", parameters: {} } },
          { type: "function", function: { name: "complete_task", description: "Complete", parameters: {} } },
        ],
        execute,
      },
      emit: (event) => events.push(event),
      sessionId: "flyd-session-complete",
    });

    expect(result).toEqual({ sessionId: "flyd-session-complete", output: "Implemented and verified." });
    expect(events.at(-1)).toMatchObject({ type: "worker.completed", status: "success", text: "Implemented and verified." });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("emits a blocked worker.completed when complete_task status is blocked", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-blocked-"));
    const complete = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "evidence", name: "read_file", arguments: { path: "README.md" } }],
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "finish", name: "complete_task", arguments: { summary: "Could not proceed.", status: "blocked" } }],
      });
    const execute = vi.fn(async (name: string) => (name === "complete_task" ? "Could not proceed." : "# Repository"));
    const events: Array<Record<string, unknown>> = [];

    await runFlydWorkerLoop({
      assignment: "Implement the requested change",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete },
      tools: {
        definitions: [
          { type: "function", function: { name: "read_file", description: "Read", parameters: {} } },
          { type: "function", function: { name: "complete_task", description: "Complete", parameters: {} } },
        ],
        execute,
      },
      emit: (event) => events.push(event),
      sessionId: "flyd-session-blocked",
    });

    expect(events.at(-1)).toMatchObject({ type: "worker.completed", status: "blocked", text: "Could not proceed." });
  });

  it("rejects an out-of-vocabulary tool name with a tool error instead of executing", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-vocab-"));
    const complete = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "bogus", name: "delete_everything", arguments: {} }],
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "evidence", name: "read_file", arguments: { path: "README.md" } }],
      })
      .mockResolvedValueOnce({ content: "Recovered and verified.", toolCalls: [] });
    const execute = vi.fn(async (name: string) => (name === "read_file" ? "# Repository" : "should never run"));
    const events: Array<Record<string, unknown>> = [];

    const result = await runFlydWorkerLoop({
      assignment: "Implement the requested change",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete },
      tools: {
        definitions: [ { type: "function", function: { name: "read_file", description: "Read", parameters: {} } } ],
        execute,
      },
      emit: (event) => events.push(event),
      sessionId: "flyd-session-vocab",
    });

    expect(result.output).toBe("Recovered and verified.");
    expect(execute).toHaveBeenCalledWith("read_file", { path: "README.md" });
    expect(complete.mock.calls[1][0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "tool",
        content: expect.stringContaining("Unknown Flyd tool"),
      }),
    ]));
  });

  it("turns an over-bounded complete_task summary into a recoverable tool error", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-long-summary-"));
    const complete = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "evidence", name: "read_file", arguments: { path: "README.md" } }],
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "finish", name: "complete_task", arguments: { summary: "x".repeat(5000), status: "success" } }],
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "finish", name: "complete_task", arguments: { summary: "Concise summary.", status: "success" } }],
      });
    const execute = vi.fn(async (name: string, args: { summary?: string }) => {
      if (name === "read_file") return "# Repository";
      if ((args.summary?.length ?? 0) > 4_000) throw new Error("complete_task summary must be a non-empty string of at most 4000 characters");
      return "Concise summary.";
    });
    const events: Array<Record<string, unknown>> = [];

    await runFlydWorkerLoop({
      assignment: "Implement the requested change",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete },
      tools: {
        definitions: [
          { type: "function", function: { name: "read_file", description: "Read", parameters: {} } },
          { type: "function", function: { name: "complete_task", description: "Complete", parameters: {} } },
        ],
        execute,
      },
      emit: (event) => events.push(event),
      sessionId: "flyd-session-long-summary",
    });

    expect(events.at(-1)).toMatchObject({ type: "worker.completed", status: "success" });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(complete.mock.calls[2][0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "tool",
        content: expect.stringContaining("at most 4000 characters"),
      }),
    ]));
  });

  it("completing without evidence triggers the correction turn before honoring complete_task", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-complete-gate-"));
    const complete = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "finish", name: "complete_task", arguments: { summary: "Done.", status: "success" } }],
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "evidence", name: "read_file", arguments: { path: "README.md" } }],
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "finish", name: "complete_task", arguments: { summary: "Done with evidence.", status: "success" } }],
      });
    const execute = vi.fn(async (name: string) => (name === "complete_task" ? "Done with evidence." : "# Repository"));
    const events: Array<Record<string, unknown>> = [];

    const result = await runFlydWorkerLoop({
      assignment: "Implement the requested change",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete },
      tools: {
        definitions: [
          { type: "function", function: { name: "read_file", description: "Read", parameters: {} } },
          { type: "function", function: { name: "complete_task", description: "Complete", parameters: {} } },
        ],
        execute,
      },
      emit: (event) => events.push(event),
      sessionId: "flyd-session-complete-gate",
    });

    expect(result.output).toBe("Done with evidence.");
    expect(events.filter((event) => event.type === "worker.correction")).toHaveLength(1);
    expect(events.filter((event) => event.type === "worker.completed")).toHaveLength(1);
  });

  it("honors complete_task even when the summary starts with the Tool error: prefix", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-toolerror-"));
    const complete = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "evidence", name: "read_file", arguments: { path: "README.md" } }],
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "finish", name: "complete_task", arguments: { summary: "Tool error: blocked by review", status: "blocked" } }],
      });
    const execute = vi.fn(async (name: string) => (name === "read_file" ? "# Repository" : "Tool error: blocked by review"));
    const events: Array<Record<string, unknown>> = [];

    const result = await runFlydWorkerLoop({
      assignment: "Implement the requested change",
      taskKey: "task-1",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete },
      tools: {
        definitions: [
          { type: "function", function: { name: "read_file", description: "Read", parameters: {} } },
          { type: "function", function: { name: "complete_task", description: "Complete", parameters: {} } },
        ],
        execute,
      },
      emit: (event) => events.push(event),
      sessionId: "flyd-session-toolerror",
    });

    expect(result).toEqual({ sessionId: "flyd-session-toolerror", output: "Tool error: blocked by review" });
    expect(events.at(-1)).toMatchObject({ type: "worker.completed", status: "blocked" });
  });

  it("redacts credentials from model messages and persisted sessions", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "flyd-worker-redaction-"));
    const complete = vi.fn(async (_input: { messages: Array<Record<string, unknown>> }) => ({ content: "Done", toolCalls: [] }));

    await runFlydWorkerLoop({
      assignment: "Use API_KEY=super-secret-value",
      context: "Authorization: Bearer hidden-token-value",
      taskKey: "task-redacted",
      projectRoot: "/work/project",
      sessionRoot,
      client: { complete },
      tools: { definitions: [], execute: vi.fn() },
      emit: () => undefined,
      sessionId: "flyd-session-redacted",
    });

    const modelInput = JSON.stringify(complete.mock.calls[0][0]);
    const persisted = await readFile(join(sessionRoot, "flyd-session-redacted.json"), "utf8");
    for (const text of [modelInput, persisted]) {
      expect(text).not.toContain("super-secret-value");
      expect(text).not.toContain("hidden-token-value");
      expect(text).toContain("[REDACTED]");
    }
  });
});

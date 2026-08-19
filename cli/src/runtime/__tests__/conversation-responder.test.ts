import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildConversationPrompt,
  immediateConversationReply,
  missingPersonalFactReply,
  respondToConversation,
} from "../conversation-responder.js";

describe("buildConversationPrompt", () => {
  it("handles an explicit chat opener without a generic model round trip", () => {
    expect(immediateConversationReply("let's just chat", [])).toBe(
      "What are you thinking about that does not belong in a task yet?",
    );
    expect(immediateConversationReply("let's just chat", [
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Response" },
    ])).toBeNull();
  });

  it("refuses to invent a horoscope when no personal evidence exists", () => {
    expect(missingPersonalFactReply("What is my current horoscope?", {
      verdict: "insufficient",
      matches: [],
    })).toBe("I do not have your zodiac sign or a current horoscope in Flyd yet, so I will not invent one.");
    expect(missingPersonalFactReply("What is my current horoscope?", {
      verdict: "partial",
      matches: [{
        id: "horoscope",
        path: "personal/horoscope.md",
        excerpt: "Your current horoscope.",
        stale: false,
        kind: "horoscope",
      }],
    })).toBeNull();
    expect(missingPersonalFactReply("What is my zodiac sign?", {
      verdict: "partial",
      matches: [{
        id: "unrelated",
        path: "posttraction/profile.md",
        excerpt: "A generic note that happens to mention zodiac signs.",
        stale: false,
        kind: "archive",
      }],
    })).toBe("I do not have your zodiac sign or a current horoscope in Flyd yet, so I will not invent one.");
    expect(missingPersonalFactReply("What star sign am I?", {
      verdict: "insufficient",
      matches: [],
    })).toBe("I do not have your zodiac sign or a current horoscope in Flyd yet, so I will not invent one.");
    expect(missingPersonalFactReply("Am I a Taurus?", {
      verdict: "insufficient",
      matches: [],
    })).toBe("I do not have your zodiac sign or a current horoscope in Flyd yet, so I will not invent one.");
  });

  it("treats memory as personal evidence rather than a refusal boundary", () => {
    const prompt = buildConversationPrompt({
      message: "What should I work on next?",
      history: [{ role: "user", content: "I am trying to make Flyd useful." }],
      memory: {
        verdict: "partial",
        matches: [{
          id: "memory-1",
          path: "flyd/product.md",
          excerpt: "The first proof is that George chooses Flyd for real work.",
          stale: false,
        }],
      },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: true,
        changedFiles: 4,
        latestCommit: "fix(runtime): settle local reviews and timestamps",
        outcome: "Repair the daily-driver loop",
        status: "ready",
        nextAction: "Fix conversational startup",
      },
    });

    expect(prompt.system).toContain("Your user is George");
    expect(prompt.system).toContain("general knowledge");
    expect(prompt.system).toContain("Never reply with generic availability");
    expect(prompt.system).toContain("Act now");
    expect(prompt.system).toContain("No plan-only finish");
    expect(prompt.system).toContain("vary the query and try again");
    expect(prompt.system).toContain("does not belong in a task yet");
    expect(prompt.prompt).toContain("The first proof is that George chooses Flyd");
    expect(prompt.prompt).toContain("Repair the daily-driver loop");
    expect(prompt.prompt).toContain("fix(runtime): settle local reviews and timestamps");
    expect(prompt.system).toContain("Current repository and task evidence outranks older memory");
    expect(prompt.system).toContain("memory authority labels");
    expect(prompt.prompt).toContain("<personal-memory>");
    expect(prompt.prompt).toContain("What should I work on next?");
  });

  it("does not expose an empty evidence section as the answer", () => {
    const prompt = buildConversationPrompt({
      message: "Let's just chat",
      history: [],
      memory: { verdict: "insufficient", matches: [] },
      situation: null,
    });

    expect(prompt.prompt).toContain("Let's just chat");
    expect(prompt.prompt).not.toContain("No evidence found");
  });

  it("prioritizes user-confirmed memory and excludes rejected assistant output", () => {
    const prompt = buildConversationPrompt({
      message: "Which model should Flyd use?",
      history: [],
      memory: {
        verdict: "sufficient",
        matches: [{
          id: "confirmed-model",
          path: "corrections/model.md",
          excerpt: "George explicitly configured gpt-4.6 for primary Flyd chat.",
          stale: false,
          authority: "user_confirmed",
          outcome: "accepted",
        }, {
          id: "rejected-answer",
          path: "conversations/bad",
          excerpt: "Flyd should use a cheap mini model.",
          stale: false,
          authority: "assistant_output",
          outcome: "rejected",
        }],
      },
      situation: null,
    });

    expect(prompt.prompt).toContain("[user_confirmed]");
    expect(prompt.prompt).toContain("gpt-4.6");
    expect(prompt.prompt).not.toContain("cheap mini model");
    expect(prompt.system).toContain("User-confirmed memory outranks");
  });

  it("does not let archival memory define current repository state", () => {
    const prompt = buildConversationPrompt({
      message: "What is the latest code change?",
      history: [],
      memory: {
        verdict: "partial",
        matches: [{
          id: "old-memory",
          path: "old-capture.md",
          excerpt: "An old exploration of the capture command.",
          stale: false,
        }],
      },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "bcb0399",
        dirty: true,
        changedFiles: 19,
        latestCommit: "fix(runtime): settle local reviews and timestamps",
        outcome: "Review current project status",
        status: "completed",
        nextAction: "Start a concrete outcome",
      },
    });

    expect(prompt.system).toContain("For this temporal question");
    expect(prompt.prompt).toContain("fix(runtime): settle local reviews and timestamps");
    expect(prompt.prompt).not.toContain("old exploration of the capture command");
  });

  it("uses recent conversation memory when asking what George was last working on", () => {
    const prompt = buildConversationPrompt({
      message: "What was I last working on?",
      history: [],
      memory: {
        verdict: "partial",
        matches: [{
          id: "recent-conversation",
          path: "conversations/art-release",
          excerpt: "George was working through how to release his artwork.",
          stale: false,
          kind: "conversation",
        }],
      },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "bcb0399",
        dirty: false,
        changedFiles: 0,
        latestCommit: "fix(runtime): settle local reviews and timestamps",
        outcome: null,
        status: null,
        nextAction: null,
      },
    });

    expect(prompt.prompt).toContain("release his artwork");
    expect(prompt.prompt).toContain("fix(runtime): settle local reviews and timestamps");
  });

  it("keeps personal memory for recency questions that are not about repository work", () => {
    const prompt = buildConversationPrompt({
      message: "What is my current horoscope?",
      history: [],
      memory: {
        verdict: "partial",
        matches: [{
          id: "horoscope",
          path: "personal/horoscope.md",
          excerpt: "Today's horoscope is available here.",
          stale: false,
        }],
      },
      situation: null,
    });

    expect(prompt.prompt).toContain("Today's horoscope");
  });

  it("does not inject Git state into an unrelated personal conversation", () => {
    const prompt = buildConversationPrompt({
      message: "How should I release my artwork?",
      history: [],
      memory: {
        verdict: "partial",
        matches: [{
          id: "art-memory",
          path: "conversations/artwork",
          excerpt: "George wants the artwork release to feel like art.",
          stale: false,
          kind: "conversation",
        }],
      },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: true,
        changedFiles: 32,
        latestCommit: "A code commit",
        outcome: "A coding task",
        status: "ready",
        nextAction: "Run tests",
      },
    });

    expect(prompt.prompt).toContain("artwork release");
    expect(prompt.prompt).toContain("GeorgeGally/flyd");
    expect(prompt.prompt).toContain("32 uncommitted");
  });

  it("runs the exact generic Flyd question through a real bounded tool loop and records the turn", async () => {
    let observedTools: string[] = [];
    let observedIterations = 0;
    let recorded: Record<string, unknown> | null = null;
    const streamed: string[] = [];

    const answer = await respondToConversation({
      sessionId: "generic-regression",
      turnNumber: 1,
      message: "how can flyd improve",
      history: [],
      memory: {
        verdict: "partial",
        matches: [{
          id: "prior-question",
          path: "conversations/prior",
          excerpt: "George: how can flyd improve",
          stale: false,
          authority: "user_observation",
        }],
      },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "fix/trusted-memory-runtime",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: "fix: repair the primary conversation runtime",
        outcome: null,
        status: null,
        nextAction: null,
        projectRoot: process.cwd(),
      },
      onToken: (token) => streamed.push(token),
    }, {
      resolveConnection: () => ({
        model: "gpt-4.6",
        apiKey: "test-key",
        baseURL: "https://models.example.test/v1",
        providerIdentity: "models.example.test/gpt-4.6",
      }),
      runAgentLoop: async (_system, _prompt, tools, onToolCall, _model, iterations) => {
        observedTools = tools.map((tool) => tool.name);
        observedIterations = iterations ?? 0;
        onToolCall("git_log", { count: 1 });
        return "<final>Flyd's primary conversation runtime needs an evidence-first loop.</final>";
      },
      persistReceipt: async (input) => {
        recorded = input as unknown as Record<string, unknown>;
        return input as never;
      },
    });

    expect(observedTools).toEqual(["read_file", "grep", "list_files", "git_log"]);
    expect(observedIterations).toBeGreaterThan(1);
    expect(answer).toContain("evidence-first loop");
    expect(recorded).toMatchObject({
      sessionId: "generic-regression",
      turnNumber: 1,
      model: "gpt-4.6",
      providerIdentity: "models.example.test/gpt-4.6",
      status: "succeeded",
    });
    expect((recorded as unknown as { toolCalls: unknown[] }).toolCalls).toHaveLength(1);
    expect(streamed.join(" ")).not.toContain("Which of these areas resonates");
  });

  it("refuses an uninspected generic answer to a Flyd project question", async () => {
    const emptyDir = join(tmpdir(), `flyd-test-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    let recorded: Record<string, unknown> | null = null;
    try {
    await expect(respondToConversation({
      sessionId: "ungrounded-regression",
      turnNumber: 1,
      message: "how can flyd improve",
      history: [],
      memory: { verdict: "partial", matches: [] },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: "current commit",
        outcome: null,
        status: null,
        nextAction: null,
        projectRoot: emptyDir,
      },
      onToken: () => undefined,
    }, {
      resolveConnection: () => ({
        model: "gpt-4.6",
        apiKey: "test-key",
        providerIdentity: "models.example.test/gpt-4.6",
      }),
      runAgentLoop: async () => "<final>Improve contextual understanding and analytics.</final>",
      persistReceipt: async (input) => {
        recorded = input as unknown as Record<string, unknown>;
        return input as never;
      },
    })).rejects.toThrow("refused an ungrounded project answer");

    expect(recorded).toMatchObject({ status: "failed" });
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("lets the model page through long source files instead of losing later evidence", async () => {
    let laterEvidence = "";
    await respondToConversation({
      message: "inspect the Flyd runtime",
      history: [],
      memory: { verdict: "insufficient", matches: [] },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: "current commit",
        outcome: null,
        status: null,
        nextAction: null,
        projectRoot: process.cwd(),
      },
      onToken: () => undefined,
    }, {
      resolveConnection: () => ({
        model: "gpt-4.6",
        apiKey: "test-key",
        providerIdentity: "models.example.test/gpt-4.6",
      }),
      runAgentLoop: async (_system, _prompt, _tools, onToolCall) => {
        laterEvidence = onToolCall("read_file", {
          path: "src/runtime/conversation-responder.ts",
          offset: 8_000,
          limit: 20_000,
        });
        return "<final>Inspected the complete runtime.</final>";
      },
      persistReceipt: async (input) => input as never,
    });

    expect(laterEvidence).toContain("refused an ungrounded project answer");
  });

  it("answers a named-project needs question from Documents/git, not the to-do list", async () => {
    const streamed: string[] = [];
    let ranLoop = false;
    const answer = await respondToConversation({
      message: "what needs to be done on DIR?",
      history: [],
      memory: { verdict: "insufficient", matches: [] },
      situation: {
        project: "flyd",
        branch: "main",
        head: "abc123",
        dirty: true,
        changedFiles: 2,
        latestCommit: "wip",
        outcome: null,
        status: null,
        nextAction: null,
        projectRoot: "/Users/radarboy3000/Documents/flyd",
      },
      crossRepo: [
        {
          root: "/Users/radarboy3000/Documents/dead-internet-radio",
          name: "dead-internet-radio",
          branch: "main",
          dirty: true,
          lastCommitRelative: "5 weeks ago",
          isForeground: false,
        },
      ],
      presentHypothesis: "  Dead Internet Radio is first today.",
      onToken: (token) => streamed.push(token),
    }, {
      runAgentLoop: async () => {
        ranLoop = true;
        return "<final>should not run</final>";
      },
      persistReceipt: async (input) => input as never,
    });

    expect(ranLoop).toBe(false);
    expect(answer).toMatch(/Dead Internet Radio last moved/i);
    expect(answer).toMatch(/uncommitted work/i);
    expect(answer).not.toMatch(/no concrete next task|only has the project-level to-do/i);
    expect(streamed.join("")).toContain("Dead Internet Radio");
  });

  it("denies file and directory symlinks that escape the current repository", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "flyd-conversation-project-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "flyd-conversation-outside-"));
    writeFileSync(join(outsideRoot, "secret.txt"), "outside secret\n");
    symlinkSync(join(outsideRoot, "secret.txt"), join(projectRoot, "secret-link"));
    symlinkSync(outsideRoot, join(projectRoot, "outside-dir"));
    const observed: string[] = [];
    try {
      await respondToConversation({
        message: "show me these files",
        history: [],
        memory: { verdict: "insufficient", matches: [] },
        situation: {
          project: "test/project", branch: "main", head: "abc123", dirty: false,
          changedFiles: 0, latestCommit: null, outcome: null, status: null, nextAction: null,
          projectRoot: realpathSync(projectRoot),
        },
        onToken: () => undefined,
      }, {
        resolveConnection: () => ({
          model: "gpt-4.6", apiKey: "test-key", providerIdentity: "models.example.test/gpt-4.6",
        }),
        runAgentLoop: async (_system, _prompt, _tools, onToolCall) => {
          observed.push(onToolCall("read_file", { path: "secret-link" }));
          observed.push(onToolCall("list_files", { path: "outside-dir" }));
          return "<final>Inspected safely.</final>";
        },
        persistReceipt: async (input) => input as never,
      });

      expect(observed).toEqual([
        "Access denied: secret-link",
        "Access denied: outside-dir",
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("denies an unregistered repository even when it contains Git metadata", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "flyd-conversation-project-"));
    const unregisteredRoot = mkdtempSync(join(tmpdir(), "flyd-conversation-unregistered-"));
    mkdirSync(join(unregisteredRoot, ".git"));
    writeFileSync(join(unregisteredRoot, "secret.txt"), "not registered\n");
    let observed = "";
    try {
      await respondToConversation({
        message: "show me this file",
        history: [],
        memory: { verdict: "insufficient", matches: [] },
        situation: {
          project: "test/project", branch: "main", head: "abc123", dirty: false,
          changedFiles: 0, latestCommit: null, outcome: null, status: null, nextAction: null,
          projectRoot: realpathSync(projectRoot),
        },
        crossRepo: [],
        onToken: () => undefined,
      }, {
        resolveConnection: () => ({
          model: "gpt-4.6", apiKey: "test-key", providerIdentity: "models.example.test/gpt-4.6",
        }),
        runAgentLoop: async (_system, _prompt, _tools, onToolCall) => {
          observed = onToolCall("read_file", { repo: realpathSync(unregisteredRoot), path: "secret.txt" });
          return "<final>Inspection denied.</final>";
        },
        persistReceipt: async (input) => input as never,
      });

      expect(observed).toBe(`Repository not found: ${realpathSync(unregisteredRoot)}`);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(unregisteredRoot, { recursive: true, force: true });
    }
  });

  it("indexes memory locally instead of entering the agent loop", async () => {
    const runAgentLoop = async () => {
      throw new Error("should not call LLM for index now");
    };
    const answer = await respondToConversation(
      {
        message: "index now",
        history: [],
        memory: { verdict: "insufficient", matches: [] },
        situation: null,
        onToken: () => undefined,
      },
      { persistReceipt: async () => undefined as never, runAgentLoop },
    );
    expect(answer).toMatch(/Memory index updated/);
  });

  it('answers skill inventory via compound-nl without an LLM round trip', async () => {
    const answer = await respondToConversation(
      {
        message: 'what skills do i have',
        history: [],
        memory: { verdict: 'insufficient', matches: [] },
        situation: null,
        onToken: () => undefined,
      },
      {
        persistReceipt: async () => undefined as never,
        runAgentLoop: async () => {
          throw new Error('should not call LLM for compound-nl');
        },
      },
    );
    expect(answer).toMatch(/Domain standards|Identity skills|Pending Skillify/i);
  });

  it('routes a message addressed to a registered specialist to its dispatcher', async () => {
    const { registerSpecialist } = await import("../specialist-registry.js");
    registerSpecialist({
      name: "coach",
      domain: "coaching",
      dispatch: async () => "Coach here, grounded.",
    });

    const answer = await respondToConversation(
      {
        message: "hey coach, what should I focus on?",
        history: [],
        memory: { verdict: "insufficient", matches: [] },
        situation: null,
        onToken: () => undefined,
      },
      {
        persistReceipt: async () => undefined as never,
        runAgentLoop: async () => {
          throw new Error("should not call the general LLM for a specialist turn");
        },
      },
    );

    expect(answer).toBe("Coach here, grounded.");
  });

  it('does not route a non-specialist message and falls through to the general path', async () => {
    const answer = await respondToConversation(
      {
        message: "what is the weather today?",
        history: [],
        memory: { verdict: "insufficient", matches: [] },
        situation: null,
        onToken: () => undefined,
      },
      {
        persistReceipt: async () => undefined as never,
        runAgentLoop: async () => "<final>general answer</final>",
      },
    );

    expect(answer).toBe("general answer");
  });
});

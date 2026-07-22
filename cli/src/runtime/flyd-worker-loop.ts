import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";
import type { FlydToolDefinition } from "./flyd-worker-tools.js";
import { redactSensitiveText } from "./context-redactor.js";

interface FlydToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface FlydCompletion {
  content: string | null;
  toolCalls: FlydToolCall[];
}

export interface FlydCompletionClient {
  complete(input: { messages: Array<Record<string, unknown>>; tools: FlydToolDefinition[] }): Promise<FlydCompletion>;
}

interface FlydWorkerState {
  sessionId: string;
  taskKey: string;
  projectRoot: string;
  messages: Array<Record<string, unknown>>;
}

const SYSTEM_PROMPT = `You are Flyd's native coding worker. Flyd, not an external coding harness, owns this loop and every tool you can use.

Inspect the repository, implement the assigned outcome, and verify it. Act directly through the supplied structured tools. Do not give the user instructions to do the work. Do not claim you cannot act. Do not ask questions or pause for confirmation. Make conservative assumptions from repository evidence. Never access paths or commands outside the task grant. Finish with a concise factual summary of changes and verification.`;
const EVIDENCE_TOOLS = new Set([ "list_files", "read_file", "search", "run_command" ]);

async function persistState(sessionRoot: string, state: FlydWorkerState): Promise<void> {
  await mkdir(sessionRoot, { recursive: true, mode: 0o700 });
  const path = join(sessionRoot, `${state.sessionId}.json`);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

async function loadState(sessionRoot: string, sessionId: string): Promise<FlydWorkerState> {
  return JSON.parse(await readFile(join(sessionRoot, `${sessionId}.json`), "utf8")) as FlydWorkerState;
}

export async function runFlydWorkerLoop(input: {
  assignment: string;
  taskKey: string;
  projectRoot: string;
  sessionRoot: string;
  context?: string;
  sessionId?: string;
  resume?: boolean;
  maxTurns?: number;
  client: FlydCompletionClient;
  tools: {
    definitions: FlydToolDefinition[];
    execute(name: string, args: Record<string, unknown>): Promise<string>;
  };
  emit(event: { type: string; sessionId: string; text: string | null }): void;
}): Promise<{ sessionId: string; output: string }> {
  const sessionId = input.sessionId ?? `flyd-${randomUUID()}`;
  if (!/^flyd-[A-Za-z0-9-]{1,128}$/.test(sessionId)) throw new Error("Invalid Flyd session ID");
  const state = input.resume
    ? await loadState(input.sessionRoot, sessionId)
    : { sessionId, taskKey: input.taskKey, projectRoot: input.projectRoot, messages: [] };
  if (state.taskKey !== input.taskKey) throw new Error("Flyd session belongs to a different task");
  if (state.projectRoot !== input.projectRoot) throw new Error("Flyd session belongs to a different assignment repository");
  const assignment = redactSensitiveText(input.assignment.trim());
  const context = input.context?.trim() ? `\n\nFlyd context:\n${redactSensitiveText(input.context.trim())}` : "";
  state.messages.push({ role: "user", content: `${assignment}${context}` });
  await persistState(input.sessionRoot, state);
  input.emit({ type: "session.started", sessionId, text: null });
  let usedRepositoryEvidence = false;

  for (let turn = 0; turn < (input.maxTurns ?? 32); turn += 1) {
    const completion = await input.client.complete({
      messages: [ { role: "system", content: SYSTEM_PROMPT }, ...state.messages ],
      tools: input.tools.definitions,
    });
    const assistant: Record<string, unknown> = { role: "assistant", content: completion.content };
    if (completion.toolCalls.length > 0) {
      assistant.tool_calls = completion.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }));
    }
    state.messages.push(assistant);
    await persistState(input.sessionRoot, state);

    if (completion.toolCalls.length === 0) {
      const output = completion.content?.trim();
      if (!output) throw new Error("Flyd worker returned no result");
      if (!usedRepositoryEvidence && input.tools.definitions.length > 0) {
        state.messages.push({
          role: "user",
          content: "You have not inspected the repository or used an approved tool. Do not describe what you would do — use the supplied tools to examine the codebase, gather evidence, verify, and only then provide a final answer.",
        });
        await persistState(input.sessionRoot, state);
        input.emit({ type: "worker.correction", sessionId, text: "More repository evidence required" });
        continue;
      }
      input.emit({ type: "agent_message", sessionId, text: output });
      return { sessionId, output };
    }

    for (const call of completion.toolCalls) {
      input.emit({ type: "tool.started", sessionId, text: call.name });
      let result: string;
      try {
        result = await input.tools.execute(call.name, call.arguments);
        if (EVIDENCE_TOOLS.has(call.name)) usedRepositoryEvidence = true;
      } catch (error) {
        result = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
      }
      state.messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: result });
      await persistState(input.sessionRoot, state);
      input.emit({ type: "tool.completed", sessionId, text: call.name });
    }
  }

  throw new Error("Flyd worker exceeded its tool-turn limit");
}

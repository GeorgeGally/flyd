import { interpretAgentInput } from "./input-interpreter.js";
import type { MemoryEvidence } from "./types.js";

export interface AgentSituation {
  project: string;
  branch: string;
  head: string;
  dirty: boolean;
  changedFiles: number;
  latestCommit: string | null;
  outcome: string | null;
  status: string | null;
  nextAction: string | null;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface AgentTerminal {
  write(message: string): void;
  ask(prompt: string): Promise<string>;
  close(): Promise<void>;
}

interface AgentSessionDependencies {
  terminal: AgentTerminal;
  retrieveMemory(message: string): Promise<MemoryEvidence>;
  recordTurn(turn: { user: string; assistant: string }): Promise<void>;
  loadSituation(): Promise<AgentSituation | null>;
  respond(input: {
    message: string;
    history: ConversationTurn[];
    memory: MemoryEvidence;
    situation: AgentSituation | null;
    onToken(token: string): void;
  }): Promise<string>;
}

export type AgentSessionResult =
  | { kind: "exit" }
  | { kind: "coding"; outcome: string }
  | { kind: "resume" };

const MAX_HISTORY_TURNS = 12;

function situationLine(situation: AgentSituation): string {
  const unfinished = [ "awaiting_grant", "ready", "running", "blocked" ].includes(situation.status ?? "");
  if (!situation.outcome || !unfinished) return "";
  const repository = `${situation.project} · ${situation.branch}`;
  const next = situation.nextAction ? ` Next: ${situation.nextAction}` : "";
  return `Unfinished coding work: ${situation.outcome}. ${repository}.${next}\n`;
}

export async function runAgentSession(deps: AgentSessionDependencies): Promise<AgentSessionResult> {
  const history: ConversationTurn[] = [];
  let situation: AgentSituation | null = null;

  try {
    deps.terminal.write("\nflyd\nTalk naturally. Use /resume for unfinished coding work or /exit to leave.\n");
    try {
      situation = await deps.loadSituation();
      const line = situation ? situationLine(situation) : "";
      if (line) deps.terminal.write(line);
    } catch {
      // Conversation remains available when operational task state is unavailable.
    }

    while (true) {
      const text = (await deps.terminal.ask("\nYou >")).trim();
      if (!text) continue;

      const input = interpretAgentInput(text);
      if (input.kind === "exit") return { kind: "exit" };
      if (input.kind === "resume") return { kind: "resume" };
      if (input.kind === "coding") return input;

      deps.terminal.write("\nFlyd > ");
      try {
        try {
          situation = await deps.loadSituation();
        } catch {
          // Keep the last known situation when live state cannot be refreshed.
        }
        const memory = await deps.retrieveMemory(input.message);
        let streamed = false;
        const answer = await deps.respond({
          message: input.message,
          history: history.slice(-MAX_HISTORY_TURNS),
          memory,
          situation,
          onToken: (token) => {
            streamed = true;
            deps.terminal.write(token);
          },
        });
        if (!streamed && answer) deps.terminal.write(answer);
        deps.terminal.write("\n");
        history.push(
          { role: "user", content: input.message },
          { role: "assistant", content: answer },
        );
        try {
          await deps.recordTurn({
            user: input.message,
            assistant: answer,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          deps.terminal.write(`Flyd could not save this turn: ${message}\n`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.terminal.write(`I could not answer that turn: ${message}\n`);
      }
    }
  } finally {
    await deps.terminal.close();
  }
}

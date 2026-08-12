import { interpretAgentInput } from "./input-interpreter.js";
import type { ActionableOutcome } from "./conversation-memory.js";
import type { MemoryEvidence } from "./types.js";
import type { BriefRepo } from "./repo-registry.js";

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
  projectRoot?: string;
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
  sessionId?: string;
  now?: () => Date;
  terminal: AgentTerminal;
  retrieveMemory(message: string): Promise<MemoryEvidence>;
  recoverActionRequest(): Promise<ActionableOutcome | null>;
  repairLastTurn?(feedback: string): Promise<{ id: string; failureClasses: string[] }>;
  recordTurn(turn: { user: string; assistant: string; handoff?: ActionableOutcome }): Promise<void>;
  loadSituation(): Promise<AgentSituation | null>;
  /** Optional: known repos for tool inspection — not shown as a catalog dump. */
  loadCrossRepo?(foregroundPath?: string): Promise<BriefRepo[]>;
  /** Shared Present Model hypothesis line for intro. */
  loadPresentHypothesis?(foregroundPath?: string): Promise<string | null>;
  /** Apply soft-durable hypothesis corrections from chat. */
  applyPresentCorrection?(text: string, foregroundPath?: string): Promise<void>;
  respond(input: {
    sessionId?: string;
    turnNumber: number;
    message: string;
    history: ConversationTurn[];
    memory: MemoryEvidence;
    situation: AgentSituation | null;
    crossRepo: BriefRepo[];
    presentHypothesis?: string | null;
    weather?: string;
    onToken(token: string): void;
  }): Promise<string>;
}

export type AgentSessionResult =
  | { kind: "exit" }
  | { kind: "coding"; outcome: string }
  | { kind: "resume" };

const MAX_HISTORY_TURNS = 12;

const ART = [
  "\u001b[32m███████╗██╗  ██╗   ██╗██████╗ ",
  "██╔════╝██║  ╚██╗ ██╔╝██╔══██╗",
  "█████╗  ██║   ╚████╔╝ ██║  ██║",
  "██╔══╝  ██║    ╚██╔╝  ██║  ██║",
  "██║     ███████╗██║   ██████╔╝",
  "╚═╝     ╚══════╝╚═╝   ╚═════╝ \u001b[0m",
].join("\n");

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning, George.";
  if (hour < 18) return "Good afternoon, George.";
  return "Good evening, George.";
}

// ponytail: quick weather fetch, skip if >1s
async function weatherLine(): Promise<string> {
  try {
    const res = await fetch("https://wttr.in?format=3", {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return "";
    const text = (await res.text()).trim();
    if (!text) return "";
    return `  ${text}`;
  } catch {
    return "";
  }
}

function introLine(
  situation: AgentSituation | null,
  weather?: string,
  presentHypothesis?: string | null,
): string {
  let line = `\n${ART}\n  ${greeting()}`;
  if (weather) line += `\n${weather}`;
  if (presentHypothesis) line += `\n${presentHypothesis}`;
  if (hasUnfinishedTask(situation) && situation) {
    const action = situation.nextAction
      ? `${situation.outcome} — ${situation.nextAction}`
      : situation.outcome!;
    line += `\n  You have unfinished work: ${action}.`;
  }
  return line + "\n\n";
}

function hasUnfinishedTask(situation: AgentSituation | null): boolean {
  return Boolean(
    situation?.outcome &&
    [ "awaiting_grant", "ready", "running", "blocked" ].includes(situation.status ?? ""),
  );
}

export async function runAgentSession(deps: AgentSessionDependencies): Promise<AgentSessionResult> {
  const history: ConversationTurn[] = [];
  let situation: AgentSituation | null = null;
  let repos: BriefRepo[] = [];
  let presentHypothesis: string | null = null;
  let weatherText = "";

  try {
    const [situationResult, weather] = await Promise.all([
      deps.loadSituation().catch(() => null),
      weatherLine(),
    ]);
    situation = situationResult;
    weatherText = weather || "";
    repos = (await deps.loadCrossRepo?.(situationResult?.projectRoot).catch(() => [])) ?? [];
    presentHypothesis =
      (await deps.loadPresentHypothesis?.(situationResult?.projectRoot).catch(() => null)) ?? null;
    deps.terminal.write(introLine(situation, weatherText || undefined, presentHypothesis));

    while (true) {
      const text = (await deps.terminal.ask("\nYou >")).trim();
      if (!text) continue;

      const repairMatch = text.match(/^\/flyd-fix(?:\s+([\s\S]+))?$/i);
      if (repairMatch) {
        if (!deps.repairLastTurn) {
          deps.terminal.write("Flyd repair is not available in this session.\n");
          continue;
        }
        try {
          const repair = await deps.repairLastTurn(repairMatch[1]?.trim() ?? "");
          deps.terminal.write(
            `Recorded Flyd repair ${repair.id}: ${repair.failureClasses.join(", ")}.\n`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          deps.terminal.write(`Flyd could not repair that turn: ${message}\n`);
        }
        continue;
      }

      let input = interpretAgentInput(text);
      if (input.kind === "exit") return { kind: "exit" };
      if (input.kind === "resume") return { kind: "resume" };
      if (input.kind === "conversation") {
        const codeTerms = /\b(?:codebase|repo|repository|architecture|code|source|project|app|application|branch|commit|test|migration|deploy|refactor|implement|debug|bug|fix|feature|merge|PR|pull request|worker|backend|frontend|runtime)\b/i;
        const explorerVerbs = /\b(?:what|how|where|show|tell|explain|describe|look|see|check|explore|examine|inspect|review|audit|survey|assess|evaluate|analyze|study|walk|dive|familiarize|overview|status|state|progress|going on)\b/i;
        if (codeTerms.test(text) && explorerVerbs.test(text)) {
          input = { kind: "coding", outcome: text };
        }
      }
      if (input.kind === "coding") {
        const handoff: ActionableOutcome = {
          outcome: input.outcome,
          sourceSessionId: deps.sessionId ?? "current-session",
          sourceTurn: history.length / 2,
          recordedAt: (deps.now?.() ?? new Date()).toISOString(),
        };
        try {
          await deps.recordTurn({
            user: text,
            assistant: "Handed to the supervised coding runtime.",
            handoff,
          });
          return input;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          deps.terminal.write(`Flyd could not preserve that handoff: ${message}\n`);
          continue;
        }
      }
      if (input.kind === "contextual_action") {
        const handoff = await deps.recoverActionRequest();
        if (handoff) {
          try {
            await deps.recordTurn({
              user: input.message,
              assistant: "Handed to the supervised coding runtime.",
              handoff,
            });
            return { kind: "coding", outcome: handoff.outcome };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.terminal.write(`Flyd could not preserve that handoff: ${message}\n`);
          }
        }
        input = { kind: "conversation", message: input.message };
      }
      if (input.kind === "continue" && history.length === 0) {
        try {
          situation = await deps.loadSituation();
        } catch {
          // Continue from persisted conversation when live task state is unavailable.
        }
        if (hasUnfinishedTask(situation)) return { kind: "resume" };
        const outcome = await deps.recoverActionRequest();
        if (outcome) return { kind: "coding", outcome: outcome.outcome };
      }

      deps.terminal.write("\nFlyd > ");
      try {
        try {
          situation = await deps.loadSituation();
        } catch {
          // Keep the last known situation when live state cannot be refreshed.
        }
        if (deps.applyPresentCorrection) {
          await deps.applyPresentCorrection(input.message, situation?.projectRoot).catch(() => {});
          presentHypothesis =
            (await deps.loadPresentHypothesis?.(situation?.projectRoot).catch(() => null)) ??
            presentHypothesis;
        }
        const memory = await deps.retrieveMemory(input.message);
        if (deps.loadCrossRepo) {
          repos = (await deps.loadCrossRepo(situation?.projectRoot).catch(() => repos)) ?? repos;
        }

        // ponytail: spinner while waiting for first token
        const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        let spinnerIdx = 0;
        let spinnerActive = true;
        let spinnerStarted = false;
        let spinInterval: ReturnType<typeof setInterval> | undefined;
        const stopSpinner = () => {
          if (!spinnerActive) return;
          spinnerActive = false;
          if (spinInterval) clearInterval(spinInterval);
          if (spinnerStarted) deps.terminal.write("\b \b");
          deps.terminal.write("\u001b[?25h");
        };
        deps.terminal.write("\u001b[?25l");
        spinInterval = setInterval(() => {
          if (!spinnerActive) return;
          deps.terminal.write(spinnerStarted ? `\b${spinner[spinnerIdx]}` : spinner[spinnerIdx]);
          spinnerStarted = true;
          spinnerIdx = (spinnerIdx + 1) % spinner.length;
        }, 100);

        let streamed = false;
        let answer = "";
        try {
          answer = await deps.respond({
            sessionId: deps.sessionId,
            turnNumber: history.length / 2 + 1,
            message: input.message,
            history: history.slice(-MAX_HISTORY_TURNS),
            memory,
            situation,
            crossRepo: repos,
            presentHypothesis,
            weather: weatherText || undefined,
            onToken: (token) => {
              if (!streamed) {
                stopSpinner();
              }
              streamed = true;
              deps.terminal.write(token);
            },
          });
        } finally {
          stopSpinner();
        }
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

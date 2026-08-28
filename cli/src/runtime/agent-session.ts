import { interpretAgentInput } from "./input-interpreter.js";
import { formatChatReply, wrapDisplayText } from "./terminal.js";
import type { ActionableOutcome } from "./conversation-memory.js";
import type { MemoryEvidence } from "./types.js";
import type { BriefRepo } from "./repo-registry.js";
import {
  openChatSession,
  replyText,
} from "./cli-chat-kernel.js";
import { stdout } from "process";

const DIM = "\u001b[2m";
const GREEN = "\u001b[32m";
const WHITE = "\u001b[97m";
const RESET = "\u001b[0m";

function useColor(): boolean {
  return Boolean(stdout.isTTY) && !process.env.NO_COLOR;
}

function promptLabel(label: string): string {
  return useColor() ? `${DIM}${label}${RESET}` : label;
}

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
const CROSS_REPO_TTL_MS = 5 * 60 * 1000;

const ART = [
  `${GREEN}███████╗██╗  ██╗   ██╗██████╗ ${RESET}`,
  `${GREEN}██╔════╝██║  ╚██╗ ██╔╝██╔══██╗${RESET}`,
  `${GREEN}█████╗  ██║   ╚████╔╝ ██║  ██║${RESET}`,
  `${WHITE}██╔══╝  ██║    ╚██╔╝  ██║  ██║${RESET}`,
  `${WHITE}██║     ███████╗██║   ██████╔╝${RESET}`,
  `${WHITE}╚═╝     ╚══════╝╚═╝   ╚═════╝ ${RESET}`,
].join("\n");

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning, George.";
  if (hour < 18) return "Good afternoon, George.";
  return "Good evening, George.";
}

// A PA opening is value, not noise. Lead with the single most useful signal
// available — a clear next action, then unfinished work, then a blocker. Only
// fall back to a bare human greeting when there is nothing actionable to say.
// No weather, no raw project-telemetry dump.
function valueOpening(situation: AgentSituation | null): string {
  if (situation?.nextAction) {
    const next = situation.nextAction.trim();
    if (!QUESTION_OUTCOME.test(next)) return `Next: ${next}.`;
  }
  if (situation?.outcome && ["awaiting_grant", "ready", "running", "blocked"].includes(situation.status ?? "")) {
    const outcome = situation.outcome.trim();
    if (outcome && !QUESTION_OUTCOME.test(outcome)) return `Carrying on from: ${outcome}.`;
  }
  if (situation?.status === "blocked") return "You have a blocked task — say 'resume' and I'll pick it up.";
  return "";
}

const QUESTION_OUTCOME = /^(?:so\s+)?(?:how|why|what|when|where|who)\b|[?？]\s*$/i;

function introLine(
  situation: AgentSituation | null,
  _presentHypothesis?: string | null,
): string {
  let line = `\n${ART}\n\n  ${greeting()}`;
  const value = valueOpening(situation);
  if (value) line += `\n  ${value}`;
  return wrapDisplayText(line + "\n\n");
}

function hasUnfinishedTask(situation: AgentSituation | null): boolean {
  if (!situation?.outcome) return false;
  if (![ "awaiting_grant", "ready", "running", "blocked" ].includes(situation.status ?? "")) {
    return false;
  }
  return !QUESTION_OUTCOME.test(situation.outcome.trim());
}

export async function runAgentSession(deps: AgentSessionDependencies): Promise<AgentSessionResult> {
  // Conversation turns flow through the session kernel (durable trail when
  // Postgres answers, in-memory otherwise). Control-flow commands — /flyd-fix,
  // /brief, coding handoffs, resume — are not chat and bypass the kernel.
  let chat: Awaited<ReturnType<typeof openChatSession>> | null = null;
  const ensureChat = async () => {
    if (!chat) {
      chat = await openChatSession({
        handleTurn: async (ctx) => {
          const answer = await runConversationTurn(ctx.message);
          ctx.emit({ type: "message", text: answer });
          return { status: "completed", result: {} };
        },
      });
    }
    return chat;
  };

  const history: ConversationTurn[] = [];
  let situation: AgentSituation | null = null;
  let repos: BriefRepo[] = [];
  let presentHypothesis: string | null = null;
  let lastContextRefresh = 0;

  /**
   * One conversation turn, kernel-handler style: refresh state, retrieve
   * memory, call the model with streaming, and return the full reply.
   */
  async function runConversationTurn(message: string): Promise<string> {
    try {
      situation = await deps.loadSituation();
    } catch {
      // Keep the last known situation when live state cannot be refreshed.
    }
    if (deps.applyPresentCorrection) {
      const { isConfirmedTodoUtterance } = await import("../work/work-hypothesis/confirmed-todos.js");
      // Confirmed to-do utterances are not Present Model corrections.
      if (!isConfirmedTodoUtterance(message)) {
        await deps.applyPresentCorrection(message, situation?.projectRoot).catch(() => {});
        presentHypothesis =
          (await deps.loadPresentHypothesis?.(situation?.projectRoot).catch(() => null)) ??
          presentHypothesis;
      }
    }
    const memory = await deps.retrieveMemory(message);
    if (deps.loadCrossRepo && Date.now() - lastContextRefresh > CROSS_REPO_TTL_MS) {
      repos = (await deps.loadCrossRepo(situation?.projectRoot).catch(() => repos)) ?? repos;
      lastContextRefresh = Date.now();
    }
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
    try {
      const answer = await deps.respond({
        sessionId: deps.sessionId,
        turnNumber: history.length / 2 + 1,
        message,
        history: history.slice(-MAX_HISTORY_TURNS),
        memory,
        situation,
        crossRepo: repos,
        presentHypothesis,
        onToken: (token) => {
          if (!streamed) stopSpinner();
          streamed = true;
          deps.terminal.write(token);
        },
      });
      if (!streamed && answer) deps.terminal.write(formatChatReply(answer));
      return answer;
    } finally {
      stopSpinner();
    }
  }

  try {
    situation = await deps.loadSituation().catch(() => null);
    repos = (await deps.loadCrossRepo?.(situation?.projectRoot).catch(() => [])) ?? [];
    presentHypothesis =
      (await deps.loadPresentHypothesis?.(situation?.projectRoot).catch(() => null)) ?? null;
    lastContextRefresh = Date.now();
    deps.terminal.write(introLine(situation, presentHypothesis));

    while (true) {
      let text: string;
      try {
        text = (await deps.terminal.ask(`\n${promptLabel("You >")}`)).trim();
      } catch (error) {
        // Ctrl+C during the prompt (TTY raw reader) — leave cleanly.
        if (error instanceof Error && error.message === "Interrupted") {
          return { kind: "exit" };
        }
        throw error;
      }
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

      if (/^\/brief\b/i.test(text.trim())) {
        const { readLatestBrief, composeDailyBrief } = await import("./daily-brief.js");
        const { getKey } = await import("../lib/config.js");
        // Prefer a fresh cron-produced brief (from the background scheduler);
        // fall back to a live compose so /brief never blocks on network.
        const latest = readLatestBrief();
        let body: string;
        if (latest) {
          body = latest.body;
        } else {
          const script = getKey("LAST30DAYS_SCRIPT");
          const topics = getKey("LAST30DAYS_TOPICS")
            ?.split(",").map((t) => t.trim()).filter(Boolean);
          const brief = await composeDailyBrief({ situation, last30daysScript: script, last30daysTopics: topics });
          body = [
            brief.heading,
            ...brief.state,
            ...(brief.external.length ? ["\nCurrent signal:"] : []),
            ...brief.external,
          ].join("\n");
        }
        deps.terminal.write(wrapDisplayText(`\n  ${body}\n\n`));
        continue;
      }

      let input = interpretAgentInput(text);
      if (input.kind === "exit") return { kind: "exit" };
      if (input.kind === "resume") return { kind: "resume" };
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

      deps.terminal.write(`\n${promptLabel("Flyd >")}\n`);
      try {
        // The turn runs through the session kernel; the handler does memory,
        // situation and model streaming. The local history array stays in
        // lockstep — every push corresponds to a completed submit.
        const session = await ensureChat();
        const outputs = await session.kernel.submit(session.sessionKey, {
          type: "user_message",
          text: input.message,
        });
        const answer = replyText(outputs);
        if (!answer) {
          const failed = outputs.find((o) => o.type === "failed");
          throw new Error(failed && failed.type === "failed" ? failed.error : "Turn produced no reply");
        }
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

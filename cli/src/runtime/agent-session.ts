import { interpretAgentInput } from "./input-interpreter.js";
import { formatChatReply, wrapDisplayText } from "./terminal.js";
import type { ActionableOutcome } from "./conversation-memory.js";
import type { MemoryEvidence } from "./types.js";
import type { BriefRepo } from "./repo-registry.js";
import {
  openChatSession,
  replyText,
} from "./cli-chat-kernel.js";
import { isCurrentWorkQuestion } from "./conversation-responder.js";
import { stdout } from "process";

const GREEN = "\u001b[32m";
const CYAN = "\u001b[36m";
const WHITE = "\u001b[97m";
const RESET = "\u001b[0m";

function useColor(): boolean {
  return Boolean(stdout.isTTY) && !process.env.NO_COLOR;
}

function paint(text: string, color: string): string {
  return useColor() ? `${color}${text}${RESET}` : text;
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
  ask(prompt: string, echoColor?: string): Promise<string>;
  confirm(prompt: string): Promise<boolean>;
  close(): Promise<void>;
  /** Live assistant streaming; TUI hosts buffer it instead of writing raw. */
  stream?(token: string): void;
  /** Thinking indicator; TUI hosts render it in a status line. */
  setBusy?(busy: boolean): void;
  /** Messages queued behind the running turn. */
  setPending?(messages: string[]): void;
  /** Full-screen pinned-input mode. */
  tui?: boolean;
}

interface AgentSessionDependencies {
  sessionId?: string;
  now?: () => Date;
  /** Bound a stalled provider so the interactive session remains usable. */
  responseTimeoutMs?: number;
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
    askUser?(prompt: string): Promise<boolean>;
    onToken(token: string): void;
  }): Promise<string>;
}

export type AgentSessionResult =
  | { kind: "exit" }
  | { kind: "coding"; outcome: string }
  | { kind: "resume" };

const MAX_HISTORY_TURNS = 12;
const CROSS_REPO_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 45_000;

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
  presentHypothesis?: string | null,
): string {
  let line = `\n${ART}\n\n  ${greeting()}`;
  const hypothesis = (presentHypothesis ?? "").trim();
  if (
    hypothesis &&
    hypothesis !== "I don't have a clear picture yet." &&
    hypothesis !== "Nothing urgent on the board."
  ) {
    line += `\n  ${hypothesis}`;
    return wrapDisplayText(line + "\n\n");
  }
  const value = valueOpening(situation);
  if (value) {
    line += `\n  ${value}`;
  } else {
    line += `\n  What are we working on today?`;
  }
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
  const responseTimeoutMs = deps.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;

  /**
   * One conversation turn, kernel-handler style: refresh state, retrieve
   * memory, call the model with streaming, and return the full reply.
   */
  async function runConversationTurn(message: string): Promise<string> {
    const currentWorkQuestion = isCurrentWorkQuestion(message);
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
    const memoryQuery = currentWorkQuestion
      ? [message, presentHypothesis ?? "", (repos.map((r) => r.name).join(" ") || "")].filter(Boolean).join(" ")
      : message;
    const memory = await deps.retrieveMemory(memoryQuery);
    if (deps.loadCrossRepo && Date.now() - lastContextRefresh > CROSS_REPO_TTL_MS) {
      repos = (await deps.loadCrossRepo(situation?.projectRoot).catch(() => repos)) ?? repos;
      lastContextRefresh = Date.now();
    }

    deps.terminal.setBusy?.(true);
    let streamed = false;
    let streamColored = false;
    try {
      const answer = await withResponseDeadline(deps.respond({
        sessionId: deps.sessionId,
        turnNumber: history.length / 2 + 1,
        message,
        history: history.slice(-MAX_HISTORY_TURNS),
        memory,
        situation,
        crossRepo: repos,
        presentHypothesis,
        askUser: (prompt) => deps.terminal.confirm(prompt),
        onToken: (token) => {
          streamed = true;
          if (deps.terminal.stream) {
            deps.terminal.stream(token);
          } else {
            if (!streamColored && useColor()) deps.terminal.write(GREEN);
            streamColored = true;
            deps.terminal.write(token);
          }
        },
      }), responseTimeoutMs);
      if (!streamed && answer) deps.terminal.write(paint(formatChatReply(answer), GREEN));
      return answer;
    } finally {
      deps.terminal.setBusy?.(false);
      if (streamed && !deps.terminal.stream && useColor()) deps.terminal.write(RESET);
    }
  }

  const promptText = deps.terminal.tui ? "You > " : `\n${paint("You >", CYAN)}`;

  // The input reader stays live between asks, so a message can be submitted
  // while a turn is still streaming. The session kernel serializes turns;
  // this chain tracks completion so control commands cannot overtake a turn.
  const queued: string[] = [];
  let tail: Promise<void> = Promise.resolve();

  function submitTurn(message: string): void {
    queued.push(message);
    deps.terminal.setPending?.([...queued]);
    const turn = tail.then(async () => {
      queued.shift();
      deps.terminal.setPending?.([...queued]);
      if (!deps.terminal.tui) deps.terminal.write(`\n${paint("Flyd >", GREEN)}\n`);
      const session = await ensureChat();
      const outputs = await session.kernel.submit(session.sessionKey, {
        type: "user_message",
        text: message,
      });
      const answer = replyText(outputs);
      if (!answer) {
        const failed = outputs.find((o) => o.type === "failed");
        throw new Error(failed && failed.type === "failed" ? failed.error : "Turn produced no reply");
      }
      deps.terminal.write("\n");
      history.push(
        { role: "user", content: message },
        { role: "assistant", content: answer },
      );
      try {
        await deps.recordTurn({
          user: message,
          assistant: answer,
        });
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        deps.terminal.write(`Flyd could not save this turn: ${err}\n`);
      }
    }).catch((error) => {
      const err = error instanceof Error ? error.message : String(error);
      deps.terminal.write(`I could not answer that turn: ${err}\n`);
    });
    tail = turn;
  }

  async function waitForTurns(): Promise<void> {
    await tail;
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
        text = (await deps.terminal.ask(promptText, CYAN)).trim();
      } catch (error) {
        // Ctrl+C during the prompt (TTY raw reader) — leave cleanly.
        if (error instanceof Error && error.message === "Interrupted") {
          await waitForTurns();
          return { kind: "exit" };
        }
        throw error;
      }
      if (!text) continue;

      const repairMatch = text.match(/^\/flyd-fix(?:\s+([\s\S]+))?$/i);
      if (repairMatch) {
        await waitForTurns();
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
        await waitForTurns();
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
      if (input.kind === "exit") {
        await waitForTurns();
        return { kind: "exit" };
      }
      if (input.kind === "resume") {
        await waitForTurns();
        return { kind: "resume" };
      }
      if (input.kind === "coding") {
        await waitForTurns();
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
        await waitForTurns();
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
      if (input.kind === "continue") {
        // A "continue" is only a resume when no conversation has happened yet;
        // wait for any in-flight turn so its history lands first.
        await waitForTurns();
        if (history.length === 0) {
          try {
            situation = await deps.loadSituation();
          } catch {
            // Continue from persisted conversation when live task state is unavailable.
          }
          if (hasUnfinishedTask(situation)) return { kind: "resume" };
          const outcome = await deps.recoverActionRequest();
          if (outcome) return { kind: "coding", outcome: outcome.outcome };
        }
      }

      submitTurn(input.message);
    }
  } finally {
    await tail.catch(() => undefined);
    await deps.terminal.close();
  }
}

function withResponseDeadline<T>(response: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return response;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Flyd response timed out after ${Math.ceil(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
    response.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

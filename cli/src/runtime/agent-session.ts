import { interpretAgentInput } from "./input-interpreter.js";
import { formatChatReply, paintFlyd, wrapDisplayText } from "./terminal.js";
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
const MAGENTA = "\u001b[35m";
const DIM = "\u001b[2m";

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
  /** y / n / a (always this session); hosts without it fall back to confirm. */
  approve?(prompt: string): Promise<boolean | "always">;
  close(): Promise<void>;
  /** Live assistant streaming; TUI hosts buffer it instead of writing raw. */
  stream?(token: string): void;
  /** Thinking indicator; TUI hosts render it in a status line. */
  setBusy?(busy: boolean): void;
  /** What Flyd is doing right now (tool progress); null clears it. */
  setActivity?(activity: string | null): void;
  /** Messages queued behind the running turn. */
  setPending?(messages: string[]): void;
  /** Full-screen pinned-input mode. */
  tui?: boolean;
  /** Toggle wheel capture (on) vs native text selection (off); returns the new state. */
  toggleMouse?(): boolean;
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
  /** After a turn is answered: journal it and let the council react (never blocks the chat). */
  afterTurn?(turn: { user: string; assistant: string }): Promise<{ museNote?: string; advisoryId?: string } | null>;
  /** George's verdict on the last Muse note that raised an advisory. */
  rateAdvisory?(advisoryId: string, verdict: "useful" | "dismissed"): Promise<void>;
  /** George's verdict on a Scout edition item. */
  rateStory?(n: number, verdict: "more" | "less"): Promise<string | null>;
  /** Proactive briefing lines for the intro (inbox, due reminders, agenda). */
  loadBriefing?(): Promise<string[]>;
  /** The Muse turns the briefing into a few warm sentences; the raw lines move to /brief. */
  composeGreeting?(input: { briefing: string[]; hypothesis: string | null }): Promise<string>;
  /** Put text on the system clipboard (/copy). */
  copyToClipboard?(text: string): Promise<void>;
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
    askUser?(prompt: string): Promise<boolean | "always">;
    onActivity?(activity: string): void;
    signal?: AbortSignal;
    onCodingHandoff?(outcome: string): void;
    onToken(token: string): void;
  }): Promise<string>;
}

/** A short interview that fills George's profile; the turns that follow carry it. */
export const ONBOARD_REQUEST = [
  "Interview me so you know me properly. Look at my profile and ask about the biggest gaps first:",
  "the people in my life (names and relationships), where I live and my timezone, my daily routines, my current goals, and constraints you should respect.",
  "Ask ONE short question at a time. After each answer, save each durable fact with remember (about_george true, with the right section), then ask the next question.",
  "Stop after about 8 questions or when I say stop, then summarise what you learned in a few lines.",
].join(" ");

interface TurnHandle {
  message: string;
  /** Moved backstage because George kept talking; answers as a whole message when done. */
  background: boolean;
  /** The reply is being written to the screen right now. */
  streaming: boolean;
  /** History slot holding "still working" until the real answer lands. */
  placeholder?: number;
  done?: Promise<void>;
}

export type AgentSessionResult =
  | { kind: "exit" }
  | { kind: "coding"; outcome: string }
  | { kind: "resume" };

const MAX_HISTORY_TURNS = 12;
const CROSS_REPO_TTL_MS = 5 * 60 * 1000;
/** Silence budget: the turn fails only when nothing has happened for this long. */
const DEFAULT_RESPONSE_TIMEOUT_MS = 90_000;
/** Absolute ceiling so a busy tool loop cannot hold the session forever. */
const MAX_TURN_MS = 10 * 60 * 1000;

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
  briefing: string[] = [],
): string {
  let line = `\n${ART}\n\n  ${greeting()}`;
  if (briefing.length) line += `\n${briefing.map((entry) => `  ${entry}`).join("\n")}`;
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


export async function runAgentSession(deps: AgentSessionDependencies): Promise<AgentSessionResult> {
  // Conversation turns flow through the session kernel (durable trail when
  // Postgres answers, in-memory otherwise). Control-flow commands — /flyd-fix,
  // /brief, coding handoffs, resume — are not chat and bypass the kernel.
  let chat: Awaited<ReturnType<typeof openChatSession>> | null = null;
  const ensureChat = async () => {
    if (!chat) {
      chat = await openChatSession({
        handleTurn: async (ctx) => {
          const answer = await runConversationTurn(ctx.message, kernelHandle ?? undefined);
          ctx.emit({ type: "message", text: answer });
          return { status: "completed", result: {} };
        },
      });
    }
    return chat;
  };

  const history: ConversationTurn[] = [];
  let kernelHandle: TurnHandle | null = null;
  let busyTurns = 0;
  let briefingLines: string[] = [];
  let situation: AgentSituation | null = null;
  let repos: BriefRepo[] = [];
  let presentHypothesis: string | null = null;
  let lastContextRefresh = 0;
  const responseTimeoutMs = deps.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;

  /**
   * One conversation turn, kernel-handler style: refresh state, retrieve
   * memory, call the model with streaming, and return the full reply.
   */
  async function runConversationTurn(message: string, handle: TurnHandle = { message, background: false, streaming: false }): Promise<string> {
    const currentWorkQuestion = isCurrentWorkQuestion(message);
    try {
      situation = await deps.loadSituation();
    } catch {
      // Keep the last known situation when live state cannot be refreshed.
    }
    const memoryQuery = currentWorkQuestion
      ? [message, presentHypothesis ?? "", (repos.map((r) => r.name).join(" ") || "")].filter(Boolean).join(" ")
      : message;
    const memory = await deps.retrieveMemory(memoryQuery);
    if (deps.loadCrossRepo && Date.now() - lastContextRefresh > CROSS_REPO_TTL_MS) {
      repos = (await deps.loadCrossRepo(situation?.projectRoot).catch(() => repos)) ?? repos;
      lastContextRefresh = Date.now();
    }

    busyTurns += 1;
    deps.terminal.setBusy?.(true);
    let streamed = false;
    let streamColored = false;
    const deadline = createTurnDeadline(responseTimeoutMs, MAX_TURN_MS);
    try {
      const answer = await deadline.run(deps.respond({
        sessionId: deps.sessionId,
        turnNumber: history.length / 2 + 1,
        message,
        // A turn moved to the background never sees its own "still working" placeholder.
        history: history.filter((_, index) => handle.placeholder === undefined || (index !== handle.placeholder && index !== handle.placeholder - 1)).slice(-MAX_HISTORY_TURNS),
        memory,
        situation,
        crossRepo: repos,
        presentHypothesis,
        askUser: async (prompt) => {
          deadline.pause();
          try {
            return deps.terminal.approve
              ? await deps.terminal.approve(prompt)
              : await deps.terminal.confirm(prompt);
          } finally {
            deadline.resume();
          }
        },
        signal: deadline.signal,
        onCodingHandoff: (outcome) => {
          pendingHandoff = outcome;
        },
        onActivity: (activity) => {
          deadline.touch();
          if (handle.background) return;
          if (deps.terminal.setActivity) deps.terminal.setActivity(activity);
          else if (!deps.terminal.tui) deps.terminal.write(`${paint(`  · ${activity}`, CYAN)}\n`);
        },
        onToken: (token) => {
          deadline.touch();
          // Work that moved to the background answers as a whole message when done.
          if (handle.background) return;
          handle.streaming = true;
          streamed = true;
          if (deps.terminal.stream) {
            deps.terminal.stream(token);
          } else {
            if (!streamColored && useColor()) deps.terminal.write(GREEN);
            streamColored = true;
            deps.terminal.write(token);
          }
        },
      }));
      if (!streamed && answer) {
        const about = handle.background ? `${paint(`  ↳ re: ${message.length > 60 ? `${message.slice(0, 59)}…` : message}`, DIM)}\n` : "";
        const reply = formatChatReply(answer);
        deps.terminal.write(`${about}${useColor() ? reply.split("\n").map(paintFlyd).join("\n") : reply}`);
      }
      return answer;
    } finally {
      deadline.dispose();
      busyTurns -= 1;
      if (!handle.background) deps.terminal.setActivity?.(null);
      deps.terminal.setBusy?.(busyTurns > 0);
      if (streamed && !deps.terminal.stream && useColor()) deps.terminal.write(RESET);
    }
  }

  const promptText = deps.terminal.tui ? "You > " : `\n${paint("You >", CYAN)}`;

  // The input reader stays live between asks, so a message can be submitted
  // while a turn is still streaming. The session kernel serializes turns;
  // this chain tracks completion so control commands cannot overtake a turn.
  const queued: string[] = [];
  let active: TurnHandle[] = [];
  const all = new Set<Promise<void>>();
  let lastSubmitted: Promise<unknown> = Promise.resolve();
  // The model hands coding work to the supervised runtime via start_coding_task;
  // the handoff fires once its turn has been answered and recorded.
  let pendingHandoff: string | null = null;
  let lastMuseAdvisory: string | null = null;
  let signalHandoff: (outcome: string) => void = () => {};
  const handoffRequested = new Promise<string>((resolve) => { signalHandoff = resolve; });

  /**
   * Conversation never waits on work. A message sent while Flyd is still
   * working moves that work to the background — it answers when it finishes —
   * and the new message is answered now. Only a reply already being written
   * holds the next message back, for the few seconds it takes to finish.
   */
  function submitTurn(message: string): void {
    const handle: TurnHandle = { message, background: false, streaming: false };
    const foreground = active.find((item) => !item.background);
    let before: Promise<unknown> = lastSubmitted;
    if (deps.terminal.tui && foreground && !foreground.streaming && queued.length === 0) {
      before = Promise.resolve();
      foreground.background = true;
      deps.terminal.setActivity?.(null);
      deps.terminal.write(paint("  I'll keep going on that and come back to you.\n", DIM));
      history.push(
        { role: "user", content: foreground.message },
        { role: "assistant", content: "(Still working on this in the background; the answer will follow when it's ready.)" },
      );
      foreground.placeholder = history.length - 1;
    } else if (foreground || all.size) {
      queued.push(message);
      deps.terminal.setPending?.([...queued]);
    }
    const turn = before.then(async () => {
      if (queued[0] === message) {
        queued.shift();
        deps.terminal.setPending?.([...queued]);
      }
      active.push(handle);
      if (!deps.terminal.tui) deps.terminal.write(`\n${paint("Flyd >", GREEN)}\n`);
      let answer: string;
      if (kernelHandle === null) {
        // The session kernel keeps the durable trail for the foreground turn.
        kernelHandle = handle;
        try {
          const session = await ensureChat();
          const outputs = await session.kernel.submit(session.sessionKey, { type: "user_message", text: message });
          answer = replyText(outputs) ?? "";
          if (!answer) {
            const failed = outputs.find((o) => o.type === "failed");
            throw new Error(failed && failed.type === "failed" ? failed.error : "Turn produced no reply");
          }
        } finally {
          kernelHandle = null;
        }
      } else {
        answer = await runConversationTurn(message, handle);
      }
      deps.terminal.write("\n");
      if (handle.placeholder !== undefined) history[handle.placeholder] = { role: "assistant", content: answer };
      else history.push({ role: "user", content: message }, { role: "assistant", content: answer });
      try {
        await deps.recordTurn({
          user: message,
          assistant: answer,
          ...(pendingHandoff ? {
            handoff: {
              outcome: pendingHandoff,
              sourceSessionId: deps.sessionId ?? "current-session",
              sourceTurn: history.length / 2,
              recordedAt: (deps.now?.() ?? new Date()).toISOString(),
            },
          } : {}),
        });
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        deps.terminal.write(`Flyd could not save this turn: ${err}\n`);
      }
      if (pendingHandoff) signalHandoff(pendingHandoff);
      if (deps.afterTurn) {
        void deps.afterTurn({ user: message, assistant: answer }).then((reaction) => {
          if (!reaction?.museNote) return;
          lastMuseAdvisory = reaction.advisoryId ?? null;
          deps.terminal.write(`\n${wrapDisplayText(`  ${reaction.museNote}`).split("\n").map((line) => paint(line, MAGENTA)).join("\n")}\n`);
        }).catch(() => undefined);
      }
    }).catch((error) => {
      const err = error instanceof Error ? error.message : String(error);
      deps.terminal.write(`I could not answer that turn: ${err}\n`);
    }).finally(() => {
      active = active.filter((item) => item !== handle);
    });
    handle.done = turn;
    lastSubmitted = turn;
    all.add(turn);
    void turn.finally(() => all.delete(turn));
  }

  async function waitForTurns(): Promise<void> {
    while (all.size) await Promise.allSettled([...all]);
  }

  try {
    situation = await deps.loadSituation().catch(() => null);
    repos = (await deps.loadCrossRepo?.(situation?.projectRoot).catch(() => [])) ?? [];
    const [hypothesis, briefing] = await Promise.all([
      deps.loadPresentHypothesis?.(situation?.projectRoot).catch(() => null),
      deps.loadBriefing?.().catch(() => []),
    ]);
    presentHypothesis = hypothesis ?? null;
    lastContextRefresh = Date.now();
    briefingLines = briefing ?? [];
    if (deps.composeGreeting) {
      deps.terminal.write(wrapDisplayText(`\n${ART}\n\n  ${greeting()}\n`));
      const note = deps.composeGreeting({ briefing: briefingLines, hypothesis: presentHypothesis })
        .then((text) => deps.terminal.write(`${wrapDisplayText(`  ${text}`).split("\n").map((line) => paint(line, MAGENTA)).join("\n")}\n\n`))
        .catch(() => deps.terminal.write("\n"));
      // A full-screen host keeps taking input while the Muse writes; a plain terminal waits so lines don't interleave.
      if (!deps.terminal.tui) await note;
    } else {
      deps.terminal.write(introLine(situation, presentHypothesis, briefingLines));
    }

    while (true) {
      let text: string;
      try {
        const next = await Promise.race([
          deps.terminal.ask(promptText, CYAN).then((line) => ({ kind: "line" as const, line })),
          handoffRequested.then((outcome) => ({ kind: "handoff" as const, outcome })),
        ]);
        if (next.kind === "handoff") {
          await waitForTurns();
          return { kind: "coding", outcome: next.outcome };
        }
        text = next.line.trim();
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

      const crewCommand = text.trim().match(/^\/(land|discard)(?:\s+(\S+))?$/i);
      if (crewCommand) {
        try {
          const crew = await import("../crew/crew.js");
          const land = crewCommand[1].toLowerCase() === "land";
          // Bare /land or /discard means the one piece of work waiting on George.
          const id = crewCommand[2] ?? (() => {
            const waiting = crew.listTasks().filter((item) => item.status === "ready" || (!land && item.status === "failed"));
            if (waiting.length === 1) return waiting[0].id;
            throw new Error(waiting.length ? `A few things are waiting: ${waiting.map((item) => `/${crewCommand[1].toLowerCase()} ${item.id} (${crew.plainOutcome(item)})`).join(", ")}` : "Nothing is waiting for you.");
          })();
          const task = land ? await crew.landCrewTask(id) : await crew.discardCrewTask(id);
          deps.terminal.write(`  ${land ? "Merged in" : "Dropped"}: ${crew.plainOutcome(task)}.\n`);
        } catch (error) {
          deps.terminal.write(`${error instanceof Error ? error.message : String(error)}\n`);
        }
        continue;
      }

      const story = text.trim().toLowerCase().match(/^\/(more|less)\s+(\d+)$/);
      if (story) {
        const title = deps.rateStory ? await deps.rateStory(Number(story[2]), story[1] === "more" ? "more" : "less").catch(() => null) : null;
        deps.terminal.write(title
          ? `${story[1] === "more" ? "Got it, more like" : "Got it, less like"} "${title}".\n`
          : `No item ${story[2]} in the latest edition.\n`);
        continue;
      }

      const verdict = text.trim().toLowerCase().match(/^\/(useful|dismiss)$/);
      if (verdict) {
        if (lastMuseAdvisory && deps.rateAdvisory) {
          await deps.rateAdvisory(lastMuseAdvisory, verdict[1] === "useful" ? "useful" : "dismissed").catch(() => undefined);
          deps.terminal.write(verdict[1] === "useful" ? "Noted, glad it helped.\n" : "Fair enough, I'll drop it.\n");
          lastMuseAdvisory = null;
        } else {
          deps.terminal.write("Nothing to rate yet.\n");
        }
        continue;
      }

      if (/^\/onboard\b/i.test(text.trim())) {
        submitTurn(ONBOARD_REQUEST);
        continue;
      }

      if (/^\/copy\b/i.test(text.trim())) {
        await waitForTurns();
        const last = [...history].reverse().find((turn) => turn.role === "assistant");
        if (!last || !deps.copyToClipboard) {
          deps.terminal.write(`  ${last ? "Copy isn't available here." : "Nothing to copy yet."}\n`);
        } else {
          await deps.copyToClipboard(last.content).then(
            () => deps.terminal.write(paint("  Copied Flyd's last reply.\n", DIM)),
            (error: unknown) => deps.terminal.write(`  Copy failed: ${error instanceof Error ? error.message : String(error)}\n`),
          );
        }
        continue;
      }

      if (/^\/mouse\b/i.test(text.trim())) {
        if (!deps.terminal.toggleMouse) {
          deps.terminal.write("  Mouse mode only applies to the full-screen view.\n");
        } else {
          deps.terminal.write(paint(deps.terminal.toggleMouse()
            ? "  Wheel scrolling on. Text selection is off until /mouse again.\n"
            : "  Text selection on. Scroll with Shift+↑/↓ or PgUp/PgDn.\n", DIM));
        }
        continue;
      }

      if (/^\/brief\b/i.test(text.trim())) {
        await waitForTurns();
        if (briefingLines.length) deps.terminal.write(wrapDisplayText(`\n${briefingLines.map((line) => `  ${line}`).join("\n")}\n`));
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

      const input = interpretAgentInput(text);
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
      submitTurn(input.message);
    }
  } finally {
    await waitForTurns().catch(() => undefined);
    await deps.terminal.close();
  }
}

/**
 * Idle deadline for one turn. Progress (tool activity, streamed tokens) resets
 * the silence timer; expiry aborts the provider request and blocks further tool
 * calls, so a turn reported as timed out cannot keep acting in the background.
 */
export function createTurnDeadline(idleMs: number, maxMs: number) {
  const controller = new AbortController();
  const enabled = Number.isFinite(idleMs) && idleMs > 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectTurn: ((error: Error) => void) | undefined;
  let paused = false;
  const expire = (message: string) => {
    if (controller.signal.aborted) return;
    controller.abort();
    rejectTurn?.(new Error(message));
  };
  const arm = () => {
    if (!enabled || paused) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => expire(`Flyd response timed out after ${Math.ceil(idleMs / 1000)} seconds without progress`),
      idleMs,
    );
  };
  const hardTimer = enabled
    ? setTimeout(() => expire(`Flyd stopped this turn after ${Math.round(maxMs / 60000)} minutes`), maxMs)
    : undefined;
  return {
    signal: controller.signal,
    touch: arm,
    pause() {
      paused = true;
      if (idleTimer) clearTimeout(idleTimer);
    },
    resume() {
      paused = false;
      arm();
    },
    run<T>(response: Promise<T>): Promise<T> {
      arm();
      return new Promise<T>((resolve, reject) => {
        rejectTurn = reject;
        response.then(resolve, reject);
      });
    },
    dispose() {
      if (idleTimer) clearTimeout(idleTimer);
      if (hardTimer) clearTimeout(hardTimer);
    },
  };
}

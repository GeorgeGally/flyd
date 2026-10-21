import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ArtefactFeed } from "../conversation-view/artefact.js";
import { artefactJudgeFromEnv } from "../conversation-view/artefact-judge.js";
import { semanticJudgeFromEnv } from "../conversation-view/semantic-judge.js";
import { importanceJudgeFromEnv } from "../conversation-view/importance-judge.js";
import { ArtefactVoice, defaultVoiceCache } from "../conversation-view/artefact-voice.js";
import { AutoAnswers, defaultAutoAnswerLog } from "../conversation-view/auto-answers.js";
import { ClaudeCodeTranscriptSource, FIRSTMATE_PROJECT_DIR, resolveProjectDir } from "../conversation-view/claude-code-source.js";
import { CrewProgress } from "../conversation-view/crew-progress.js";
import { FirstmateInbox } from "../conversation-view/firstmate-inbox.js";
import { FlydDesk, type Answerer, type Complete, type Seer } from "../conversation-view/flyd-desk.js";
import { flydBrief } from "../conversation-view/flyd-brief.js";
import { AnswerInterpreter, defaultInterpretationCache } from "../conversation-view/interpret.js";
import { memoryLookup } from "../conversation-view/living.js";
import { defaultProviders, defaultSummaryCache, ReplySummarizer } from "../conversation-view/summaries.js";
import { claudeApiKey } from "../lib/claude-spend.js";
import { readProjects } from "../council/projects.js";
import { tastePath } from "../council/taste.js";
import { userProfilePath } from "../lib/user-profile.js";
import { firstmateHome } from "../lib/firstmate-home.js";
import { PlanUsageReader } from "../conversation-view/plan-usage.js";
import { WeatherReader } from "../conversation-view/weather.js";
import { ActivityReader } from "../conversation-view/activity.js";
import { WhatsAppPairing } from "../connectors/whatsapp-pairing.js";
import { MemoryReader } from "../conversation-view/memory.js";
import { OvertakenCalls } from "../conversation-view/overtaken.js";
import { defaultUnreadChaseState, UnreadNoteWatcher } from "../conversation-view/note-receipts.js";
import { ConversationViewServer, DEFAULT_VIEW_PORT, VIEW_HOST } from "../conversation-view/server.js";
import { LiveStaffSession } from "../command/fleet-monitor.js";

export interface ViewOptions {
  project?: string;
  session?: string;
  port?: number;
  open?: boolean;
}

const PORT_ATTEMPTS = 10;

/**
 * His recorded preferences, whole (a prompt's copy of USER.md is cut short): USER.md, TASTE.md without the rules
 * he vetoed or the Librarian retired, and the standing memos he gave firstmate (its data/captain.md).
 */
function recordedPreferences(): string {
  const read = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");
  const kept = read(tastePath()).split(/^(?=## )/m).filter((section) => !/^## (?:Not me|Retired)\b/i.test(section)).join("");
  return [read(userProfilePath()), kept, read(join(firstmateHome(), "data", "captain.md"))].join("\n");
}

async function listenNear(server: ConversationViewServer, port: number, explicit: boolean): Promise<number> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await server.listen(port + attempt);
    } catch (error) {
      const busy = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!busy || explicit || attempt + 1 >= PORT_ATTEMPTS) throw error;
    }
  }
}

/**
 * Flyd's own assistant turn, as agenda items and background jobs run one: nobody is there to approve actions.
 * Each step it takes is said under his question as it happens.
 */
const answerAsFlyd: Answerer = async (question, history, onStep, turn) => {
  const [{ respondToConversation }, { retrieveAgentMemory, loadAgentSituation }, { refreshRepoRegistry }] = await Promise.all([
    import("../runtime/conversation-responder.js"), import("./code.js"), import("../runtime/repo-registry.js"),
  ]);
  const situation = await loadAgentSituation().catch(() => null);
  const crossRepo = await refreshRepoRegistry(situation?.projectRoot).catch(() => []);
  onStep?.("Remembering what I know about this", memoryLookup(question));
  const memory = await retrieveAgentMemory(question).catch(() => ({ verdict: "insufficient" as const, matches: [] }));
  return respondToConversation({ ...(turn ? { source: turn.source, sessionId: turn.source.sessionId, turnNumber: turn.turnNumber, onPreparation: turn.onPreparation, onInteraction: turn.onInteraction, onUnderstanding: turn.onUnderstanding, onArtefact: turn.onArtefact } : {}), message: question, history, memory, situation, crossRepo, onToken: () => {}, ...(onStep ? { onActivity: onStep } : {}) });
};

/** What the screenshots he attached to a question show, read by a vision model. */
const screenshotsSeen: Seer = async (question, images, onStep) => {
  onStep?.(images.length === 1 ? "Looking at your screenshot" : "Looking at your screenshots");
  const { quickQuery } = await import("../lib/llm.js");
  const prompt = [
    `George attached ${images.length === 1 ? "this screenshot" : "these screenshots"} to his question: "${question.slice(0, 1_000)}"`,
    "Say exactly what they show that bears on it: any text, errors, numbers and names word for word, and what is on screen. Describe only; do not answer.",
  ].join("\n\n");
  const seen = await quickQuery(prompt, { images: images.map((image) => `data:${image.mediaType};base64,${image.data}`) })
    .then((text) => text.trim())
    .catch(() => "");
  return seen
    ? `[What the screenshot he attached shows: ${seen}]`
    : "[He attached a screenshot that could not be read; say so if the answer depends on it.]";
};

function openInBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(command, [url], () => {});
}

/** `flyd view`: a calm view of a conversation, served on loopback, with a box to message firstmate. */
export async function runView(options: ViewOptions = {}): Promise<void> {
  const { acquireDesktopOwner } = await import("../mobile/owner.js");
  const { FLYD_DIR } = await import("../lib/config.js");
  const releaseOwner = acquireDesktopOwner(FLYD_DIR);
  try {
  if (options.port !== undefined && !(Number.isInteger(options.port) && options.port > 0 && options.port < 65536)) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  const projectDir = resolveProjectDir(options.project ?? FIRSTMATE_PROJECT_DIR);
  // Messages go to firstmate's own inbox, so the box only appears on
  // firstmate's conversation.
  const inbox = new FirstmateInbox();
  // Routing, retold answers and status lines are quick jobs: Claude Haiku first.
  const complete: Complete = async (prompt) => (await import("../lib/llm.js")).quickQuery(prompt);
  const wantsInbox = options.project === undefined && inbox.available();
  const liveSession = wantsInbox ? new LiveStaffSession({ home: inbox.home }) : undefined;
  const source = new ClaudeCodeTranscriptSource({
    projectDir,
    // Skills and commands: ~/.claude plus firstmate's own .claude, as Claude Code lists them.
    ...(wantsInbox ? { inbox, crew: new CrewProgress({ home: inbox.home }), commandRoots: { projectDir: inbox.home } } : {}),
    // The window follows the session that holds firstmate's lock, not whichever transcript was written last.
    ...(liveSession ? { liveSession: () => liveSession.current() } : {}),
    // Flyd answers what is not software work itself; the router is one short call to Flyd's model.
    ...(wantsInbox ? {
      desk: {
        desk: new FlydDesk({ answer: answerAsFlyd, see: screenshotsSeen }),
        complete,
        brief: (text, recent) => flydBrief(text, recent, complete),
      },
    } : {}),
  });
  const sessions = await source.listSessions();
  if (sessions.length === 0) throw new Error(`No Claude Code sessions in ${projectDir}`);
  if (options.session && !sessions.some((session) => session.id === options.session)) {
    throw new Error(`No session ${options.session} in ${projectDir}`);
  }

  // Plain-English summaries: Claude Haiku, then xAI Grok, from whichever keys
  // exist; with neither, a long reply leads with Flyd's whole briefing of it
  // (engineering stubs out, a status card for several pieces of work, every sentence kept).
  const providers = defaultProviders({ anthropicKey: claudeApiKey() });
  const summarizer = new ReplySummarizer({ providers, cacheFile: defaultSummaryCache() });
  // The plan's usage limits, from quota-axi when it can read them without prompting.
  const plan = new PlanUsageReader();
  plan.start();
  // Firstmate's answer to each note is told by Flyd, through Flyd's own model.
  const interpreter = new AnswerInterpreter({ complete, cacheFile: defaultInterpretationCache() });
  // The artefact says each piece of work in Flyd's own words, through Flyd's own model.
  // A call whose task the staff's record shows finished, answered or released leaves Needs you, and firstmate is told to close it.
  const overtaken = wantsInbox && process.env.FLYD_CLOSE_OVERTAKEN !== "0"
    ? new OvertakenCalls({ send: (note, requestId) => inbox.sendOwn(note, requestId) })
    : undefined;
  const feed = new ArtefactFeed({ voice: new ArtefactVoice({ complete, cacheFile: defaultVoiceCache() }), ...(overtaken ? { overtaken } : {}) });
  // Show mode names things by his own projects; the column shows what Flyd remembers for the one we are on.
  // Firstmate's routine questions that his standing rules settle are answered for him, each one he can take back.
  const autoAnswers = wantsInbox && process.env.FLYD_AUTO_ANSWER !== "0"
    ? new AutoAnswers({ preferences: recordedPreferences, logFile: defaultAutoAnswerLog() })
    : undefined;
  const server = new ConversationViewServer(source, { summarizer, interpreter, artefacts: artefactJudgeFromEnv(), semantic: semanticJudgeFromEnv(), importance: importanceJudgeFromEnv(), always: process.env.FLYD_SUMMARY_ALWAYS === "1" }, plan, { projects: () => readProjects() }, feed, new WeatherReader(), undefined, undefined, undefined, new MemoryReader(), autoAnswers, undefined, new ActivityReader(), new WhatsAppPairing());
  const port = await listenNear(server, options.port ?? DEFAULT_VIEW_PORT, options.port !== undefined);
  const url = `http://${VIEW_HOST}:${port}/${options.session ? `?session=${encodeURIComponent(options.session)}` : ""}`;
  console.log(`flyd view — ${source.assistantLabel} at ${url}`);
  console.log(source.canSend
    ? `Flyd answers what you type; software work goes to firstmate's inbox (${inbox.script}). Ctrl-C to stop.`
    : "Read-only. Ctrl-C to stop.");
  console.log(providers.length
    ? `Summaries: ${providers.map((provider) => provider.name).join(", then ")} (reply text is sent to that provider; FLYD_VIEW_SUMMARIES=0 turns it off).`
    : process.env.FLYD_VIEW_SUMMARIES === "0"
      ? "Summaries: model summaries off (FLYD_VIEW_SUMMARIES=0); long replies lead with Flyd's whole briefing."
      : "Summaries: no CLAUDE_API_KEY, ANTHROPIC_API_KEY or XAI_API_KEY found; long replies lead with Flyd's whole briefing.");
  if (options.open !== false) openInBrowser(url);
  // A note firstmate leaves unread past three minutes: Flyd chases firstmate itself, quietly, and George never hears.
  const unread = wantsInbox
    ? new UnreadNoteWatcher(
      () => source.heardExchanges(),
      (note, requestId) => inbox.sendOwn(note, requestId),
      Date.now,
      defaultUnreadChaseState(),
    )
    : undefined;
  unread?.start();

  await new Promise<void>((resolve) => {
    let watchdog: NodeJS.Timeout | undefined;
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      if (watchdog) clearInterval(watchdog);
      unread?.stop();
      void server.close().then(resolve);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    // Started by Flyd.app: go away with it, even if it crashed without
    // stopping us.
    const parent = Number(process.env.FLYD_VIEW_PARENT_PID);
    if (Number.isInteger(parent) && parent > 1) {
      watchdog = setInterval(() => {
        try {
          process.kill(parent, 0);
        } catch {
          stop();
        }
      }, 2_000);
    }
  });
  } finally { releaseOwner(); }
}

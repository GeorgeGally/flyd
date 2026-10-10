import { execFile } from "node:child_process";
import { ArtefactFeed } from "../conversation-view/artefact.js";
import { ArtefactVoice, defaultVoiceCache } from "../conversation-view/artefact-voice.js";
import { ClaudeCodeTranscriptSource, FIRSTMATE_PROJECT_DIR, projectNames, resolveProjectDir } from "../conversation-view/claude-code-source.js";
import { FirstmateInbox } from "../conversation-view/firstmate-inbox.js";
import { FlydDesk, type Answerer, type Complete } from "../conversation-view/flyd-desk.js";
import { AnswerInterpreter, defaultInterpretationCache } from "../conversation-view/interpret.js";
import { defaultProviders, defaultSummaryCache, ReplySummarizer } from "../conversation-view/summaries.js";
import { getKey } from "../lib/config.js";
import { readProjects } from "../council/projects.js";
import { PlanUsageReader } from "../conversation-view/plan-usage.js";
import { WeatherReader } from "../conversation-view/weather.js";
import { ConversationViewServer, DEFAULT_VIEW_PORT, VIEW_HOST } from "../conversation-view/server.js";

export interface ViewOptions {
  project?: string;
  session?: string;
  port?: number;
  open?: boolean;
}

const PORT_ATTEMPTS = 10;

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

/** Flyd's own assistant turn, as agenda items and background jobs run one: nobody is there to approve actions. */
const answerAsFlyd: Answerer = async (question, history) => {
  const [{ respondToConversation }, { retrieveAgentMemory, loadAgentSituation }, { refreshRepoRegistry }] = await Promise.all([
    import("../runtime/conversation-responder.js"), import("./code.js"), import("../runtime/repo-registry.js"),
  ]);
  const situation = await loadAgentSituation().catch(() => null);
  const crossRepo = await refreshRepoRegistry(situation?.projectRoot).catch(() => []);
  const memory = await retrieveAgentMemory(question).catch(() => ({ verdict: "insufficient" as const, matches: [] }));
  return respondToConversation({ message: question, history, memory, situation, crossRepo, onToken: () => {} });
};

function openInBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(command, [url], () => {});
}

/** `flyd view`: a calm view of a conversation, served on loopback, with a box to message firstmate. */
export async function runView(options: ViewOptions = {}): Promise<void> {
  if (options.port !== undefined && !(Number.isInteger(options.port) && options.port > 0 && options.port < 65536)) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  const projectDir = resolveProjectDir(options.project ?? FIRSTMATE_PROJECT_DIR);
  // Messages go to firstmate's own inbox, so the box only appears on
  // firstmate's conversation.
  const inbox = new FirstmateInbox({ projects: projectNames });
  const complete: Complete = async (prompt) => (await import("../lib/llm.js")).query(prompt);
  const wantsInbox = options.project === undefined && inbox.available();
  const source = new ClaudeCodeTranscriptSource({
    projectDir,
    // Skills and commands: ~/.claude plus firstmate's own .claude, as Claude Code lists them.
    ...(wantsInbox ? { inbox, commandRoots: { projectDir: inbox.home } } : {}),
    // Flyd answers what is not software work itself; the router is one short call to Flyd's model.
    ...(wantsInbox ? {
      desk: {
        desk: new FlydDesk({ answer: answerAsFlyd }),
        complete,
      },
    } : {}),
  });
  const sessions = await source.listSessions();
  if (sessions.length === 0) throw new Error(`No Claude Code sessions in ${projectDir}`);
  if (options.session && !sessions.some((session) => session.id === options.session)) {
    throw new Error(`No session ${options.session} in ${projectDir}`);
  }

  // Plain-English summaries: xAI Grok, then Claude Haiku, from whichever keys
  // exist; with neither, a long reply leads with Flyd's whole briefing of it
  // (engineering stubs out, a status card for several pieces of work, every sentence kept).
  const providers = defaultProviders({ anthropicKey: getKey("ANTHROPIC_API_KEY") });
  const summarizer = new ReplySummarizer({ providers, cacheFile: defaultSummaryCache() });
  // The plan's usage limits, from quota-axi when it can read them without prompting.
  const plan = new PlanUsageReader();
  plan.start();
  // Firstmate's answer to each note is told by Flyd, through Flyd's own model.
  const interpreter = new AnswerInterpreter({ complete, cacheFile: defaultInterpretationCache() });
  // The artefact says each piece of work in Flyd's own words, through Flyd's own model.
  const feed = new ArtefactFeed({ voice: new ArtefactVoice({ complete, cacheFile: defaultVoiceCache() }) });
  // Show mode names things by his own projects.
  const server = new ConversationViewServer(source, { summarizer, interpreter, always: process.env.FLYD_SUMMARY_ALWAYS === "1" }, plan, { projects: () => readProjects() }, feed, new WeatherReader());
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
      : "Summaries: no XAI_API_KEY or ANTHROPIC_API_KEY found; long replies lead with Flyd's whole briefing.");
  if (options.open !== false) openInBrowser(url);

  await new Promise<void>((resolve) => {
    let watchdog: NodeJS.Timeout | undefined;
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      if (watchdog) clearInterval(watchdog);
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
}

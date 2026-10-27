import { execFile } from "node:child_process";
import { join } from "node:path";
import { diagnosisFromText } from "../conversation-view/answer-form.js";
import { answerForm, reshapeAnswer } from "../conversation-view/answer-shape.js";
import { ArtefactFeed } from "../conversation-view/artefact.js";
import { artefactJudgeFromEnv } from "../conversation-view/artefact-judge.js";
import { semanticJudgeFromEnv } from "../conversation-view/semantic-judge.js";
import { importanceJudgeFromEnv } from "../conversation-view/importance-judge.js";
import { ArtefactVoice, defaultVoiceCache } from "../conversation-view/artefact-voice.js";
import { ClaudeCodeTranscriptSource, FIRSTMATE_PROJECT_DIR, resolveProjectDir } from "../conversation-view/claude-code-source.js";
import { CrewProgress } from "../conversation-view/crew-progress.js";
import { FirstmateInbox } from "../conversation-view/firstmate-inbox.js";
import { FlydDesk, type Answerer, type Complete, type Seer } from "../conversation-view/flyd-desk.js";
import { flydBrief } from "../conversation-view/flyd-brief.js";
import { executiveConversationSource } from "../conversation-view/executive-source.js";
import { FlydConversationSource } from "../conversation-view/flyd-source.js";
import type { ConversationSource } from "../conversation-view/types.js";
import { AnswerInterpreter, defaultInterpretationCache } from "../conversation-view/interpret.js";
import { memoryLookup } from "../conversation-view/living.js";
import { defaultProviders, defaultSummaryCache, ReplySummarizer } from "../conversation-view/summaries.js";
import { claudeApiKey } from "../lib/claude-spend.js";
import { readProjects } from "../council/projects.js";
import { PlanUsageReader } from "../conversation-view/plan-usage.js";
import { WeatherReader } from "../conversation-view/weather.js";
import { ActivityReader } from "../conversation-view/activity.js";
import { WhatsAppPairing } from "../connectors/whatsapp-pairing.js";
import { MemoryReader } from "../conversation-view/memory.js";
import { OvertakenCalls } from "../conversation-view/overtaken.js";
import { StaleCallJudge } from "../conversation-view/stale-calls.js";
import { ConversationViewServer, DEFAULT_VIEW_PORT, VIEW_HOST } from "../conversation-view/server.js";
import { LiveStaffSession } from "../command/fleet-monitor.js";
import { listDomainRuns } from "../command/store.js";
import { sendRunMessage } from "../command/messages.js";
import { NOTE_ALREADY_SENT, processFirstmateChanges, authorityForStaffRun } from "../intelligence/executive/firstmate-decision.js";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { notesSentToBoss, readExecutiveDecision, resolveExecutiveDecision } from "../intelligence/executive/decision-step.js";
import { deliverBossNote } from "../command/scheduler.js";
import { CognitiveCurator } from "../cognition/curator/curator.js";
import { runCuratorSweep } from "../cognition/curator/reconcile.js";
import { autonomyLevel } from "../runtime/tool-policy.js";

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

/**
 * The shape Flyd's own answers may take in the view, said to the model on
 * these turns only; one it does not choose is prose.
 */
const DIAGNOSIS_PROMPT = "This answer is in the Flyd conversation view. When it explains why something did or did not work, it MUST use the diagnosis form, even though your usual style is connected prose: open with `**Diagnosis: <the outcome in one line>**`, then exactly one line each for `**Expected:**`, `**Observed:**`, `**Cause:**`, `**Evidence:**` and `**Next:**` (Evidence names the mechanism, spec or source — a file, a log, or the documented behaviour — and need not be something you read this turn). Every other answer is prose. Never force the shape onto an answer that is not explaining a cause.";

/**
 * Flyd's own assistant turn, as agenda items and background jobs run one: nobody is there to approve actions.
 * Each step it takes is said under his question as it happens.
 */
export const answerAsFlyd: Answerer = async (question, history, onStep, turn) => {
  const [{ respondToConversation }, { retrieveAgentMemory, loadAgentSituation }, { refreshRepoRegistry }] = await Promise.all([
    import("../runtime/conversation-responder.js"), import("./code.js"), import("../runtime/repo-registry.js"),
  ]);
  const situation = await loadAgentSituation().catch(() => null);
  const crossRepo = await refreshRepoRegistry(situation?.projectRoot).catch(() => []);
  onStep?.("Remembering what I know about this", memoryLookup(question));
  const memory = await retrieveAgentMemory(question).catch(() => ({ verdict: "insufficient" as const, matches: [] }));
  const article = turn ? await articleForTurn(turn.source.sessionId, question) : undefined;
  const text = await respondToConversation({ ...(turn ? { source: turn.source, sessionId: turn.source.sessionId, turnNumber: turn.turnNumber, onPreparation: turn.onPreparation, onInteraction: turn.onInteraction, onUnderstanding: turn.onUnderstanding, onArtefact: turn.onArtefact, ...(turn.askUser ? { askUser: turn.askUser } : {}) } : {}), ...(article ? { article } : {}), message: question, history, memory, situation, crossRepo, onToken: () => {}, ...(onStep ? { onActivity: onStep } : {}), formPrompt: DIAGNOSIS_PROMPT });
  const declared = diagnosisFromText(text);
  if (declared) return declared;
  const form = await answerForm(question, text);
  if (!form) return text;
  const { quickQuery } = await import("../lib/llm.js");
  return (await reshapeAnswer(question, text, form, (prompt) => quickQuery(prompt, { json: true }))) ?? text;
};

/** The article this turn is grounded in; none for an off-topic question or an unreadable page, so the turn takes the ordinary path with its tools. */
async function articleForTurn(sessionId: string, question: string): Promise<{ title: string; url: string; text: string } | undefined> {
  const [{ articleTurnFor }, { FLYD_DIR }] = await Promise.all([
    import("../conversation-view/article-chat.js"),
    import("../lib/config.js"),
  ]);
  return articleTurnFor(FLYD_DIR, sessionId, question);
}

function runCouncilAfterTurn(turn: { sessionId: string; user: string; assistant: string; recordInCognition?: boolean }): void {
  void (async () => {
    if (turn.recordInCognition) {
      const curator = new CognitiveCurator();
      try {
        curator.recordConversationTurn({ sessionId: `view:${turn.sessionId}`, user: turn.user, assistant: turn.assistant });
      } finally {
        curator.close();
      }
      await runCuratorSweep().catch(() => undefined);
    }
    const { runCouncilInBackground } = await import("../council/council.js");
    runCouncilInBackground();
  })().catch(() => undefined);
}

function flydDesk(): FlydDesk {
  return new FlydDesk({ answer: answerAsFlyd, see: screenshotsSeen, afterTurn: runCouncilAfterTurn });
}

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

/** `flyd view`: Flyd's own conversation, served on loopback. */
export async function runView(options: ViewOptions = {}): Promise<void> {
  const { acquireDesktopOwner } = await import("../mobile/owner.js");
  const { FLYD_DIR } = await import("../lib/config.js");
  const releaseOwner = acquireDesktopOwner(FLYD_DIR);
  try {
  if (options.port !== undefined && !(Number.isInteger(options.port) && options.port > 0 && options.port < 65536)) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  const complete: Complete = async (prompt) => (await import("../lib/llm.js")).quickQuery(prompt);
  const inbox = new FirstmateInbox();
  const resolveDecision = async (decisionId: string, taskId: string, answer: string): Promise<void> => {
    const store = new IntelligenceEventStore({ path: join(FLYD_DIR, "intelligence.sqlite") });
    try {
      const decision = readExecutiveDecision(store, decisionId);
      if (!decision || decision.taskId !== taskId || decision.disposition !== "ask_george") throw new Error("That decision is no longer available");
      if (decision.resolution) {
        if (decision.resolution.answer === answer.trim()) return;
        throw new Error("That decision already has George's answer");
      }
      const run = listDomainRuns().find((item) => item.id === taskId && item.transport.kind === "firstmate"
        && item.request.domain === "coding" && ["queued", "accepted", "working", "needs_decision", "incomplete"].includes(item.status));
      let evidenceRef: string;
      if (run) {
        const message = `George's answer to: ${decision.question}\n\n${answer.trim()}`;
        const sent = await sendRunMessage({ run, kind: "decision", body: message, from: "flyd" });
        if (!sent.delivered) throw new Error("Flyd could not deliver that decision to the active work");
        const receipt = sent.run?.messages?.find((item) => item.kind === "decision" && item.body === message && item.deliveredAt);
        if (!receipt) throw new Error("Flyd could not verify delivery of that decision");
        evidenceRef = `domain-message:${receipt.id}`;
      } else {
        if (!inbox.available()) throw new Error("There is no connected coding employee to receive that decision");
        // No run of his is open for it: his answer goes as a run of its own, his words as its original message.
        await inbox.sendOwn(`George's answer to the recorded decision ${decision.question}:\n\n${answer.trim()}`, `flyd-decision-${decisionId}`, {
          outcome: `Act on George's answer to: ${decision.question}`.slice(0, 200),
          georgesWords: answer.trim(),
          doneWhen: ["George's answer is carried out on the work it decides", "what was done is replied to this note"],
          contextRefs: [`decision:${decisionId}`, `task:${taskId}`],
        });
        evidenceRef = `firstmate-note:flyd-decision-${decisionId}`;
      }
      resolveExecutiveDecision(store, decisionId, answer, [evidenceRef]);
    } finally {
      store.close();
    }
  };
  const flydSource = new FlydConversationSource({ desk: flydDesk(), articlesDir: FLYD_DIR, resolveDecision });
  let source: ConversationSource = flydSource;
  let wantsInbox = false;
  let transcriptProjectDir: string | undefined;
  let transcript: ClaudeCodeTranscriptSource | undefined;
  if (options.project !== undefined || options.session !== undefined) {
    transcriptProjectDir = resolveProjectDir(options.project ?? FIRSTMATE_PROJECT_DIR);
    wantsInbox = options.project === undefined && inbox.available();
    const liveSession = wantsInbox ? new LiveStaffSession({ home: inbox.home }) : undefined;
    transcript = new ClaudeCodeTranscriptSource({
      projectDir: transcriptProjectDir,
      ...(wantsInbox ? { inbox, crew: new CrewProgress({ home: inbox.home }), commandRoots: { projectDir: inbox.home } } : {}),
      ...(liveSession ? { liveSession: () => liveSession.current() } : {}),
      ...(wantsInbox ? { desk: { desk: flydDesk(), complete, brief: (text, recent) => flydBrief(text, recent, complete) } } : {}),
    });
    source = transcript;
  }
  const sessions = await source.listSessions();
  if (sessions.length === 0 && transcriptProjectDir) throw new Error(`No Claude Code sessions in ${transcriptProjectDir}`);
  if (options.session && transcriptProjectDir && !sessions.some((session) => session.id === options.session)) {
    throw new Error(`No session ${options.session} in ${transcriptProjectDir}`);
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
  const firstmateInbox = inbox;
  const overtaken = wantsInbox && firstmateInbox && process.env.FLYD_CLOSE_OVERTAKEN !== "0"
    ? new OvertakenCalls({ send: (note, requestId, task) => firstmateInbox.sendOwn(note, requestId, {
      outcome: `Close the overtaken call on ${task}`,
      doneWhen: ["the hold is closed, or reopened with what changed if it is still a real decision", "what you did is replied to this note"],
      contextRefs: [`task:${task}`],
      // The call's own run, when one of Flyd's handoffs raised it.
      ...(listDomainRuns().some((run) => run.id === task) ? { parentRequestId: task } : {}),
    }),
    // An old call the staff never closed is weighed against the repo and his project list (FLYD_STALE_CALLS=0 off).
    ...(process.env.FLYD_STALE_CALLS !== "0" ? { stale: new StaleCallJudge({ complete: async (prompt) => (await import("../lib/llm.js")).quickQuery(prompt, { json: true }) }) } : {}),
    })
    : undefined;
  const decideChanges = async (changes: import("../intelligence/executive/firstmate-decision.js").FirstmateChange[]) => {
    const runs = listDomainRuns();
    const activeStatuses = new Set(["queued", "accepted", "working", "needs_decision", "incomplete", "failed"]);
    const prepared = changes.map((change) => {
      const run = change.taskId ? runs.find((item) => item.id === change.taskId) : undefined;
      const authority = run ? authorityForStaffRun({
        runId: run.id,
        firstmate: run.transport.kind === "firstmate" && run.request.domain === "coding",
        active: activeStatuses.has(run.status),
        autonomy: autonomyLevel(),
      }) : change.taskId && change.kind === "fleet_state" && ["working", "paused", "unknown", "failed"].includes(change.state)
        ? authorityForStaffRun({ runId: change.taskId, firstmate: inbox.available(), active: true, autonomy: autonomyLevel() })
        : [];
      const sentToBoss = notesSentToBoss(run?.messages);
      return { ...change, ...(authority.length ? { authority } : {}), ...(sentToBoss.length ? { sentToBoss } : {}), evidenceRefs: [...change.evidenceRefs, ...(run?.result?.evidence ?? [])] };
    });
    return processFirstmateChanges(prepared, {
      complete: async (prompt) => (await import("../lib/llm.js")).quickQuery(prompt, { json: true }),
      jev: { ...(process.env.FLYD_JEV_MODEL ? { model: process.env.FLYD_JEV_MODEL } : {}) },
      executeInternalAction: async (action) => {
        const run = listDomainRuns().find((item) => item.id === action.target && item.transport.kind === "firstmate"
          && item.request.domain === "coding" && activeStatuses.has(item.status));
        if (!run) {
          const observedTask = prepared.find((change) => change.taskId === action.target && change.authority?.some((grant) => grant.grantId === action.grantId));
          if (!observedTask || !inbox.available()) return { status: "unknown", evidenceRefs: [] };
          // Work firstmate already archived as done (George may have closed it) is not chased back to life.
          if (inbox.taskClosed(action.target)) return { status: "verified", evidenceRefs: [`firstmate-task-closed:${action.target}`] };
          const { requestId, replayed } = await inbox.sendTaskNote(action.target, action.text);
          return replayed
            ? { status: "failed", evidenceRefs: [`${NOTE_ALREADY_SENT}${requestId}`] }
            : { status: "verified", evidenceRefs: [`firstmate-note:${requestId}`] };
        }
        return deliverBossNote(run, action);
      },
    });
  };
  const feed = new ArtefactFeed({
    voice: new ArtefactVoice({ complete, cacheFile: defaultVoiceCache() }),
    decideChanges,
    ...(overtaken ? { overtaken } : {}),
  });
  if (source !== flydSource) source = executiveConversationSource(source, decideChanges, resolveDecision);
  const server = new ConversationViewServer(source, { summarizer, interpreter, artefacts: artefactJudgeFromEnv(), semantic: semanticJudgeFromEnv(), importance: importanceJudgeFromEnv(), always: process.env.FLYD_SUMMARY_ALWAYS === "1" }, plan, { projects: () => readProjects() }, feed, new WeatherReader(), undefined, undefined, undefined, new MemoryReader(), undefined, new ActivityReader(), new WhatsAppPairing());
  const port = await listenNear(server, options.port ?? DEFAULT_VIEW_PORT, options.port !== undefined);
  const url = `http://${VIEW_HOST}:${port}/${options.session ? `?session=${encodeURIComponent(options.session)}` : ""}`;
  console.log(`flyd view — ${source.assistantLabel} at ${url}`);
  console.log(source.canSend ? "Flyd answers what you type. Ctrl-C to stop." : "Read-only. Ctrl-C to stop.");
  console.log(providers.length
    ? `Summaries: ${providers.map((provider) => provider.name).join(", then ")} (reply text is sent to that provider; FLYD_VIEW_SUMMARIES=0 turns it off).`
    : process.env.FLYD_VIEW_SUMMARIES === "0"
      ? "Summaries: model summaries off (FLYD_VIEW_SUMMARIES=0); long replies lead with Flyd's whole briefing."
      : "Summaries: no CLAUDE_API_KEY, ANTHROPIC_API_KEY or XAI_API_KEY found; long replies lead with Flyd's whole briefing.");
  if (options.open !== false) openInBrowser(url);
  // A note left unread is not chased from here: each is a domain run, and the command layer and the staff watch
  // in Core look after it (a session launched for an unread note, one open chase for a run gone quiet).

  await new Promise<void>((resolve) => {
    let watchdog: NodeJS.Timeout | undefined;
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      if (watchdog) clearInterval(watchdog);
      // A stray timer or child (a fleet read, a model call) must not keep a stopped
      // view alive and port-less, where Flyd.app's supervisor never sees it exit.
      setTimeout(() => process.exit(0), 5_000).unref();
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

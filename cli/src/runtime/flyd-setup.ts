import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatModelChain, claudeChatModel, claudeQuickModel, defaultModel, fallbackModelChain, FLYD_APPLICATION_ROOT, getKey, quickModelChain } from "../lib/config.js";
import { claudeApiKey, spendStatus } from "../lib/claude-spend.js";

// What Flyd runs on, worked out each time it is asked, from the same resolvers
// each job uses to pick its model. So the answer follows his .env,
// ~/.flyd/config.json and the code defaults the moment any of them changes.
// Model ids, setting names and on/off only: no key, token or URL leaves this
// file.

export interface ModelAssignment {
  /** The job, in George's words. */
  job: string;
  /** The model doing it, or what happens when none is set. */
  model: string;
  /** Tried next, in order, when the model fails. */
  fallbacks?: string[];
  /** What decided it: the setting that is set, or "code default". */
  setBy: string;
  /** Every setting this job reads to pick its model. */
  settings: string[];
  /** A development tool, not part of his daily Flyd. */
  dev?: boolean;
}

/** A setting as the jobs read it: the environment (with Flyd's .env), then ~/.flyd/config.json. */
function setting(name: string): string | undefined {
  return (process.env[name] ?? (getKey as unknown as (key: string) => string | undefined)(name))?.trim() || undefined;
}

function decidedBy(settings: string[]): string {
  return settings.find((name) => setting(name)) ?? "code default";
}

function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** qmd's on-device models: its own QMD_* settings, else the defaults of the installed qmd. */
function qmdModels(): { embed: string; expand: string; rerank: string } {
  let defaults: Record<string, string> = {};
  try {
    const entry = fileURLToPath(import.meta.resolve("@tobilu/qmd"));
    const source = readFileSync(join(dirname(entry), "llm.js"), "utf8");
    defaults = Object.fromEntries([...source.matchAll(/^const DEFAULT_(EMBED|GENERATE|RERANK)_MODEL = "([^"]+)";$/gm)].map((match) => [match[1]!, match[2]!]));
  } catch {
    // qmd not installed here: its own defaults are unknown, not guessed.
  }
  const local = (env: string, key: string): string => setting(env) ?? defaults[key] ?? "qmd's built-in default";
  return { embed: local("QMD_EMBED_MODEL", "EMBED"), expand: local("QMD_GENERATE_MODEL", "GENERATE"), rerank: local("QMD_RERANK_MODEL", "RERANK") };
}

const COMMANDCODE_SETTINGS = ["COMMANDCODE_MODEL", "COMMANDCODE_API_KEY_MODEL"];
const CLAUDE_SETTINGS = ["FLYD_CLAUDE", "FLYD_CLAUDE_MONTHLY_CAP_USD"];

/** Why Claude leads a chain, or why it is missing from one. */
function claudeState(): string {
  if (setting("FLYD_CLAUDE") === "0") return "Claude off (FLYD_CLAUDE=0)";
  if (!claudeApiKey()) return "Claude off (no CLAUDE_API_KEY)";
  const spend = attempt(() => spendStatus());
  return spend?.capped ? `Claude paused: this month's $${spend.cap} cap is reached, back on the 1st` : "Claude on";
}

/** Who picked a chain: Claude's own setting or the code default while Claude leads it, else what picks it without Claude (the spend line says why Claude is out). */
function claudeDecidedBy(claude: string | null, modelSetting: string, otherwise: string): string {
  if (!claude) return otherwise;
  return setting(modelSetting) ? modelSetting : "code default (CLAUDE_API_KEY set, under the monthly cap)";
}

/** Each job Flyd does with a model, and the model doing it right now. */
export async function flydModelAssignments(): Promise<ModelAssignment[]> {
  const [
    { loadFlydWorkerConfigs, loadFlydRouterConfig },
    { turnRouteJevModel },
    { jevModel },
    { crewModel },
    { webSearchModel, webSearchOrder },
    { queryExpansionModel },
    { summaryModels },
    { predictionModel },
    { transcriptionModelsForPushToTalk },
    { dictationModel },
    { conversationLearnModel },
    { realtimeModel, REALTIME_TRANSCRIPTION_MODEL },
    { ttsModel },
    { profileBootstrapModel },
    { evalJudgeModel },
  ] = await Promise.all([
    import("./flyd-worker-config.js"),
    import("./turn-plan.js"),
    import("../cognition/system-one/jev.js"),
    import("../crew/crew.js"),
    import("./personal-tools.js"),
    import("../lib/query-expansion.js"),
    import("../conversation-view/summaries.js"),
    import("../conversation-view/composer-predictions.js"),
    import("../transcription.js"),
    import("../dictation/cleanup.js"),
    import("../cognition/curator/content-learning.js"),
    import("../realtime-session.js"),
    import("../tts.js"),
    import("../commands/profile.js"),
    import("../evals/chat/scoring.js"),
  ]);
  const assignments: ModelAssignment[] = [];
  const add = (assignment: Omit<ModelAssignment, "setBy"> & { setBy?: string }): void => {
    assignments.push({ ...assignment, setBy: assignment.setBy ?? decidedBy(assignment.settings) });
  };

  const chain = attempt(chatModelChain) ?? [];
  const claudeChat = attempt(claudeChatModel);
  const chatSettings = ["FLYD_CLAUDE_CHAT_MODEL", ...CLAUDE_SETTINGS, "FLYD_CHAT_MODEL", "FLYD_MODEL", "FLYD_CHAT_FALLBACK_MODELS", ...COMMANDCODE_SETTINGS];
  add({
    job: "Chat: talking with George in the conversation window and the CLI, plus background jobs and scheduled agenda runs",
    model: chain[0] ?? "not configured (set FLYD_MODEL)",
    ...(chain.length > 1 ? { fallbacks: chain.slice(1) } : {}),
    settings: chatSettings,
    setBy: claudeDecidedBy(claudeChat, "FLYD_CLAUDE_CHAT_MODEL", setting("FLYD_CHAT_MODEL") ? "FLYD_CHAT_MODEL" : setting("FLYD_MODEL") ? "FLYD_MODEL (FLYD_CHAT_MODEL is not set)" : "code default"),
  });

  const main = attempt(defaultModel);
  const mainFallbacks = attempt(fallbackModelChain) ?? [];
  add({
    job: "One-shot thinking: memory curation and the council, the news edition and the morning brief",
    model: main ?? "not configured (set FLYD_MODEL)",
    ...(mainFallbacks.length ? { fallbacks: mainFallbacks } : {}),
    settings: ["FLYD_MODEL", "FLYD_CHAT_FALLBACK_MODELS", ...COMMANDCODE_SETTINGS],
  });

  const typesafe = Boolean(process.env.TYPESAFE_API_KEY?.trim());
  add({
    job: "Reading each chat turn (route, domain, whether it needs code), in about 0.3s",
    model: !typesafe ? `${turnRouteJevModel()} (off: no TYPESAFE_API_KEY)` : process.env.FLYD_JEV_TURN_ROUTE === "0" ? `${turnRouteJevModel()} (off: FLYD_JEV_TURN_ROUTE=0)` : turnRouteJevModel(),
    settings: ["FLYD_JEV_MODEL"],
  });
  add({
    job: "Other quick System-1 judgments",
    model: typesafe ? jevModel() : `${jevModel()} (off: no TYPESAFE_API_KEY)`,
    settings: ["FLYD_JEV_MODEL", "BEACON_JEV_MODEL"],
  });
  const quick = attempt(quickModelChain) ?? [];
  const claudeQuick = attempt(claudeQuickModel);
  const quickJobs = (job: string, override?: string): void => {
    const overridden = override ? setting(override) : undefined;
    add({
      job,
      model: overridden ?? quick[0] ?? "not configured (set FLYD_MODEL)",
      ...(!overridden && quick.length > 1 ? { fallbacks: quick.slice(1) } : {}),
      settings: [...(override ? [override] : []), "FLYD_CLAUDE_QUICK_MODEL", ...CLAUDE_SETTINGS, "FLYD_MODEL", "FLYD_CHAT_FALLBACK_MODELS", ...COMMANDCODE_SETTINGS],
      setBy: overridden ? override! : claudeDecidedBy(claudeQuick, "FLYD_CLAUDE_QUICK_MODEL", "FLYD_MODEL"),
    });
  };
  quickJobs("Reading the room before each chat reply when Jev is unsure", "FLYD_ROUTING_FALLBACK_MODEL");
  quickJobs("Deciding who answers a message in the window (Flyd or firstmate) when Jev is unsure, retelling firstmate's replies and artefacts, and the status line under a waiting message");

  const workers = attempt(() => loadFlydWorkerConfigs()) ?? [];
  add({
    job: "Overlay questions (fn key, text and voice), LIVE's look-ups and actions, and Core's coding worker",
    model: workers[0]?.providerIdentity ?? "not configured",
    ...(workers.length > 1 ? { fallbacks: workers.slice(1).map((worker) => worker.providerIdentity) } : {}),
    settings: ["FLYD_MODEL", "OPENCODE_MODEL", "OPENOCE_MODEL", "OPENROUTER_MODEL", ...COMMANDCODE_SETTINGS],
  });
  add({
    job: "Overlay route classifier",
    model: attempt(() => loadFlydRouterConfig())?.model ?? "off (keyword routing)",
    settings: ["FLYD_ROUTER_MODEL"],
  });
  add({
    job: "Coding crewmates (when FirstMate isn't installed; FirstMate picks its own models)",
    model: crewModel(),
    settings: ["FLYD_CREW_MODEL"],
  });

  const searches = webSearchOrder();
  add({
    job: "Web search",
    model: searches.length
      ? searches.map((search) => (search.name === "openai" ? `${search.label} on ${webSearchModel()}` : search.label)).join(", then ")
      : "none (no BRAVE_SEARCH_API_KEY, JINA_API_KEY or OPENAI_API_KEY)",
    settings: ["FLYD_WEB_SEARCH_MODEL"],
  });

  const qmd = qmdModels();
  const rewrite = attempt(() => queryExpansionModel());
  add({
    job: "Searching George's memory: rewriting the search, embedding and reranking, on this Mac",
    model: `query expansion ${qmd.expand}; embeddings ${qmd.embed}; reranking ${qmd.rerank}`,
    fallbacks: [rewrite ? `${rewrite} rewrites the search if the on-device expansion fails` : "the search runs on the words as typed if the on-device expansion fails (no Claude and no OPENAI_API_KEY)"],
    settings: ["QMD_EMBED_MODEL", "QMD_GENERATE_MODEL", "QMD_RERANK_MODEL"],
  });

  const summaryChain = summaryModels({ anthropicKey: claudeApiKey() });
  const summaries = summaryChain.map(({ model }) => model);
  const summarySettings = summaryChain[0]?.provider === "anthropic" ? ["FLYD_VIEW_ANTHROPIC_MODEL", "FLYD_CLAUDE_QUICK_MODEL"] : ["FLYD_VIEW_XAI_MODEL"];
  add({
    job: "Summaries of long replies in the window",
    model: process.env.FLYD_VIEW_SUMMARIES === "0" ? "off (FLYD_VIEW_SUMMARIES=0)" : summaries[0] ?? "none (no CLAUDE_API_KEY or XAI_API_KEY): long replies lead with Flyd's own briefing",
    ...(summaries.length > 1 ? { fallbacks: summaries.slice(1) } : {}),
    settings: ["FLYD_VIEW_ANTHROPIC_MODEL", "FLYD_CLAUDE_QUICK_MODEL", "FLYD_VIEW_XAI_MODEL"],
    setBy: decidedBy(summarySettings),
  });
  add({
    job: "Typing suggestions in the message box",
    model: getKey("FLYD_PREDICTIONS") === "0" ? "off (FLYD_PREDICTIONS=0)" : predictionModel(),
    settings: ["FLYD_PREDICTION_MODEL", "FLYD_CLAUDE_QUICK_MODEL"],
  });

  const transcription = transcriptionModelsForPushToTalk(process.env.FLYD_TRANSCRIPTION_MODEL);
  add({
    job: "Transcribing push-to-talk and dictation after he stops (no realtime session)",
    model: transcription[0]!,
    ...(transcription.length > 1 ? { fallbacks: transcription.slice(1) } : {}),
    settings: ["FLYD_TRANSCRIPTION_MODEL"],
  });
  add({
    job: "Cleaning up dictation before it's pasted",
    model: dictationModel() ?? "none (rule-based cleanup only)",
    settings: ["FLYD_DICTATE_MODEL"],
  });
  add({
    job: "Learning lessons from conversations",
    model: conversationLearnModel() ?? "none (rule-based extraction only)",
    settings: ["FLYD_CONVERSATION_LEARN_MODEL", "FLYD_DICTATE_MODEL"],
  });
  add({
    job: "LIVE voice sessions (Ctrl×3)",
    model: `${realtimeModel()}, transcribing George with ${REALTIME_TRANSCRIPTION_MODEL}`,
    settings: ["FLYD_REALTIME_MODEL"],
  });
  add({ job: "Speaking replies aloud", model: ttsModel(), settings: ["FLYD_TTS_MODEL"] });
  add({ job: "Drafting USER.md from George's captures (flyd profile bootstrap)", model: profileBootstrapModel(), settings: ["FLYD_PROFILE_MODEL"] });
  add({ job: "Grading chat evals", model: evalJudgeModel(), settings: ["FLYD_EVAL_JUDGE_MODEL"], dev: true });
  add({
    job: "Judging routing audits",
    model: setting("FLYD_ROUTING_JUDGE_MODEL") ?? "off (FLYD_ROUTING_JUDGE_MODEL is not set)",
    settings: ["FLYD_ROUTING_JUDGE_MODEL"],
    dev: true,
  });
  return assignments;
}

/** Switches that change what Flyd does; only the ones that are set are reported, the rest are at their code defaults. */
const SWITCHES = [
  "FLYD_AUTONOMY", "FLYD_COUNCIL", "FLYD_MUSE", "FLYD_SELF_IMPROVE", "FLYD_TASTE_LEARNING", "FLYD_TASTE_SKILLS",
  "FLYD_PROFILE_AUTOLEARN", "FLYD_ROUTING_CASCADE", "FLYD_ROUTING_LEARNING", "FLYD_ROOM", "FLYD_JEV_TURN_ROUTE",
  "FLYD_VIEW_SUMMARIES", "FLYD_SUMMARY_ALWAYS", "FLYD_AUTO_ANSWER", "FLYD_PREDICTIONS", "FLYD_FIRSTMATE",
  "FLYD_DELEGATION_ENABLED", "FLYD_TRANSITIONS_DISABLED", "FLYD_PROVIDER", "FLYD_CLAUDE", "FLYD_CLAUDE_MONTHLY_CAP_USD",
];

/** Keys that turn providers on: named when present, never shown. */
const PROVIDER_KEYS = [
  "FLYD_MODEL_API_KEY", "OPENAI_API_KEY", "CLAUDE_API_KEY", "ANTHROPIC_API_KEY", "OPENCODE_API_KEY", "OPENROUTER_API_KEY", "COMMANDCODE_API_KEY",
  "XAI_API_KEY", "TYPESAFE_API_KEY", "JINA_API_KEY", "BRAVE_SEARCH_API_KEY", "GITHUB_TOKEN", "X_BEARER_TOKEN",
];

/** A setting that holds a secret: its name ends like one (COMMANDCODE_API_KEY_MODEL names a model, not a key). */
const SECRET_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH|_API|COOKIE|SESSION)$/i;
const SECRET_SHAPE = /\b(?:sk|pk|rk|xai|ghp|gho|ghs|github_pat|AIza|tsk)[-_][A-Za-z0-9_-]{12,}\b|\b[A-Za-z0-9_-]{40,}\b/g;

/** Hides every secret value this process knows of, and anything shaped like a key. */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const [name, value] of Object.entries(env)) {
    const secret = value?.trim();
    if (secret && secret.length >= 8 && SECRET_NAME.test(name)) out = out.split(secret).join("[hidden]");
  }
  return out.replace(SECRET_SHAPE, "[hidden]");
}

/** This month's Claude spend against its cap; at the cap Claude drops out of every chain until the 1st. */
function claudeSpendLine(): string {
  const spend = attempt(() => spendStatus());
  if (!spend) return `Claude spend: unknown (${claudeState()}).`;
  return `Claude spend for ${spend.month}: $${spend.usd.toFixed(2)} of a $${spend.cap} monthly cap over ${spend.calls} calls (${claudeState()}; George is warned at 80%, and at the cap every job moves to its fallback until the 1st).`;
}

/** Flyd's setup as it reads to the chat model: every job with its model, the switches he set, which providers have keys. */
export async function flydSetupReport(now = new Date()): Promise<string> {
  const assignments = await flydModelAssignments();
  const line = (assignment: ModelAssignment): string =>
    `- ${assignment.job}: ${assignment.model} [${assignment.setBy}]${assignment.fallbacks?.length ? `; if it fails: ${assignment.fallbacks.join(", then ")}` : ""}`;
  const set = SWITCHES.flatMap((name) => {
    const value = setting(name);
    return value ? [`${name}=${value}`] : [];
  });
  const keys = PROVIDER_KEYS.filter((name) => setting(name));
  return redactSecrets([
    `Flyd's own setup, resolved from its live configuration at ${now.toISOString()} (environment and .env, then ~/.flyd/config.json, then code defaults). Setting names and model ids only; keys are never shown.`,
    "",
    "Models, by job:",
    ...assignments.filter((assignment) => !assignment.dev).map(line),
    "",
    "Development tools:",
    ...assignments.filter((assignment) => assignment.dev).map(line),
    "",
    claudeSpendLine(),
    `Switches set: ${set.length ? set.join(", ") : "none"}; everything else is at its code default.`,
    `Provider keys present (names only): ${keys.length ? keys.join(", ") : "none"}.`,
    `Flyd's own code and docs: ${FLYD_APPLICATION_ROOT} (AGENTS.md describes its features; read the code there for anything about Flyd not listed here).`,
  ].join("\n"));
}

const SETUP = String.raw`(?:models?|llms?|config(?:uration|ured)?|settings?|providers?|features?|capabilities)`;
const SELF_SETUP = [
  new RegExp(String.raw`\bflyd\b[\s\S]*\b(?:${SETUP}|running on|runs? on|powered by)\b|\b${SETUP}\b[\s\S]*\bflyd\b`, "i"),
  new RegExp(String.raw`\b(?:your|ur)\s+(?:own\s+)?${SETUP}\b`, "i"),
  new RegExp(String.raw`\b${SETUP}(?:\s+\w+){0,2}?\s+(?:are|do|did|have|is)\s+(?:you|u)(?:\s+(?:use|using|run|running|on|powered|built)\b|\s+(?:have|got)(?:\s+(?:configured|set up|enabled|installed|turned on|available)\b|\s*(?:[?.!]|$))|\s*(?:[?.!]|$))`, "i"),
  new RegExp(String.raw`\b(?:you|u)(?:'re|\s+are)?\s+(?:run(?:ning)?\s+on|powered by)\b`, "i"),
  new RegExp(String.raw`\b(?:you|u)\s+read\s+(?:the\s+|your\s+|ur\s+)?config(?:uration)?\b`, "i"),
];

/** A question about Flyd's own setup: its models, configuration or features, with Flyd plainly the one asked about. */
export function isFlydSetupQuestion(message: string): boolean {
  return SELF_SETUP.some((pattern) => pattern.test(message));
}

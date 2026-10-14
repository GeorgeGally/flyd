import { chatModelChain, quickModelChain } from "./config.js";
import { claudeApiKey, claudeHeaders, spendStatus, type SpendStatus } from "./claude-spend.js";

/** Which model does which job right now, and where this month's Claude spend stands. */
export interface ModelSetup {
  chat: string[];
  quick: string[];
  typing: string;
  crew: string;
  claude: { key: boolean; workspace: boolean; spend: SpendStatus };
}

function safe<T>(read: () => T, fallback: T): T {
  try { return read(); } catch { return fallback; }
}

export async function modelSetup(): Promise<ModelSetup> {
  const [{ predictionModel }, { crewModel }] = await Promise.all([
    import("../conversation-view/composer-predictions.js"),
    import("../crew/crew.js"),
  ]);
  return {
    chat: safe(chatModelChain, []),
    quick: safe(quickModelChain, []),
    typing: safe(predictionModel, "unconfigured"),
    crew: safe(() => crewModel() ?? "OpenCode's own default", "OpenCode's own default"),
    claude: { key: Boolean(claudeApiKey()), workspace: Object.keys(claudeHeaders()).length > 0, spend: spendStatus() },
  };
}

export function formatModelSetup(setup: ModelSetup): string {
  const { spend } = setup.claude;
  const sources = Object.entries(spend.bySource)
    .sort(([, a], [, b]) => b.usd - a.usd)
    .map(([source, value]) => `${source} $${value.usd.toFixed(2)}`)
    .join(", ");
  return [
    "Models (first answers, the rest are fallbacks)",
    `  chat     ${setup.chat.join(" → ") || "(none)"}`,
    `  quick    ${setup.quick.join(" → ") || "(none)"}   routing, rewrites, summaries, status lines`,
    `  typing   ${setup.typing}`,
    `  crew     ${setup.crew}`,
    `Claude: ${setup.claude.key ? "key set" : "no CLAUDE_API_KEY"}${setup.claude.workspace ? ", workspace set" : ""}; ${spend.month} spend $${spend.usd.toFixed(2)} of $${spend.cap}${spend.capped ? " (cap reached: on fallbacks until the 1st)" : ""}${sources ? ` (${sources})` : ""}`,
  ].join("\n");
}

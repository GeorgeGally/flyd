import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { modelSetup } from "../lib/model-setup.js";
import { realtimeModel } from "../lib/realtime-model.js";
import type { MachineTools } from "./machines.js";

// The Machines tab's models and usage: which model does which job (the same
// answer as `flyd doctor` and docs/product/flyd-models.md), this month's Claude
// spend from ~/.flyd/claude-spend.json, and how much each coding plan has left,
// read from Firstmate's quota-axi. quota-axi is another tool's output: Flyd only
// reads its JSON, never refreshes a credential through it, and shows nothing
// for a provider that is not set up. The newest Claude Code and Codex come from
// the npm registry, read at most every few hours, so the tab can say which
// machine is behind.

export interface SetupModel {
  /** What the model does, in a word or two: "Chat", "Quick jobs". */
  role: string;
  model: string;
}

export interface SetupUsage {
  provider: string;
  /** 0–100, what is left of the tightest window. */
  left: number;
  /** When that window resets, ISO. */
  resetsAt?: string;
  /** When the current pace runs it out before the reset, ISO. */
  runsOutAt?: string;
}

export interface MachineSetup {
  models: SetupModel[];
  spend?: { usd: number; cap: number; calls: number; capped: boolean };
  usage: SetupUsage[];
  /** When usage was read, ISO. */
  usageAt?: string;
  /** The newest release of each tool, from the npm registry. */
  latest?: MachineTools;
}

const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude", codex: "Codex", cursor: "Cursor", "opencode-go": "OpenCode Go", copilot: "Copilot", grok: "Grok",
  commandcode: "CommandCode", openrouter: "OpenRouter", deepseek: "DeepSeek", zai: "Z.ai", kimi: "Kimi",
};

const ROUTE_NAMES: Record<string, string> = { "opencode-go": "OpenCode Go", openrouter: "OpenRouter", commandcode: "CommandCode", cursor: "Cursor" };

/** A provider/model id as people say it: "anthropic:claude-sonnet-5-5" reads "Claude Sonnet 5.5", "opencode-go/gpt-6-luna" reads "GPT-6 Luna through OpenCode Go". */
export function modelName(id: string): string {
  const route = /^([a-z-]+)[:/]/i.exec(id)?.[1]?.toLowerCase();
  const bare = id.replace(/^[a-z-]+[:/]/i, "").split("/").pop() ?? id;
  const claude = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(bare);
  const gpt = /^gpt-([\d.]+)(?:-(.+))?$/i.exec(bare);
  const word = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
  const said = claude ? `Claude ${word(claude[1]!)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`
    : gpt && !/realtime/i.test(bare) ? `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].split("-").map(word).join(" ")}` : ""}`
      : /realtime/i.test(bare) ? bare : bare.split("-").map(word).join(" ");
  return route && ROUTE_NAMES[route] ? `${said} through ${ROUTE_NAMES[route]}` : said;
}

const PACKAGES: Record<keyof MachineTools, string> = { claude: "@anthropic-ai/claude-code", codex: "@openai/codex" };
const LATEST_FRESH_MS = 6 * 60 * 60 * 1000;

/** The newest published version of each tool, from the npm registry. A tool that cannot be read is left out. */
async function readLatest(): Promise<MachineTools> {
  const found: MachineTools = {};
  await Promise.all((Object.keys(PACKAGES) as Array<keyof MachineTools>).map(async (tool) => {
    try {
      const response = await fetch(`https://registry.npmjs.org/${PACKAGES[tool]}/latest`, { signal: AbortSignal.timeout(10_000) });
      const version = response.ok ? ((await response.json()) as { version?: unknown }).version : undefined;
      if (typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version)) found[tool] = version;
    } catch { /* left out */ }
  }));
  return found;
}

interface QuotaWindow { id?: string; resetsAt?: string; percentRemaining?: number }
interface QuotaProvider {
  provider?: string;
  notSetUp?: boolean;
  windows?: QuotaWindow[];
  state?: { status?: string };
  quotaSemantics?: { effectiveAvailability?: Array<{ scope?: string; effectivePercentRemaining?: number; limitingWindowIds?: string[]; runway?: { status?: string; projectedExhaustedAt?: string } }> };
}

/** quota-axi's --json as one row per provider that reported a number. Pure. */
export function usageFrom(raw: unknown): SetupUsage[] {
  const providers = (raw as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(providers)) return [];
  return (providers as QuotaProvider[]).flatMap((entry) => {
    if (!entry || entry.notSetUp || typeof entry.provider !== "string") return [];
    const all = (entry.quotaSemantics?.effectiveAvailability ?? []).find((one) => one.scope === "all_models") ?? entry.quotaSemantics?.effectiveAvailability?.[0];
    const windows = entry.windows ?? [];
    const tightest = [...windows].filter((window) => typeof window.percentRemaining === "number").sort((a, b) => a.percentRemaining! - b.percentRemaining!)[0];
    const left = typeof all?.effectivePercentRemaining === "number" ? all.effectivePercentRemaining : tightest?.percentRemaining;
    if (typeof left !== "number") return [];
    const limiting = windows.find((window) => all?.limitingWindowIds?.includes(window.id ?? "")) ?? tightest;
    const runsOut = all?.runway?.status === "projected_exhaustion" ? all.runway.projectedExhaustedAt : undefined;
    return [{
      provider: PROVIDER_NAMES[entry.provider] ?? entry.provider,
      left: Math.max(0, Math.min(100, Math.round(left))),
      ...(limiting?.resetsAt ? { resetsAt: limiting.resetsAt } : {}),
      ...(runsOut && limiting?.resetsAt && Date.parse(runsOut) < Date.parse(limiting.resetsAt) ? { runsOutAt: runsOut } : {}),
    }];
  });
}

const USAGE_FRESH_MS = 5 * 60 * 1000;

function readQuota(): Promise<unknown> {
  return new Promise((resolve) => {
    const path = [process.env.PATH, join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(delimiter);
    execFile("quota-axi", ["--json", "--max-age", "5m", "--no-credential-refresh"], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, PATH: path } }, (error, stdout) => {
      if (error) { resolve(null); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

/** Keeps the last usage read; asking never waits on a new one. */
export class MachineSetupReader {
  private usage: SetupUsage[] = [];
  private usageAt = 0;
  private reading = false;
  private latest: MachineTools = {};
  private latestAt = 0;
  private latestReading = false;

  constructor(private readonly quota: () => Promise<unknown> = readQuota, private readonly newest: () => Promise<MachineTools> = readLatest) {}

  private refreshLatest(): void {
    if (this.latestReading || Date.now() - this.latestAt < LATEST_FRESH_MS) return;
    this.latestReading = true;
    void this.newest().then((found) => {
      if (Object.keys(found).length) { this.latest = found; this.latestAt = Date.now(); }
    }).catch(() => {}).finally(() => { this.latestReading = false; });
  }

  private refreshUsage(): void {
    if (this.reading || Date.now() - this.usageAt < USAGE_FRESH_MS) return;
    this.reading = true;
    void this.quota().then((raw) => {
      if (!raw || typeof raw !== "object" || !("providers" in raw) || !Array.isArray(raw.providers)) return;
      this.usage = usageFrom(raw);
      this.usageAt = Date.now();
    }).catch(() => {}).finally(() => { this.reading = false; });
  }

  async read(): Promise<MachineSetup> {
    this.refreshUsage();
    this.refreshLatest();
    const setup = await modelSetup().catch(() => null);
    const live = realtimeModel();
    const models: SetupModel[] = setup ? [
      ...(setup.chat[0] ? [{ role: "Chat", model: modelName(setup.chat[0]) }] : []),
      ...(setup.quick[0] ? [{ role: "Quick jobs", model: modelName(setup.quick[0]) }] : []),
      ...(setup.crew ? [{ role: "Coding crews", model: modelName(setup.crew) }] : []),
      ...(setup.typing && setup.typing !== "unconfigured" ? [{ role: "Typing", model: modelName(setup.typing) }] : []),
      ...(live ? [{ role: "LIVE voice", model: live }] : []),
    ] : [];
    const spend = setup?.claude.spend;
    return {
      models,
      ...(spend ? { spend: { usd: spend.usd, cap: spend.cap, calls: spend.calls, capped: spend.capped } } : {}),
      usage: this.usage,
      ...(this.usage.length ? { usageAt: new Date(this.usageAt).toISOString() } : {}),
      ...(Object.keys(this.latest).length ? { latest: this.latest } : {}),
    };
  }
}

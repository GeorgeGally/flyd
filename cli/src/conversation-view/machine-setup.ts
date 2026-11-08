import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { modelSetup } from "../lib/model-setup.js";

// The Machines tab's models and usage: which model does which job (the same
// answer as `flyd doctor` and docs/product/flyd-models.md), this month's Claude
// spend from ~/.flyd/claude-spend.json, and how much each coding plan has left,
// read from Firstmate's quota-axi. quota-axi is another tool's output: Flyd only
// reads its JSON, never refreshes a credential through it, and shows nothing
// for a provider that is not set up.

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
}

const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude", codex: "Codex", cursor: "Cursor", "opencode-go": "OpenCode Go", copilot: "Copilot", grok: "Grok",
  commandcode: "CommandCode", openrouter: "OpenRouter", deepseek: "DeepSeek", zai: "Z.ai", kimi: "Kimi",
};

/** A provider/model id as people say it: "anthropic:claude-sonnet-5-5" reads "claude-sonnet-5-5". */
function modelName(id: string): string {
  return id.replace(/^[a-z-]+[:/]/i, "");
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

const QUOTA_BIN = join(homedir(), ".local", "bin", "quota-axi");
const USAGE_FRESH_MS = 5 * 60 * 1000;

function readQuota(): Promise<unknown> {
  return new Promise((resolve) => {
    if (!existsSync(QUOTA_BIN)) { resolve(null); return; }
    execFile(QUOTA_BIN, ["--json", "--max-age", "5m", "--no-credential-refresh"], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error && !stdout) { resolve(null); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

/** Keeps the last usage read; asking never waits on a new one. */
export class MachineSetupReader {
  private usage: SetupUsage[] = [];
  private usageAt = 0;
  private reading = false;

  constructor(private readonly quota: () => Promise<unknown> = readQuota) {}

  private refreshUsage(): void {
    if (this.reading || Date.now() - this.usageAt < USAGE_FRESH_MS) return;
    this.reading = true;
    void this.quota().then((raw) => {
      const usage = usageFrom(raw);
      if (usage.length) this.usage = usage;
      this.usageAt = Date.now();
    }).finally(() => { this.reading = false; });
  }

  async read(): Promise<MachineSetup> {
    this.refreshUsage();
    const setup = await modelSetup().catch(() => null);
    const models: SetupModel[] = setup ? [
      ...(setup.chat[0] ? [{ role: "Chat", model: modelName(setup.chat[0]) }] : []),
      ...(setup.quick[0] ? [{ role: "Quick jobs", model: modelName(setup.quick[0]) }] : []),
      ...(setup.crew ? [{ role: "Coding crews", model: modelName(setup.crew) }] : []),
      ...(setup.typing && setup.typing !== "unconfigured" ? [{ role: "Typing", model: modelName(setup.typing) }] : []),
    ] : [];
    const spend = setup?.claude.spend;
    return {
      models,
      ...(spend ? { spend: { usd: spend.usd, cap: spend.cap, calls: spend.calls, capped: spend.capped } } : {}),
      usage: this.usage,
      ...(this.usage.length ? { usageAt: new Date(this.usageAt).toISOString() } : {}),
    };
  }
}

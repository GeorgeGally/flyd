import { execFile } from "node:child_process";

// The Claude plan's usage limits (session and weekly windows), read with
// quota-axi. Read-only: never prompts for the Keychain and never refreshes a
// credential, so when quota-axi cannot read Claude quietly there is simply
// nothing to show.

export interface PlanWindow {
  label: string;
  percentRemaining: number;
  resetsAt?: string;
}

export interface PlanUsage {
  source: string;
  windows: PlanWindow[];
}

const REFRESH_MS = 5 * 60 * 1000;
const ARGS = ["--provider", "claude", "--json", "--no-credential-refresh", "--max-age", "10m"];

type Runner = (args: string[]) => Promise<string>;

function runQuotaAxi(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("quota-axi", args, { timeout: 30_000, maxBuffer: 1 << 20 }, (error, stdout) => (error && !stdout ? reject(error) : resolve(stdout)));
  });
}

/** The Claude windows from quota-axi's JSON, or null when it has none to give. */
export function parsePlanUsage(json: string): PlanUsage | null {
  try {
    const report = JSON.parse(json) as { providers?: Array<{ provider?: string; windows?: unknown[] }> };
    const claude = report.providers?.find((provider) => provider.provider === "claude");
    const windows = (claude?.windows ?? []).flatMap((raw): PlanWindow[] => {
      const window = raw as { label?: unknown; id?: unknown; percentRemaining?: unknown; resetsAt?: unknown };
      if (typeof window.percentRemaining !== "number") return [];
      const label = typeof window.label === "string" ? window.label : typeof window.id === "string" ? window.id : "limit";
      return [{ label, percentRemaining: window.percentRemaining, ...(typeof window.resetsAt === "string" ? { resetsAt: window.resetsAt } : {}) }];
    });
    return windows.length ? { source: "quota-axi", windows } : null;
  } catch {
    return null;
  }
}

/** Keeps the latest reading, refreshed in the background. */
export class PlanUsageReader {
  private latest: PlanUsage | null = null;
  private timer?: NodeJS.Timeout;

  constructor(private readonly run: Runner = runQuotaAxi) {}

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<PlanUsage | null> {
    try {
      this.latest = parsePlanUsage(await this.run(ARGS));
    } catch {
      this.latest = null;
    }
    return this.latest;
  }

  current(): PlanUsage | null {
    return this.latest;
  }
}

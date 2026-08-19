import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { listGoals, listPatterns } from './coach-memory.js';
import { listJournalEntries } from '../work-intelligence/outcome-journal.js';
import { FLYD_DIR } from '../lib/config.js';
import type { AgentSituation } from './agent-session.js';

const execFileAsync = promisify(execFile);

export interface DailyBriefDeps {
  situation?: AgentSituation | null;
  last30daysScript?: string;
  last30daysTopics?: string[];
  now?: () => Date;
}

export interface DailyBrief {
  heading: string;
  state: string[];
  external: string[];
  degraded: boolean;
}

const DEFAULT_TOPICS = ['ai agents', 'software engineering'];

export function dailyBriefFile(): string {
  return join(FLYD_DIR, 'overlay', 'daily-brief.md');
}

// Compose the always-available, local-value half of the brief: what is
// actually on George's plate right now. Never blocks on network.
export function composeStateBrief(situation?: AgentSituation | null): string[] {
  const lines: string[] = [];

  const goals = listGoals();
  if (goals.length) {
    lines.push(`Goals: ${goals.map((g) => g.statement).join(" | ")}`);
  } else {
    lines.push("No active goals recorded — tell me a goal and I'll hold you to it.");
  }

  if (situation?.nextAction) {
    const next = situation.nextAction.trim();
    if (next && !/^(?:so\s+)?(?:how|why|what|when|where|who)\b|[?？]\s*$/i.test(next)) {
      lines.push(`Next: ${next}.`);
    }
  } else if (situation?.status === "blocked") {
    lines.push("You have a blocked task — say 'resume' to pick it up.");
  }

  const patterns = listPatterns().slice(0, 3);
  if (patterns.length) {
    lines.push(`Patterns I'm watching: ${patterns.map((p) => p.observation).join(" | ")}`);
  }

  try {
    const recent = listJournalEntries({ limit: 3 });
    if (recent.length) {
      const kinds = recent.map((e) => e.eventType).join(", ");
      lines.push(`Recent activity: ${kinds}`);
    }
  } catch {
    // journal read is best-effort
  }

  return lines;
}

// Pull current external signal via last30days for the topics George cares
// about. Degrades gracefully to empty when the engine or key is unavailable —
// the brief must never hang or fail the session.
export async function composeExternalBrief(deps: DailyBriefDeps): Promise<{
  lines: string[];
  degraded: boolean;
}> {
  const script = deps.last30daysScript;
  if (!script || !existsSync(script)) {
    return { lines: [], degraded: false };
  }
  const topics = deps.last30daysTopics?.length ? deps.last30daysTopics : DEFAULT_TOPICS;
  const lines: string[] = [];
  let degraded = false;

  for (const topic of topics.slice(0, 3)) {
    try {
      const { stdout } = await execFileAsync("python3", [script, topic, "--emit=json"], {
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout) as {
        title?: string;
        summary?: string;
        key_findings?: string[];
      };
      const title = parsed.title ?? topic;
      const summary = parsed.summary ?? "";
      const findings = parsed.key_findings?.slice(0, 3) ?? [];
      if (summary || findings.length) {
        lines.push(`— ${title}: ${summary}`);
        for (const f of findings) lines.push(`  · ${f}`);
      }
    } catch {
      degraded = true;
    }
  }

  return { lines, degraded };
}

export async function composeDailyBrief(deps: DailyBriefDeps = {}): Promise<DailyBrief> {
  const state = composeStateBrief(deps.situation);
  const { lines: external, degraded } = await composeExternalBrief(deps);
  const time = deps.now ? deps.now().toLocaleString() : new Date().toLocaleString();

  const heading = external.length
    ? `Daily brief — ${time}`
    : `Daily brief — ${time} (local)`;

  return { heading, state, external, degraded };
}

export function briefToMarkdown(brief: DailyBrief): string {
  return [
    `# ${brief.heading}`,
    "",
    ...brief.state,
    ...(brief.external.length ? ["", "## Current signal", ...brief.external] : []),
  ].join("\n");
}

export function persistDailyBrief(brief: DailyBrief, file = dailyBriefFile()): string {
  const dir = resolvePath(file, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const body = briefToMarkdown(brief);
  writeFileSync(file, body, { encoding: "utf-8", mode: 0o600 });
  return file;
}

export interface LatestBrief {
  body: string;
  writtenAt: number;
}

export function readLatestBrief(file = dailyBriefFile(), maxAgeMs = 12 * 60 * 60 * 1000): LatestBrief | null {
  if (!existsSync(file)) return null;
  try {
    const writtenAt = statSync(file).mtimeMs;
    if (Date.now() - writtenAt > maxAgeMs) return null;
    return { body: readFileSync(file, "utf-8"), writtenAt };
  } catch {
    return null;
  }
}

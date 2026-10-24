import type { AgendaItem } from "./agenda.js";
import { carriesUntoldNews, composeMorning, isMorningBriefTask, markNewsTold, morningBriefFacts } from "./session-briefing.js";
import { startCommandScheduler, stopCommandScheduler } from "../command/scheduler.js";
import { startStaffMonitor, stopStaffMonitor } from "../command/fleet-monitor.js";

// Runs one due agenda item as an unattended agent turn. Nobody is there to
// approve anything, so actions the policy would ask about are refused and
// reported; reads, searches, and summaries run normally.
export async function runAgendaTask(task: string, item: AgendaItem, onTool?: (name: string) => void): Promise<string> {
  const { respondToConversation } = await import("./conversation-responder.js");
  const { retrieveAgentMemory, loadAgentSituation } = await import("../commands/code.js");
  const { refreshRepoRegistry } = await import("./repo-registry.js");
  const situation = await loadAgentSituation().catch(() => null);
  const crossRepo = await refreshRepoRegistry(situation?.projectRoot).catch(() => []);
  const memory = await retrieveAgentMemory(task).catch(() => ({ verdict: "insufficient" as const, matches: [] }));
  // His morning brief is written from the one composed morning (session-briefing.ts), news included.
  const morning = isMorningBriefTask(task)
    ? await composeMorning({ peek: true, background: true }).catch(() => [])
    : [];
  const answer = await respondToConversation({
    sessionId: `agenda-${item.id}`,
    turnNumber: item.runs + 1,
    message: agendaTaskMessage(task, item, morning),
    history: [],
    memory,
    situation,
    crossRepo,
    onToken: () => {},
    ...(onTool ? { onTool } : {}),
  });
  // The brief reaches him as a notification: the news in it has now been told.
  if (carriesUntoldNews(morning)) await markNewsTold().catch(() => undefined);
  return answer;
}

/** The unattended turn's instructions; a morning brief carries the composed morning as its facts. */
export function agendaTaskMessage(task: string, item: Pick<AgendaItem, "repeat">, morning: string[] = []): string {
  return [
    `Scheduled task George set up earlier (${item.repeat === "none" ? "one-off" : item.repeat}): ${task}`,
    "Do it now. George is not at the keyboard: anything needing his approval, describe instead of doing.",
    ...morningBriefFacts(morning),
    `Report the outcome in at most ${morning.length ? 8 : 6} short lines, most important first. If nothing needs his attention, say so in one line.`,
  ].join("\n");
}

let agendaTimer: ReturnType<typeof setInterval> | null = null;

/** Core-hosted agenda loop; the shared lock keeps it from racing the launchd runner. */
export function startAgendaScheduler(options: { intervalMs?: number; onError?: (error: unknown) => void } = {}): () => void {
  stopAgendaScheduler();
  startCommandScheduler({ onError: options.onError });
  // Flyd watches its coding staff: what is under way, stuck or waiting (command/fleet-monitor.ts).
  startStaffMonitor({ onError: options.onError });
  // One shared tick (runtime/agenda-tick.ts): each job isolated, model jobs wait out a usage-limit backoff.
  const tick = () => {
    void import("./agenda-tick.js")
      .then(({ runAgendaTick }) => runAgendaTick({ log: (line) => console.log(`[Flyd Core] tick ${line}`) }))
      .catch((error) => options.onError?.(error));
  };
  agendaTimer = setInterval(tick, options.intervalMs ?? 5 * 60 * 1000);
  agendaTimer.unref();
  tick();
  return stopAgendaScheduler;
}

export function stopAgendaScheduler(): void {
  if (agendaTimer) clearInterval(agendaTimer);
  agendaTimer = null;
  stopCommandScheduler();
  stopStaffMonitor();
}

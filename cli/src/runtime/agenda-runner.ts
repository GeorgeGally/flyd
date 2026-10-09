import type { AgendaItem } from "./agenda.js";
import { startCommandScheduler, stopCommandScheduler } from "../command/scheduler.js";

// Runs one due agenda item as an unattended agent turn. Nobody is there to
// approve anything, so actions the policy would ask about are refused and
// reported; reads, searches, and summaries run normally.
export async function runAgendaTask(task: string, item: AgendaItem): Promise<string> {
  const { respondToConversation } = await import("./conversation-responder.js");
  const { retrieveAgentMemory, loadAgentSituation } = await import("../commands/code.js");
  const { refreshRepoRegistry } = await import("./repo-registry.js");
  const situation = await loadAgentSituation().catch(() => null);
  const crossRepo = await refreshRepoRegistry(situation?.projectRoot).catch(() => []);
  const memory = await retrieveAgentMemory(task).catch(() => ({ verdict: "insufficient" as const, matches: [] }));
  const message = [
    `Scheduled task George set up earlier (${item.repeat === "none" ? "one-off" : item.repeat}): ${task}`,
    "Do it now. George is not at the keyboard: anything needing his approval, describe instead of doing.",
    "Report the outcome in at most 6 short lines, most important first. If nothing needs his attention, say so in one line.",
  ].join("\n");
  return respondToConversation({
    sessionId: `agenda-${item.id}`,
    turnNumber: item.runs + 1,
    message,
    history: [],
    memory,
    situation,
    crossRepo,
    onToken: () => {},
  });
}

let agendaTimer: ReturnType<typeof setInterval> | null = null;

/** Core-hosted agenda loop; the shared lock keeps it from racing the launchd runner. */
export function startAgendaScheduler(options: { intervalMs?: number; onError?: (error: unknown) => void } = {}): () => void {
  stopAgendaScheduler();
  startCommandScheduler({ onError: options.onError });
  const tick = () => {
    void import("./agenda.js")
      .then(({ runDueAgenda }) => runDueAgenda({ runTask: runAgendaTask }))
      .then(async () => {
        const [{ runCouncilPass }, { query }, { notifyMac }] = await Promise.all([
          import("../council/council.js"), import("../lib/llm.js"), import("./agenda.js"),
        ]);
        await runCouncilPass({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }), notify: notifyMac });
        const { superviseCrew } = await import("../crew/crew.js");
        await superviseCrew({ notify: notifyMac });
        // Learn George's taste from his own turns in his Claude Code sessions (council/taste.ts).
        const { learnTaste } = await import("../council/taste.js");
        await learnTaste({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }) }).catch(() => undefined);
        const [{ investigate }, { runPersonalTool }] = await Promise.all([import("../council/investigator.js"), import("./personal-tools.js")]);
        await investigate({
          complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }),
          calendar: (from, days) => runPersonalTool("calendar_events", { from, days }),
          reminders: () => runPersonalTool("reminders", { action: "list" }),
          recall: (text) => runPersonalTool("recall", { query: text }),
          otherAssistants: async () => {
            const { readFileSync } = await import("node:fs");
            const { homedir } = await import("node:os");
            const files = [".hermes/memories/USER.md", ".hermes/memories/MEMORY.md", ".openclaw/workspace/USER.md", ".openclaw/workspace/MEMORY.md"];
            return files.map((file) => { try { return readFileSync(`${homedir()}/${file}`, "utf8"); } catch { return ""; } }).join("\n\n");
          },
        }).catch(() => undefined);
        const { backfillArchive } = await import("../council/investigator.js");
        await backfillArchive({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }) }).catch(() => undefined);
        const { runSelfImprovement } = await import("../crew/self-improve.js");
        await runSelfImprovement({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }), notify: notifyMac }).catch(() => undefined);
        const { scoutTick } = await import("../council/scout.js");
        await scoutTick({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }), notify: notifyMac });
        // Have the morning ready before George is up (council/morning.ts).
        const [{ prepareMorning }, { composeSessionBriefing }, { museGreeting }, { readUserProfile }, scout, { localDay }] = await Promise.all([
          import("../council/morning.js"), import("./session-briefing.js"), import("../council/greeting.js"),
          import("../lib/user-profile.js"), import("../council/scout.js"), import("../council/memory-store.js"),
        ]);
        await prepareMorning({
          briefing: (now) => composeSessionBriefing({ now: () => now, peek: true }),
          compose: (briefing, now) => museGreeting({ briefing, now, profile: (() => { try { return readUserProfile(); } catch { return null; } })() }, (prompt) => query(prompt)),
          newsReady: (now) => scout.latestEdition()?.date === localDay(now),
        }).catch(() => undefined);
      })
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
}

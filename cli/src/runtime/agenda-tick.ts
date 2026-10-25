import { guardModelCall, isUsageLimitError, ModelBackoffActive, readModelBackoff, recordModelBackoff } from "./model-backoff.js";

// One background tick, shared by Core's 5-minute loop and launchd's
// `flyd agenda run-due`. Every job runs in isolation: one failing (a model's
// weekly limit, a bad file) never skips the jobs after it. While models are
// backed off after a usage limit, model-calling jobs wait instead of retrying.

export interface TickJob {
  name: string;
  /** Calls a model; skipped while the global model backoff is active. */
  usesModel: boolean;
  /** Returns a line worth logging, or nothing. */
  run(): Promise<string | void | null | undefined>;
}

export interface TickOptions {
  log?: (line: string) => void;
  now?: () => Date;
  backoffPath?: string;
}

export interface TickJobResult { name: string; status: "ok" | "failed" | "skipped"; detail?: string }

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runTickJobs(jobs: TickJob[], options: TickOptions = {}): Promise<TickJobResult[]> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const results: TickJobResult[] = [];
  let announcedBackoff = false;
  for (const job of jobs) {
    if (job.usesModel) {
      const backoff = readModelBackoff(now(), options.backoffPath);
      if (backoff) {
        if (!announcedBackoff) log(`models backed off until ${backoff.until}: model jobs wait`);
        announcedBackoff = true;
        results.push({ name: job.name, status: "skipped", detail: "model backoff" });
        continue;
      }
    }
    try {
      const line = await job.run();
      if (line) log(`${job.name}: ${line}`);
      results.push({ name: job.name, status: "ok", ...(line ? { detail: line } : {}) });
    } catch (error) {
      if (error instanceof ModelBackoffActive) {
        results.push({ name: job.name, status: "skipped", detail: "model backoff" });
        continue;
      }
      if (isUsageLimitError(error) && !readModelBackoff(now(), options.backoffPath)) {
        const backoff = recordModelBackoff(error, now(), options.backoffPath);
        log(`usage limit hit; models backed off until ${backoff.until}`);
      }
      log(`${job.name} failed: ${message(error)}`);
      results.push({ name: job.name, status: "failed", detail: message(error) });
    }
  }
  return results;
}

/** The real tick's jobs, in order. */
export async function defaultTickJobs(options: { now?: () => Date; backoffPath?: string } = {}): Promise<TickJob[]> {
  const [{ query }, { notifyMac }] = await Promise.all([import("../lib/llm.js"), import("./agenda.js")]);
  const guard = { ...(options.now ? { now: options.now } : {}), ...(options.backoffPath ? { path: options.backoffPath } : {}) };
  const complete = guardModelCall((prompt: string) => query(prompt, undefined, undefined, undefined, undefined, { json: true }), guard);
  const prose = guardModelCall((prompt: string) => query(prompt), guard);
  return [
    {
      // A read-only Claude Code audit, once a week; it calls no Flyd model.
      name: "weekly-audit",
      usesModel: false,
      run: async () => (await import("./weekly-audit.js")).startWeeklyAuditIfDue(),
    },
    {
      // George's own scheduled tasks: they have their own retry/failure handling and
      // the chat failover chain, so they are not held back by the background backoff.
      name: "agenda", usesModel: false,
      run: async () => {
        const [{ runDueAgenda }, { runAgendaTask }] = await Promise.all([import("./agenda.js"), import("./agenda-runner.js")]);
        const result = await runDueAgenda({ runTask: runAgendaTask });
        const lines = result.ran.map((ran) => `${ran.status} ${ran.id} ${ran.task}`);
        if (result.skipped) lines.unshift("another agenda run is in progress");
        return lines.join("\n");
      },
    },
    {
      name: "council", usesModel: true,
      run: async () => {
        if (process.env.FLYD_COUNCIL === "0") return;
        const { runCouncilPass } = await import("../council/council.js");
        const council = await runCouncilPass({ complete, notify: notifyMac });
        if (council.skipped) return;
        return `${council.librarian?.turns ?? 0} turns, ${council.librarian?.captures ?? 0} captures, ${council.advisories.length} advisories`;
      },
    },
    {
      name: "crew", usesModel: false,
      run: async () => {
        const { superviseCrew } = await import("../crew/crew.js");
        return (await superviseCrew({ notify: notifyMac })).map((task) => `${task.id} ${task.status}`).join("; ");
      },
    },
    {
      // Learn George's taste from his own turns in his Claude Code sessions (council/taste.ts).
      name: "taste", usesModel: true,
      run: async () => {
        const { learnTaste } = await import("../council/taste.js");
        await learnTaste({ complete });
      },
    },
    {
      // …and carry it to every agent as skills (council/taste-skills.ts).
      name: "taste-skills", usesModel: false,
      run: async () => {
        const { syncTasteSkills } = await import("../council/taste-skills.js");
        syncTasteSkills();
      },
    },
    {
      name: "investigator", usesModel: true,
      run: async () => {
        const [{ investigate }, { runPersonalTool }] = await Promise.all([import("../council/investigator.js"), import("./personal-tools.js")]);
        const learned = await investigate({
          complete,
          calendar: (from, days) => runPersonalTool("calendar_events", { from, days }, { background: true }),
          reminders: () => runPersonalTool("reminders", { action: "list" }, { background: true }),
          recall: (text) => runPersonalTool("recall", { query: text }),
          otherAssistants: async () => {
            const { readFileSync } = await import("node:fs");
            const { homedir } = await import("node:os");
            const files = [".hermes/memories/USER.md", ".hermes/memories/MEMORY.md", ".openclaw/workspace/USER.md", ".openclaw/workspace/MEMORY.md"];
            return files.map((file) => { try { return readFileSync(`${homedir()}/${file}`, "utf8"); } catch { return ""; } }).join("\n\n");
          },
        });
        return learned.status === "not_due" ? undefined : learned.status;
      },
    },
    {
      name: "backfill", usesModel: true,
      run: async () => {
        const { backfillArchive } = await import("../council/investigator.js");
        await backfillArchive({ complete });
      },
    },
    {
      // Read back what George was shown against the chief-of-staff standard; shortfalls feed the improver.
      name: "self-review", usesModel: false,
      run: async () => {
        const { runReplyReview } = await import("../council/reply-review.js");
        const review = await runReplyReview();
        return review.reviewed || review.status !== "reviewed" ? `${review.status}, ${review.reviewed} reviewed, ${review.shortfalls} short` : undefined;
      },
    },
    {
      // Daily consolidation of experience traces into candidate insights; analysis only.
      name: "dream", usesModel: false,
      run: async () => {
        const { runDreamCycle } = await import("../intelligence/dream/cycle.js");
        await runDreamCycle();
      },
    },
    {
      name: "self-improve", usesModel: true,
      run: async () => {
        const { runSelfImprovement } = await import("../crew/self-improve.js");
        const improved = await runSelfImprovement({ complete, notify: notifyMac });
        return improved.status === "not_due" ? undefined : improved.status;
      },
    },
    {
      name: "scout", usesModel: true,
      run: async () => {
        const [{ scoutTick, editionActivityRecord }, { recordActivity }] = await Promise.all([
          import("../council/scout.js"), import("../conversation-view/activity.js"),
        ]);
        const log = await scoutTick({ complete, notify: notifyMac, record: (edition) => recordActivity(editionActivityRecord(edition)) });
        return log.join("; ");
      },
    },
    {
      // Have the morning ready before George is up (council/morning.ts).
      name: "morning", usesModel: true,
      run: async () => {
        const [{ prepareMorning }, { composeMorning }, { museGreeting }, { readUserProfile }, scout, { localDay }] = await Promise.all([
          import("../council/morning.js"), import("./session-briefing.js"), import("../council/greeting.js"),
          import("../lib/user-profile.js"), import("../council/scout.js"), import("../council/memory-store.js"),
        ]);
        await prepareMorning({
          briefing: (now) => composeMorning({ now: () => now, peek: true, background: true }),
          compose: (briefing, now) => museGreeting({ briefing, now, profile: (() => { try { return readUserProfile(); } catch { return null; } })() }, prose),
          newsReady: (now) => scout.latestEdition()?.date === localDay(now),
        });
      },
    },
  ];
}

/** One full background tick (Core loop and launchd runner). */
export async function runAgendaTick(options: TickOptions = {}): Promise<TickJobResult[]> {
  const jobs = await defaultTickJobs({ ...(options.now ? { now: options.now } : {}), ...(options.backoffPath ? { backoffPath: options.backoffPath } : {}) });
  return runTickJobs(jobs, options);
}

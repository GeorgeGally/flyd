import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// Work Flyd takes on while the conversation carries on: generating, drafting,
// researching, building. Each job is an unattended agent turn with a long
// budget; its result comes back into the chat the moment it finishes (and to
// the inbox and a notification), in Flyd's own voice.

export interface JobResult { id: string; task: string; status: "ok" | "failed"; result: string }

export const jobEvents = new EventEmitter();
const running = new Map<string, string>();

export function runningJobs(): string[] {
  return [...running.values()];
}

export function jobMessage(task: string): string {
  return [
    `Background job you took on for George: ${task}`,
    "Do it fully now. Run what needs running (bash accepts timeout_seconds up to 1800 for long steps), look at what came out, and judge it honestly against what he wants.",
    "He isn't watching: anything that needs his approval, describe instead of doing.",
    "Report back in a few plain sentences: what you made, how good it is and why, and where to find it.",
  ].join("\n");
}

export interface JobDependencies {
  run(task: string, id: string): Promise<string>;
  deliver?(result: JobResult): Promise<void>;
}

/** Start a job and return at once; the result arrives on jobEvents("done"). */
export const MAX_RUNNING_JOBS = 3;

export function startBackgroundJob(task: string, deps: JobDependencies): string {
  // A job can start jobs; the cap keeps that from running away.
  if (running.size >= MAX_RUNNING_JOBS) throw new Error(`already running ${running.size} background jobs; finish or wait for one first`);
  const id = randomUUID().slice(0, 8);
  running.set(id, task);
  void deps.run(task, id)
    .then((result) => ({ id, task, status: "ok" as const, result: result.trim() || "(no result)" }))
    .catch((error: unknown) => ({ id, task, status: "failed" as const, result: `Couldn't finish: ${error instanceof Error ? error.message : String(error)}` }))
    .then(async (done) => {
      running.delete(id);
      await deps.deliver?.(done).catch(() => undefined);
      jobEvents.emit("done", done);
    });
  return id;
}

/** The real runner: an unattended Flyd turn with the job budget. */
export async function runJobTurn(task: string, id: string): Promise<string> {
  const [{ respondToConversation }, { retrieveAgentMemory, loadAgentSituation }, { refreshRepoRegistry }] = await Promise.all([
    import("./conversation-responder.js"), import("../commands/code.js"), import("./repo-registry.js"),
  ]);
  const situation = await loadAgentSituation().catch(() => null);
  const crossRepo = await refreshRepoRegistry(situation?.projectRoot).catch(() => []);
  const memory = await retrieveAgentMemory(task).catch(() => ({ verdict: "insufficient" as const, matches: [] }));
  return respondToConversation({
    sessionId: `job-${id}`, turnNumber: 1, message: jobMessage(task), history: [], memory, situation, crossRepo, onToken: () => {},
  });
}

/** Inbox + notification, so a result is never lost if the chat has closed. */
export async function deliverJob(result: JobResult): Promise<void> {
  const agenda = await import("./agenda.js");
  agenda.recordInbox({ itemId: `job-${result.id}`, task: result.task, status: result.status, result: result.result });
  await agenda.notifyMac("Flyd", `${result.task.slice(0, 60)}: ${result.result.slice(0, 180)}`);
}

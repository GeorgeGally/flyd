import { gatherEvidence, runSelfImprovement, selfImproveStatus } from "../crew/self-improve.js";

export async function runImproveCommand(action = "status", options: { force?: boolean } = {}): Promise<void> {
  switch (action) {
    case "status": {
      const { lastRunAt, attempts } = selfImproveStatus();
      const { listTasks, describeTask } = await import("../crew/crew.js");
      const tasks = new Map(listTasks().map((task) => [task.id, task]));
      process.stdout.write(`Last run: ${lastRunAt ?? "never"}\n`);
      process.stdout.write(attempts.length
        ? `${attempts.slice(-10).map((attempt) => {
          const task = attempt.taskId ? tasks.get(attempt.taskId) : undefined;
          return `${attempt.at.slice(0, 10)} ${attempt.title}${task ? `\n  ${describeTask(task)}` : ""}`;
        }).join("\n")}\n`
        : "No self-improvement attempts yet.\n");
      return;
    }
    case "evidence": {
      const evidence = gatherEvidence();
      process.stdout.write(evidence.length ? `${evidence.map((item) => `[${item.id}] ${item.text}`).join("\n")}\n` : "No evidence of shortfalls in the last 14 days.\n");
      return;
    }
    case "run": {
      const { query } = await import("../lib/llm.js");
      const { notifyMac } = await import("../runtime/agenda.js");
      const result = await runSelfImprovement({
        complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }),
        notify: notifyMac,
        force: options.force ?? true,
      });
      process.stdout.write(result.status === "dispatched"
        ? `Dispatched: ${result.improvement!.title}\nTask ${result.task!.id} on ${result.task!.branch}. Land with: flyd crew land ${result.task!.id}\n`
        : `${result.status.replace(/_/g, " ")}${result.task ? ` (${result.task.id})` : ""}\n`);
      return;
    }
    default:
      throw new Error(`Unknown improve action: ${action} (status|evidence|run)`);
  }
}

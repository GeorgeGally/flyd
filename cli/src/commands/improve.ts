import { gatherEvidence, runSelfImprovement, selfImproveStatus } from "../crew/self-improve.js";

export async function runImproveCommand(action = "status", options: { force?: boolean } = {}): Promise<void> {
  switch (action) {
    case "status": {
      const { lastRunAt, attempts } = selfImproveStatus();
      const [{ listTasks, describeTask }, { listDomainRuns }] = await Promise.all([
        import("../crew/crew.js"), import("../command/store.js"),
      ]);
      const tasks = new Map(listTasks().map((task) => [task.id, task]));
      const domainRuns = new Map(listDomainRuns().map((run) => [run.id, run]));
      process.stdout.write(`Last run: ${lastRunAt ?? "never"}\n`);
      process.stdout.write(attempts.length
        ? `${attempts.slice(-10).map((attempt) => {
          const task = attempt.taskId ? tasks.get(attempt.taskId) : undefined;
          const domain = attempt.taskId ? domainRuns.get(attempt.taskId) : undefined;
          const detail = task
            ? describeTask(task)
            : domain
              ? `[${domain.request.domain}/${domain.status}] ${domain.result?.brief ?? domain.request.intendedOutcome}`
              : "";
          return `${attempt.at.slice(0, 10)} ${attempt.title}${detail ? `\n  ${detail}` : ""}`;
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
      if (result.status === "dispatched") {
        const task = result.task!;
        if ("branch" in task) {
          process.stdout.write(`Dispatched: ${result.improvement!.title}\nTask ${task.id} on ${task.branch}. Land with: flyd crew land ${task.id}\n`);
        } else {
          process.stdout.write(`Dispatched: ${result.improvement!.title}\nCoding domain run ${task.id} is owned by ${task.owner}; Flyd will surface the verified result or decision when it comes back.\n`);
        }
      } else {
        process.stdout.write(`${result.status.replace(/_/g, " ")}${result.task ? ` (${result.task.id})` : ""}\n`);
      }
      return;
    }
    default:
      throw new Error(`Unknown improve action: ${action} (status|evidence|run)`);
  }
}

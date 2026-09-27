import { describeTask, discardCrewTask, dispatchCrewTask, landCrewTask, listTasks, readTask, superviseCrew } from "../crew/crew.js";

export async function runCrewCommand(action = "list", args: string[] = []): Promise<void> {
  switch (action) {
    case "list": {
      const tasks = listTasks();
      process.stdout.write(tasks.length ? `${tasks.slice(0, 20).map(describeTask).join("\n")}\n` : "No crew tasks yet.\n");
      return;
    }
    case "dispatch": {
      const task = await dispatchCrewTask({ repo: process.cwd(), outcome: args.join(" "), source: "cli" });
      process.stdout.write(`Dispatched ${describeTask(task)}\nWorktree: ${task.worktree}\n`);
      return;
    }
    case "show": {
      const task = readTask(args[0] ?? "");
      if (!task) throw new Error(`No crew task ${args[0] ?? ""}`);
      process.stdout.write(`${describeTask(task)}\n${task.summary ? `\n${task.summary}\n` : ""}${(task.verification ?? []).map((step) => `${step.ok ? "✓" : "✗"} ${step.command}`).join("\n")}\nLog: ${task.log}\n`);
      return;
    }
    case "supervise": {
      const changed = await superviseCrew();
      process.stdout.write(changed.length ? `${changed.map(describeTask).join("\n")}\n` : "Nothing changed.\n");
      return;
    }
    case "land":
      process.stdout.write(`${describeTask(await landCrewTask(args[0] ?? ""))}\n`);
      return;
    case "discard":
      process.stdout.write(`${describeTask(await discardCrewTask(args[0] ?? ""))}\n`);
      return;
    default:
      throw new Error(`Unknown crew action: ${action} (list|dispatch <outcome>|show <id>|supervise|land <id>|discard <id>)`);
  }
}

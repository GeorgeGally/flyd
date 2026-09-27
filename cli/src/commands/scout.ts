import {
  evolveScout, fitness, formatEdition, latestEdition, readSources, readTaste, recordScoutFeedback, runScoutLocked, watchScout,
} from "../council/scout.js";

export async function runScoutCommand(action = "show", args: string[] = []): Promise<void> {
  const complete = async (prompt: string) => {
    const { query } = await import("../lib/llm.js");
    return query(prompt, undefined, undefined, undefined, undefined, { json: true });
  };
  switch (action) {
    case "show": {
      const edition = latestEdition();
      const lines = formatEdition(edition);
      process.stdout.write(lines.length ? `Scout edition ${edition!.date}\n${lines.join("\n")}\n\nRate with: flyd scout more N | less N\n` : "No edition yet. Run: flyd scout run\n");
      return;
    }
    case "run": {
      const result = await runScoutLocked({ complete, force: true });
      if (result.skipped) { process.stdout.write(`Scout skipped: ${result.skipped}\n`); return; }
      process.stdout.write(`${formatEdition(result.edition ?? null).join("\n") || "Nothing cleared the bar today."}\n${result.failedTopics.length ? `\n(${result.failedTopics.length} sources failed: ${result.failedTopics.slice(0, 6).join(", ")})\n` : ""}`);
      return;
    }
    case "watch": {
      const { notifyMac } = await import("../runtime/agenda.js");
      const musts = await watchScout({ complete, notify: notifyMac });
      process.stdout.write(musts.length ? `${musts.map((item) => `❗ ${item.title} — ${item.why} ${item.url}`).join("\n")}\n` : "Nothing must-know right now.\n");
      return;
    }
    case "evolve": {
      const changes = await evolveScout({ complete });
      process.stdout.write(changes.length ? `${changes.map((change) => `${change.kind}: ${change.detail}`).join("\n")}\n` : "No changes.\n");
      return;
    }
    case "more":
    case "less": {
      const item = recordScoutFeedback(Number(args[0]), action);
      process.stdout.write(item ? `${action === "more" ? "More" : "Less"} like "${item.title}".\n` : `No item ${args[0] ?? ""} in the latest edition.\n`);
      return;
    }
    case "sources": {
      const sources = readSources().sort((a, b) => fitness(b) - fitness(a));
      for (const source of sources) {
        process.stdout.write(`${source.status.padEnd(7)} ${fitness(source).toFixed(2)}  ${source.kind.padEnd(6)} ${source.name}${source.shown ? `  (shown ${source.shown}, +${source.likes}/-${source.dislikes})` : ""}${source.note ? `  — ${source.note}` : ""}\n`);
      }
      return;
    }
    case "taste":
      process.stdout.write(`${readTaste()}\n`);
      return;
    default:
      throw new Error(`Unknown scout action: ${action} (show|run|watch|evolve|more N|less N|sources|taste)`);
  }
}

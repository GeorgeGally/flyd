import {
  evolveScout, fitness, formatEdition, latestEdition, readSources, readTaste, recordScoutFeedback, runScoutLocked, scoutDir, watchScout,
} from "../council/scout.js";
import { discoveryStatus, refreshDiscovery } from "../council/scout-discovery.js";
import { discoverLast30days, last30daysHealth, last30daysPath } from "../council/scout-last30days.js";
import { scoutMetricsSummary, scoutResearchHealthSummary } from "../council/scout-metrics.js";
import { editorialEvaluationSummary, editorialShadowBrief, recordEditorialJudgment } from "../council/scout-eval.js";

export async function runScoutCommand(action = "show", args: string[] = []): Promise<void> {
  const complete = async (prompt: string) => {
    const { query } = await import("../lib/llm.js");
    return query(prompt, undefined, undefined, undefined, undefined, { json: true, source: "commands/scout" });
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
      const reason = args[1];
      if (reason && !["wrong-topic", "repeat", "not-new", "too-shallow", "bad-source", "interesting", "surprising", "already-knew"].includes(reason))
        throw new Error("Unknown reason: " + reason);
      const item = recordScoutFeedback(args[0] ?? "", action, scoutDir(), new Date(), reason as "wrong-topic" | "repeat" | "not-new" | "too-shallow" | "bad-source" | "interesting" | "surprising" | "already-knew" | undefined);
      process.stdout.write(item ? `${action === "more" ? "More" : "Less"} like "${item.title}".\n` : `Nothing to rate for ${args[0] ?? ""} (an item number, story link or source id).\n`);
      return;
    }
    case "sources": {
      const sources = readSources().sort((a, b) => fitness(b) - fitness(a));
      for (const source of sources) {
        process.stdout.write(`${source.status.padEnd(7)} ${fitness(source).toFixed(2)}  ${source.kind.padEnd(6)} ${source.name}${source.shown ? `  (shown ${source.shown}, +${source.likes}/-${source.dislikes})` : ""}${source.note ? `  — ${source.note}` : ""}\n`);
      }
      return;
    }
    case "compare":
      process.stdout.write(editorialShadowBrief(scoutDir(), args[0]));
      process.stdout.write(editorialEvaluationSummary(scoutDir()) + "\n");
      return;
    case "judge": {
      const verdict = (args[0] || "").trim();
      if (!["A", "B", "tie"].includes(verdict)) throw new Error("flyd scout judge A | B | tie");
      process.stdout.write(recordEditorialJudgment(scoutDir(), verdict as "A" | "B" | "tie", args[1]) + "\n");
      return;
    }
    case "status": {
      const health = await last30daysHealth();
      const discovery = discoveryStatus(scoutDir());
      process.stdout.write([
        scoutMetricsSummary(scoutDir()),
        scoutResearchHealthSummary(scoutDir()),
        "Last30days engine: " + last30daysPath(),
        "Python: " + health.interpreter + " (" + health.detail + ")",
        "Discovery: " + discovery.mode + " (" + discovery.cached + " nominated, " + discovery.verified + " corroborated)",
        ...(discovery.lastRun ? ["Last discovery: " + discovery.lastRun.ranAt + " — " + discovery.lastRun.outcome + " via " + discovery.lastRun.engine + " — " + (discovery.lastRun.domain || "global")] : []),
      ].join("\n") + "\n");
      return;
    }
    case "discover": {
      const run = await refreshDiscovery(scoutDir(), new Date(), discoverLast30days, { force: true });
      process.stdout.write(run ? run.outcome + ": " + run.domain + " (" + run.nominations.length + " nominations)\n" : "Discovery not due or disabled.\n");
      return;
    }
    case "taste":
      process.stdout.write(`${readTaste()}\n`);
      return;
    default:
      throw new Error(`Unknown scout action: ${action} (show|run|watch|evolve|discover|status|compare|judge A|B|tie|more N|less N|sources|taste)`);
  }
}

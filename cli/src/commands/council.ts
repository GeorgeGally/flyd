import { advisoriesPath, openAdvisories, readAdvisories } from "../council/advisors.js";
import { runCouncilPass } from "../council/council.js";
import { collectNewCaptures, readLibrarianState } from "../council/librarian.js";
import { readJournalSince } from "../council/journal.js";
import { memoryPaths, readMemoryEntries, staleEntries } from "../council/memory-store.js";

export async function runCouncilCommand(action = "status", options: { all?: boolean } = {}): Promise<void> {
  switch (action) {
    case "status": {
      const state = readLibrarianState();
      const memory = readMemoryEntries();
      const open = openAdvisories();
      process.stdout.write([
        `Librarian: ${state.runs} pass${state.runs === 1 ? "" : "es"}, last ${state.lastRunAt ?? "never"}`,
        `  waiting: ${readJournalSince(state.journalCursor).length} journal turns, ${collectNewCaptures(state.captureCursorMs, undefined, 1000).length} captures`,
        `Memory: ${memory.length} entries (${staleEntries(memory, new Date()).length} stale) in ${memoryPaths().memory}`,
        `Advisories: ${open.length} open (${open.filter((advisory) => advisory.advisor === "critic").length} critic, ${open.filter((advisory) => advisory.advisor === "strategist").length} strategist)`,
      ].join("\n") + "\n");
      return;
    }
    case "run": {
      const { query } = await import("../lib/llm.js");
      const { notifyMac } = await import("../runtime/agenda.js");
      // --all works through a backlog pass by pass (each pass takes a bounded slice).
      for (let pass = 1; pass <= (options.all ? 30 : 1); pass += 1) {
        const result = await runCouncilPass({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }), notify: notifyMac, force: true });
        if (result.skipped) { process.stdout.write(`Council pass skipped: ${result.skipped}\n`); return; }
        const receipt = result.librarian?.memory;
        process.stdout.write(`Pass ${pass}: ${result.librarian?.turns ?? 0} turns, ${result.librarian?.captures ?? 0} captures → memory +${receipt?.added ?? 0} ~${receipt?.updated ?? 0} ✓${receipt?.reinforced ?? 0} ↓${receipt?.archived ?? 0}, profile +${result.librarian?.profileAdded ?? 0}, advisories +${result.advisories.length}\n`);
        if (result.librarian?.skipped) return;
      }
      return;
    }
    case "advisories": {
      const all = readAdvisories(advisoriesPath());
      if (all.length === 0) { process.stdout.write("No advisories yet.\n"); return; }
      for (const advisory of all.slice(-20).reverse()) {
        process.stdout.write(`[${advisory.status}] ${advisory.advisor} (${advisory.urgency}, until ${advisory.expires}): ${advisory.text}\n  why now: ${advisory.whyNow || "—"}\n`);
      }
      return;
    }
    case "investigate": {
      const [{ investigate }, { runPersonalTool }, { query }] = await Promise.all([
        import("../council/investigator.js"), import("../runtime/personal-tools.js"), import("../lib/llm.js"),
      ]);
      const result = await investigate({
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
        force: true,
      });
      process.stdout.write(`${result.status}${result.area ? ` — ${result.area}` : ""}${result.added !== undefined ? `: ${result.added} new fact${result.added === 1 ? "" : "s"}` : ""}\n`);
      return;
    }
    case "backfill": {
      const [{ backfillArchive }, { query }] = await Promise.all([import("../council/investigator.js"), import("../lib/llm.js")]);
      const result = await backfillArchive({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }) });
      process.stdout.write(`${result.status}: read ${result.read}, learned ${result.added}\n`);
      return;
    }
    default:
      throw new Error(`Unknown council action: ${action} (status|run|advisories|investigate|backfill)`);
  }
}

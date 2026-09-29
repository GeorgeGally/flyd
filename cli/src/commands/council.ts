import { advisoriesPath, openAdvisories, readAdvisories } from "../council/advisors.js";
import { runCouncilPass } from "../council/council.js";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { collectNewCaptures, readLibrarianState, reprocessSources, type BackfillSource } from "../council/librarian.js";
import { readJournalSince } from "../council/journal.js";
import { memoryPaths, readMemoryEntries, staleEntries } from "../council/memory-store.js";

/** Old material about George, identity first, then conversation, then captures oldest-first so newer facts win. */
export function historicalSources(stage: string, home = homedir()): BackfillSource[] {
  const read = (path: string) => { try { return readFileSync(path, "utf8"); } catch { return ""; } };
  const identity: BackfillSource[] = [
    { id: "doc:cv", text: read(join(home, "Documents", "jobs", "cv", "george_galanakis_cv.md")) },
    { id: "doc:candidate-profile", text: read(join(home, "Documents", "jobs", "profile", "candidate_profile.json")) },
    { id: "doc:innovation-highlights", text: read(join(home, "Documents", "jobs", "George Galanakis Innovation Project Highlights.docx.txt")) },
    { id: "doc:job-search-tracker", text: read(join(home, "Documents", "jobs", "job_search_tracker.csv")) },
    ...["USER.md", "MEMORY.md"].map((file) => ({ id: `doc:hermes-${file.toLowerCase()}`, text: read(join(home, ".hermes", "memories", file)) })),
    ...["USER.md", "MEMORY.md"].map((file) => ({ id: `doc:openclaw-${file.toLowerCase()}`, text: read(join(home, ".openclaw", "workspace", file)) })),
    ...(() => {
      const dir = join(FLYD_DIR, "wiki", "projects");
      try { return readdirSync(dir).filter((name) => name.endsWith(".md")).map((name) => ({ id: `doc:wiki-${name.replace(/\.md$/, "")}`, text: read(join(dir, name)) })); } catch { return []; }
    })(),
  ];
  const journal = Object.entries(readJournalSince(null, undefined, 10_000).reduce<Record<string, string[]>>((days, turn) => {
    (days[turn.at.slice(0, 10)] ??= []).push(`George: ${turn.user}\nFlyd: ${turn.assistant.slice(0, 1_500)}`);
    return days;
  }, {})).map(([day, turns]) => ({ id: `journal:${day}`, text: turns.join("\n\n") }));
  const captures = collectNewCaptures(0, undefined, 10_000).map((capture) => ({ id: capture.id, text: capture.text }));
  const pick = { identity, journal, captures, all: [...identity, ...journal, ...captures] }[stage] ?? [];
  return pick.filter((source) => source.text.trim().length >= 20);
}

export async function runCouncilCommand(action = "status", options: { all?: boolean; stage?: string } = {}): Promise<void> {
  switch (action) {
    case "reprocess": {
      // Old material run through the Librarian again (resumable: council/reprocess.json).
      const { query } = await import("../lib/llm.js");
      const stage = options.stage ?? "all";
      const sources = historicalSources(stage);
      process.stdout.write(`Reprocessing ${sources.length} sources (${stage}), ${sources.reduce((n, source) => n + source.text.length, 0)} chars…\n`);
      const started = Date.now();
      const result = await reprocessSources(sources, {
        complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }),
        progressPath: join(FLYD_DIR, "council", "reprocess.json"),
        onSkip: (ids) => process.stdout.write(`  skipped (unreadable reply twice, will retry next run): ${ids.join(", ")}\n`),
        onBatch: (done, total, receipt) => process.stdout.write(`  batch ${done}/${total}: memory +${receipt.memory.added} ~${receipt.memory.updated} notes +${receipt.memory.notes}, profile +${receipt.profileAdded}, projects ${receipt.projects.upserted} (${Math.round((Date.now() - started) / 1000)}s)\n`),
      });
      process.stdout.write(`Done: ${result.batches} batches → memory +${result.memory.added} ~${result.memory.updated} ↓${result.memory.archived}, daily notes +${result.memory.notes}, profile +${result.profileAdded}, projects ${result.projects.upserted} updated ${result.projects.archived} closed\n`);
      return;
    }
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

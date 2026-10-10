import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { curateTaste, learnTaste, readTaste, renderTaste, resolveTasteProject, tastePath, tastePromptText, writeTaste } from "../council/taste.js";

const USAGE = "flyd taste [show|for <project|path>|learn [--days N]|curate|edit]";

/**
 * `flyd taste`: what Flyd has learned about George's taste. `for` prints the
 * rules an agent should follow before design or code work on a project or
 * repo; `learn` runs a learning pass over his Claude Code sessions now.
 */
export async function runTaste(action = "show", args: string[] = []): Promise<void> {
  const path = tastePath();
  if (action === "for") {
    const target = args[0] ?? process.cwd();
    const project = resolveTasteProject(target);
    const text = tastePromptText({ projects: project ? [project] : [] });
    process.stdout.write(text ? `${text}\n` : "Nothing learned about George's taste yet.\n");
    return;
  }
  if (action === "learn") {
    const days = Number(args[args.indexOf("--days") + 1]);
    const { query } = await import("../lib/llm.js");
    process.stdout.write("Reading George's turns in his Claude Code sessions…\n");
    const result = await learnTaste({
      complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }),
      ...(args.includes("--days") && Number.isFinite(days) && days > 0 ? { backfillDays: days } : {}),
      maxCalls: 12,
    });
    if (result.skipped) {
      process.stdout.write(result.skipped === "disabled" ? "Taste learning is off (FLYD_TASTE_LEARNING=0).\n" : "A learning pass is already running.\n");
      return;
    }
    process.stdout.write(`Read ${result.turns} turn${result.turns === 1 ? "" : "s"}: ${result.added} new rule${result.added === 1 ? "" : "s"}, ${result.strengthened} strengthened, ${result.promoted} moved to Everywhere. ${path}\n`);
    return;
  }
  if (action === "curate") {
    const { query } = await import("../lib/llm.js");
    process.stdout.write("Curating what Flyd knows about George's taste…\n");
    const receipt = await curateTaste({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }) });
    const ignored = receipt.rejected.length ? ` ${receipt.rejected.length} ignored.` : "";
    process.stdout.write(`Curated: ${receipt.folded} folded, ${receipt.promoted} promoted to Everywhere, ${receipt.retired} retired.${ignored} ${path}\n`);
    return;
  }
  if (action === "edit") {
    if (!existsSync(path)) writeTaste(readTaste(path), path);
    const editor = process.env.VISUAL || process.env.EDITOR || "nano";
    const result = spawnSync(editor, [path], { stdio: "inherit", shell: true });
    if (result.status !== 0) throw new Error(`${editor} exited with status ${result.status}`);
    return;
  }
  if (action !== "show") throw new Error(`Unknown taste action: ${action} (use: ${USAGE})`);
  const body = existsSync(path) ? readFileSync(path, "utf8").trim() : renderTaste(readTaste(path)).trim();
  process.stdout.write(`${path}\n\n${body}\n\nAlso in the Conversation window under "taste". \`flyd taste learn\` learns from new sessions now.\n`);
}

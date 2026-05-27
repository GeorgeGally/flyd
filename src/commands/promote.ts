import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { RAW_DIR, WIKI_DIR, hasApiKey, defaultModel } from "../lib/config.js";
import { mkdirSync } from "fs";
import { loadState, saveState, fileHash } from "../lib/state.js";
import { runHostDistill } from "../lib/host.js";
import { reviewWithMom, reviewWithGeorge, applyDecision } from "../lib/governor.js";

export async function runPromote(opts: { force?: boolean; model?: string } = {}): Promise<void> {
  const model = opts.model ?? defaultModel();

  if (!existsSync(RAW_DIR)) {
    console.log("no raw captures found — run 'flyd <text>' first");
    return;
  }

  if (!hasApiKey(model)) {
    console.log(`promote requires an API key — run 'flyd setup'`);
    return;
  }

  ensureWikiDirs();

  const state = loadState();
  const rawFiles = readdirSync(RAW_DIR).filter((f) => f.endsWith(".md")).sort();
  const toPromote: { path: string; content: string }[] = [];

  for (const file of rawFiles) {
    const absPath = join(RAW_DIR, file);
    const content = readFileSync(absPath, "utf8");
    const relPath = `raw/${file}`;
    const hash = fileHash(content);
    if (opts.force || state.promoted[relPath]?.hash !== hash) {
      toPromote.push({ path: absPath, content });
    }
  }

  if (!toPromote.length) {
    console.log("nothing to promote");
    return;
  }

  console.log(`promoting ${toPromote.length} file(s)...`);
  const now = new Date().toISOString();

  for (const { path: rawPath, content } of toPromote) {
    const relPath = `raw/${rawPath.split("/").pop()}`;
    console.log(`  distilling ${relPath}...`);

    let proposedPaths: string[];
    try {
      proposedPaths = await runHostDistill(rawPath, model);
    } catch (err) {
      console.error(`  host distill failed for ${relPath}:`, err);
      continue;
    }

    if (!proposedPaths.length) {
      console.log(`  no candidates extracted from ${relPath}`);
      state.promoted[relPath] = { hash: fileHash(content), promoted_at: now };
      saveState(state);
      continue;
    }

    console.log(`  ${proposedPaths.length} candidate(s) proposed`);

    for (const proposalPath of proposedPaths) {
      const slug = proposalPath.split("/").pop() ?? proposalPath;
      try {
        const [momVerdict, georgeVerdict] = await Promise.all([
          reviewWithMom(proposalPath, model),
          reviewWithGeorge(proposalPath, model),
        ]);
        const result = applyDecision(proposalPath, momVerdict, georgeVerdict);
        const icon = result.action === "promoted" ? "✓" : result.action === "rejected" ? "✗" : "?";
        console.log(`  ${icon} ${result.action}: ${slug} → ${result.writtenPath}`);
        if (result.principalReviewRequired) {
          console.log(`    principal review required`);
        }
      } catch (err) {
        console.error(`  governance failed for ${slug}:`, err);
      }
    }

    state.promoted[relPath] = { hash: fileHash(content), promoted_at: now };
    saveState(state);
  }

  console.log("done");
}

function ensureWikiDirs(): void {
  const subdirs = ["skills", "career", "education", "awards", "testimonials", "projects", "people", "constraints", "entries", "meta"];
  for (const sub of subdirs) {
    mkdirSync(join(WIKI_DIR, sub), { recursive: true });
  }
  mkdirSync(join(WIKI_DIR), { recursive: true });
}

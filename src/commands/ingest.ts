import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { RAW_DIR, defaultModel, hasApiKey } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";
import { search as qmdSearch, updateRaw, embedRaw } from "../lib/qmd.js";
import { runBatchIngest, executeIngestPlan, populateQueueFromRaw, dequeueSlice, runBatchIngestSlice, getQueueSize, clearQueue } from "../lib/ingest.js";

export async function runIngest(source: string, opts: { topic?: boolean; write?: boolean; model?: string; limit?: number; all?: boolean } = {}): Promise<void> {
  const m = opts.model ?? defaultModel();

  if (opts.all) {
    if (!hasApiKey(m)) {
      console.log("no API key configured — run 'flyd setup'");
      return;
    }
    console.log("populating ingest queue from raw captures...\n");
    const added = populateQueueFromRaw(opts.limit ?? 200);
    console.log(`  queued ${added} captures\n`);

    const chunkSize = opts.limit ? Math.min(opts.limit, 12) : 12;
    let totalNew = 0, totalUpdated = 0, chunkNum = 0;
    let queueRemaining = getQueueSize();

    while (queueRemaining > 0) {
      chunkNum++;
      const slice = dequeueSlice(chunkSize);
      console.log(`chunk ${chunkNum}: ${slice.length} captures, ${queueRemaining - slice.length} remaining...`);
      const plan = await runBatchIngestSlice(slice);
      if (plan) {
        if (plan.newPages.length || plan.updatedPages.length) {
          console.log(`  new: ${plan.newPages.length}, updated: ${plan.updatedPages.length}`);
          if (opts.write) {
            await executeIngestPlan(plan);
          }
        } else {
          console.log("  (no meaningful knowledge in this chunk)");
        }
        totalNew += plan.newPages.length;
        totalUpdated += plan.updatedPages.length;
      } else {
        console.log("  (processing error, skipping chunk)");
      }
      queueRemaining = getQueueSize();
    }

    console.log(`\ningest ${opts.write ? "complete" : "dry run"}: ${totalNew} new pages, ${totalUpdated} updated across ${chunkNum} chunks`);
    return;
  }

  if (opts.topic && source) {
    if (!hasApiKey(m)) {
      console.log("no API key configured — run 'flyd setup'");
      return;
    }

    console.log(`ingesting captures matching: "${source}"\n`);

    const results = await qmdSearch(source, "flyd-raw", 20);
    if (!results.length) {
      console.log("no captures found for this topic");
      return;
    }

    const captures: string[] = [];
    for (const r of results) {
      const fullPath = join(RAW_DIR, r.path);
      if (!existsSync(fullPath)) continue;
      const content = readFileSync(fullPath, "utf8");
      const { body } = parse(content);
      captures.push(`[${r.path}]\n${body.trim().slice(0, 1000)}`);
    }

    const prompt = `You are a wiki maintainer. Below are ${captures.length} raw captures. Analyze them and propose a wiki page.

Suggested filename: topics/${source.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.md

If this is a dry-run, show what you would create. If writing, return the full page content.

Captures:
${captures.join("\n\n---\n\n")}

Respond with the proposed wiki page content, starting with a title (# Title) and including [[wiki links]] to related pages.`;

    const result = await query(prompt, m);

    if (opts.write) {
      const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
      const { writeWikiPage, createTopicPage, appendLog, generateIndex } = await import("../lib/wiki.js");
      const content = createTopicPage({
        slug,
        title: source,
        body: result,
        tags: [],
        source: "ingest-manual",
        confidence: "medium",
      });
      writeWikiPage(`topics/${slug}.md`, content);
      appendLog({ type: "ingest", title: `manual: ${source}`, affected: [`topics/${slug}.md`] });
      await generateIndex();
      console.log(`filed to wiki/topics/${slug}.md`);
    } else {
      console.log("\nDRY RUN — proposed page:\n");
      console.log(result);
      console.log("\nrun with --write to create this page");
    }

    return;
  }

  if (!hasApiKey(m)) {
    console.log("no API key configured — run 'flyd setup'");
    return;
  }

  console.log("running batch ingest...\n");

  const plan = await runBatchIngest();
  if (!plan || (!plan.newPages.length && !plan.updatedPages.length)) {
    console.log("ingest queue is empty or no meaningful knowledge found");
    return;
  }

  console.log("batch ingest plan:");
  if (plan.newPages.length) {
    console.log(`\nnew pages (${plan.newPages.length}):`);
    for (const p of plan.newPages) {
      console.log(`  ${p.path} — ${p.title}`);
    }
  }
  if (plan.updatedPages.length) {
    console.log(`\nupdated pages (${plan.updatedPages.length}):`);
    for (const u of plan.updatedPages) {
      console.log(`  ${u.path}`);
    }
  }
  if (plan.contradictions.length) {
    console.log(`\ncontradictions (${plan.contradictions.length}):`);
    for (const c of plan.contradictions) {
      console.log(`  ${c.a} vs ${c.b} — ${c.claim}`);
    }
  }

  if (opts.write) {
    await executeIngestPlan(plan);
    clearQueue();
    console.log("\ningest complete");
  } else {
    console.log("\ndry run — run with --write to execute");
  }
}

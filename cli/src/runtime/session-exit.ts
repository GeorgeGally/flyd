import { updateRaw, embedRaw, closeStore } from "../lib/qmd.js";
import { extractInterests } from "../lib/interests.js";
import { findNewCapturesSince, suggestLinksForCapture, writeLinksToCapture } from "../lib/linking.js";
import { wikiExists } from "../lib/wiki.js";
import { closeDb } from "../work/database.js";

export interface SessionExitLog {
  write(text: string): void;
}

/**
 * Light memory + library maintenance on chat exit.
 * Full `flyd consolidate` is too heavy for every quit; this reindexes
 * conversation transcripts, refreshes interests, and links new captures.
 */
export async function runSessionExitMaintenance(log: SessionExitLog): Promise<void> {
  log.write("\nClosing — memory and library…\n");

  try {
    await updateRaw();
    await embedRaw();
    log.write("  memory index updated\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.write(`  memory index skipped (${message})\n`);
  }

  try {
    const { extracted, updated } = extractInterests();
    if (extracted > 0 || updated > 0) {
      log.write(`  interests: ${extracted} new, ${updated} updated\n`);
    } else {
      log.write("  interests unchanged\n");
    }
  } catch {
    log.write("  interests skipped\n");
  }

  try {
    if (wikiExists()) {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const recent = findNewCapturesSince(since);
      let linked = 0;
      for (const capture of recent) {
        const suggestions = suggestLinksForCapture(capture);
        if (suggestions.length > 0 && writeLinksToCapture(capture, suggestions)) {
          linked += 1;
        }
      }
      if (linked > 0) {
        log.write(`  library: linked ${linked} recent capture${linked === 1 ? "" : "s"}\n`);
      } else {
        log.write("  library: no new links\n");
      }
    } else {
      log.write("  library: wiki not initialized\n");
    }
  } catch {
    log.write("  library skipped\n");
  }

  try {
    await closeStore();
  } catch {
    // ignore
  }
  try {
    closeDb();
  } catch {
    // ignore
  }

  log.write("Done.\n");
}

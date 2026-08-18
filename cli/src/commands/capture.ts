import { existsSync, mkdirSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { RAW_DIR, PROJECT } from "../lib/config.js";
import { serialize } from "../lib/frontmatter.js";
import { updateRaw, embedRaw } from "../lib/qmd.js";
import { addToQueue } from "../lib/ingest.js";

export interface CaptureOptions {
  quiet?: boolean;
  /** Write the file but leave QMD indexing to the caller. */
  deferIndex?: boolean;
}

function nextCapturePath(stamp: string): string {
  const first = join(RAW_DIR, `${stamp}.md`);
  if (!existsSync(first)) return first;
  for (let i = 1; i < 10_000; i++) {
    const next = join(RAW_DIR, `${stamp}-${String(i).padStart(3, "0")}.md`);
    if (!existsSync(next)) return next;
  }
  throw new Error("capture filename collision");
}

export async function runCapture(text: string, options: CaptureOptions = {}): Promise<string> {
  mkdirSync(RAW_DIR, { recursive: true });

  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  const filepath = nextCapturePath(timestamp.replace(/[ :]/g, "-"));
  const filename = basename(filepath);

  const content = serialize(
    {
      source: "cli",
      project: PROJECT.name,
      project_path: PROJECT.path,
      timestamp,
    },
    text
  );

  writeFileSync(filepath, content, "utf8");
  if (!options.quiet) console.log(`captured ${timestamp}`);

  addToQueue(filename);

  if (!options.deferIndex && !process.env.VITEST) {
    await updateRaw();
    await embedRaw();
  }
  return filepath;
}

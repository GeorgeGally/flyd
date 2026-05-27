import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { RAW_DIR } from "../lib/config.js";
import { serialize } from "../lib/frontmatter.js";

export async function runCapture(text: string): Promise<void> {
  mkdirSync(RAW_DIR, { recursive: true });

  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  const filename = timestamp.replace(/[ :]/g, "-") + ".md";
  const filepath = join(RAW_DIR, filename);

  const content = serialize(
    {
      source: "cli",
      timestamp,
    },
    text
  );

  writeFileSync(filepath, content, "utf8");
  console.log(`captured ${timestamp}`);
}

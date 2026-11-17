import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { memoryPaths } from "./memory-store.js";

export function newsInterestsPath(memory = memoryPaths().memory): string {
  return join(dirname(memory), "news-interests.txt");
}

export function readNewsInterests(fallback: string, path = newsInterestsPath()): string {
  try { return readFileSync(path, "utf8").trim() || fallback; } catch { return fallback; }
}

/** Only the curator writes this derived, bounded brief; missing or invalid proposals leave it alone. */
export function writeNewsInterests(value: unknown, path = newsInterestsPath()): void {
  if (typeof value !== "string") return;
  const brief = value.trim();
  if (brief.length < 30 || brief.length > 2000) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${brief}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

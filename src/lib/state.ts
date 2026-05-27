import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { FLYD_DIR } from "./config.js";

const STATE_PATH = join(FLYD_DIR, "knowledge-state.json");

export interface State {
  raw: Record<string, { hash: string; compiled_at: string }>;
}

export function loadState(): State {
  if (!existsSync(STATE_PATH)) return { raw: {} };
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

export function saveState(state: State): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

export function fileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

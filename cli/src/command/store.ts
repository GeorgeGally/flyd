import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import type { DomainRun } from "./types.js";

export function commandDir(): string {
  return process.env.FLYD_COMMAND_DIR?.trim() || join(FLYD_DIR, "command");
}

function runPath(id: string, dir = commandDir()): string {
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(id)) throw new Error("Invalid domain run id");
  return join(dir, "runs", `${id}.json`);
}

export function saveDomainRun(run: DomainRun, dir = commandDir()): void {
  const path = runPath(run.id, dir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function readDomainRun(id: string, dir = commandDir()): DomainRun | null {
  try {
    return JSON.parse(readFileSync(runPath(id, dir), "utf8")) as DomainRun;
  } catch {
    return null;
  }
}

export function listDomainRuns(dir = commandDir()): DomainRun[] {
  const path = join(dir, "runs");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      try {
        return [JSON.parse(readFileSync(join(path, name), "utf8")) as DomainRun];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

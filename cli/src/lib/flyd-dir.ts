import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

/** Flyd's home: FLYD_DIR, else ./.flyd when it exists, else ~/.flyd. */
export function resolveFlydDir(): string {
  const configured = process.env.FLYD_DIR?.trim();
  if (configured) return resolve(configured);

  const cwdLocal = join(process.cwd(), ".flyd");
  if (existsSync(cwdLocal)) return cwdLocal;
  return join(homedir(), ".flyd");
}

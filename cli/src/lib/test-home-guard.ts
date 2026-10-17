import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

/**
 * Tests must never touch George's real ~/.flyd. vitest.setup.ts points FLYD_DIR
 * at a throwaway directory; this is the backstop for any store that still
 * resolves the home directory itself.
 */
export function assertNotRealFlydHome(path: string): void {
  if (!process.env.VITEST) return;
  const realHome = resolve(join(process.env.FLYD_REAL_HOME?.trim() || homedir(), ".flyd"));
  const target = resolve(path);
  if (target === realHome || target.startsWith(realHome + sep)) {
    throw new Error(`Test run attempted to open ${target}, inside the real ${realHome}. Point FLYD_DIR (or the store's own path) at a temp directory.`);
  }
}

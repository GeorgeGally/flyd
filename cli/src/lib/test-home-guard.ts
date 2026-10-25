import { homedir, userInfo } from "node:os";
import { join, resolve, sep } from "node:path";

/**
 * Tests must never touch George's real ~/.flyd. vitest.setup.ts points FLYD_DIR
 * at a throwaway directory; this is the backstop for any store that still
 * resolves the home directory itself. The account's own home is read from the
 * user database as well as $HOME, because a test run whose shell rewrote $HOME
 * (a crewmate's sandbox) would otherwise slip past it.
 */
export function assertNotRealFlydHome(path: string): void {
  if (!process.env.VITEST) return;
  const homes = [process.env.FLYD_REAL_HOME?.trim(), homedir(), accountHome()].filter((home): home is string => Boolean(home));
  const target = resolve(path);
  for (const home of new Set(homes)) {
    const realHome = resolve(join(home, ".flyd"));
    if (target === realHome || target.startsWith(realHome + sep)) {
      throw new Error(`Test run attempted to open ${target}, inside the real ${realHome}. Point FLYD_DIR (or the store's own path) at a temp directory.`);
    }
  }
}

function accountHome(): string | undefined {
  try { return userInfo().homedir; } catch { return undefined; }
}

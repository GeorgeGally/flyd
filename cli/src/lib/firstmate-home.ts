import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_FIRSTMATE_HOME = join(homedir(), "Documents", "firstmate");

/**
 * Where firstmate lives: FLYD_FIRSTMATE_HOME, else ~/Documents/firstmate.
 * Under vitest the real home is never the fallback, so a test that forgets to
 * inject a fake can't run George's real fm-inbox.sh and drop notes in his inbox.
 */
export function firstmateHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FLYD_FIRSTMATE_HOME?.trim();
  if (configured) return configured;
  return env.VITEST ? join(tmpdir(), "flyd-test-no-firstmate") : DEFAULT_FIRSTMATE_HOME;
}

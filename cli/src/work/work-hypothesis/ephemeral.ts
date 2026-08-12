import { resolve } from "path";
import { tmpdir, homedir } from "os";

const TMP = resolve(tmpdir());
const HOME_TMP_MARKERS = ["/var/folders/", "/tmp/", "\\Temp\\", "/TemporaryItems/"];

/**
 * Temp dirs and vitest fixtures must never become Present Model threads.
 * Tests historically wrote these into ~/.flyd/work-index.sqlite.
 */
export function isEphemeralRepoRoot(root: string, name?: string): boolean {
  const resolved = resolve(root);
  const base = (name ?? resolved.split("/").pop() ?? "").toLowerCase();

  if (base.startsWith("flyd-test") || base === "same-name") return true;
  if (resolved.startsWith(TMP + "/") || resolved === TMP) return true;
  if (HOME_TMP_MARKERS.some((m) => resolved.includes(m))) return true;
  // Never treat nested worktree backups / sql dumps as projects
  if (/_backup_|_worktree_backup/i.test(resolved)) return true;
  if (resolved.endsWith(".sql")) return true;
  return false;
}

export function isDurableWorkRoot(root: string): boolean {
  const resolved = resolve(root);
  const home = resolve(homedir());
  // Prefer real user workspaces under home Documents/Code/Projects/…
  const durablePrefixes = [
    resolve(home, "Documents"),
    resolve(home, "Code"),
    resolve(home, "Projects"),
    resolve(home, "Developer"),
    resolve(home, "src"),
    resolve(home, "dev"),
  ];
  return durablePrefixes.some((p) => resolved === p || resolved.startsWith(p + "/"));
}

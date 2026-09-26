import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ensureUserProfile, readUserProfile, userProfilePath } from "../lib/user-profile.js";

export async function runProfile(action?: string): Promise<void> {
  if (action && action !== "edit") throw new Error(`Unknown profile action: ${action} (use: flyd profile [edit])`);
  if (action === "edit") {
    const path = ensureUserProfile();
    const editor = process.env.VISUAL || process.env.EDITOR || "nano";
    const result = spawnSync(editor, [path], { stdio: "inherit", shell: true });
    if (result.status !== 0) throw new Error(`${editor} exited with status ${result.status}`);
    return;
  }
  const path = userProfilePath();
  const body = readUserProfile(path);
  if (!body) {
    process.stdout.write(`No profile yet. Run \`flyd profile edit\` to write ${path} — Flyd trusts it over anything it infers.\n`);
    return;
  }
  process.stdout.write(`${path}\n\n${readFileSync(path, "utf8").trim()}\n`);
}

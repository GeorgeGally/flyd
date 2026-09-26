import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { addUserProfileFact, ensureUserProfile, readUserProfile, userProfilePath } from "../lib/user-profile.js";

async function bootstrap(): Promise<void> {
  const { draftProfileFromMemory } = await import("../runtime/profile-bootstrap.js");
  const { query } = await import("../lib/llm.js");
  const model = process.env.FLYD_PROFILE_MODEL?.trim() || "openai:gpt-5.6-sol";
  process.stdout.write(`Reading your captures and conversations with ${model}…\n`);
  const { facts, sources } = await draftProfileFromMemory({ complete: (prompt) => query(prompt, model) });
  ensureUserProfile();
  let added = 0;
  for (const { section, fact } of facts) {
    if (addUserProfileFact(fact, { section, dated: false })) added += 1;
  }
  process.stdout.write(`Drafted ${added} new fact${added === 1 ? "" : "s"} from ${sources} notes into ${userProfilePath()}.\nReview them with \`flyd profile\` and fix anything wrong with \`flyd profile edit\` — Flyd treats this file as the truth about you.\n`);
}

export async function runProfile(action?: string): Promise<void> {
  if (action === "bootstrap") {
    await bootstrap();
    return;
  }
  if (action && action !== "edit") throw new Error(`Unknown profile action: ${action} (use: flyd profile [edit|bootstrap])`);
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

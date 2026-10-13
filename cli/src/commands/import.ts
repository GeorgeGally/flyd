import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { IMPORT_SOURCE, learningRegistry } from "../dictation/corrections.js";
import { importChatGPTTurns, planChatGPTImport, readChatGPTExport, type ChatGPTImportPlan } from "../cognition/chatgpt-export.js";

const n = (value: number) => value.toLocaleString("en-US");
const day = (value?: string) => value?.slice(0, 10) ?? "unknown";
const count = (value: number, one: string, many: string) => `${n(value)} ${value === 1 ? one : many}`;

export function formatChatGPTPlan(path: string, plan: ChatGPTImportPlan): string {
  const lines = [`ChatGPT export: ${path}`,
    `  ${n(plan.conversations)} conversations${plan.empty ? ` (${n(plan.empty)} empty, skipped)` : ""}`,
    `  ${n(plan.turns)} turns — ${n(plan.newTurns.length)} new, ${n(plan.alreadyImported)} already imported`];
  if (plan.from) lines.push(`  From ${day(plan.from)} to ${day(plan.to)}`);
  if (plan.attachments) lines.push(`  ${count(plan.attachments, "attachment or image", "attachments and images")} noted, not imported`);
  if (plan.truncated) lines.push(`  ${count(plan.truncated, "long turn", "long turns")} shortened to 12,000 characters per side`);
  return lines.join("\n");
}

export async function runImport(kind: string, path: string, opts: { write?: boolean; json?: boolean } = {}): Promise<void> {
  if (kind !== "chatgpt") throw new Error(`Unknown import "${kind}" — supported: chatgpt`);
  const conversations = readChatGPTExport(path);
  const store = new IntelligenceEventStore();
  let plan: ChatGPTImportPlan;
  try { plan = planChatGPTImport(conversations, store); } finally { store.close(); }
  const enabled = learningRegistry().status(IMPORT_SOURCE) === "enabled";
  const summary = { ...plan, newTurns: plan.newTurns.length, enabled };
  if (!opts.write) {
    console.log(opts.json ? JSON.stringify({ ...summary, written: 0 }, null, 2) : formatChatGPTPlan(path, plan) +
      "\n\nDry run — nothing written. Add --write to import." +
      (enabled ? "" : `\nConversation import is off; turn it on first with: flyd learning --enable ${IMPORT_SOURCE}`));
    return;
  }
  if (!enabled) {
    console.log(opts.json ? JSON.stringify({ ...summary, written: 0, error: "Conversation import is not enabled" }, null, 2)
      : formatChatGPTPlan(path, plan) + `\n\nConversation import is off. Turn it on with: flyd learning --enable ${IMPORT_SOURCE}`);
    process.exitCode = 1;
    return;
  }
  const written = await importChatGPTTurns(plan.newTurns);
  console.log(opts.json ? JSON.stringify({ ...summary, written }, null, 2) : formatChatGPTPlan(path, plan) +
    `\n\nImported ${n(written)} turns. Flyd learns from them in the background.`);
}

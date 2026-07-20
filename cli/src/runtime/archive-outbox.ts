import { mkdir, rename, stat, writeFile } from "fs/promises";
import { join } from "path";
import { RAW_DIR } from "../lib/config.js";
import { updateRawStrict } from "../lib/qmd.js";
import type { ArchiveRuntimeEvent } from "./types.js";
import { promoteRuntimeOutcome } from "./outcome-promoter.js";

interface ArchiveOutboxStore {
  pendingArchiveEvents(limit?: number): Promise<ArchiveRuntimeEvent[]>;
  markArchiveDelivered(eventId: string): Promise<void>;
  markArchiveFailed(eventId: string, error: string): Promise<void>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function renderEvent(event: ArchiveRuntimeEvent): string {
  const promotedKnowledge = promoteRuntimeOutcome(event);
  const verification = event.payload.verification as Record<string, unknown> | undefined;
  const summary = event.eventType === "task.completed" && verification?.local_project_briefing === true
    ? `Local project brief: ${String(event.payload.summary ?? "Reviewed project status locally")}`
    : event.eventType === "task.completed"
    ? `Verified outcome: ${String(event.payload.summary ?? "Completed task")} at ${String(
        (event.payload.repository as Record<string, unknown> | undefined)?.head ?? "verified repository head",
      )}`
    : event.eventType === "task.corrected"
      ? `Correction: ${String(event.payload.original_claim ?? "Previous Flyd claim")} -> ${String(
          event.payload.corrected_value ?? "Task interpretation corrected",
        )}`
      : `Tool escape: ${String(event.payload.reason ?? "Work continued outside Flyd")}`;
  return [
    "---",
    `type: flyd-runtime-${event.eventType.replaceAll(".", "-")}`,
    `event_key: ${event.eventKey}`,
    `task_key: ${event.taskKey}`,
    `task_revision: ${event.taskRevision}`,
    `occurred_at: ${event.occurredAt}`,
    "source: flyd-runtime",
    "---",
    "",
    `# ${event.eventType}`,
    "",
    summary,
    "",
    "Promotable knowledge:",
    "",
    "```json",
    JSON.stringify(promotedKnowledge, null, 2),
    "```",
    "",
    "Operational provenance:",
    "",
    "```json",
    JSON.stringify(event.payload, null, 2),
    "```",
    "",
  ].join("\n");
}

export async function deliverArchiveOutbox(
  store: ArchiveOutboxStore,
  rawDir = RAW_DIR,
  refreshIndex: () => Promise<void> = updateRawStrict,
): Promise<number> {
  await mkdir(rawDir, { recursive: true, mode: 0o700 });
  const events = await store.pendingArchiveEvents();
  const prepared: ArchiveRuntimeEvent[] = [];
  for (const event of events) {
    const path = join(rawDir, `runtime-event-${event.eventKey}.md`);
    try {
      if (!await exists(path)) {
        const temporaryPath = `${path}.${process.pid}.tmp`;
        await writeFile(temporaryPath, renderEvent(event), { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, path);
      }
      prepared.push(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.markArchiveFailed(event.id, message);
    }
  }

  if (prepared.length === 0) return 0;

  try {
    await refreshIndex();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await Promise.all(prepared.map((event) => store.markArchiveFailed(event.id, message)));
    throw error;
  }

  let delivered = 0;
  for (const event of prepared) {
    try {
      await store.markArchiveDelivered(event.id);
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.markArchiveFailed(event.id, message);
    }
  }
  return delivered;
}

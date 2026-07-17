import { mkdir, rename, stat, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { ArchiveRuntimeEvent } from "./types.js";

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
  const summary = event.eventType === "task.completed"
    ? `Verified outcome: ${String(event.payload.summary ?? "Completed task")}`
    : event.eventType === "task.corrected"
      ? `Correction: ${String(event.payload.correction ?? "Task interpretation corrected")}`
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
  rawDir = join(homedir(), ".flyd", "raw"),
): Promise<number> {
  await mkdir(rawDir, { recursive: true, mode: 0o700 });
  const events = await store.pendingArchiveEvents();
  let delivered = 0;
  for (const event of events) {
    const path = join(rawDir, `runtime-event-${event.eventKey}.md`);
    try {
      if (!await exists(path)) {
        const temporaryPath = `${path}.${process.pid}.tmp`;
        await writeFile(temporaryPath, renderEvent(event), { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, path);
      }
      await store.markArchiveDelivered(event.id);
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.markArchiveFailed(event.id, message);
    }
  }
  return delivered;
}

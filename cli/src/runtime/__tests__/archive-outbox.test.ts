import { mkdtemp, readFile, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { deliverArchiveOutbox } from "../archive-outbox.js";

describe("deliverArchiveOutbox", () => {
  it("exports eligible corrections and outcomes idempotently", async () => {
    const rawDir = await mkdtemp(join(tmpdir(), "flyd-outbox-"));
    const events = [{
      id: "7",
      eventKey: "event-7",
      eventType: "task.completed",
      taskKey: "task-1",
      taskRevision: 8,
      occurredAt: "2026-07-17T04:00:00.000Z",
      payload: { summary: "Continuity works", verification: { user_confirmed: true } },
    }];
    const store = {
      pendingArchiveEvents: vi.fn(async () => events),
      markArchiveDelivered: vi.fn(async () => undefined),
      markArchiveFailed: vi.fn(async () => undefined),
    };

    await deliverArchiveOutbox(store, rawDir);
    await deliverArchiveOutbox(store, rawDir);

    const path = join(rawDir, "runtime-event-event-7.md");
    expect((await stat(path)).isFile()).toBe(true);
    expect(await readFile(path, "utf8")).toContain("Verified outcome: Continuity works");
    expect(store.markArchiveDelivered).toHaveBeenCalledWith("7");
    expect(store.markArchiveFailed).not.toHaveBeenCalled();
  });
});

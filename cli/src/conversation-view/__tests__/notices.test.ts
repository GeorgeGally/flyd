import { describe, expect, it } from "vitest";
import { NOTICE_TTL_MS, NoticeBoard, noticeLine, noticeOf, REPEAT_MS, RING_MS } from "../notices.js";

describe("noticeOf", () => {
  it("reads Claude Code's Notification hook JSON as it comes", () => {
    expect(noticeOf({ hook_event_name: "Notification", session_id: "s1", cwd: "/Users/x/good_neighbours", message: "Claude needs your permission to use Bash", notification_type: "permission_prompt" }, 0))
      .toMatchObject({ kind: "attention", source: "Claude Code", title: "Claude Code", session: "s1", project: "good_neighbours", message: "Claude needs your permission to use Bash" });
    expect(noticeOf({ session_id: "s1", message: "Claude is waiting for your input", notification_type: "idle_prompt" }, 0)).toMatchObject({ kind: "idle" });
  });

  it("calls a usage-limit warning one that needs him, and takes Flyd's own shape", () => {
    expect(noticeOf({ source: "Claude Code", title: "Usage", message: "You've used 90% of your weekly limit" }, 0)).toMatchObject({ kind: "attention", title: "Usage" });
    expect(noticeOf({ source: "opencode", message: "Session finished", project: "flyd", kind: "idle" }, 0)).toMatchObject({ kind: "idle", source: "opencode", project: "flyd" });
  });

  it("says nothing without a message, and keeps what it holds short", () => {
    expect(noticeOf({ title: "Claude Code" }, 0)).toBeNull();
    expect(noticeOf({ message: 42 }, 0)).toBeNull();
    expect(noticeOf({ message: "x".repeat(1000) }, 0)!.message.length).toBeLessThanOrEqual(240);
  });
});

describe("NoticeBoard", () => {
  it("keeps one notice for repeats, so the island rings once", () => {
    let now = 1_000_000;
    const board = new NoticeBoard(() => now);
    const asked = { session_id: "s1", message: "Claude needs your permission to use Bash", notification_type: "permission_prompt" };
    const first = board.add(asked)!;
    now += 60_000;
    const again = board.add(asked)!;
    expect(again).toMatchObject({ id: first.id, count: 2 });
    expect(board.list()).toHaveLength(1);
    expect(board.ringing()?.id).toBe(first.id);
    now += REPEAT_MS + 1;
    expect(board.add(asked)!.id).not.toBe(first.id);
  });

  it("lets a session's newer notice replace its older one, and stops ringing once it is stale", () => {
    let now = 1_000_000;
    const board = new NoticeBoard(() => now);
    board.add({ session_id: "s1", message: "Claude needs your permission to use Bash", notification_type: "permission_prompt" });
    board.add({ session_id: "s2", message: "Claude is waiting for your input", notification_type: "idle_prompt" });
    board.add({ session_id: "s1", message: "Claude is waiting for your input", notification_type: "idle_prompt" });
    expect(board.list().map((notice) => [notice.session, notice.kind])).toEqual([["s2", "idle"], ["s1", "idle"]]);
    expect(board.ringing()).toBeUndefined();
    board.add({ message: "Weekly limit reached", title: "Usage" });
    expect(board.ringing()).toBeDefined();
    now += RING_MS + 1;
    expect(board.ringing()).toBeUndefined();
    now += NOTICE_TTL_MS;
    expect(board.list()).toEqual([]);
  });

  it("tells its listeners when a notice comes", () => {
    const board = new NoticeBoard();
    let heard = 0;
    const stop = board.onChange(() => (heard += 1));
    board.add({ message: "hi" });
    board.add({ title: "nothing" });
    stop();
    board.add({ message: "again" });
    expect(heard).toBe(1);
  });

  it("names where a notice came from on the island", () => {
    expect(noticeLine({ project: "flyd", message: "Claude is waiting for your input" })).toBe("flyd: Claude is waiting for your input");
    expect(noticeLine({ message: "Weekly limit reached" })).toBe("Weekly limit reached");
  });
});

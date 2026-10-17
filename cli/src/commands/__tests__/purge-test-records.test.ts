import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { purgeTestRecords } from "../purge-test-records.js";

function seed(path: string): void {
  const store = new IntelligenceEventStore({ path });
  let n = 0;
  const add = (sourceId: string, kind: string, payload: Record<string, unknown>) => {
    const db = (store as any).db;
    db.prepare(`INSERT INTO personal_events (id, schema_version, kind, source_id, captured_at, consent_json, retention_class, provenance, idempotency_key, payload_domain, payload_json)
      VALUES (?, 1, ?, ?, '2026-10-17T00:00:00Z', '{}', 'durable', 'test', ?, 'x', ?)`).run(`e${n}`, kind, sourceId, `k${n++}`, JSON.stringify(payload));
    return Number(db.prepare("SELECT MAX(sequence) s FROM personal_events").get().s);
  };
  // Test traffic.
  add("transition.cli-chat", "proposed_action", { sessionId: "9b1f", invocationId: "t1", action: { model: "gpt-4o-mini" } });
  add("transition.cli-chat", "verified_outcome", { invocationId: "t1", nextState: {} });
  const fixtureSeq = add("transition.cli-chat", "proposed_action", { sessionId: "route-fast", invocationId: "t2", action: { model: "anthropic:claude-sonnet-5-5" } });
  add("transition.judge", "observation", { transitionSeq: fixtureSeq, verdict: 1 });
  const convo = add("chat.cognition", "observation", { conversation: { sessionId: "u1", user: "who is the head coach", assistant: "done", projectIds: ["project:test-project"] } });
  add("cognition.system-one", "observation", { sourceEvent: convo });
  add("chat.cognition", "inferred_belief", { entity: { id: "topic:aaa" }, attribute: "fact", value: "who is the head coach" });
  add("chat.cognition", "inferred_belief", { entity: { id: "topic:aaa" }, attribute: "label", value: "who" });
  add("chat.cognition", "observation", { relation: { from: "topic:aaa", type: "part_of", to: "project:test-project" } });
  // George's real traffic.
  add("transition.cli-chat", "proposed_action", { sessionId: "20261017-real", invocationId: "r1", action: { model: "anthropic:claude-sonnet-5-5" } });
  add("transition.cli-chat", "verified_outcome", { invocationId: "r1", nextState: {} });
  add("chat.cognition", "observation", { conversation: { sessionId: "20261017-real", user: "plan my week", assistant: "Monday is light.", projectIds: ["project:flyd"] } });
  add("chat.cognition", "inferred_belief", { entity: { id: "topic:bbb" }, attribute: "fact", value: "plan my week" });
  add("transition.judge", "observation", { transitionSeq: 999999, verdict: 1 });
  store.close();
}

describe("purgeTestRecords", () => {
  it("dry run counts and changes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "purge-"));
    const dbPath = join(dir, "intelligence.sqlite");
    seed(dbPath);
    const report = await purgeTestRecords({ dbPath, dryRun: true });
    expect(report.totalDeleted).toBe(9);
    expect(report.eventsAfter).toBe(report.eventsBefore - 9);
    const after = new IntelligenceEventStore({ path: dbPath });
    expect(after.count()).toBe(report.eventsBefore);
    after.close();
    expect(existsSync(join(dir, "backups"))).toBe(false);
  });

  it("backs up first, deletes only test rows, and is idempotent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "purge-"));
    const dbPath = join(dir, "intelligence.sqlite");
    seed(dbPath);
    const report = await purgeTestRecords({ dbPath, rebuild: false });
    expect(report.totalDeleted).toBe(9);
    expect(report.backupPath && existsSync(report.backupPath)).toBe(true);
    expect(readdirSync(join(dir, "backups"))).toHaveLength(1);

    const store = new IntelligenceEventStore({ path: dbPath });
    const left = store.readFrom(0).map((e) => e.sourceId + ":" + e.kind);
    expect(left).toEqual([
      "transition.cli-chat:proposed_action",
      "transition.cli-chat:verified_outcome",
      "chat.cognition:observation",
      "chat.cognition:inferred_belief",
      "transition.judge:observation",
    ]);
    store.close();

    const again = await purgeTestRecords({ dbPath, rebuild: false });
    expect(again.totalDeleted).toBe(0);
    expect(again.backupPath).toBeUndefined();
  });

  it("removes a fixture prompt sent from several sessions in one go, but keeps a lone genuine use of it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "purge-"));
    const dbPath = join(dir, "intelligence.sqlite");
    const store = new IntelligenceEventStore({ path: dbPath });
    const db = (store as any).db;
    let n = 0;
    const add = (at: string, sessionId: string, intent: string, model = "local") => db.prepare(
      `INSERT INTO personal_events (id, schema_version, kind, source_id, captured_at, consent_json, retention_class, provenance, idempotency_key, payload_domain, payload_json)
       VALUES (?, 1, 'proposed_action', 'transition.cli-chat', ?, '{}', 'durable', 'test', ?, 'x', ?)`,
    ).run(`b${n}`, at, `bk${n++}`, JSON.stringify({ sessionId, invocationId: `i${n}`, action: { intent, model } }));
    for (const [i, id] of ["a1", "a2", "a3"].entries()) add(`2026-09-26T13:4${i}:00Z`, id, "what skills do i have");
    add("2026-10-02T09:00:00Z", "genuine-1", "what skills do i have");
    add("2026-10-02T09:05:00Z", "genuine-2", "Draft the invoice reminder for Friday");
    store.close();

    const report = await purgeTestRecords({ dbPath, rebuild: false });
    expect(report.totalDeleted).toBe(3);

    const after = new IntelligenceEventStore({ path: dbPath });
    expect(after.readFrom(0).map((e) => (e.payload as any).sessionId)).toEqual(["genuine-1", "genuine-2"]);
    after.close();
  });
});

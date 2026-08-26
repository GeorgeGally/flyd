import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../event-store.js";
import {
  ExecutiveCycle,
  opportunityDigest,
  type Opportunity,
} from "../executive/executive-cycle.js";

const dir = mkdtempSync(join(tmpdir(), "flyd-exec-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function cycle(name: string, config: Partial<ExecutiveCycle["config"]> = {}): ExecutiveCycle {
  const store = new IntelligenceEventStore({ path: join(dir, `exec-${name}.sqlite`) });
  return new ExecutiveCycle({
    store,
    config,
    statePath: join(dir, `exec-state-${name}.json`),
  });
}

function flightConflict(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    key: `calendar.conflict.${randomUUID().slice(0, 6)}`,
    benefit: 0.8,
    urgency: 0.7,
    confidence: 0.9,
    interruptionCost: 0.2,
    whyNow: "Two calendar events overlap in 40 minutes",
    whyMe: "You asked to be warned about scheduling conflicts",
    ...overrides,
  };
}

describe("ExecutiveCycle", () => {
  it("the same opportunity/policy/world-state digest does not interrupt twice", () => {
    const exec = cycle("dedup");
    const now = new Date("2026-08-23T10:00:00Z");
    const digestKey = "stable-opportunity";

    const first = exec.consider([flightConflict({ key: digestKey })], "world-v1", now);
    const interruptingFirst = first.filter((d) => d.action === "propose" || d.action === "notify");
    expect(interruptingFirst).toHaveLength(1);
    const eventsAfterFirst = exec.pendingInterventions().length;

    // same world state + same policy → same digest → no new interruption
    const second = exec.consider([flightConflict({ key: digestKey })], "world-v1", new Date(now.getTime() + 60_000));
    const repeat = second.find((d) => d.digest === interruptingFirst[0].digest)!;
    expect(repeat.reason).toBe("already_decided");
    expect(exec.pendingInterventions().length).toBe(eventsAfterFirst);

    // a changed world state produces a fresh digest and may interrupt again
    const third = exec.consider([flightConflict({ key: digestKey })], "world-v2", new Date(now.getTime() + 2 * 60 * 60_000));
    expect(third[0].digest).not.toBe(interruptingFirst[0].digest);
  });

  it("quiet hours, cooldowns, budgets, pause, and kill switch suppress delivery", () => {
    const morning = cycle(
      "suppress",
      { quietHours: [0, 420], cooldownMinutes: 30, dailyInterruptionBudget: 2 },
    );

    // quiet hours
    let decisions = morning.consider([flightConflict()], "w", new Date("2026-08-23T03:00:00Z"));
    expect(decisions[0]).toMatchObject({ action: "silent", reason: "quiet_hours" });

    // after quiet hours: interrupts
    decisions = morning.consider([flightConflict()], "w", new Date("2026-08-23T09:00:00Z"));
    expect(decisions[0].action).toBe("propose");

    // cooldown: bundles instead of interrupting again
    decisions = morning.consider([flightConflict()], "w2", new Date("2026-08-23T09:10:00Z"));
    expect(decisions[0]).toMatchObject({ action: "bundle", reason: "cooldown" });

    // kill switch silences everything
    morning.killSwitch(true);
    decisions = morning.consider([flightConflict()], "w3", new Date("2026-08-23T11:00:00Z"));
    expect(decisions[0]).toMatchObject({ action: "silent", reason: "kill_switch" });
    morning.killSwitch(false);

    // pause suppresses until lifted
    morning.pause(new Date("2026-08-23T12:00:00Z"));
    decisions = morning.consider([flightConflict()], "w4", new Date("2026-08-23T11:30:00Z"));
    expect(decisions[0]).toMatchObject({ action: "silent", reason: "paused" });

    // daily interruption budget eventually exhausts (budget=2, one used so far)
    morning.killSwitch(false);
    const afterPause = new Date("2026-08-23T12:05:00Z"); // past pause end, cooldown long expired
    const d1 = morning.consider([flightConflict()], "w5", afterPause);
    expect(d1[0].action).toBe("propose");
    const immediate = morning.consider([flightConflict()], "w6", new Date(afterPause.getTime() + 31 * 60_000));
    // budget exhausted (2/2 used) — but cooldown also passed; either way no propose beyond budget
    expect(immediate[0].action === "silent" || immediate[0].action === "bundle").toBe(true);
  });

  it("crash/retry resumes without duplicate proposals", () => {
    const storePath = join(dir, `resume-${randomUUID()}.sqlite`);
    const statePath = join(dir, `resume-${randomUUID()}.json`);
    const store = new IntelligenceEventStore({ path: storePath });
    const config = { policyVersion: "v1", cooldownMinutes: 0, dailyInterruptionBudget: 5 };
    const now = new Date("2026-08-23T10:00:00Z");

    // first process decides and dies
    const firstProcess = new ExecutiveCycle({ store, config, statePath });
    const batch = [flightConflict({ key: "crash-prone" }), flightConflict({ key: "also-crash-prone" })];
    const decided = firstProcess.consider(batch, "state-a", now);
    const interrupting = decided.filter((d) => d.action !== "silent").length;
    expect(interrupting).toBeGreaterThan(0);
    const eventCountBefore = store.count();

    // restarted process re-considers the same world: no duplicates
    const restarted = new ExecutiveCycle({ store, config, statePath });
    const again = restarted.consider(batch, "state-a", new Date(now.getTime() + 5 * 60_000));
    for (const record of again) {
      if (record.reason === "already_decided") continue;
      // anything newly considered must not have been an interruption before
      expect(record.action).not.toBe("propose");
    }
    expect(store.count()).toBe(eventCountBefore); // spine unchanged on replay

    // idempotency is structural: same digest → same idempotency key → coalesced append
    const digest = opportunityDigest("crash-prone", "state-a", "v1");
    store.append({
      pathKind: "executive",
      kind: "executive_decision",
      sourceId: "executive.cycle",
      consent: { grantedAt: now.toISOString(), scopes: ["executive"] },
      retentionClass: "local_default",
      payloadClassification: "operational",
      provenance: "executive:v1",
      idempotencyKey: `exec:${digest}`,
      payload: { digest },
    } as never);
    expect(store.count()).toBe(eventCountBefore);

    store.close();
  });

  it("every decision includes a concise why-now / why-me trace", () => {
    const exec = cycle("traces");
    const decisions = exec.consider([flightConflict()], "w", new Date("2026-08-23T10:00:00Z"));
    for (const decision of decisions) {
      expect(decision.whyNow).toBeTruthy();
      expect(decision.whyMe).toBeTruthy();
      expect(typeof decision.score).toBe("number");
    }
    // traces persist onto the spine events too
    const queued = exec.pendingInterventions();
    expect(queued.length).toBeGreaterThan(0);
    for (const intervention of queued) {
      expect(intervention.whyNow).toBeTruthy();
      expect(intervention.whyMe).toBeTruthy();
    }
  });

  it("ranks by score and defers low-confidence opportunities to notify", () => {
    const exec = cycle("rank", { cooldownMinutes: 0, dailyInterruptionBudget: 5 });
    const decisions = exec.consider(
      [
        flightConflict({ key: "weak-evidence", confidence: 0.3 }),
        flightConflict({ key: "strong-evidence", confidence: 0.95, benefit: 0.9 }),
      ],
      "w",
      new Date("2026-08-23T10:00:00Z"),
    );
    const byKey = Object.fromEntries(decisions.map((d) => [d.opportunityKey, d]));
    expect(byKey["strong-evidence"].action).toBe("propose");
    expect(byKey["weak-evidence"].action).toBe("notify");
  });
});

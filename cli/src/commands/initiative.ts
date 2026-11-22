import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { FLYD_DIR } from "../lib/config.js";
import { INITIATIVE_CURATED_CONTRACT, SourceContractRegistry } from "../intelligence/sensors/source-contracts.js";
import { IntelligenceEventStore, defaultIntelligenceDbPath } from "../intelligence/event-store.js";
import { activityRecordPath } from "../conversation-view/activity.js";
import { initiativeMode, runInitiativeCycle } from "../runtime/initiative/cycle.js";

const ID = INITIATIVE_CURATED_CONTRACT.sourceId;

export function erasePreparedInitiativeCards(path = activityRecordPath()): number {
  if (!existsSync(path)) return 0;
  const rows = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const keep = rows.filter(row => {
    try {
      const key = (JSON.parse(row) as { key?: unknown }).key;
      return typeof key !== "string" || !key.startsWith("initiative:");
    } catch { return true; }
  });
  if (keep.length === rows.length) return 0;
  const temp = path + "." + randomUUID() + ".tmp";
  writeFileSync(temp, keep.join("\n") + (keep.length ? "\n" : ""), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
  return rows.length - keep.length;
}

/** User action is explicit source consent; a generic "be proactive" is not. */
export async function runInitiativeCommand(action = "status"): Promise<void> {
  const registry = new SourceContractRegistry();
  registry.register(INITIATIVE_CURATED_CONTRACT);
  if (action === "enable") {
    if (registry.status(ID) === "revoked") {
      throw new Error("Initiative source was revoked. Run flyd initiative renew, then enable it explicitly.");
    }
    registry.setStatus(ID, "enabled");
    console.log("Enabled local evidence-based initiative from curated projects, Scout, Council and CoS results. No new private sources, provider uploads or autonomous external effects.");
    console.log("Use flyd initiative disable to stop. Use flyd initiative revoke to erase derived findings.");
    return;
  }
  if (action === "disable" || action === "pause") {
    registry.setStatus(ID, action === "pause" ? "paused" : "disabled");
    console.log("Proactive investigation " + (action === "pause" ? "paused" : "disabled") + "; previously prepared cards are no longer shown.");
    return;
  }
  if (action === "revoke") {
    if (registry.status(ID) === "revoked") {
      console.log("Initiative source is already revoked.");
      return;
    }
    registry.setStatus(ID, "revoked");
    let events = 0;
    const dbPath = defaultIntelligenceDbPath();
    if (existsSync(dbPath)) {
      const store = new IntelligenceEventStore({ path: dbPath });
      try {
        events = store.eraseSource(ID).tombstone.eventCount;
        const removed = erasePreparedInitiativeCards(activityRecordPath(FLYD_DIR));
        for (const sweep of store.pendingSweeps(ID).filter(s => s.surface === "legacy_copies")) {
          store.completeSweep(sweep.sweepId);
        }
        console.log("Revoked local initiative and erased " + events + " derived events and " + removed + " stored cards.");
      } finally { store.close(); }
    } else {
      erasePreparedInitiativeCards(activityRecordPath(FLYD_DIR));
      console.log("Revoked local initiative; no derived-event store exists.");
    }
    return;
  }
  if (action === "renew") {
    registry.renew(ID);
    const dbPath = defaultIntelligenceDbPath();
    if (existsSync(dbPath)) {
      const store = new IntelligenceEventStore({ path: dbPath });
      try { store.renewSource(ID); } finally { store.close(); }
    }
    console.log("New disabled consent generation prepared. Run flyd initiative enable to opt in again; previously erased events do not return.");
    return;
  }
  if (action === "run") {
    console.log(JSON.stringify(await runInitiativeCycle(), null, 2));
    return;
  }
  if (action !== "status") {
    throw new Error("Usage: flyd initiative status | enable | disable | pause | revoke | renew | run");
  }
  console.log([
    "Flyd self-initiated intelligence",
    "Local curated source: " + (registry.status(ID) ?? "disabled"),
    "Presentation mode: " + initiativeMode(),
    "Inputs: curated projects, Scout discoveries, Council advice, CoS outcome receipts",
    "Permission: local only. No external model or automatic worker actions.",
    "Output: one quiet source-linked hypothesis a day; original evidence remains authoritative.",
    "Opt in explicitly with flyd initiative enable. Shadow without cards: FLYD_INITIATIVE=shadow.",
  ].join("\n"));
}

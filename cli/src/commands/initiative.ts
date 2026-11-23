import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { FLYD_DIR } from "../lib/config.js";
import { INITIATIVE_CURATED_CONTRACT, INITIATIVE_PUBLIC_RESEARCH_CONTRACT, INITIATIVE_MANDATE_CONTRACT, SourceContractRegistry } from "../intelligence/sensors/source-contracts.js";
import { readProjects } from "../council/projects.js";
import { acceptReadOnlyInitiativeMandate } from "../runtime/initiative/mandate.js";
import { recordInitiativeReview, summarizeInitiativeOutcomes } from "../runtime/initiative/outcomes.js";
import { purgeInitiativeObjectives } from "../command/cos/objectives.js";
import { IntelligenceEventStore, defaultIntelligenceDbPath } from "../intelligence/event-store.js";
import { activityRecordPath } from "../conversation-view/activity.js";
import { initiativeMode, runInitiativeCycle } from "../runtime/initiative/cycle.js";

const ID = INITIATIVE_CURATED_CONTRACT.sourceId;

export function erasePreparedInitiativeCards(path = activityRecordPath(), researchOnly = false): number {
  if (!existsSync(path)) return 0;
  const rows = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const keep = rows.filter(row => {
    try {
      const key = (JSON.parse(row) as { key?: unknown }).key;
      return typeof key !== "string" || !(researchOnly
        ? key.startsWith("initiative:research:") || key.startsWith("initiative:cos:")
        : key.startsWith("initiative:"));
    } catch { return !row.includes("initiative:"); }
  });
  if (keep.length === rows.length) return 0;
  const temp = path + "." + randomUUID() + ".tmp";
  writeFileSync(temp, keep.join("\n") + (keep.length ? "\n" : ""), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
  return rows.length - keep.length;
}

/** User action is explicit source consent; a generic "be proactive" is not. */
export async function runInitiativeCommand(action = "status", projectId?: string, verdict?: string): Promise<void> {
  const registry = new SourceContractRegistry();
  registry.register(INITIATIVE_CURATED_CONTRACT);
  registry.register(INITIATIVE_PUBLIC_RESEARCH_CONTRACT);
  registry.register(INITIATIVE_MANDATE_CONTRACT);
  if (action === "review") {
    if (!projectId || (verdict !== "helpful" && verdict !== "not_helpful")) {
      throw new Error("Usage: flyd initiative review <candidate-id> helpful|not_helpful");
    }
    const path = defaultIntelligenceDbPath();
    if (!existsSync(path)) throw new Error("No local initiative research is recorded.");
    const store = new IntelligenceEventStore({ path });
    try {
      console.log(recordInitiativeReview({ store, registry, candidateId: projectId, verdict }));
    } finally { store.close(); }
    return;
  }
  if (action === "stats" || action === "doctor") {
    const path = defaultIntelligenceDbPath();
    if (!existsSync(path)) {
      console.log("No intelligence store exists. Source consent remains " + registry.status(ID) + ".");
      return;
    }
    const store = new IntelligenceEventStore({ path });
    try {
      const events = store.readSourcePage(ID, { limit: 1000 });
      const summary = summarizeInitiativeOutcomes(events);
      console.log(JSON.stringify({
        localConsent: registry.status(ID),
        publicResearchConsent: registry.status(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId),
        mandateConsent: registry.status(INITIATIVE_MANDATE_CONTRACT.sourceId),
        mode: initiativeMode(),
        sourceStatus: store.isRevoked(ID) ? "erased" : "available",
        research: summary,
        budget: { researchPerDay: 2, ambientCardsPerDay: 1 },
        outstandingErasureSweeps: store.pendingSweeps(ID).map(s => s.surface),
        ...(action === "doctor" ? {
          macRuntime: process.platform === "darwin" ? "macOS: verify installed Core and UI manually" : "not macOS",
          verifiedLivePilot: false,
          releaseReadiness: "requires explicit macOS acceptance and outcome evaluation",
        } : {}),
      }, null, 2));
    } finally { store.close(); }
    return;
  }
  if (action === "authorize-readonly") {
    if (!projectId) throw new Error("Specify an existing project id: flyd initiative authorize-readonly <project-id>");
    if (registry.status(ID) !== "enabled" || registry.status(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId) !== "enabled") {
      throw new Error("Enable local initiative and public evidence research first.");
    }
    const project = readProjects().find(item => item.id === projectId);
    if (!project) throw new Error("Unknown curated project id.");
    const source = INITIATIVE_MANDATE_CONTRACT.sourceId;
    if (registry.status(source) === "revoked") throw new Error("Mandate source revoked. Run flyd initiative renew-mandates first.");
    registry.setStatus(source, "enabled");
    const store = new IntelligenceEventStore();
    try {
      const mandate = acceptReadOnlyInitiativeMandate(store, project, { explicitUserAction: true, registry });
      console.log("Accepted READ-ONLY research follow-up for " + project.name + " until " + mandate.expiresAt + ".");
      console.log("No repository edits, sending, publishing, payments or new user-owned decisions are authorized.");
    } finally { store.close(); }
    return;
  }
  if (action === "revoke-mandates" || action === "renew-mandates") {
    const source = INITIATIVE_MANDATE_CONTRACT.sourceId;
    if (action === "revoke-mandates") {
      registry.setStatus(source, "revoked");
      const dbPath = defaultIntelligenceDbPath();
      if (existsSync(dbPath)) {
        const store = new IntelligenceEventStore({ path: dbPath });
        try { store.eraseSource(source); } finally { store.close(); }
      }
      const removed = purgeInitiativeObjectives();
      erasePreparedInitiativeCards(activityRecordPath(FLYD_DIR), true);
      console.log("Read-only initiative remits revoked; cleared " + removed + " generated CoS objective records.");
    } else {
      registry.renew(source);
      const dbPath = defaultIntelligenceDbPath();
      if (existsSync(dbPath)) {
        const store = new IntelligenceEventStore({ path: dbPath });
        try { store.renewSource(source); } finally { store.close(); }
      }
      console.log("Mandates remain disabled until you explicitly authorize a project again.");
    }
    return;
  }
  if (action === "research-enable") {
    if (registry.status(ID) !== "enabled") throw new Error("Enable local initiative first: flyd initiative enable");
    if (registry.status(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId) === "revoked") {
      throw new Error("Public research was revoked. Run flyd initiative research-renew before enabling it.");
    }
    registry.setStatus(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId, "enabled");
    console.log("Enabled bounded PUBLIC evidence lookup only. Private project facts cannot enter the public query.");
    return;
  }
  if (action === "research-disable" || action === "research-pause") {
    registry.setStatus(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId, action === "research-pause" ? "paused" : "disabled");
    console.log("Background public research stopped.");
    return;
  }
  if (action === "research-revoke") {
    registry.setStatus(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId, "revoked");
    const dbPath = defaultIntelligenceDbPath();
    let derived = 0;
    if (existsSync(dbPath)) {
      const store = new IntelligenceEventStore({ path: dbPath });
      try { derived = store.retractInitiativeResearch(); } finally { store.close(); }
    }
    const cards = erasePreparedInitiativeCards(activityRecordPath(FLYD_DIR), true);
    purgeInitiativeObjectives();
    console.log("Public research revoked; erased " + derived + " research events and " + cards + " research cards.");
    return;
  }
  if (action === "research-renew") {
    registry.renew(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId);
    console.log("Public research consent reset to disabled. Enable explicitly if needed.");
    return;
  }
  if (action === "research-run") {
    const { runInitiativeResearchCycle } = await import("../runtime/initiative/research-cycle.js");
    console.log(JSON.stringify(await runInitiativeResearchCycle({ registry }), null, 2));
    return;
  }
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
    registry.setStatus(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId, "disabled");
    registry.setStatus(INITIATIVE_MANDATE_CONTRACT.sourceId, "disabled");
    console.log("Proactive investigation " + (action === "pause" ? "paused" : "disabled") + "; previously prepared cards are no longer shown.");
    return;
  }
  if (action === "revoke") {
    if (registry.status(ID) === "revoked") {
      console.log("Initiative source is already revoked.");
      return;
    }
    registry.setStatus(ID, "revoked");
    registry.setStatus(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId, "revoked");
    registry.setStatus(INITIATIVE_MANDATE_CONTRACT.sourceId, "revoked");
    purgeInitiativeObjectives();
    let events = 0;
    const dbPath = defaultIntelligenceDbPath();
    if (existsSync(dbPath)) {
      const store = new IntelligenceEventStore({ path: dbPath });
      try {
        events = store.eraseSource(ID).tombstone.eventCount;
        store.eraseSource(INITIATIVE_MANDATE_CONTRACT.sourceId);
        store.eraseSource(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId);
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
    // Mandates remain revoked until a separate explicit renew-mandates action.
    const dbPath = defaultIntelligenceDbPath();
    if (existsSync(dbPath)) {
      const store = new IntelligenceEventStore({ path: dbPath });
      try { store.renewSource(ID); } finally { store.close(); }
    }
    console.log("New disabled consent generation prepared. Run flyd initiative enable to opt in again; previously erased events do not return.");
    return;
  }
  if (action === "run") {
    const local = await runInitiativeCycle();
    const { runInitiativeResearchCycle } = await import("../runtime/initiative/research-cycle.js");
    const publicResearch = registry.status(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId) === "enabled"
      ? await runInitiativeResearchCycle({ registry }) : { held: ["public_research_not_enabled"] };
    console.log(JSON.stringify({ local, publicResearch }, null, 2));
    return;
  }
  if (action !== "status") {
    throw new Error("Usage: flyd initiative status|stats|doctor|review <candidate-id> helpful|not_helpful|enable|disable|pause|revoke|renew|run|research-enable|research-disable|research-pause|research-revoke|research-renew|research-run|authorize-readonly <project-id>|revoke-mandates|renew-mandates");
  }
  console.log([
    "Flyd self-initiated intelligence",
    "Local curated source: " + (registry.status(ID) ?? "disabled"),
    "Presentation mode: " + initiativeMode(),
    "Public research permission: " + registry.status(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId),
    "Read-only research mandates: " + registry.status(INITIATIVE_MANDATE_CONTRACT.sourceId),
    "Inputs: curated projects, Scout discoveries, Council advice, CoS outcome receipts",
    "Local initiative is private. Separately enabled PUBLIC lookups may use public Scout titles/URLs only.",
    "Output: one quiet source-linked hypothesis a day; original evidence remains authoritative.",
    "Opt in: flyd initiative enable. Optional public research: flyd initiative research-enable.",
    "Shadow without cards: FLYD_INITIATIVE=shadow. No private model upload or automatic external effects.",
  ].join("\n"));
}

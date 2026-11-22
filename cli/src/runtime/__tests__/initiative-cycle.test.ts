import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { INITIATIVE_CURATED_CONTRACT, SourceContractRegistry } from "../../intelligence/sensors/source-contracts.js";
import { erasePreparedInitiativeCards } from "../../commands/initiative.js";
import { ActivityReader, recordActivity, visibleInitiativeRecords, type ActivityRecord } from "../../conversation-view/activity.js";
import type { Project } from "../../council/projects.js";
import type { Edition } from "../../council/scout.js";
import type { Advisory } from "../../council/advisors.js";
import { deriveInitiatives, initiativeRevision, type InitiativeSource } from "../initiative/candidates.js";
import { decideInitiative, inspectInitiative, safeInitiativePayload } from "../initiative/policy.js";
import { initiativeActivity, runInitiativeCycle } from "../initiative/cycle.js";
import { initiativeSourcesCurrent } from "../initiative/source-validity.js";

const now = new Date("2026-11-23T12:00:00Z");
const project: Project = {
  id: "gen-typography", name: "Generative Typography", kind: "creative",
  status: "active", what: "Experimental generative typography visuals", now: "Testing motion and visual identity",
  people: [], repos: [], updated: "2026-11-23",
};
const edition: Edition = {
  date: "2026-11-23", generatedAt: now.toISOString(), topics: ["creative code"],
  items: [
    { n: 1, title: "Particle array Generative Typography experiments", url: "https://design.example.org/typography",
      source: "Creative Archive", topic: "design", why: "Particle arrays create experimental generative typography effects", kind: "relevant" },
    { n: 2, title: "Generic travel article", url: "https://news.example.org/travel",
      source: "News", topic: "travel", why: "Travel destination", kind: "relevant" },
  ],
};
const advisory: Advisory = {
  id: "advisory-1", advisor: "critic", text: "Review the missing tests for generative typography output.",
  headline: "An untested output path", whyNow: "A test never ran",
  evidence: ["project:gen-typography"], confidence: "high", urgency: "normal",
  topics: ["generative", "typography"], createdAt: now.toISOString(), expires: "2026-11-25", status: "open",
};

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});
function dir(): string {
  const path = mkdtempSync(join(tmpdir(), "flyd-initiative-"));
  dirs.push(path);
  return path;
}
function store(path: string): IntelligenceEventStore {
  return new IntelligenceEventStore({ path: join(path, "intelligence.sqlite") });
}
function sources(): ReturnType<typeof deriveInitiatives> {
  return deriveInitiatives({ now, projects: [project], edition, advisories: [advisory] });
}

describe("Flyd v10 source-grounded curiosity", () => {
  it("forms independent questions from live projects, public references and evidence-backed advice", () => {
    const found = sources();
    expect(found.some(x => x.origin === "scout" && x.question.includes("Generative Typography"))).toBe(true);
    expect(found.some(x => x.origin === "council" && x.question.includes("evidence"))).toBe(true);
    expect(found.every(x => x.sources.length && x.sources.every(s => s.evidenceRef && s.revision))).toBe(true);
    expect(found.every(x => x.counterQuestion && x.proposedTest)).toBe(true);
  });

  it("refuses revoked, stale, unrelated, personal and missing-source inputs", () => {
    const projects = [project, { ...project, id: "personal", name: "Private family health", what: "medical notes" }];
    const found = deriveInitiatives({ now, projects, edition, advisories: [advisory],
      sourceAllowed: s => !s.id.startsWith("project:") });
    expect(found.some(x => x.origin === "scout")).toBe(false);
    expect(found.some(x => x.origin === "council")).toBe(true);
    expect(deriveInitiatives({ now, projects: [project], edition: { ...edition, date: "2026-11-01" } })).toHaveLength(0);
    expect(deriveInitiatives({ now, projects: [{ ...project, updated: "2026-01-01" }], edition })).toHaveLength(0);
    expect(deriveInitiatives({ now, projects: [], advisories: [] })).toEqual([]);
  });

  it("notices an explicitly dated waiting venture independently of Calendar or personal sensing", () => {
    const waiting: Project = {
      ...project, id: "market", name: "Community Market", kind: "venture",
      status: "waiting", next: "Confirm the venue contract",
      due: "2026-11-25", now: "Venue has not confirmed the revised terms",
    };
    const found = deriveInitiatives({ now, projects: [waiting] });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ origin: "project", domain: "venture" });
    expect(found[0]?.observed).toContain("Recorded due date: 2026-11-25");
    expect(decideInitiative(found[0]!, { mode: "on", allowed: () => true }).attention).toBe("silent");
    const cleared = deriveInitiatives({ now, projects: [{ ...waiting, status: "active" }] });
    expect(cleared).toHaveLength(0);
  });

  it("uses evidence/source revisions as stable identity, never Date.now or prose punctuation", () => {
    const a = sources().find(x => x.origin === "scout")!;
    const b = deriveInitiatives({ now: new Date(now.getTime() + 60_000), projects: [project], edition }).find(x => x.origin === "scout")!;
    expect(a.id).toBe(b.id);
    expect(initiativeRevision(a.sources)).toBe(initiativeRevision(b.sources));
    expect(initiativeRevision(a.sources.map(s => ({ ...s, revision: s.revision + "-revised" })))).not.toBe(initiativeRevision(a.sources));
  });

  it("preserves uncertain findings separately from verified outcomes and action authority", () => {
    const candidate = sources().find(x => x.origin === "scout")!;
    const decision = decideInitiative(candidate, { mode: "on", allowed: () => true });
    expect(decision.disposition).toBe("investigate");
    const finding = inspectInitiative(candidate);
    expect(finding.verified).toBe(false);
    expect(finding.whatIsNotKnown).toContain("genuinely different");
    const payload = safeInitiativePayload(candidate, finding);
    expect(payload.verified).toBe(false);
    expect(payload).not.toHaveProperty("authorityGrantId");
    expect(payload).not.toHaveProperty("doneWhen");
  });

  it("recognizes repeated failures only when two different accepted objectives share the obstacle", () => {
    const tmp = dir();
    const db = store(tmp);
    try {
      for (const [index, outcome] of [
        "Build image pipeline missing input validation",
        "Image pipeline missing input validation in worker",
      ].entries()) {
        db.append({
          pathKind: "interface", kind: "observation", sourceId: "cos.report",
          consent: { grantedAt: now.toISOString(), scopes: ["operational"] },
          retentionClass: "local_default", payloadClassification: "operational",
          provenance: "test:cos", idempotencyKey: "r" + index,
          payload: { report: { objectiveId: "obj-" + index, kind: "blocked", outcome } },
        });
      }
      const items = deriveInitiatives({ now, projects: [], reports: db.readSource("cos.report") });
      expect(items.filter(x => x.origin === "cos_failure")).toHaveLength(1);
      expect(items[0]?.sources).toHaveLength(2);
      expect(items[0]?.hypothesis).toContain("possibly");
    } finally { db.close(); }
  });

  it("writes the decision and an unverified proposal once across repeated Core ticks", async () => {
    const tmp = dir(); const db = store(tmp);
    try {
      const deps = { now: () => now, store: db, projects: () => [project],
        edition: () => edition, advisories: () => [advisory], mode: "shadow" as const, consented: () => true };
      const first = await runInitiativeCycle(deps);
      expect(first.generated).toBeGreaterThanOrEqual(2);
      expect(first.investigated).toBeGreaterThanOrEqual(1);
      expect(first.published).toBe(0);
      const initial = db.readSource("initiative.curated");
      expect(initial.some(e => e.kind === "proposed_action")).toBe(true);
      expect(initial.some(e => e.kind === "verified_outcome")).toBe(false);
      await runInitiativeCycle(deps);
      expect(db.readSource("initiative.curated").length).toBe(initial.length);
    } finally { db.close(); }
  });

  it("never restores erased proposals, but permits fresh reasoning after explicit consent renewal", async () => {
    const tmp = dir(); const db = store(tmp);
    try {
      const deps = { now: () => now, store: db, projects: () => [project],
        edition: () => edition, advisories: () => [advisory],
        mode: "shadow" as const, consented: () => true };
      await runInitiativeCycle(deps);
      const original = db.readSource("initiative.curated");
      expect(original.length).toBeGreaterThanOrEqual(2);
      const erased = db.eraseSource("initiative.curated");
      expect(erased.tombstone.eventCount).toBe(original.length);
      expect(db.readSource("initiative.curated").every(e => e.erased && !e.payload)).toBe(true);
      db.renewSource("initiative.curated");
      const fresh = await runInitiativeCycle(deps);
      expect(fresh.investigated).toBeGreaterThanOrEqual(1);
      const events = db.readSource("initiative.curated");
      expect(events.some(e => !e.erased && !!e.payload)).toBe(true);
      expect(events.filter(e => e.erased)).toHaveLength(original.length);
    } finally { db.close(); }
  });

  it("publishes no more than one quiet card, without requiring a new task or notification", async () => {
    const tmp = dir(); const db = store(tmp);
    const seen = new Set<string>(); const cards: ActivityRecord[] = [];
    try {
      const deps = { now: () => now, store: db, projects: () => [project], edition: () => edition,
        advisories: () => [advisory], mode: "on" as const, consented: () => true,
        seen: (key: string) => seen.has(key), countPublished: () => cards.length,
        record: (card: ActivityRecord) => { cards.push(card); seen.add(card.key!); },
      };
      const first = await runInitiativeCycle(deps);
      expect(first.published).toBe(1);
      await runInitiativeCycle(deps);
      expect(cards).toHaveLength(1);
      expect(cards[0]?.key?.startsWith("initiative:")).toBe(true);
      expect(cards[0]?.sourceRefs?.length).toBeGreaterThanOrEqual(2);
      expect(cards[0]?.line).toMatch(/\?/);
      expect(cards[0]?.title).not.toMatch(/worker|agent|staff/i);
    } finally { db.close(); }
  });

  it("hides a recorded idea as soon as a source changes or initiative is disabled", () => {
    const candidate = sources().find(x => x.origin === "scout")!;
    const card = initiativeActivity(candidate);
    const current = { projects: [project], edition, advisories: [advisory], reports: [] };
    const allowed = (refs: InitiativeSource[]) => initiativeSourcesCurrent(refs, current);
    expect(visibleInitiativeRecords([card], { enabled: true, current: allowed })).toHaveLength(1);
    expect(visibleInitiativeRecords([card], { enabled: false, current: allowed })).toEqual([]);
    expect(visibleInitiativeRecords([card], {
      enabled: true, current: refs => initiativeSourcesCurrent(refs, { ...current, projects: [] }),
    })).toEqual([]);
    expect(visibleInitiativeRecords([card], {
      enabled: true, current: refs => initiativeSourcesCurrent(refs, { ...current, edition: { ...edition, generatedAt: "2026-11-23T15:00:00Z" } }),
    })).toEqual([]);
  });

  it("does not read any curated source or open a DB without explicit LEARN consent", async () => {
    const tmp = dir();
    const result = await runInitiativeCycle({
      mode: "on", consented: () => false,
      now: () => now,
      projects: () => { throw new Error("private project source was accessed"); },
      edition: () => { throw new Error("private edition source was accessed"); },
      advisories: () => { throw new Error("private advisory source was accessed"); },
    });
    expect(result.mode).toBe("off");
    expect(result.reasons).toContain("source_consent_required");
    expect(existsSync(join(tmp, "intelligence.sqlite"))).toBe(false);
  });

  it("revoke removes persisted initiative presentation records without changing other activity", () => {
    const tmp = dir();
    const card = initiativeActivity(sources().find(x => x.origin === "scout")!);
    recordActivity(card, tmp, now);
    recordActivity({ key: "other", kind: "noted", title: "Real work remains" }, tmp, now);
    expect(erasePreparedInitiativeCards(join(tmp, "activity", "records.jsonl"))).toBe(1);
    const reader = new ActivityReader({ dir: tmp, now: () => now.getTime() });
    reader.refresh();
    expect(reader.current().recent.some(x => x.title === "Real work remains")).toBe(true);
  });

  it("the installed reader checks live evidence, not only visibility when the card was written", () => {
    vi.stubEnv("FLYD_INITIATIVE", "on");
    const tmp = dir();
    mkdirSync(join(tmp, "scout"), { recursive: true });
    const consent = new SourceContractRegistry({ path: join(tmp, "intelligence", "source-consents.json") });
    consent.register(INITIATIVE_CURATED_CONTRACT);
    consent.setStatus(INITIATIVE_CURATED_CONTRACT.sourceId, "enabled");
    writeFileSync(join(tmp, "projects.json"), JSON.stringify({ projects: [project] }));
    writeFileSync(join(tmp, "scout", "edition-latest.json"), JSON.stringify(edition));
    recordActivity(initiativeActivity(sources().find(x => x.origin === "scout")!), tmp, now);
    const reader = new ActivityReader({ dir: tmp, now: () => now.getTime() });
    reader.refresh();
    expect(reader.current().recent.some(x => x.title.includes("connection"))).toBe(true);
    writeFileSync(join(tmp, "projects.json"), JSON.stringify({ projects: [] }));
    reader.refresh();
    expect(reader.current().recent.some(x => x.title.includes("connection"))).toBe(false);
  });
});

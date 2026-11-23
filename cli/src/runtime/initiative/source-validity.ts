import { existsSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../../lib/config.js";
import { readProjects, type Project } from "../../council/projects.js";
import { latestEdition, type Edition } from "../../council/scout.js";
import { readAdvisories, type Advisory } from "../../council/advisors.js";
import { IntelligenceEventStore, type StoredEvent } from "../../intelligence/event-store.js";
import type { InitiativeSource } from "./candidates.js";
import { projectRevision, scoutItemRevision, councilRevision } from "./lineage.js";

export interface CurrentInitiativeEvidence {
  projects: Project[];
  edition: Edition | null;
  advisories: Advisory[];
  reports: StoredEvent[];
}

/** A source's current revision, not the state it had when a card was written. */
export function initiativeSourcesCurrent(sources: InitiativeSource[], current: CurrentInitiativeEvidence): boolean {
  if (!sources.length) return false;
  return sources.every(s => {
    if (!s.id || !s.revision || !s.evidenceRef) return false;
    if (s.scope === "public") {
      if (!s.id.startsWith("scout:") || !current.edition) return false;
      return current.edition.items.some(item =>
        "scout:" + (item.storyId ?? item.url) === s.id && item.url === s.evidenceRef
        && scoutItemRevision(item) === s.revision);
    }
    if (s.scope !== "local_operational") return false;
    if (s.id.startsWith("project:")) {
      const project = current.projects.find(p => "project:" + p.id === s.id);
      return !!project && projectRevision(project) === s.revision && !["done", "paused"].includes(project.status);
    }
    if (s.id.startsWith("council:")) {
      return current.advisories.some(a =>
        "council:" + a.id === s.id && councilRevision(a) === s.revision && a.status === "open");
    }
    if (s.id.startsWith("cos:")) {
      return current.reports.some(e =>
        "cos:" + e.id === s.id && String(e.sequence) === s.revision && !e.erased && e.kind === "observation");
    }
    return false;
  });
}

/** The live Activity reader uses this before every display of a candidate. */
export function currentInitiativeEvidence(dir = FLYD_DIR): CurrentInitiativeEvidence {
  const projects = readProjects(dir === FLYD_DIR ? undefined : join(dir, "projects.json"));
  const edition = latestEdition(dir === FLYD_DIR ? undefined : join(dir, "scout"));
  const advisories = readAdvisories(dir === FLYD_DIR ? undefined : join(dir, "council", "advisories.jsonl"));
  const dbPath = join(dir, "intelligence.sqlite");
  let reports: StoredEvent[] = [];
  if (existsSync(dbPath)) {
    const store = new IntelligenceEventStore({ path: dbPath });
    try { reports = store.readSourcePage("cos.report", { limit: 200 }); }
    finally { store.close(); }
  }
  return { projects, edition, advisories, reports };
}

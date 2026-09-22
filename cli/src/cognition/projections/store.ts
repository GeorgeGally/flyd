import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { ProjectionEngine } from "../../intelligence/projections.js";
import { deriveWorldState, worldModelProjector, type DerivedWorldState } from "../../intelligence/world/world-model.js";

export interface KnowledgeProjectionPaths {
  root: string;
  profile: string;
  now: string;
  projects: string;
}

export function knowledgeProjectionPaths(): KnowledgeProjectionPaths {
  const flyd = process.env.FLYD_DIR?.trim() || join(homedir(), ".flyd");
  const root = join(flyd, "knowledge");
  return { root, profile: join(root, "PROFILE.md"), now: join(root, "NOW.md"), projects: join(root, "projects") };
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content.endsWith("\n") ? content : content + "\n", { encoding: "utf8", mode: 0o600 });
}

function line(claim: DerivedWorldState["current"][number]): string {
  const date = claim.validUntil ? ` until ${claim.validUntil}` : claim.observedAt ? ` observed ${claim.observedAt.slice(0,10)}` : "";
  return `- [${claim.authority}; ${claim.temporalStatus}${date}] ${claim.entityId} · ${claim.attribute}: ${claim.value}`;
}

export function renderProfile(state: DerivedWorldState): string {
  const profileClaims = state.current.filter((c) =>
    c.entityId.startsWith("person:") ||
    c.entityId.startsWith("preference:") ||
    /preference|communication|autonomy|identity|role|location|diet|style/i.test(c.attribute)
  );
  return ["# PROFILE", "", `Generated: ${state.now}`, "", "## Durable context", ...(profileClaims.length ? profileClaims.map(line) : ["- No canonical profile claims yet."])].join("\n");
}

export function renderNow(state: DerivedWorldState): string {
  const active = state.current.filter((c) => !c.timeShape || c.timeShape !== "historical").slice(0,80);
  const historical = state.historical.filter((c) => ["completed","expired","cancelled","superseded"].includes(c.temporalStatus)).slice(0,20);
  const conflicts = state.conflicts.slice(0,20);
  return [
    "# NOW", "",
    `Generated: ${state.now}`, "",
    "## Active now", ...(active.length ? active.map(line) : ["- No canonical active claims."]),
    "", "## Recently completed / expired", ...(historical.length ? historical.map(line) : ["- None."]),
    "", "## Conflicts", ...(conflicts.length ? conflicts.map((c) => `- ${c.entityId} · ${c.attribute}: ${[c.active.value,...c.conflicting.map((x) => x.claim.value)].join(" ↔ ")}`) : ["- None."]),
  ].join("\n");
}

function projectIds(state: DerivedWorldState): string[] {
  const ids = new Set<string>();
  for (const c of [...state.current, ...state.historical]) {
    if (c.entityId.startsWith("project:") || c.entityId.startsWith("event:")) ids.add(c.entityId);
  }
  for (const r of state.relations) {
    if (r.fromId.startsWith("project:") || r.fromId.startsWith("event:")) ids.add(r.fromId);
    if (r.toId.startsWith("project:") || r.toId.startsWith("event:")) ids.add(r.toId);
  }
  return [...ids];
}

function renderProject(id: string, state: DerivedWorldState): string {
  const relatedIds = new Set([id]);
  for (const r of state.relations) {
    if (r.fromId === id) relatedIds.add(r.toId);
    if (r.toId === id) relatedIds.add(r.fromId);
  }
  const current = state.current.filter((c) => relatedIds.has(c.entityId));
  const history = state.historical.filter((c) => relatedIds.has(c.entityId)).slice(0,30);
  const relations = state.relations.filter((r) => r.fromId === id || r.toId === id);
  return [
    "---", `id: ${id}`, `updated_at: ${state.now}`, "---", "",
    `# ${id}`, "", "## Current state", ...(current.length ? current.map(line) : ["- No current claims."]),
    "", "## Relations", ...(relations.length ? relations.map((r) => `- ${r.fromId} --${r.type}--> ${r.toId} [${r.confidence.toFixed(2)}]`) : ["- None."]),
    "", "## History", ...(history.length ? history.map(line) : ["- None."]),
  ].join("\n");
}

export function rebuildKnowledgeProjections(store?: IntelligenceEventStore): DerivedWorldState {
  const owned = !store;
  const eventStore = store ?? new IntelligenceEventStore();
  try {
    const engine = new ProjectionEngine(eventStore, worldModelProjector);
    const snapshot = engine.rebuild(0);
    const state = deriveWorldState(snapshot.state);
    const paths = knowledgeProjectionPaths();
    write(paths.profile, renderProfile(state));
    write(paths.now, renderNow(state));
    mkdirSync(paths.projects, { recursive: true, mode: 0o700 });
    for (const id of projectIds(state)) {
      const slug = id.replace(/[^a-z0-9._-]+/gi, "-");
      write(join(paths.projects, `${slug}.md`), renderProject(id, state));
    }
    return state;
  } finally {
    if (owned) eventStore.close();
  }
}

export function readProjection(kind: "profile" | "now"): string {
  const paths = knowledgeProjectionPaths();
  const path = kind === "profile" ? paths.profile : paths.now;
  if (!existsSync(path)) {
    try { rebuildKnowledgeProjections(); } catch { return ""; }
  }
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

export function readProjectProjection(projectId: string): string {
  const paths = knowledgeProjectionPaths();
  const path = join(paths.projects, `${projectId.replace(/[^a-z0-9._-]+/gi, "-")}.md`);
  try { return existsSync(path) ? readFileSync(path, "utf8") : ""; } catch { return ""; }
}

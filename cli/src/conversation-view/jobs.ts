import { basename } from "node:path";
import { applyProjectOps, projectId, readProjects, type Project, type ProjectKind } from "../council/projects.js";
import type { DomainRun } from "../command/types.js";
import { digestHash, type DigestSource, type JobDigest } from "./job-digest.js";
import type { ShowItem, ShowScreen } from "./show.js";

/**
 * A job is a project George is moving, not one delegated run. Runs, conversations
 * and artefacts group under it. Status comes from those records: a run that
 * needs a decision, a run that is open, a project marked waiting or done.
 * `project.now` is not a status.
 */

export type JobGroup = "needs" | "working" | "waiting" | "done";

export interface JobArtifact {
  label: string;
  kind: "file" | "image" | "pr" | "url";
  /** A same-origin or https URL. A file that only exists on disk has no href. */
  href?: string;
}

export interface JobThread {
  id: string;
  title: string;
  at: string;
  kind: "conversation" | "run";
}

export interface JobDigestView {
  changed: string;
  means: string;
  needed: string;
  link?: string;
}

export interface Job {
  id: string;
  group: JobGroup;
  state: string;
  title: string;
  /** Client, or the one-line what, shown beside the state. */
  project: string;
  at: string;
  next: string;
  /** "you" when the next action is his; otherwise the run's owner. */
  owner: string;
  /** The decision, when the group is needs. */
  ask: string;
  because: string;
  shots: Array<{ src: string; label: string }>;
  links: Array<{ label: string; url: string }>;
  files: Array<{ label: string }>;
  threads: JobThread[];
  digest: JobDigestView | null;
  /** The show item's decision, when the job needs one, so the job opens on its decisions. */
  decision?: ShowItem["decision"];
}

export interface JobRun {
  id: string;
  status: string;
  project?: string;
  outcome: string;
  owner: string;
  updatedAt: string;
  question?: string;
  report?: string;
  artifacts: string[];
}

export interface JobSession {
  id: string;
  title: string;
  project?: string;
  updatedAt: string;
}

export interface JobReport {
  project?: string;
  title: string;
  text: string;
  link?: string;
  at?: string;
}

export interface JobBoard {
  jobs: Job[];
  fleetKnown: boolean;
  /** Named by a run or a conversation, and not on the project list yet. */
  inferred: Array<{ name: string; kind: ProjectKind }>;
  /** Artefacts with no stored reading. The column does not distil these while drawing. */
  pending: DigestSource[];
}

const DAY = 24 * 60 * 60 * 1000;
const DONE_KEEP_DAYS = 21;
const REPORT_CHARS = 240;
const OPEN_RUN = new Set(["queued", "accepted", "working", "needs_decision", "incomplete", "failed"]);
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

const STATE: Record<JobGroup, string> = { needs: "Needs you", working: "Working", waiting: "Waiting", done: "Done" };

export function jobKey(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return slug.replace(/capfive|capfire|cap5/g, "cap5");
}

const one = (value: string, max = 200) => value.replace(/\s+/g, " ").trim().slice(0, max);

export function jobRunFromDomain(run: DomainRun): JobRun {
  const report = [run.result?.brief, run.result?.detailedReport].filter((part): part is string => Boolean(part?.trim())).join("\n\n");
  const question = run.result?.unresolvedQuestions.find((item) => item.trim())
    ?? run.messages?.find((message) => message.kind === "decision")?.body;
  return {
    id: run.id,
    status: run.status,
    ...(run.request.project?.name ? { project: run.request.project.name } : {}),
    outcome: one(run.request.intendedOutcome || run.request.originalMessage),
    owner: run.owner,
    updatedAt: run.updatedAt,
    ...(question ? { question: one(question) } : {}),
    ...(report ? { report } : {}),
    artifacts: run.result?.artifacts ?? [],
  };
}

interface Signal {
  group: JobGroup;
  at: string;
  next: string;
  owner: string;
  ask: string;
  because: string;
  decision?: ShowItem["decision"];
}

function rank(group: JobGroup): number {
  return group === "needs" ? 0 : group === "working" ? 1 : group === "waiting" ? 2 : 3;
}

function runSignal(run: JobRun): Signal | null {
  const at = run.updatedAt;
  if (run.status === "needs_decision") {
    return { group: "needs", at, next: run.question || run.outcome || "A decision is open", owner: "you", ask: run.question || run.outcome, because: `Run ${run.id} is waiting on a decision` };
  }
  if (run.status === "queued" || run.status === "accepted" || run.status === "working") {
    return { group: "working", at, next: run.outcome || "In progress", owner: run.owner || "Flyd", ask: "", because: `Run ${run.id} is ${run.status}` };
  }
  if (run.status === "incomplete" || run.status === "failed") {
    return { group: "waiting", at, next: run.outcome || "The last handoff did not finish", owner: run.owner || "Flyd", ask: "", because: `Run ${run.id} is ${run.status}` };
  }
  if (run.status === "completed") {
    return { group: "done", at, next: run.outcome || "Landed", owner: "", ask: "", because: `Run ${run.id} completed` };
  }
  return null;
}

function itemGroup(kind: ShowItem["kind"]): JobGroup | null {
  if (kind === "call") return "needs";
  if (kind === "ready") return "needs";
  if (kind === "live" || kind === "next") return "working";
  if (kind === "waiting") return "waiting";
  if (kind === "landed") return "done";
  return null;
}

function dayNumber(iso: string, now: number): number {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return Infinity;
  return (now - parsed) / DAY;
}

interface Bucket {
  id: string;
  title: string;
  project: string;
  signals: Signal[];
  shots: Job["shots"];
  links: Job["links"];
  files: Job["files"];
  threads: JobThread[];
  reports: DigestSource[];
}

export function jobsFrom(input: {
  projects?: Project[];
  runs?: JobRun[];
  sessions?: JobSession[];
  reports?: JobReport[];
  show?: ShowScreen;
  digests?: JobDigest[];
  exists?: (path: string) => boolean;
  now?: number;
}): JobBoard {
  const now = input.now ?? Date.now();
  const exists = input.exists ?? (() => false);
  const projects = input.projects ?? [];
  const known = new Map(projects.map((project) => [jobKey(project.name), project]));
  for (const project of projects) known.set(jobKey(project.id), project);
  const buckets = new Map<string, Bucket>();
  const inferred: JobBoard["inferred"] = [];
  const seenInferred = new Set<string>();

  const bucketFor = (name: string, fallbackTitle?: string): Bucket => {
    const key = jobKey(name);
    const project = known.get(key);
    const mapKey = project ? jobKey(project.id) : key;
    let bucket = buckets.get(mapKey);
    if (bucket) return bucket;
    const title = project?.name || fallbackTitle || name;
    const id = project?.id || key;
    bucket = { id, title, project: project ? labelOf(project) : "", signals: [], shots: [], links: [], files: [], threads: [], reports: [] };
    buckets.set(project ? jobKey(project.id) : key, bucket);
    if (!project && !seenInferred.has(key) && key) {
      seenInferred.add(key);
      inferred.push({ name: title, kind: "product" });
    }
    return bucket;
  };

  for (const project of projects) {
    if (project.status === "done" && dayNumber(project.updated, now) > DONE_KEEP_DAYS) continue;
    bucketFor(project.name);
  }

  for (const run of input.runs ?? []) {
    const signal = runSignal(run);
    if (!signal) continue;
    const name = run.project;
    if (!name && signal.group === "done") continue;
    const bucket = name ? bucketFor(name) : lone(buckets, run.id, run.outcome || "Untitled run");
    bucket.signals.push(signal);
    bucket.threads.push({ id: run.id, title: run.outcome || run.id, at: run.updatedAt, kind: "run" });
    for (const artifact of artifactsOf(run.artifacts, exists)) {
      if (artifact.href) bucket.links.push({ label: artifact.label, url: artifact.href });
      else bucket.files.push({ label: artifact.label });
    }
    if ((run.report?.length ?? 0) >= REPORT_CHARS) {
      bucket.reports.push({ hash: digestHash(run.report!), project: bucket.title, title: run.outcome || bucket.title, text: run.report!, link: bucket.links[0]?.url });
    }
  }

  for (const session of input.sessions ?? []) {
    if (!session.project) continue;
    const bucket = bucketFor(session.project);
    bucket.threads.push({ id: session.id, title: session.title || "Conversation", at: session.updatedAt, kind: "conversation" });
  }

  for (const item of showItems(input.show)) {
    const group = itemGroup(item.kind);
    if (!group) continue;
    const bucket = item.project ? bucketFor(item.project, item.headline) : lone(buckets, item.id, item.headline);
    const ask = group === "needs" ? (item.decision?.question || item.detail || item.headline) : "";
    bucket.signals.push({
      group,
      at: item.at || item.started || "",
      next: item.detail || item.headline,
      owner: group === "needs" ? "you" : "Flyd",
      ask,
      because: `Fleet ${item.kind}: ${item.id}`,
      ...(group === "needs" && item.decision ? { decision: item.decision } : {}),
    });
    for (const shot of item.shots ?? []) if (shot.src) bucket.shots.push({ src: shot.src, label: shot.label });
    for (const link of [...(item.links ?? []), ...(item.open ? [item.open] : [])]) {
      if (link.closed || !link.url) continue;
      bucket.links.push({ label: link.label || "Open", url: link.url });
    }
    if ((item.detail?.length ?? 0) >= REPORT_CHARS) {
      bucket.reports.push({ hash: digestHash(item.detail!), project: bucket.title, title: item.headline, text: item.detail!, link: bucket.links[0]?.url });
    }
  }

  for (const report of input.reports ?? []) {
    if (report.text.trim().length < REPORT_CHARS) continue;
    const name = report.project;
    if (!name) continue;
    const bucket = bucketFor(name);
    bucket.reports.push({ hash: digestHash(report.text), project: bucket.title, title: report.title, text: report.text, ...(report.link ? { link: report.link } : {}) });
  }

  const digests = (input.digests ?? []).filter((digest) => !digest.failed);
  const stored = new Set((input.digests ?? []).map((digest) => digest.hash));
  const jobs: Job[] = [];
  const pending: DigestSource[] = [];
  for (const bucket of buckets.values()) {
    const project = projects.find((item) => item.id === bucket.id);
    if (!bucket.signals.length && project) bucket.signals.push(idleSignal(project));
    if (!bucket.signals.length && (bucket.threads.length || bucket.reports.length)) {
      bucket.signals.push({ group: "waiting", at: bucket.threads[0]?.at ?? "", next: "Nothing is moving this.", owner: "you", ask: "", because: "Named in a conversation, no open run" });
    }
    if (!bucket.signals.length) continue;
    const lead = [...bucket.signals].sort((a, b) => rank(a.group) - rank(b.group) || Date.parse(b.at) - Date.parse(a.at))[0]!;
    const at = [...bucket.signals.map((signal) => signal.at), ...bucket.threads.map((thread) => thread.at)].filter(Boolean).sort().at(-1) ?? "";
    if (lead.group === "done" && dayNumber(at || project?.updated || "", now) > DONE_KEEP_DAYS) continue;
    const digest = newestDigest(digests, bucket);
    for (const source of bucket.reports) {
      if (!stored.has(source.hash) && !pending.some((item) => item.hash === source.hash)) pending.push(source);
    }
    const links = uniqueLinks(bucket.links);
    jobs.push({
      id: bucket.id,
      group: lead.group,
      state: STATE[lead.group],
      title: bucket.title,
      project: bucket.project,
      at,
      next: lead.next,
      owner: lead.owner,
      ask: lead.ask,
      because: lead.because,
      shots: bucket.shots.slice(0, 4),
      links: links.slice(0, 4),
      files: bucket.files.slice(0, 6),
      threads: bucket.threads.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8),
      digest: digest ? { changed: digest.changed, means: digest.means, needed: digest.needed, ...(digest.link ? { link: digest.link } : {}) } : null,
      ...(lead.decision ? { decision: lead.decision } : {}),
    });
  }
  jobs.sort((a, b) => rank(a.group) - rank(b.group) || Date.parse(b.at) - Date.parse(a.at));
  return { jobs, fleetKnown: Boolean(input.show?.read), inferred, pending: pending.slice(0, 8) };
}

function labelOf(project: Project): string {
  if (project.kind === "client") return "Client";
  return project.what && project.what.length <= 42 ? project.what : project.kind;
}

function idleSignal(project: Project): Signal {
  const at = project.updated;
  if (project.status === "done") return { group: "done", at, next: "Closed", owner: "", ask: "", because: "The project is closed" };
  if (project.status === "waiting" || project.status === "paused") {
    return { group: "waiting", at, next: project.next || "Paused. No next step is written down.", owner: "you", ask: "", because: `Project status is ${project.status}` };
  }
  return { group: "waiting", at, next: project.next || "Nothing is moving this.", owner: "you", ask: "", because: "No open run" };
}

function lone(buckets: Map<string, Bucket>, id: string, title: string): Bucket {
  const existing = buckets.get(id);
  if (existing) return existing;
  const bucket: Bucket = { id, title: one(title, 140) || "Untitled", project: "", signals: [], shots: [], links: [], files: [], threads: [], reports: [] };
  buckets.set(id, bucket);
  return bucket;
}

function showItems(show: ShowScreen | undefined): ShowItem[] {
  if (!show) return [];
  return [show.calls, show.ready, show.underway, show.next, show.held, show.done, show.landedWeek].flatMap((list) => list ?? []);
}

function artifactsOf(paths: string[], exists: (path: string) => boolean): JobArtifact[] {
  const out: JobArtifact[] = [];
  for (const ref of paths) {
    if (/^https?:\/\//i.test(ref)) {
      const pr = /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(ref);
      out.push({ label: pr ? "Pull request" : safeHost(ref), kind: pr ? "pr" : "url", href: ref });
      continue;
    }
    if (!ref.startsWith("/") && !ref.startsWith("~")) continue;
    if (!exists(ref)) continue;
    out.push({ label: basename(ref), kind: IMAGE.test(ref) ? "image" : "file" });
  }
  return out;
}

function safeHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Link"; }
}

function uniqueLinks(links: Job["links"]): Job["links"] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function newestDigest(digests: JobDigest[], bucket: Bucket): JobDigest | undefined {
  const hashes = new Set(bucket.reports.map((report) => report.hash));
  const key = jobKey(bucket.title);
  return digests
    .filter((digest) => hashes.has(digest.hash) || (digest.project ? jobKey(digest.project) === key : false))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
}

export interface JobEdit {
  op: "create" | "rename" | "close";
  id?: string;
  name?: string;
}

/** George's own create, rename or close. Writes the project list and returns the job. */
export function editJob(edit: JobEdit, options: { path: string; now?: number }): { job: Job | null; error?: string } {
  const name = one(edit.name ?? "", 60);
  const written = { knownRepos: [] as string[], path: options.path, ...(options.now ? { now: new Date(options.now) } : {}) };
  let id = edit.id ?? "";
  if (edit.op === "create") {
    if (!name) return { job: null, error: "A job needs a name." };
    id = projectId(name);
    applyProjectOps([{ op: "upsert", name, kind: "product", status: "active", what: "", next: "Say what the next step is." }], written);
  } else if (edit.op === "rename") {
    if (!edit.id || !name) return { job: null, error: "Rename needs the job and a name." };
    if (!readProjects(options.path).some((project) => project.id === edit.id)) return { job: null, error: "That job is not on the list." };
    applyProjectOps([{ op: "upsert", id: edit.id, name }], written);
  } else {
    if (!edit.id) return { job: null, error: "Close needs the job." };
    if (!readProjects(options.path).some((project) => project.id === edit.id)) return { job: null, error: "That job is not on the list." };
    applyProjectOps([{ op: "archive", id: edit.id, reason: "Closed" }], written);
  }
  const board = jobsFrom({ projects: readProjects(options.path), now: options.now });
  const job = board.jobs.find((item) => item.id === id) ?? null;
  return job ? { job } : { job: null, error: "That job is not on the list." };
}

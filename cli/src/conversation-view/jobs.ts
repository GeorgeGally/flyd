import { basename } from "node:path";
import { viaOpener } from "./liesel.js";
import { applyProjectOps, projectId, readProjects, type Project, type ProjectKind } from "../council/projects.js";
import type { DomainRun, DomainRunStatus } from "../command/types.js";
import { workStateOfRun, type WorkState } from "../lib/work-state.js";
import { namesBackstage } from "../runtime/honesty-check.js";
import { plainSaid } from "../lib/backstage.js";
import { bannedFor, forHim, statusSaid } from "../lib/pa-voice.js";
import { plainTitle } from "./plain-words.js";
import { digestHash, type DigestSource, type JobDigest } from "./job-digest.js";
import { namedAnswers, type NamedAnswers } from "./choices.js";
import { holdDecisions, numberedChoice, type HoldDecision } from "./artefact.js";
import type { ShowItem, ShowScreen } from "./show.js";
import { cardSource, fallbackWords, jargonIn, placeholderLine, type CardSource, type CardWords } from "./card-words.js";

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
  /** The whole entry as one sentence, never cut short: what the Timeline says when he opens it. */
  full?: string;
}

/** What changed, then what he needs to do: one sentence each, said to him. */
export interface JobDigestView {
  changed: string;
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
  started?: string;
  next: string;
  /** "you" when the next action is his; otherwise the run's owner. */
  owner: string;
  /** The decision, when the group is needs. */
  ask: string;
  questionIdentity?: string;
  because: string;
  shots: Array<{ src: string; label: string }>;
  links: Array<{ label: string; url: string }>;
  files: Array<{ label: string }>;
  threads: JobThread[];
  digest: JobDigestView | null;
  /** The show item's decision, when the job needs one, so the job opens on its decisions. */
  decision?: ShowItem["decision"];
  /** The few answers the decision names, one tap each, the recommended one first. Absent for an open question. */
  choices?: string[];
  /** The answer Flyd recommends, when it names one. */
  recommended?: string;
  /** How each answer reads on its button, by the answer it sends: "Merge" reads "Go ahead". An answer not in it reads as it is. */
  labels?: Record<string, string>;
  /** Several numbered questions in one ask, each with its own answers: one card each on the open job. */
  decisions?: HoldDecision[];
  /** The domain run an answer given on this job reaches. Absent when the run has finished and cannot take one. */
  domainRun?: string;
  /** A call Flyd answered for him by one of his standing rules; his own answer takes it back. */
  handled?: { decisionId: string; task: string };
}

export interface JobRun {
  id: string;
  status: string;
  transport?: DomainRun["transport"]["kind"];
  source?: DomainRun["request"]["source"];
  phase?: string;
  project?: string;
  outcome: string;
  owner: string;
  updatedAt: string;
  started?: string;
  /** When its outcome settled, from its report: how long finished work has been waiting. */
  settled?: string;
  question?: string;
  questionIdentity?: string;
  report?: string;
  artifacts: string[];
  /** Where the work stands, as read once from its reply (lib/work-state.ts); from its status when it carries none. */
  work?: WorkState;
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
  /** Cards built from a worker's status line with no plain words stored yet: the server has them said, never while drawing. */
  untranslated: CardSource[];
}

const DAY = 24 * 60 * 60 * 1000;
const DONE_KEEP_DAYS = 21;
/** An open run that has not moved for this long is not work under way, whatever its record still says. */
const QUIET_RUN_MS = DAY;
const REPORT_CHARS = 240;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

const STATE: Record<JobGroup, string> = { needs: "Needs you", working: "Working", waiting: "Waiting", done: "Done" };
/** Finished work waiting on his look, in his words: never "ready to land". */
const READY = "Ready for you";

export function jobKey(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return slug.replace(/capfive|capfire|cap5/g, "cap5");
}

/** One line, cut at a word with "…" when it is long: never mid-word ("Do you want me to r"). Pure. */
const one = (value: string, max = 200) => {
  const line = value.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.lastIndexOf(" ", max - 1);
  return `${line.slice(0, cut > max / 2 ? cut : max - 1).replace(/[\s,;:–—-]+$/, "")}…`;
};

/** A run's brief as one whole sentence to him: the staff framing gone, nothing cut. Pure. */
export function runSentence(outcome: string): string {
  let text = outcome.replace(/\s+/g, " ").trim();
  const card = BRIEF_FRAME.test(text) ? /\bcard titled\s+["“]([^"”]+)/i.exec(text) : null;
  if (card) text = card[1]!;
  for (let pass = 0; pass < 3 && BRIEF_FRAME.test(text); pass += 1) text = text.replace(BRIEF_FRAME, "");
  return forHim(plainTitle(text)).replace(/…$/, "");
}

/** Hand-off framing Flyd wrote for its staff, never for him: "Answer George's question, reading whatever code is needed, and change nothing:". */
const BRIEF_FRAME = /^(?:answer (?:george's|your|the captain's|his) question\b[^:]*|act on (?:george's|your|the captain's|his) answer to|update the work from (?:george's|your|his) follow-up on|answer to pending decision [\w.-]+)\s*:\s*/i;

/**
 * A run's name as he would say it: the subject, not the brief Flyd gave its
 * staff. "Answer George's question…: George got a card titled \"Answer to
 * pending decision jev-firstmate-review: Review Jev decision log: did Jev…\""
 * reads "Review Jev decision log". Pure.
 */
export function runTitle(outcome: string): string {
  const text = runSentence(outcome);
  // The subject before a colon is the name; the rest is the brief's detail.
  const head = /^([^:?]{8,80}):\s/.exec(text)?.[1];
  return one(head ?? text, 90);
}


export function jobRunFromDomain(run: DomainRun): JobRun {
  const report = [run.result?.brief, run.result?.detailedReport].filter((part): part is string => Boolean(part?.trim())).join("\n\n");
  const question = run.result?.unresolvedQuestions.find((item) => item.trim())
    ?? (run.result?.brief?.trim() || undefined);
  return {
    id: run.id,
    status: run.status,
    transport: run.transport.kind,
    source: run.request.source,
    ...(run.phase ? { phase: run.phase } : {}),
    ...(run.request.project?.name ? { project: run.request.project.name } : {}),
    outcome: one(run.request.intendedOutcome || run.request.originalMessage),
    owner: run.owner,
    updatedAt: run.updatedAt,
    ...(run.createdAt ? { started: run.createdAt } : {}),
    ...(run.report?.since ? { settled: run.report.since } : {}),
    // His question is never cut: it is shown whole and wraps.
    ...(question ? { question: one(question, 4_000) } : {}),
    questionIdentity: question ?? run.request.intendedOutcome ?? run.request.originalMessage,
    ...(report ? { report } : {}),
    artifacts: run.result?.artifacts ?? [],
    ...(() => { const work = run.result?.workState ?? workStateOfRun(run.status, run.result); return work ? { work } : {}; })(),
  };
}

interface Signal {
  group: JobGroup;
  /** Its own state word, when the group's does not say it. */
  state?: string;
  at: string;
  started?: string;
  next: string;
  owner: string;
  ask: string;
  questionIdentity?: string;
  because: string;
  decision?: ShowItem["decision"];
  domainRun?: string;
  handled?: Job["handled"];
  /** The hash of this signal's own report, so its card reads its own digest and never another item's. */
  reportHash?: string;
  /** The staff's own words this card came from (a worker's status line), when it is not his decision: said plainly before he reads it. */
  raw?: { title: string; line: string; thread?: string; keep?: boolean };
}

function rank(group: JobGroup): number {
  return group === "needs" ? 0 : group === "working" ? 1 : group === "waiting" ? 2 : 3;
}

/**
 * A run's card carries its staff words, to be said plainly. A question for him
 * in plain words keeps them and only its title is said; a decision with no
 * question of its own, or one asked in developer words, is said plainly too,
 * so the Needs you column never shows the staff's line. A run with no words of
 * its own sends nothing to be said: the board's placeholder is not a line.
 */
function runSignal(run: JobRun, now: number): Signal | null {
  const signal = runSignalOf(run, now);
  if (!signal) return signal;
  const question = run.question?.trim() ?? "";
  const keep = Boolean(question) && !jargonIn(question);
  const line = question && !keep ? question : run.outcome;
  if (!line) return signal;
  return { ...signal, raw: { title: runTitle(run.outcome) || run.project || "", line, thread: run.id, ...(keep ? { keep } : {}) } };
}

function runSignalOf(run: JobRun, now: number): Signal | null {
  const at = run.updatedAt;
  // Where the work stands is the one work state its reply was read into; its status alone says how it is held.
  const read = run.work ?? workStateOfRun(run.status as DomainRunStatus);
  // Finished work waits on him for a day from when it settled; after that it is done, PR or not.
  const work = read === "ready" && now - Date.parse(run.settled ?? at) > DAY ? "landed" : read;
  if (work === "needs_you") {
    if (run.source === "flyd") return null;
    return { group: "needs", at, next: run.question || run.outcome || "A decision is open", owner: "you", ask: run.question || run.outcome, questionIdentity: run.questionIdentity, because: `Run ${run.id} is waiting on a decision`, ...(run.phase === "done" ? {} : { domainRun: run.id }) };
  }
  // Who on the staff does the work is Flyd's business: the card says only whether it is his move or Flyd's.
  if (run.status === "queued") return { group: "waiting", state: "Queued", at, next: run.outcome || "Queued", owner: "Flyd", ask: "", because: `Run ${run.id} is queued` };
  if (run.status === "incomplete") return { group: "waiting", at, next: run.outcome || "Not finished yet", owner: "Flyd", ask: "", because: `Run ${run.id} is ${run.status}` };
  if (work === "blocked") return { group: "waiting", state: "Blocked", at, next: run.outcome || "Not finished yet", owner: "Flyd", ask: "", because: `Run ${run.id} is ${run.status}` };
  if (work === "moving") {
    if (run.transport === "firstmate") return null;
    if (now - Date.parse(at) > QUIET_RUN_MS) return { group: "waiting", at, next: run.outcome || "Waiting", owner: "Flyd", ask: "", because: `Run ${run.id} has gone quiet` };
    return { group: "working", at, ...(run.started ? { started: run.started } : {}), next: run.outcome || "Under way", owner: "Flyd", ask: "", because: `Run ${run.id} is ${run.status}` };
  }
  if (work === "ready") {
    if (run.source === "flyd") return null;
    return { group: "needs", state: READY, at, next: run.outcome || READY, owner: "you", ask: run.question || run.outcome, questionIdentity: run.questionIdentity, because: `Run ${run.id} is ready to land` };
  }
  if (work === "landed") return { group: "done", at, next: run.outcome || "Landed", owner: "", ask: "", because: `Run ${run.id} completed` };
  return null;
}

function itemGroup(kind: ShowItem["kind"]): JobGroup | null {
  if (kind === "call") return "needs";
  if (kind === "ready") return "needs";
  if (kind === "live") return "working";
  if (kind === "waiting" || kind === "next") return "waiting";
  if (kind === "landed") return "done";
  return null;
}

/** The word a show item has for itself on the board: finished work is ready, not a question; queued is not waiting on him. */
function itemState(item: ShowItem): string | undefined {
  if (item.kind === "ready") return item.status === "report available" ? "Report ready" : READY;
  if (item.kind === "next") return "Queued";
  if (item.kind === "waiting" && item.status === "paused") return "Paused";
  return undefined;
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
  /** The project's own name, when the card belongs to one: what its plain words lead with. */
  name?: string;
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
  /** Plain words stored for cards built from staff status lines (card-words.ts). Given, every such card is said plainly or generically, never as written. */
  cardWords?: Map<string, CardWords>;
  /** Lines the model has given up on: a question among them is put to him exactly as asked, with its answers. */
  exhausted?: Set<string>;
  exists?: (path: string) => boolean;
  now?: number;
}): JobBoard {
  const now = input.now ?? Date.now();
  const exists = input.exists ?? (() => false);
  const projects = input.projects ?? [];
  const known = new Map(projects.map((project) => [jobKey(project.name), project]));
  for (const project of projects) known.set(jobKey(project.id), project);
  // A fleet row names its project by repo path, and a project's name need not match its repo's folder.
  const projectOfRepo = (path: string): string | undefined => {
    const folder = basename(path).toLowerCase();
    return projects.find((project) => project.repos.some((repo) => basename(repo).toLowerCase() === folder))?.name;
  };
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
    bucket = { id, title, project: project ? labelOf(project) : "", ...(project || !fallbackTitle ? { name: project?.name ?? basename(name) } : {}), signals: [], shots: [], links: [], files: [], threads: [], reports: [] };
    buckets.set(project ? jobKey(project.id) : key, bucket);
    // A fallback title is a worker's headline, not a project's name: it may label the card but never registers a project.
    if (!project && !fallbackTitle && !seenInferred.has(key) && key) {
      seenInferred.add(key);
      inferred.push({ name: title, kind: "product" });
    }
    return bucket;
  };

  for (const project of projects) {
    if (project.status === "done" && dayNumber(project.updated, now) > DONE_KEEP_DAYS) continue;
    bucketFor(project.name);
  }

  const activeProjects = new Map<string, Bucket[]>();
  const markActive = (name: string, bucket: Bucket) => {
    const key = jobKey(name);
    const projectKey = jobKey(known.get(key)?.id ?? name);
    const active = activeProjects.get(projectKey) ?? [];
    active.push(bucket);
    activeProjects.set(projectKey, active);
  };
  // Its bucket, not its name now: a card's name may be settled later, and its Timeline entry must ask for the same words as the card.
  const runThreads = new Map<JobThread, { group: JobGroup; bucket: Bucket; state: string; title: string; line: string }>();
  for (const run of input.runs ?? []) {
    const signal = runSignal(run, now);
    if (!signal) continue;
    const name = run.project;
    if (!name && signal.group === "done") continue;
    const title = runTitle(run.outcome) || name || "Untitled run";
    const bucket = (signal.group === "working" || signal.group === "needs")
      ? lone(buckets, `run:${run.id}`, title)
      : name ? bucketFor(name) : lone(buckets, run.id, title);
    if ((signal.group === "working" || signal.group === "needs") && name) { bucket.project = name; bucket.name = name; markActive(name, bucket); }
    bucket.signals.push(signal);
    const full = runSentence(run.outcome);
    const thread: JobThread = { id: run.id, title, at: run.updatedAt, kind: "run", ...(full && full !== title ? { full } : {}) };
    bucket.threads.push(thread);
    if (signal.raw) runThreads.set(thread, { group: signal.group, bucket, state: signal.state ?? STATE[signal.group], title: signal.raw.title, line: signal.raw.line });
    for (const artifact of artifactsOf(run.artifacts, exists)) {
      if (artifact.href) bucket.links.push(viaOpener({ label: artifact.label, url: artifact.href }));
      else bucket.files.push({ label: artifact.label });
    }
    if ((run.report?.length ?? 0) >= REPORT_CHARS) {
      signal.reportHash = digestHash(run.report!);
      bucket.reports.push({ hash: signal.reportHash, project: bucket.title, title, text: run.report!, link: bucket.links[0]?.url });
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
    // Every running worker is its own card: two on one project are two, and a project's open call never hides one.
    const name = item.project && (projectOfRepo(item.project) ?? item.project);
    // A call Flyd answered for him is its own quiet line, so his take-back reaches that one answer.
    const handled = item.kind === "landed" && item.status === "handled" && item.executiveDecisionId ? { decisionId: item.executiveDecisionId, task: item.task ?? "" } : undefined;
    const bucket = name && item.kind !== "live" && !handled ? bucketFor(name, item.headline) : lone(buckets, item.id, item.headline);
    if (name) bucket.name ??= projectOfRepo(name) ?? basename(name);
    if (item.kind === "live" && name) { bucket.project = basename(name); markActive(bucket.project, bucket); }
    // A staff status line ("Checks green: PR ready for review…") is said as what it means for him.
    const detail = item.detail && (statusSaid(item.detail) ?? item.detail);
    const ask = group === "needs" ? (item.decision?.question || detail || item.headline) : "";
    const state = handled ? "Handled for you" : itemState(item);
    const signal: Signal = {
      group,
      ...(state ? { state } : {}),
      at: item.at || item.started || "",
      // "Under way" says nothing the Working group has not.
      next: item.kind === "live" && /^under way\.?$/i.test(item.detail ?? "") ? "" : detail || item.headline,
      owner: group === "needs" ? "you" : "Flyd",
      ask,
      because: `Fleet ${item.kind}: ${item.id}`,
      ...(group === "needs" && item.decision ? { decision: item.decision } : {}),
      ...(handled ? { handled } : {}),
      // A call or a decision is his and keeps its question, with only its title said plainly; a handled line is Flyd's own.
      ...(!handled ? { raw: { title: item.headline, line: (item.detail && !placeholderLine(item.detail) ? item.detail : "") || item.headline, ...(item.kind === "call" || item.decision ? { keep: true } : {}) } } : {}),
    };
    bucket.signals.push(signal);
    for (const shot of item.shots ?? []) if (shot.src) bucket.shots.push({ src: shot.src, label: shot.label });
    for (const link of [...(item.links ?? []), ...(item.open ? [item.open] : [])]) {
      if (link.closed || !link.url) continue;
      bucket.links.push({ label: link.label || "Open", url: link.url });
    }
    if ((item.detail?.length ?? 0) >= REPORT_CHARS) {
      signal.reportHash = digestHash(item.detail!);
      bucket.reports.push({ hash: signal.reportHash, project: bucket.title, title: item.headline, text: item.detail!, link: bucket.links[0]?.url });
    }
  }

  for (const report of input.reports ?? []) {
    if (report.text.trim().length < REPORT_CHARS) continue;
    const name = report.project;
    if (!name) continue;
    const bucket = bucketFor(name);
    bucket.reports.push({ hash: digestHash(report.text), project: bucket.title, title: report.title, text: report.text, ...(report.link ? { link: report.link } : {}) });
  }

  for (const [key, active] of activeProjects) {
    const project = buckets.get(key);
    if (!project || project.signals.length) continue;
    for (const bucket of active) {
      bucket.threads.push(...project.threads);
      bucket.reports.push(...project.reports);
    }
  }

  const digests = (input.digests ?? []).filter((digest) => !digest.failed);
  const stored = new Set((input.digests ?? []).map((digest) => digest.hash));
  const jobs: Job[] = [];
  const pending: DigestSource[] = [];
  const untranslated: CardSource[] = [];
  const timeline: CardSource[] = [];
  // A shown run's Timeline entry is said in his words too, never as the staff wrote it: a stored reading in full, else the generic line alone.
  const said = (thread: JobThread, card?: CardSource): JobThread => {
    const item = input.cardWords && runThreads.get(thread);
    if (!item) return thread;
    const project = item.bucket.name ?? "";
    const own = cardSource(project, item.state, item.title, item.line);
    const source = card && cardSource(card.project, card.state, card.title, card.line).key === own.key ? card : own;
    const stored = input.cardWords!.get(source.key);
    if (!stored) timeline.push(source);
    const { full: _full, ...rest } = thread;
    return { ...rest, title: (stored ?? fallbackWords(project, item.group, item.state)).title, ...(stored ? { full: stored.body } : {}) };
  };
  for (const bucket of buckets.values()) {
    const project = projects.find((item) => item.id === bucket.id);
    if (!bucket.signals.length && activeProjects.has(jobKey(bucket.id))) continue;
    if (!bucket.signals.length && project) bucket.signals.push(idleSignal(project));
    if (!bucket.signals.length && (bucket.threads.length || bucket.reports.length)) {
      bucket.signals.push({ group: "waiting", at: bucket.threads[0]?.at ?? "", next: "Nothing is moving this.", owner: "you", ask: "", because: "Named in a conversation, no open run" });
    }
    if (!bucket.signals.length) continue;
    const lead = [...bucket.signals].sort((a, b) => rank(a.group) - rank(b.group) || Date.parse(b.at) - Date.parse(a.at))[0]!;
    const paused = bucket.signals.filter((signal) => signal.state === "Paused").length;
    const state = lead.state ?? STATE[lead.group];
    const at = [...bucket.signals.map((signal) => signal.at), ...bucket.threads.map((thread) => thread.at)].filter(Boolean).sort().at(-1) ?? "";
    if (lead.group === "done" && dayNumber(at || project?.updated || "", now) > DONE_KEEP_DAYS) continue;
    const digest = newestDigest(digests, bucket, lead);
    for (const source of bucket.reports) {
      if (!stored.has(source.hash) && !pending.some((item) => item.hash === source.hash)) pending.push(source);
    }
    const links = uniqueLinks(bucket.links);
    const digestSaid = digestView(digest, lead.ask);
    // A run that asks several numbered questions at once puts each to him on its own card.
    const numbered = lead.group === "needs" && !lead.decision && lead.ask ? holdDecisions(lead.ask) : [];
    const several = numbered.length > 1 ? numbered : null;
    const listed = lead.group === "needs" && !lead.decision && lead.ask ? numberedChoice(lead.ask) : undefined;
    const answers = lead.group === "needs" && !several ? (listed ?? answersOf(lead, digestSaid)) : null;
    // The buttons he taps read in his words ("Merge" reads "Go ahead") and still send the answer as named; answers that cannot be said plainly are left to his own words.
    const shownAnswers = answers && plainAnswers(answers.options);
    const decisionLabels = lead.decision?.choices.length ? plainAnswers(lead.decision.choices) : null;
    const severalLabels = several?.map((decision) => plainAnswers(decision.options));
    const shownState = paused && (paused > 1 || state !== "Paused") ? `${state === "Paused" ? "" : `${state} · `}${paused} paused` : state;
    // A card built from the staff's status line is said in his words, once (card-words.ts); until then, generically, and its Timeline entry says the same. A card with its own question and answers keeps them together.
    const asks = Boolean(several || listed || answers?.options.length);
    const raw = input.cardWords && lead.raw ? cardSource(bucket.name ?? "", state, lead.raw.title, lead.raw.line, shownAnswers ? answers!.options.map((option) => shownAnswers[option]!) : undefined) : undefined;
    const fallback = fallbackWords(bucket.name ?? "", lead.group, state);
    const named = raw ? input.cardWords!.get(raw.key) ?? fallback : undefined;
    // A question with its own answers keeps its words while they are plain; asked in developer words, it is said plainly and its answers stay.
    const unread = Boolean(raw && lead.group === "needs" && jargonIn(lead.ask) && !input.cardWords!.has(raw.key) && input.exhausted?.has(raw.key));
    const words = lead.raw?.keep || unread || (asks && !jargonIn(lead.ask)) ? undefined : named;
    // Its answers wait for a stored reading that puts the question to him: never buttons without the question they answer.
    const blind = Boolean(words && asks && !input.cardWords!.has(raw!.key));
    const labels = blind ? {} : { ...decisionLabels, ...Object.assign({}, ...(severalLabels ?? []).map((said) => said ?? {})), ...shownAnswers };
    if (raw && !input.cardWords!.has(raw.key) && !untranslated.some((item) => item.key === raw.key)) untranslated.push(raw);
    if (raw && words && !lead.raw!.thread) bucket.threads.push({ id: `note:${raw.key}`, title: words.title, ...(input.cardWords!.has(raw.key) ? { full: words.body } : {}), at: lead.at || at, kind: "run" });
    jobs.push(shownPlainly({
      id: bucket.id,
      group: lead.group,
      state: shownState,
      title: named ? named.title : bucket.title,
      project: bucket.project,
      at,
      ...(lead.started ? { started: lead.started } : {}),
      // The question is said once: a next line that only repeats it is left out.
      next: words ? (lead.group === "needs" ? "" : words.body) : sameWords(lead.next, lead.ask) ? "" : shownLine(lead.next, lead.group),
      owner: lead.owner,
      ask: words ? (lead.group === "needs" ? words.body : "") : lead.ask && forHim(plainSaid(lead.ask)),
      ...(lead.questionIdentity ? { questionIdentity: lead.questionIdentity } : {}),
      because: lead.because,
      shots: bucket.shots.slice(0, 4),
      links: links.slice(0, 4),
      files: bucket.files.slice(0, 6),
      threads: bucket.threads.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8).map((thread) => said(thread, raw)),
      digest: digestSaid,
      ...(lead.decision ? { decision: blind || !decisionLabels ? { ...lead.decision, choices: [], recommended: undefined } : lead.decision } : {}),
      ...(several && !blind ? { decisions: several.map((decision, index) => (severalLabels![index] ? decision : { ...decision, options: [], recommended: undefined })) } : {}),
      ...(shownAnswers && !blind ? { choices: answers!.options, ...(answers!.recommended ? { recommended: answers!.recommended } : {}) } : {}),
      ...(Object.keys(labels).some((option) => labels[option] !== option) ? { labels } : {}),
      ...(lead.domainRun ? { domainRun: lead.domainRun } : {}),
      ...(lead.handled ? { handled: lead.handled } : {}),
    }, fallback, unread));
  }
  jobs.sort((a, b) => rank(a.group) - rank(b.group) || Date.parse(b.at) - Date.parse(a.at));
  return { jobs, fleetKnown: Boolean(input.show?.read), inferred, pending: pending.slice(0, 8), untranslated: [...untranslated, ...timeline].filter((source, index, all) => all.findIndex((item) => item.key === source.key) === index) };
}

/**
 * The answers a decision waiting on him names, so the card can take them in one
 * tap: a fleet call's own options when it asks one thing, else the run's
 * question, else what Flyd said he needs to do ("Say merge, and I'll …"). A
 * call that asks several things at once, or an open question, names none. Pure.
 */
function answersOf(lead: Signal, digest: JobDigestView | null): NamedAnswers | null {
  const decision = lead.decision;
  if (decision) {
    if (decision.steps?.length || (decision.decisions?.length ?? 0) > 1) return null;
    if (!decision.choices.length) return namedAnswers(lead.ask, digest?.needed);
    const recommended = decision.recommended && decision.choices.includes(decision.recommended) ? decision.recommended : undefined;
    return { options: recommended ? [recommended, ...decision.choices.filter((choice) => choice !== recommended)] : decision.choices, ...(recommended ? { recommended } : {}) };
  }
  return namedAnswers(lead.ask, digest?.needed);
}

/**
 * A stored reading as he reads it: to him, two sentences. Readings stored
 * before Flyd spoke to him directly are turned to "you" here; the old "means"
 * line only restated the other two and is not shown. A "needed" that is the
 * card's own question again is not said twice. Pure.
 */
export function digestView(digest: JobDigest | null | undefined, ask = ""): JobDigestView | null {
  if (!digest) return null;
  const same = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const changed = forHim(digest.changed);
  let needed = forHim(digest.needed);
  if (needed && ((ask && same(needed, forHim(plainSaid(ask)))) || same(needed, changed))) needed = "";
  if (!changed && !needed) return null;
  return { changed, needed, ...(digest.link ? { link: digest.link } : {}) };
}

/** Whether two lines say the same words, one perhaps cut short. Pure. */
function sameWords(a: string, b: string): boolean {
  const words = (text: string) => text.toLowerCase().replace(/…/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const x = words(a);
  const y = words(b);
  return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
}

/** An answer that only goes ahead with the work, in the staff's word for it: "Merge", "Land it", "Ship now". Nothing else may follow. */
const GO_AHEAD = /^(?:yes[,.!]?\s+)?(?:merge|land|ship)(?:\s+(?:it|this|that|them|the\s+pr|pr\s*#?\d*|(?:in)?to\s+main|onto\s+main|on\s+main))*(\s+now)?[.!]?$/i;

/**
 * How one answer reads on its button: "Merge" reads "Go ahead", "Merge now"
 * reads "Go ahead now", "Wait for checks" reads "Wait". Only the label: the
 * button still sends the answer as named. Null when it still talks like a developer. Pure.
 */
export function plainAnswer(option: string): string | null {
  const go = GO_AHEAD.exec(option.trim());
  const said = go ? `Go ahead${go[1] ? " now" : ""}` : option;
  if (!jargonIn(said) && !bannedFor(said)) return said;
  // "Wait for checks" is still "Wait" to him.
  const hold = /^(?:wait|hold off|not yet)\b/i.exec(said.trim())?.[0];
  return hold ? hold.charAt(0).toUpperCase() + hold.slice(1) : null;
}

/** Each answer's label, by the answer it sends; null when any cannot be said plainly or two would read the same. Pure. */
function plainAnswers(options: string[]): Record<string, string> | null {
  const said = options.map(plainAnswer);
  if (said.some((option) => option === null) || new Set(said.map((option) => option!.toLowerCase())).size !== said.length) return null;
  return Object.fromEntries(options.map((option, index) => [option, said[index]!]));
}

/** Developer words or a banned phrase in a line he would read, or null. Pure. */
function unfit(text: string | undefined): string | null {
  return text ? jargonIn(text) ?? bannedFor(text) : null;
}

/**
 * The card as he reads it, checked once more on what is shown: a title, line,
 * question or Timeline entry that still carries developer words or a banned
 * phrase is said with its state's plain line instead. A fleet decision is
 * drawn from its own question, so its ask is left to it. Pure but for the log.
 */
function shownPlainly(job: Job, fallback: CardWords, asked = false): Job {
  const caught: string[] = [];
  const check = <T extends string | undefined>(text: T, instead: string): T | string => {
    const found = unfit(text);
    if (!found) return text;
    caught.push(found);
    return instead;
  };
  const answered = asked || Boolean(job.decisions?.length || job.decision);
  const ask = answered ? job.ask : check(job.ask, job.group === "needs" ? fallback.body : "") as string;
  const { choices: _choices, recommended: _recommended, labels: _labels, ...unasked } = job;
  const shown: Job = {
    ...(ask === job.ask ? job : unasked),
    title: check(job.title, fallback.title) as string,
    next: check(job.next, job.group === "needs" ? "" : fallback.body) as string,
    ask,
    threads: job.threads.map((thread) => {
      if (thread.kind !== "run") return thread;
      const title = check(thread.title, fallback.title) as string;
      const full = thread.full && unfit(thread.full) ? (caught.push(unfit(thread.full)!), undefined) : thread.full;
      const { full: _full, ...rest } = thread;
      return { ...rest, title, ...(full ? { full } : {}) };
    }),
  };
  if (caught.length) console.warn(`[jobs] said plainly instead of showing: ${caught.map((word) => JSON.stringify(word)).join(", ")}`);
  return shown;
}

/** What a card says when its own words would name the staff or how the work is run. */
const QUIET_LINE: Record<Exclude<JobGroup, "needs">, string> = { working: "Under way", waiting: "Waiting", done: "Done" };

/** A card's line as he may see it: the relay check holds back staff names, branches and ids. A decision keeps its question, said plainly: the call is his. Pure. */
function shownLine(line: string, group: JobGroup): string {
  if (!line) return line;
  const plain = forHim(plainSaid(line));
  return group !== "needs" && namesBackstage(plain) ? QUIET_LINE[group] : plain;
}

function labelOf(project: Project): string {
  if (project.kind === "client") return "Client";
  // A bare kind ("product") says nothing to him: the card names the project instead.
  return project.what && project.what.length <= 42 ? project.what : "";
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

/**
 * The reading for the card's lead item. A lead with its own report reads only
 * that report's digest: a project card leading on the Week page PR never shows
 * the WhatsApp card's reading because both are Flyd work. A lead without one
 * reads the project's own reports, never another item's, and never a reading
 * that only shares the project's name. Pure.
 */
function newestDigest(digests: JobDigest[], bucket: Bucket, lead: Signal): JobDigest | undefined {
  const owned = new Set(bucket.signals.flatMap((signal) => (signal.reportHash ? [signal.reportHash] : [])));
  const hashes = lead.reportHash
    ? new Set([lead.reportHash])
    : new Set(bucket.reports.map((report) => report.hash).filter((hash) => !owned.has(hash)));
  // Matched by report only: a reading stored under the same project name may be any of its items'.
  return digests
    .filter((digest) => hashes.has(digest.hash))
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

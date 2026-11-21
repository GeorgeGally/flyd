# Flyd × Rounds: First Mate-Native Work Canvas

**Implementation plan** · 21 November 2026 · **Status:** Proposed; no code changed

**Baseline examined (GitHub default branches, not uncommitted local work):**
- Flyd `GeorgeGally/flyd` `71aca2a5e5a64457b566e39f6a76ba6113090ba9` (18 Nov 2026)
- First Mate `GeorgeGally/firstmate` `a8572f6255200c4809affb0d957be7889a9d33ca` (25 Sep 2026)
- Rounds `krispuckett/rounds` `9b863e289f30c676b35379be5de2859f5858a273` (21 Nov 2026, v1.1.0)

## Outcome and non-goals

**Outcome:** First Mate work appears on a persistent spatial canvas *within Flyd*. The user can move through work by project, objective, task, and date; inspect artifacts and code changes; annotate the exact artifact version; and submit feedback through Flyd's existing First Mate inbox. A stopped agent or deleted transient output cannot silently erase a captured visual. All statuses are explicitly sourced from First Mate; the canvas does not become an orchestrator.

**Non-goals for v1:** replacing Liesel; adding a second agent scheduler or task lifecycle; reading Claude transcripts to infer First Mate state; auto-executing feedback; publishing assets; remote Second Mate worker control; rewriting Flyd's conversation view; global automatic screen recording; fully supporting all media formats and mobile editing.

**Key decision:** Fork and vendor the **Rounds React UI** and adapt its `Index` read model. Do not transplant Rounds' local backend, indexer, hook installers, transcript parser, or Claude session/resume assumptions into Flyd. First Mate stays an external source of operational truth; Flyd remains the host and owner of user feedback.

## Source-verified system map

| Existing module | Verified contract | Plan |
|---|---|---|
| Flyd `README.md` | Active macOS Swift adapter + TypeScript Core; Rails archived | Place canvas in active conversation-view/WKWebView path |
| `cli/src/conversation-view/server.ts` | Authenticated local conversation view at `127.0.0.1:4818`, with image/rail endpoints and token/origin checks | Add same-host `/work` and `/api/work/*` routes; reuse auth policy |
| `cli/src/conversation-view/page/script-timeline.ts` | Existing conversation jobs opening in place | Add “See work” affordance, not a competing jobs column |
| `cli/src/conversation-view/jobs.ts` | Project-oriented job grouping of runs, conversations and artifacts | Reuse titles/labels; don't reuse its presentation state as canonical worker lifecycle |
| `cli/src/command/cos/types.ts` and `cos/objectives.ts` | Objective → planned run → domain run references and dependencies | Join by explicit objective/run identifiers |
| `cli/src/command/types.ts`, `store.ts` | Durable DomainRun status, requestId, `objectiveId`, result artifacts, messages | Use for Flyd-originated work and follow-up ownership |
| `cli/src/command/firstmate.ts` | `FirstmateDomainTransport` sends `fm-inbox.sh note` with idempotent request IDs, reads receipts | Reuse; never invoke First Mate worker terminal directly |
| `cli/src/command/messages.ts` | `sendRunMessage` gives known DomainRun targeted, deduplicated messages | Use for live Flyd-originated run feedback |
| `cli/src/conversation-view/firstmate-inbox.ts` | `FirstmateInbox` records captain notes, attachments and replies | Use for other First Mate work/replies where appropriate |
| `cli/src/command/fleet-monitor.ts` | Read-only worker snapshot/readiness plus backoff and escalation | Reuse staff availability and semantics; don't duplicate polling |
| `cli/src/conversation-view/artefact.ts` | First Mate `parseBearings`, `enrichFleet`, `TaskExtra`, `pickShots`, `labPreviews`, `ArtifactFeed`, `SnapshotGate` | Build canvas projection from these data producers, extending only for missing provenance/version data |
| `cli/src/conversation-view/liesel.ts`, `open-board-page.ts` | Launch and link to a real Liesel board | Retain Liesel as deep HTML/element editing action |
| First Mate `bin/fm-fleet-snapshot.sh --json` | `fm-fleet-snapshot.v1`: task metadata, backlog, local and secondmate observations, artifact/report pointers | Canonical First Mate read source; feature-detect schema and expose omissions/freshness |
| First Mate `bin/fm-bearings-snapshot.sh --json` | Compact projection over canonical snapshot | Reuse existing Flyd feed for lightweight overview, not sole artifact index |
| First Mate `bin/fm-inbox.sh` | `note --request-id --json -`, `receipts`, `reply` with durable id/ack and reply cursor | All submitted feedback routes through this contract |
| Rounds `src/App.tsx`, `Cluster.tsx`, `layout.ts`, `TimeRail.tsx`, `Stage.tsx`, `ShotStage.tsx`, `FileStage.tsx` | Canvas, grouping, temporal rail, reviews/compare and file sheet | Retain, relabel and adapt |
| Rounds `src/data.ts` | `Index` with projects, threads, pages, sets, changed, comments; API helpers | Compatibility projection initially, then direct typed `WorkCanvasIndex` if justified |
| Rounds `server/indexer.mjs`, `hooks/*`, `server/topics.mjs`, `server/api.mjs` | Claude transcript replay, hooks, topic filing, local API | Exclude from embedded runtime; borrow algorithms only with explicit reasoning |

*Important ownership distinction:* Flyd's separate Execution Runtime `AgentTask`/`TaskArtifact` remains authoritative for **native Flyd runtime** tasks, per `docs/architecture/operational-truth-ownership.md`. This plan focuses on **First Mate** tasks. Do not collapse Flyd `DomainRun`, First Mate `task ID`, First Mate worker session, and native `AgentTask` into one identifier.

## Product: three levels of attention

1. **Conversation** (existing Flyd home): goals, urgent decisions, progress, spoken requests. An existing job gets a quiet **See work** affordance when there is reviewable material.
2. **Work canvas** (`/work`): Rounds spatial UI, projects and topic clusters, session-independent task artifacts, zoom/pan, time rail, recent/unreviewed markers, file sheet. No dashboards full of KPIs.
3. **Deep review**: Rounds image pin/HTML snapshot review; Liesel is opened only for interactive DOM/source-aware editing. A Liesel link returns to the same objective/task and records provenance.

The canvas view uses First Mate vocabulary for task states but keeps person-facing titles calm and readable. Project grouping is the default; objective grouping is displayed for explicit Flyd-originated work. Tasks initiated outside Flyd remain visible under their First Mate project without an invented objective. Never infer objective membership solely from a shared repository path, title, or screenshot hash.

### Conceptual hierarchy

```
Flyd objective? (optional, exists only when Flyd created it)
  └─ DomainRun / planned-run reference? (optional)
       └─ First Mate task ID (stable within FM_HOME)
            ├─ one or more worker/session episodes
            ├─ status/verification/PR evidence
            └─ artifact (stable logical ID)
                 └─ revisions (content hashes + timestamps)
```

A First Mate task may exist with no Flyd objective, a task may have multiple worker episodes, and an objective may span multiple tasks. Represent relationships as explicit edges instead of enforcing a false one-to-one tree. Remote secondmate rows must include the home/source namespace in identifiers.

## Read model: `WorkCanvasIndex` v1

The **only new semantic contract** is the canvas projection, not operational authority. Suggested TypeScript model:

```ts
type WorkCanvasIndex = {
  schema: 'flyd.rounds.v1';
  generatedAt: string;
  freshness: { observedAt: string; stale: boolean; partial: boolean; reasons: string[] };
  projects: Array<{ key: string; title: string; repository?: string }>;
  objectives: Array<{ id: string; title: string; projectKey?: string; status: string }>;
  tasks: Array<{
    key: string; fmHomeId: string; fmTaskId: string; objectiveId?: string;
    domainRunId?: string; projectKey?: string; title: string; status: string;
    observedAt: string; source: 'firstmate'; readiness?: string;
  }>;
  artifacts: Array<{
    id: string; taskKey: string; kind: 'image'|'html'|'file'|'url'|'report'|'diff';
    label: string; versions: Array<{
      id: string; sha256: string; observedAt: string; mediaType: string;
      width?: number; height?: number; contentUrl: string;
      sourcePathHint?: string; commit?: string; viewport?: string;
    }>;
  }>;
  activities: Array<{
    id: string; at: string; taskKey?: string; objectiveId?: string;
    kind: 'posted'|'state'|'verification'|'pr'|'review'|'reply';
    source: string; summary: string; evidenceRefs?: string[];
  }>;
  reviews: Array<{
    id: string; artifactId: string; versionId: string;
    status: 'draft'|'queued'|'sent'|'acknowledged'|'replied'|'failed';
    x?: number; y?: number; text: string; createdAt: string;
    firstmateReceiptId?: string;
  }>;
};
```

Implementation details:
- `taskKey = <FM_HOME canonical ID>:<First Mate task ID>`; never key globally by bare task ID.
- `artifactId = taskKey + logical artifact name or source-issued ID`; a revision is uniquely content-hashed. File path is a hint, never the security or ownership authority.
- Incremental discovery uses source-native task timestamps where available; otherwise local observation time, explicitly tagged as such. Never present inferred production times as facts.
- User-visible state is a deterministic projection of canonical First Mate snapshot + Flyd DomainRun/CoS state. No canvas-owned task status and no LLM lifecycle classification.
- For First Mate remote home / secondmate data, show cached/partial/unknown, never local-worker certainty.
- Rounds UI compatibility may temporarily map `thread` to namespaced task keys for placement only. Never expose `claude://` URLs or imply sessions can always resume.

## Technical boundary and modules

**Frontend**: fork Rounds under `cli/vendor/rounds-ui/` or an equivalent explicit vendor directory, retaining upstream MIT license and notices. Use a small patch layer rather than wholesale rewrite. Build into a path served by Flyd's existing conversation-view server, e.g. `cli/dist/work-canvas/`.

**Server** (proposed `cli/src/work-canvas/`):
- `types.ts`: versioned schema and validation.
- `firstmate-source.ts`: reads canonical snapshot via existing `SnapshotGate`/read producer, understands partial/fresh/remote source.
- `projection.ts`: joins First Mate task/worker metadata with Flyd `DomainRun` and CoS `Objective` via explicit IDs; produces read-only `WorkCanvasIndex`.
- `artifact-discovery.ts`: imports First Mate task screenshots, report files, linked pages, and optional future explicit artifact manifests; initially reuse `TaskExtra`, `pickShots`, and existing bounded scans.
- `artifact-store.ts`: content-addressed immutable media cache under `~/.flyd/work-canvas/objects/sha256`, atomic copy, ownership and path validation. No write to First Mate home.
- `review-store.ts`: durable local feedback IDs/state/receipts; Flyd owns user-authored review intent. Persist atomically and test cross-process concurrency. Existing work/feedback event store may be used instead if it has the correct ownership contract.
- `review-delivery.ts`: routes explicit Send to known `DomainRun` via `sendRunMessage`, otherwise to `FirstmateDomainTransport.sendFlydNote` with task+artifact provenance. Unaddressable notes remain queued; no fallback to a random session.
- `http.ts`: authenticated `/api/work/*` index, artifact, history, review, and receipt endpoints.

**Routes** (proposed; not existing API promises):
- `GET /work` — hosted Rounds UI, entered from Flyd.
- `GET /api/work/index?project=&asof=` — bounded snapshot/projection with explicit freshness.
- `GET /api/work/artifacts/:artifactId/versions/:versionId` — authorized immutable content (images; sandboxed HTML only).
- `GET /api/work/files/:taskKey` — read-only Git/PR/file summary, only where verifiable.
- `POST /api/work/reviews` — persist draft pin with exact version ID.
- `POST /api/work/reviews/:id/send` — idempotent, explicitly authorized delivery.
- `GET /api/work/reviews/:id` — receipt / reply state, not synthesized success.

Prefer reuse of the existing server token and local Origin/Host checks; don't add a second secret or web service. The existing `conversation-view/server.ts` should delegate these routes to a small module, not accumulate another thousand lines. WKWebView navigation can open `/work` in the existing conversation window, retaining the user's conversation. Start with **Mac only**; remote/mobile is a separate security and UX gate.

## Capture and history

### Initial capture, without modifying First Mate

1. Query First Mate's canonical `fm-fleet-snapshot.sh --json` via one gated read. Reuse Flyd's existing `parseBearings`/`enrichFleet` and task extras for title, state, screenshot, candidate and Liesel linkage. Confirm which fields can be obtained from the complete snapshot without additional per-task filesystem scans.
2. For each accessible task, discover **already produced** screenshots (`png`, `jpg`, `webp`), declared HTML pages, reports and PR references. Explicitly permit only canonical files under known task/data roots and configured project roots. Read-only; don't traverse arbitrary symlinks or remote paths.
3. Copy imported visuals into a content-addressed cache **once**; record task owner and source provenance. The source can later disappear without losing the captured snapshot.
4. Create history revisions when **content bytes change**, not when mtime changes. Deduplicate same bytes. Preserve before/after as separate records; present comparison only for a pair captured at comparable dimensions/context.
5. For code changes, use Flyd's existing Repository Intelligence and Git itself; show recorded commit/PR diffs and explicit uncertainty. Do **not** claim Rounds' per-tool-call Claude transcript history when First Mate hasn't recorded that information.
6. Support URLs as *links* initially, not automatically crawled websites. Optional screenshot capture requires an explicit trusted preview URL and opt-in.

### Optional enhancement after MVP

First Mate could expose an explicit `artifact-post` record or manifest from an owned worker task. Suggested fields: `task_id`, `repo`, `kind`, `label`, `path`, `commit`, `width`, `height`, `published_at`, `version`, `parent_artifact_id`. Flyd ingests it, but First Mate's own state remains canonical for task ownership. This is preferable to replaying vendor-specific transcripts or installing broad hooks.

### Time rail and search

Reuse Rounds `TimeRail.tsx`, `layout.ts`, search and zoom behavior. Phase 1 uses explicit project, task and timestamp metadata. Phase 2 adds topic grouping by First Mate project/task hierarchy and optional Flyd objective. Defer LLM clustering; names and links should first come from grounded records. Keep work archived, allow filtering by `project`, `objective`, `task`, `unreviewed`, `date`. The default recent window may remain compact; archive/time travel must still reach older persisted work.

## Feedback lifecycle: the critical vertical slice

```
User pins an immutable version on canvas
  -> Flyd stores draft (local durable ID, normalized point, exact artifact hash)
  -> User presses Send
  -> Flyd validates task ownership + current state + explicit scope
  -> Known active Flyd DomainRun? sendRunMessage(run, 'correction', ...)
  -> Otherwise: FirstmateDomainTransport.sendFlydNote(
       requestId = stable `flyd-...` review ID,
       parentRequestId? = known Flyd run, contextRefs = [fm task, artifact version])
  -> First Mate inbox receipt saved/acknowledged
  -> First Mate routes work within its own task/worker policy
  -> First Mate replies via fm-inbox.sh reply / receipt cursor
  -> Flyd marks the review replied, links any new artifact version
```

- **Do not send directly to the originating Claude/Code session**. A task may have moved, paused, terminated, or been reassigned. First Mate owns that routing.
- **Do not claim a task was fixed on delivery/acknowledgement.** States distinguish `draft`, `sent`, `acknowledged`, `replied`, and `verified`. Verification remains First Mate/Flyd evidence, not a chat assertion.
- For a **completed** First Mate task, note is a *new follow-up request* referencing the original task and version. It does not reopen the completed task behind First Mate's back.
- If the task association is missing/ambiguous, show “Saved locally — choose which task should receive it”; no project-based guess.
- Include only bounded evidence in the body: user words verbatim, task ID, artifact/version ID, screenshot coordinate/crop, optional source commit and viewport. Never include raw filesystem paths accessible beyond the authorized roots.
- Store send intent **before** invoking the inbox, retry using the same request ID, reconcile with `receipts` after uncertain errors. No duplicate sends after process restart.
- A user's pin on a before/after comparison binds to **one selected revision**; the other image is context only.

## Security and privacy gates

1. **Content trust:** Captured HTML, SVG, PDF, and other agent outputs are untrusted. Prefer static screenshots. If enabling HTML previews, use a sandbox with an opaque origin (`sandbox` without `allow-same-origin`), no top navigation, no privileged bridge access, and restricted external requests; never let artifact JavaScript read Flyd's auth token. SVG must not be inserted directly as trusted DOM.
2. **Path safety:** Resolve canonical paths, reject symlinks escaping authorized First Mate/task/project roots, validate file types and sizes before copying; never accept a client-provided absolute path as a fetch authorization.
3. **API auth:** Gate reads and writes against the same strict Flyd token/Origin/Host policy; preview endpoints must not make secret tokens available to untrusted artifact code. Check remote/mobile separately.
4. **User authority:** No agent wake on viewing, hovering, pinning, auto-discovery, or semantic grouping. Send is explicit. Existing First Mate decision/merge gates remain unchanged.
5. **Retention:** Captured outputs may contain secrets or private client work. Provide per-project exclusion, manual deletion, cache limits, and a clear retained-snapshot indication. No upload or third-party model clustering in v1.
6. **Freshness:** Missing, stale, secondmate-cached, or partial fleet evidence is displayed as such; no status inferred from absence.
7. **Responsiveness:** Use existing snapshot gate; index increments and thumbnailing must be bounded and off critical UI render paths.

## Implementation phases and acceptance gates

**Phase 0 — Contracts and proof fixture** (suggested 0.5–1.5 developer days)
- Record current repo SHAs and upstream license; inspect First Mate real on-disk snapshot fixtures for local/remote/secondmate tasks, screenshots and reports; verify cross-IDs between Flyd objective, DomainRun and First Mate task.
- Define `WorkCanvasIndex` and `ReviewNote` JSON schemas and fixture set.
- Check `pnpm/npm test` baselines in Flyd, `npm run eval` or equivalent Rounds smoke, and First Mate snapshot fixture tests.
- **Gate:** a deterministic sample index with at least one First Mate task and two artifact revisions renders in Rounds with no agent process started.

**Phase 1 — Embed UI, read-only** (1–2 developer days)
- Vendor Rounds `src/` frontend, license and styles; build as independently versioned bundle. Host at Flyd `/work` under its existing WKWebView/server. Retain pan, zoom, canvas clusters, search, timeline, screenshot stage and visual compare. Replace Claude-specific labels/links with task and objective navigation. Add “See work” to existing job detail.
- **Gate:** no new port/daemon; keyboard+trackpad functional in macOS WKWebView; Flyd's conversation still works; Rounds can consume fixture index; Liesel still opens normally.

**Phase 2 — First Mate read projection** (2–4 developer days)
- Implement namespaced task and objective mapping; reuse snapshot gate and existing Flyd artifact enrichment. Persist read-only projection incrementally; show unknown state without losing older items. Link job/artefact cards to canvas items, and canvas back to Flyd job view.
- **Gate:** First Mate task appears once even when multiple workers/snapshots report it; Flyd-originated objective association is exact; task started directly in First Mate appears without fake Flyd objective; stale/remote/partial status visible.

**Phase 3 — Artifact cache & comparison** (2–3 developer days)
- Import task screenshots and HTML reports safely, content-hash and preserve versions; generate bounded thumbnails; add before/after comparison where comparable. Wire Git/PR reference to file-stage with read-only diff.
- **Gate:** missing original file still shows its snapshot; identical file produces no duplicate version; same repo from two tasks never misattributes; unsupported report shows an honest link rather than a fake preview.

**Phase 4 — Feedback round trip** (2–4 developer days)
- Implement durable reviews, click-pin, notes, Send, idempotent inbox routing through existing transport, receipt and reply display; enforce completed-task follow-up semantics.
- **Gate:** fresh, running and completed task; duplicate send; process kill between queue/write/ack; stale receipt; task moved between workers; all result in correct single delivery or visible unresolved state. No notes ever land on another task just because the repo matches.

**Phase 5 — Hardening and incremental rollout** (2–3 developer days)
- XSS/HTML sandbox and SSRF tests, traversal/symlink tests, schema/freshness tests, empty/large canvas, multi-home and unavailable First Mate tests. Confirm keyboard focus, zoom, date travel, reduced motion and narrow layout. Add feature flag `FLYD_WORK_CANVAS=1` initially; document uninstall/cache cleanup. Run tests and signed app smoke on Mac.
- **Gate:** existing chat/jobs/Liesel tests pass, no First Mate state writes except explicit inbox notes, no additional worker sessions launched from read paths. Roll out to one real project, inspect logs, then enable more projects.

**Effort is a planning estimate, not a benchmark:** roughly 10–18 developer days for the described phases, dependent on actual First Mate task-artifact linkage and bundled UI integration complexity. First useful vertical slice (read-only real artifacts in Flyd) should be targeted before feedback and history depth. If First Mate snapshot doesn't consistently identify task artifacts, add an explicit post manifest before attempting arbitrary scanning.

### Test matrix

- First Mate active/queued/paused/failed/done task with and without screenshot.
- Task started in Flyd vs started externally, same repo used by two independent tasks.
- Multiple worker attempts and reassignments; source worker session ended.
- Local and secondmate cache returns; remote unknown and stale read.
- Duplicate image bytes; same logical artifact edited; source deleted; changed mtime only.
- Replay/retry note, acknowledged note, reply recorded, inbox unavailable, process interrupted after save.
- Content size/type mismatch; image and HTML containing hostile payload; symlink/path traversal; unauthorized endpoint.
- Existing Flyd job timeline, Liesel opener, bearer-token protection, macOS WKWebView and feature-flag-off behavior unchanged.

## Engineering tradeoffs

| Approach | Speed | Risk | Reversibility | Verdict |
|---|---|---|---|---|
| Iframe unmodified Rounds server | Fast demo | Duplicate service, Claude assumptions, token boundary | Easy | Prototype only |
| Rewrite Rounds as Flyd native UI | Slow | UI regressions, scope growth | Medium | Reject |
| **Vendor Rounds React frontend; build First Mate adapter** | Medium | Schema glue and licensing upkeep | High (isolated module/flag) | **Choose** |

**Strongest objection:** Flyd already has a job timeline and artifacts, so a second way to look at work could add noise. The new canvas must add a *different affordance*: simultaneous visual inspection, before/after and a persistent historical visual field. If the first two real project trials do not improve actual review speed or clarity, reduce the project to an optional “visual history” view and avoid expanding the surface.

## Suggested PR sequence

1. `feat(work-canvas): vendor Rounds frontend and mount authenticated /work route` — static fixture only, MIT notice, UI smoke.
2. `feat(work-canvas): First Mate project/task projection from existing fleet/artifact sources` — read-only live records and freshness labels.
3. `feat(work-canvas): immutable First Mate artifact import and revision comparison` — caching and diff stages.
4. `feat(work-canvas): durable pinned notes through First Mate transport` — one verified feedback loop.
5. `test(work-canvas): privacy, lifecycle, performance and regression gates` — feature-flag rollout.

Each PR must be independently revertible; no First Mate fork modifications are needed for PRs 1–4 unless Phase 0 proves existing artifact identity insufficient. Do not mutate First Mate's `FM_HOME` from an observation path.

## Exact first vertical slice

**Scenario:** A First Mate task has two versions of a website screenshot. Open Flyd → See work → open task → compare two versions → pin one point on the newest version → type “Reduce the header height at phone width” → Send → First Mate inbox records one note with the task/artifact/revision context → Flyd shows saved/acknowledged/replied accurately → when First Mate delivers a new screenshot, the canvas adds a revision. That is the product proof.

**THE ONE THING TO DO NEXT:** Create PR 1 behind `FLYD_WORK_CANVAS=1`, with a read-only Rounds frontend consuming a deterministic First Mate fixture through a `/work` route on Flyd's existing conversation-view server. This validates embedding before spending engineering effort on capture and feedback.

## Source links

- [Flyd README / active architecture](https://github.com/GeorgeGally/flyd/blob/main/README.md)
- [Flyd operational truth ownership](https://github.com/GeorgeGally/flyd/blob/main/docs/architecture/operational-truth-ownership.md)
- [Flyd Chief of Staff types](https://github.com/GeorgeGally/flyd/blob/main/cli/src/command/cos/types.ts)
- [Flyd First Mate transport](https://github.com/GeorgeGally/flyd/blob/main/cli/src/command/firstmate.ts)
- [Flyd targeted messages](https://github.com/GeorgeGally/flyd/blob/main/cli/src/command/messages.ts)
- [Flyd fleet/artifact enrichment](https://github.com/GeorgeGally/flyd/blob/main/cli/src/conversation-view/artefact.ts)
- [Flyd conversation server](https://github.com/GeorgeGally/flyd/blob/main/cli/src/conversation-view/server.ts)
- [Flyd Liesel integration](https://github.com/GeorgeGally/flyd/blob/main/cli/src/conversation-view/liesel.ts)
- [First Mate fleet snapshot](https://github.com/GeorgeGally/firstmate/blob/main/bin/fm-fleet-snapshot.sh)
- [First Mate inbox contract](https://github.com/GeorgeGally/firstmate/blob/main/bin/fm-inbox.sh)
- [Rounds UI](https://github.com/krispuckett/rounds/tree/main/src)
- [Rounds data model](https://github.com/krispuckett/rounds/blob/main/src/data.ts)
- [Rounds license](https://github.com/krispuckett/rounds/blob/main/LICENSE)
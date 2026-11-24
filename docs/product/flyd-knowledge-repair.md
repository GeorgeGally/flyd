# Knowledge repair and maintenance

Flyd keeps explicit scoped corrections in its existing event store before generating an answer. A failed model call does not lose an eligible correction. The next compiled context uses the accepted value, and a genuine unresolved disagreement stays marked as disputed.

This extends the existing Cognitive Curator, Librarian, agenda and knowledge domain. It adds no new daemon, model, learning engine or approval step for ordinary memory corrections. Authored files are preserved.

## Active scopes

The first release governs four single-valued project properties: `launch_date`, `deadline`, `hosting_provider` and `timezone`. A fact is identified by project, property and scope, rather than a broad `fact` slot.

Examples accepted through normal chat, mobile, INVOKED text/voice and original LIVE transcripts:

```text
Harbor launch date is 2030-06-10
Correction: Harbor launch date is 2030-06-12
Harbor hosting provider is Hetzner
Undo my last correction
```

The subject and property must be grounded in a direct statement. Questions, quotations, hypothetical statements and general dissatisfaction cannot authorize replacement. Unknown prose remains evidence for the existing memory system. This is not whole-memory canonicalization or an automatic rewrite of taste, people, personal preferences or authored `USER.md`.

Undo resolves the latest unretracted correction in that session only. It appends a compensating event and reverses only that repair's claims and relations. A vague reference from another session cannot undo an unrelated correction. Duplicate delivery is idempotent.

## Scope cutover

| Writer or reader | Behaviour for an accepted scope |
|---|---|
| Normal original user input | Validated correction, source attribution and target revision committed before generation |
| Librarian and Investigator `applyMemoryOps` | Competing direct writes rejected; original evidence remains available for reconciliation |
| Project facts and due dates | Accepted values supply effective reads; competing generated fact/date writes cannot bypass acceptance |
| `MEMORY.md`, authored profile and project summaries | Exact recognized facts are reconciled in the prompt without rewriting authored bytes |
| NOW/profile/project projections | Derived from accepted state; exports use atomic file replacement and a semantic revision |
| Archive retrieval | Exact recognized lines use the effective value; archive evidence is not independent confirmation |
| Unregistered properties, set-valued facts and taste | Existing paths retained; no invented canonical scope or destructive migration |

A payload-free scope hash survives canonical erasure. It prevents an old compatibility copy or reset migration cursor from becoming current authority again. It contains no fact value or source locator. Separate accepted claims with independent live support remain eligible; erasing one source does not erase an unrelated canonical assertion.

## Background work

The agenda's `knowledge` job runs without requiring a new journal entry. It incrementally migrates eligible original statements and processes up to five due issues. Original event evidence is reopened first; known repository files are read at an exact Git commit. Substantial checks reuse `dispatchKnowledgeDomain()` and retained domain reports with a stable request ID.

There is one delegated investigation at a time, a five-minute claim lease, and two source-read attempts before deferral. Waiting for a running investigation does not spend another source retry. Pending domain work resumes from its retained run rather than launching a duplicate fleet. Unavailable sources and ungrounded answers remain explicitly deferred.

At source read, model dispatch and acceptance, the system checks current source status, retention and dependencies. Paused, disabled, revoked or erased sources cannot supply new repairs. Local-only evidence cannot enter background research or the Librarian's model prompt. A worker report never grants user-confirmed authority; bounded research answers can add a dispute, and a stale target revision cannot overrule a later user correction.

The initial local source readers cover canonical events and registered repositories. Existing knowledge-domain tools handle permitted broader research. This release does not add a new Slack/Notion connector, a crawler, or cross-host writable memory replication.

## Configuration and inspection

`FLYD_KNOWLEDGE_REPAIR=active` is the default. `shadow` permits maintenance diagnostics but cannot accept fact changes. `off` stops new maintenance and corrections. Neither setting restores retired legacy writers or erased facts; effective canonical reads remain enabled. Existing Council/source controls still apply.

The authenticated Core routes expose:

- `GET /learning`: repair mode, registered properties, active scopes and issue states, alongside existing learning status.
- `POST /learning/knowledge` with `{ "sequences": [123] }`: bounded migration of up to 50 original event sequences. Unknown scope, unavailable evidence and older source time are reported as deferred.

Issues, source observations, receipts and verification records live in the same event database. Generated source copies inherit their original dependencies. Erasure and retention expiry retract dependent knowledge records transitively, including both numeric and UUID event references used by the existing runtime. Projections refresh at their read boundary. Generated procedure blocks are checked on proposal access and the existing agenda sweep; human text outside owned markers is preserved. Cleanup that has not run is not reported as swept.

## Verification and deployment boundary

Deterministic readback distinguishes accepted storage from actual formatted prompt consumption. Verification records include the consumer, semantic version, repair ID and prompt hash. They do not claim that a generated answer was correct or that a later real-world outcome succeeded. Historical questions do not earn current-state readback credit.

Episode replay can use frozen before/after snapshots without consulting future knowledge or running materializers. Source erasure is revalidated even for a previously captured snapshot. The replay adapter does not retrieve replacement facts to fill a frozen snapshot.

Chat and mobile have direct correction-to-next-prompt acceptance coverage, including failed generation. INVOKED retains the ordinary resolution/receipt path. LIVE checks the semantic version at `response.done`, recompiles once per change and sends a supported `session.update`; raced compilations are discarded. Installed Mac voice behaviour and a live provider session require separate device acceptance and have not been exercised in this workspace.

Successful turns alone no longer create learned procedure standards. The existing Skillify proposal/confirmation path accepts a candidate only with at least three distinct, attributable verified outcomes for the same scoped procedure. Explicitly authored guidance keeps its existing path. This is an evidence gate and integration seam, not a claim that every domain already emits verified procedure metadata or that a broad learned policy has been deployed.

After pulling these changes, rebuild the Core with `cd cli && npm run build` and restart it through the supported Mac install/run workflow. A Git pull alone does not change an already running Core.

Validation recorded on 24 November 2026: the first-party source regression run passed 5,006 tests (61 skipped), excluding one artifact-path test that also fails on unchanged `main` when the checkout lives under a `scratch` directory. Integration with the concurrent v10 source/retention update passed 786 tests across 81 affected files, followed by a focused 47-test erasure/voice check. Typecheck, build and an isolated compiled-Core restart/readback smoke were also exercised. These are repository/runtime checks, not installed-Mac acceptance or measured real-world procedure outcomes.

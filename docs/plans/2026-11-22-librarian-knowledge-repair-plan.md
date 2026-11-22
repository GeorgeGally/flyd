# Flyd Librarian: dependable knowledge repair and maintenance

**Revision:** 2 — evaluated and revised on 23 November 2026; originally drafted 22 November

**Status:** Implementation plan. This revision includes an executed formatter reproduction; application changes have not been implemented.

**Repository baseline:** `GeorgeGally/flyd`, `main` at `33999375973cc8aec9d78a21f372dfe85507ae6f`

**Product authority:** [Flyd Personal Intelligence PRD](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/docs/product/flyd-personal-intelligence-prd.md)

## 1. Goal and evaluation verdict

Make Flyd correct and maintain its knowledge through normal use: notice an error, establish what the evidence supports, update the relevant fact, and use the corrected knowledge on the next relevant turn. George should not have to repeat the correction, maintain knowledge files or manage another agent.

The original direction was sound: retain the existing Librarian, Cognitive Curator, event store, research team and learning system. The execution plan had three material weaknesses:

1. It missed a current presentation defect that can defeat correct storage: the formatter hides unresolved present-tense contradictions and presents a selected value as settled.
2. Its first delivery included too much migration/publication machinery before proving the actual correction-to-answer path.
3. Its contracts did not specify enough about semantic scope, conflict identity and the reader paths that can reintroduce old knowledge.

**Decision:** fix the knowledge semantics and the shared reader path first, then deliver a complete, scoped repair loop. Expand writer migration and trace-to-procedure learning behind that working loop. A synthetic documentation mismatch remains useful supporting evidence; it is no longer the sole proof of improvement.

### Observable success

- One explicit, grounded correction to a fact is enough to update that fact. Repeated evidence for a generalized behavioural rule is a separate concern.
- The next relevant answer uses the correction, including when asked in a new session after restart.
- A genuine unresolved disagreement is represented as a disagreement. An explicitly superseded value stays historical.
- Correcting one property or project does not alter another property or project.
- Original evidence remains attributable, and erased evidence cannot survive in a repair, prompt snapshot or generated skill.
- A storage repair, a consumer readback, an answer evaluation and later real-world success have separate results.
- Routine maintenance remains autonomous and quiet. Uncertainty prompts useful investigation or a qualified answer, not reflexive user questions or blanket refusals.

No production improvement rate or installed-Mac behaviour was measured. The review inspected source, existing tests and one executed synthetic formatter case.

## 2. Review findings and the changes they require

Severity here means importance to the proposed implementation, not a claim of a production incident.

| Priority | Finding and evidence | Improvement in this revision |
|---|---|---|
| Critical | [The formatter](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/cognition/context-format.ts#L106) omits `disputed` from claim lines, hides current conflicts, and calls a competing value “earlier” when looking back. | Fix the typed conflict/read contract and formatter before a broad memory migration. |
| High | [Existing tests](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/cognition/__tests__/context-format.test.ts#L86) encode suppression of a competing current value. | Split tests for resolved history and unresolved disputes. Preserve the former protection instead of simply dumping all conflicts into prompts. |
| High | [Memory queries](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/cognition/memory.ts#L130) flatten conflicts into strings and return them separately from scoped current claims. | Retain claim IDs, source references, scope and resolution state. Filter relevant conflicts before prompt limits. |
| High | [Lesson extraction](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/cognition/curator/content-learning.ts#L106) stores broad kinds such as `fact` as attributes; [world derivation](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/intelligence/world/world-model.ts#L219) can supersede lower-authority claims automatically and groups by entity/attribute. | Define a shared fact key, cardinality and explicit replacement semantics for governed facts. Do not apply a global authority-rank rewrite. |
| High | [The compiler](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/cognition/context-compiler.ts#L70) reads canonical projections and independent curated memory. [Chat](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/runtime/conversation-responder.ts#L283) also budgets raw personal memory and appends a project block. | Reconcile all representations of the selected fact before formatting/budgeting. Changing only `queryMemory()` is insufficient. |
| High | The first plan required generation manifests and broad memory/project/taste migration in the same programme as a first repair. That can delay the useful outcome. | Ship structured canonical reads for selected facts first. Retain full migration as a separate, explicit stage with writer/reader coverage. |
| High | [Compilation](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/cognition/context-compiler.ts#L58) materializes state; [episode evaluation](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/evals/episodes/context.ts#L33) reads current memory. | Isolate stores, tools, clocks and materializers and freeze the before/after knowledge versions. A “read-only” label alone is insufficient. |
| High | The plan named revocation/erasure but did not make the commit-time source check or dependency interpretation precise. | Check original source state at acceptance and model dispatch. Track copied content and value support separately; preserve independent surviving evidence. |
| Medium | The documentation mismatch proves source disagreement, not an actual failed correction-to-answer loop. | Make the first integration test traverse ordinary correction intake, the accepted fact and a real prompt consumer. Keep the mismatch as a secondary source-recheck fixture. |
| Medium | Claims such as “one accepted interpretation” can hide unresolved uncertainty, while unconstrained issue maintenance can become another background workload. | Define one consistent knowledge state, which can include a dispute. Specify demand-driven priorities, due work and bounded investigation. |

### Executed reproduction

On the audited baseline, Node `v24.22.3` imported the actual `context-format.ts` using `--experimental-strip-types`. A synthetic `CompiledContext` contained a current claim marked `disputed: true` and a conflict with two source dates. No model, credentials, network source or personal data was used.

| Check | Observed result |
|---|---|
| Present-tense prompt contains selected date | Yes |
| Present-tense prompt contains competing date | No |
| Present-tense prompt marks dispute | No |
| Past-tense prompt relabels competing date as “earlier” | Yes |

This establishes a formatter defect in the supplied conflict case. It does not prove a particular live answer was wrong or that every entry currently called a conflict is a genuine unresolved dispute.

The suppression has a legitimate goal: keep superseded facts and noisy memory dumps out of current answers. The replacement must preserve that protection and the existing prompt budgets. See the [earlier test-isolation finding](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/docs/solutions/test-isolation/tests-polluted-real-flyd-memory-2026-10-17.md).

## 3. What stays and what changes

| Existing system | Keep | Extend only where needed |
|---|---|---|
| [Cognitive Curator](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/cognition/curator/curator.ts) and `IntelligenceEventStore` | Canonical observations, claims, relations, idempotency, transactions | Validated repair acceptance, target revisions and repair-attributed retraction |
| [Background Librarian](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/council/librarian.ts) | Existing curation owner and source intake | Typed proposals, contradiction semantics and in-scope canonical writes |
| [Knowledge domain](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/command/librarian.ts) | Retriever, Researcher, Fact Checker, retained reports and request IDs | Bounded issue-linked investigations and resume from the retained run |
| [Curator sweep](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/cognition/curator/reconcile.ts) and agenda | Existing scheduling and checkpoints | Pending/due repair work independent of new journal turns |
| [Experience traces](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/runtime/experience-trace.ts) and turn receipts | Execution/feedback evidence | Exact knowledge snapshot and consumed claim attribution |
| [Dream Cycle](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/cli/src/intelligence/dream/experience.ts), Skillify and governed improvement | Existing pattern diagnosis, candidates and promotion rules | Evidence-linked knowledge issues and verified procedure candidates |
| Projects, taste and authored `USER.md` | Existing product behaviour and editing semantics | Migrate semantic facts when their scope cuts over; keep authored inputs and presentation metadata distinct |

The [temporal-memory plan](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/docs/plans/2026-09-22-001-cognitive-core-temporal-memory-plan.md), [Dream V1's deferred belief-health/canonical-Librarian work](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/docs/plans/2026-10-19-dream-cycle-v1.md) and [experience-learning plan](https://github.com/GeorgeGally/flyd/blob/33999375973cc8aec9d78a21f372dfe85507ae6f/docs/plans/2026-10-20-experience-learning-plan.md) remain references. This plan closes selected gaps rather than implementing those documents again.

The intervening `main` update after the first audit changed CoS/AgentRun recovery work; the audited memory and formatter paths were unchanged. Knowledge repair continues to use the existing agenda and knowledge domain rather than adding another workflow runtime.

### Approaches reconsidered

These are engineering judgments, not performance measurements.

| Approach | Impact | Effort/risk | Reversibility |
|---|---|---|---|
| Correct the stale documentation and add prompt instructions | Helps that example; leaves contradictory state and repeat errors | Low effort, high risk of an incomplete fix | Easy |
| Migrate all memory, projects, taste and exports before shipping repair | Broad consistency eventually | Highest effort and migration risk; delays behaviour evidence | Difficult once many writers change |
| Fix conflict semantics, then ship canonical repair for a selected fact scope | Direct next-answer improvement and a reusable integration pattern | Moderate, with bounded compatibility work | Scoped rollout and compensating events |

**Choose the third approach.** The working loop is the prerequisite for broader migration. Full project/taste migration, a new publication framework, a new model and a second learner are not prerequisites for the first release.

## 4. Ownership and runtime behaviour

Flyd owns communication with George. Workers identify issues and provide evidence. The existing Librarian owns knowledge reconciliation. The Cognitive Curator accepts validated semantic changes. Existing projection functions render derived views. Existing learning/promotion mechanisms own general behavioural changes.

This is one accountable acceptance boundary, not a requirement to send every observation through a model or an agent team. Deterministic explicit edits and verified tool observations still use appropriate validated producer paths.

### Three execution paths

1. **A grounded explicit correction:** resolve the exact fact and accepted scope, perform the local acceptance transaction, and make its version visible before reporting that the correction is saved. No required network call or research fleet. If meaning is ambiguous, honour the statement in the current conversation and retain an attributed issue without inventing a durable replacement.
2. **A narrow evidence discrepancy:** reopen the identified original source, check what it supports, and propose a targeted change. Use supplied-context reasoning only after obtaining the source.
3. **A substantial unresolved dispute:** dispatch one idempotent knowledge-domain request, retain the run ID and resume from its reports. Resource contention queues work instead of becoming George's staffing decision.

A failed model response must not lose an already supplied user correction. Record eligible correction input before the answer completes, separately from successful-turn capture; retain its source attribution and existing retention rules. A cancelled/failed save is reported as pending or unsuccessful, not “learned.”

### Attention, costs and cadence

- Explicit correction first; issues blocking accepted work second; recently used stale claims third; speculative gaps last.
- Pending issues and due rechecks trigger the existing maintenance tick even without new journal turns. Do not wait for the daily Dream Cycle to correct a known fact.
- Proposed initial limits: five local issues per pass, one delegated investigation at a time, and two scheduled retries before deferring an unchanged unavailable source. These are implementation defaults to measure, not observed optimal values.
- A source update, new evidence or an explicit retry can reopen deferred work. A timer cannot create endless retries or self-corroboration.
- Use existing `background`/`checker` model configuration and source/provider budgets. Jev remains optional for bounded registered predicates; it cannot mint factual authority.
- Ordinary facts get deterministic readback checks. Model-based answer evaluations are sampled or incident-driven rather than added to every turn.

## 5. Semantic contracts

New names below are proposed code, not implemented APIs.

### 5.1 Stable identity and source types

Use one shared fact-key function across extraction, acceptance, conflict grouping, revisions and reads:

```ts
interface FactKey {
  entityId: string;
  property: string;
  scopeId: string;
}

type EvidenceRef =
  | { kind: "event"; sequence: number }
  | { kind: "legacy_memory"; originId: string; entryId: string }
  | { kind: "source"; sourceId: string; locator: string; revision?: string };

type KnowledgeState =
  | { status: "current"; claimIds: string[] }
  | { status: "disputed"; claimIds: string[]; evidenceRefs: EvidenceRef[] }
  | { status: "unknown"; reason: string };
```

The fact property is not its lesson kind, Markdown section or display text. An unrelated hosting-provider fact and launch-date fact must not share one `fact` slot. A personal preference and a client instruction have different scopes.

Initial governed properties are single-valued. Set-valued knowledge needs its own element identity and operation semantics before it can be destructively updated; do not force several relationships or people into one exclusive slot.

For governed claims, add explicit scope/repair metadata to the payload and derive it into `WorldClaim`. Update the shared grouping key and projector version. Adding an unused `scopeId` field to a type alone does not isolate scopes.

Legacy claims retain a legacy key unless their property/scope has been grounded. Unknown scope is not silently global. Map exact legacy entry origins and predecessor IDs when migrating a fact. Memory entry IDs currently change with content; a display-text hash alone is not a stable fact identity.

Keep envelope compatibility explicit: `ContextEnvelope.evidenceRefs` currently contains strings, while projected claim evidence uses numeric event sequences. The new tagged types belong to versioned source/repair payloads. Resolve retained external evidence to an attributable source-observation event and preserve its locator/revision metadata there; accepted claims reference that event through the existing wire format. Do not pass tagged objects into old string arrays or silently discard external provenance. Retain no external source payload beyond its permitted scope and retention.

### 5.2 Time, support and authority

Keep capture time, source-observation time, effective time and the knowledge snapshot time separate. Current factual state uses supported validity/replacement, not simply the most recently imported sentence. Unknown dates remain unknown.

- An explicit new personal choice can replace the same prior choice.
- A repository observation establishes behaviour in that commit. It does not establish installation or successful use on the Mac.
- An assistant's report, a worker's allegation and a model extraction remain evidence/proposals until checked.
- Repeated excerpts from one source lineage are not independent corroboration.
- Source age can trigger rechecking without turning a durable fact false or lowering its epistemic authority.
- Prompt eviction is not semantic expiry; temporary moods and dated commitments retain their appropriate validity rules.

For new governed facts, replacement is explicit and target-specific. Prevent `supersedeLesserClaims()` from implicitly retiring unrelated or older-effective facts merely because a new governed event has a higher authority label. Preserve legacy behaviour outside migrated scopes until replay justifies a change. Do not reorder global `AUTHORITY_RANK` as part of this work.

### 5.3 Resolve changes and disputes differently

| Situation | Operation | Current answer |
|---|---|---|
| Grounded explicit correction of one fact | New claim plus targeted supersession | Corrected value |
| Supported change over time | New effective state; preserve the prior interval | Current value; history when requested |
| Credible unresolved sources disagree | Retain alternatives and a typed unresolved conflict | Qualified account of the relevant disagreement |
| Another source supports the same value | Add support without a duplicate semantic claim | Same value with stronger evidence coverage |
| “That answer was bad” without a replacement fact | Feedback/diagnosis issue | No invented new truth |
| Source/tool unavailable | Deferred evidence check | Known supported facts plus any relevant limit |
| Old import arrives late | Historical evidence with original time | No resurrection of a superseded value |

Replace the Librarian's “never keep both” instruction. Also change the consumer contract: `ConflictView.active` or `current` with `disputed: true` is not a settled winner. A legacy string-only conflict remains unresolved/unknown unless explicit replacement evidence establishes history. Never infer “earlier” from array position.

### 5.4 Issue, proposal, application and verification

Persist issue lifecycle and receipts as versioned payloads inside the existing event store/envelope kinds. A queue/index may be a rebuildable table in `intelligence.sqlite`; no new database.

An issue records origin event/turn, problem class, target key if known, exact claim/legacy references, source dependencies, priority, dedupe key, attempt count, next due time and optional existing domain-run ID. Unknown target identity is a valid investigable issue, not permission for destructive writes.

A proposal records its operation, expected target revision, original evidence, requested epistemic status, effective time and policy version. Start with targeted correction, support and unresolved-conflict operations plus repair retraction. Do not create a general-purpose knowledge-edit DSL.

An application receipt records accepted claim/relation IDs, exact legacy references retired from current reads, affected scopes and resulting semantic revision. Verification is separate and carries tested consumers, snapshot and `pass|fail|unknown`. Do not undo a correct fact merely because a later answer exposes a retrieval defect.

Old receipts remain readable; absent new attribution is unknown rather than fabricated. Extend runtime/overlay receipts to include current canonical claims: today `memoryEvidenceFromCompiled()` can mark memory sufficient using current claims while recording only relevant-memory matches.

### 5.5 Atomic acceptance and reversal

`acceptKnowledgeProposal()` must:

1. Resolve the exact fact/scope and existing targets. Establish cardinality and distinguish a direct user assertion from quoted material or external instructions.
2. Resolve the source references and original permissions/retention. A newly stamped curator envelope cannot renew a source grant.
3. Recheck the target's semantic revision and relevant source/erasure state inside `IntelligenceEventStore.transaction()`.
4. Append the accepted claim, explicit relation effects and receipt atomically with stable origin/operation idempotency keys. Advance the relevant checkpoint with that durable result.
5. Return the committed revision. Do not await source/model calls or publish filesystem exports while holding the transaction.

An unrelated trace does not invalidate a target revision. A changed target triggers bounded revalidation, not automatic overwriting or repetition of the whole research job. Re-running one origin/operation returns its existing receipt; a later recurrence has a new origin and is linked to the prior repair.

Make effects attributable to `repairId`. A compensating `repair_retracted` event deactivates that repair's claims and relations in the derived view while retaining its history. New governed claims use explicit relation effects so a retraction can actually revive the eligible earlier state; adding the old value alone cannot undo a still-active supersession edge. Preserve newer independent repairs. Erasure always overrides restoration.

### 5.6 Source dependency and erasure boundary

For every persisted derivative, distinguish evidence that supports the value, copied source content and merely operational attribution. Track the actual source dependencies instead of laundering text into a generic curator source.

- Revalidate current source state both at acceptance and immediately before permitted model dispatch. Do not infer ongoing collection/persistence permission from having an email/Drive read tool.
- Revocation stops new work from that source. Erasure removes/retracts dependent payloads, prompt snapshots, indexes, repair evidence and generated skills and re-evaluates surviving independent support.
- A mixed-source claim cannot survive solely because its envelope used another source ID. Equally, erasing one corroborating source must not erase a separate valid user assertion.
- Resume incomplete sweeps after restart; mark a new surface swept only after checking it. Any remaining operational audit must contain no copied source text or identifying source locator.
- Include the exact legacy counterparts in the erasure sweep. Removing a canonical repair must not make an erased old memory entry eligible for fallback/import again. Verify a fresh replay and reset import cursor cannot resurrect the erased content; do not retain raw-text tombstones to prevent that.
- For the first active scope, dependency closure and erasure tests are release requirements. Extending this to later scopes is part of each cutover, not a separate open-ended rewrite of every historic privacy subsystem.

## 6. One effective read for each turn

Add a structured, event-backed `EffectiveKnowledgeView` within the existing cognition layer. It is a derived view of accepted events plus explicitly identified legacy inputs, not another memory authority.

It carries the store identity, semantic revision, erasure watermark, projector schema, clock and selected current/history/conflict/source records. Capture these consistently for one turn. Recompute time-dependent validity at the query clock; a cache hit cannot keep an expired claim current indefinitely.

### Reader rules

1. Resolve relevant entity/property scopes before result limits. Do the same for conflicts; the current global conflict list must not turn into an unrelated personal-knowledge dump.
2. Resolve governed canonical values and exact legacy-reference supersession before assembling personal, project, NOW and relevant-memory blocks. Do not hide old records by fuzzy text similarity.
3. Use that same selection in `context.user.personal.memory`, budgeted profile overrides, project prompts and the main formatter. A separately appended old project fact must not overrule the repaired claim.
4. In the canonical claim and every duplicate projection line, retain an uncertainty marker for a relevant unresolved claim. Keep a bounded conflict snippet or locator alongside it; trimming details must not turn uncertainty into certainty.
5. Show superseded history only for historical questions. Show unresolved relevant disputes for current questions too. Preserve existing block budgets, per-section coverage and lean companion-mode behaviour.
6. Carry actual consumed claim IDs/evidence and snapshot revision into the receipt. Do not record retrieved-but-unused knowledge as if the model consumed it.
7. Version/invalidate shared recall and other process caches with semantic mutation and erasure. Unrelated operational events should not force full re-rendering; generated receipts/exports cannot re-enter curation as new evidence.

### Publication and session boundaries

The first release derives in-scope facts directly from the committed snapshot at the consumer boundary. It does not require building a new whole-system generation-directory framework.

Keep existing exports compatible and publish them atomically per file with a revision marker/manifest where needed. Track pending exports and retry idempotently. If an export is stale, active canonical readers derive current state rather than silently consuming it as authority. Introduce multi-file generation publication only when a migrated consumer actually needs that guarantee.

Chat/mobile/INVOKED consume the next snapshot on their next turn. Existing LIVE sessions require an explicit version check and supported session/context update at the next safe response boundary; compiling only at session startup is insufficient. Verify this path separately. Existing workers may retain a captured snapshot; refresh/revalidate relevant facts at their existing result/review boundary rather than assuming an export hot-swaps a running prompt.

Only one canonical writable runtime host is supported. Desktop/server replication, simultaneous writable hosts and new mobile capabilities remain outside this plan.

## 7. Delivery plan

Each phase has a usable outcome, concrete files and evidence required to call it complete. Proposed filenames are implementation choices, not existing modules.

### Phase 0 — correct conflict delivery and freeze the regression cases

**Goal:** prevent current uncertainty being silently converted into a settled fact.

**Work:**

- Convert the executed reproduction into focused formatter tests.
- Add typed conflict status, original claim/source IDs and scope through world derivation and `UnifiedMemoryResult`; keep compatibility with older string-only payloads without inventing resolution.
- Change `context-format.ts` and projection rendering so material unresolved conflicts retain a bounded uncertainty marker in current questions. Explicitly superseded facts remain excluded from current context.
- Scope relevant conflicts before limiting/formatting them. Preserve budgets and the volatile Git-state/history distinction.
- Replace the conflated existing “one current value” tests with separate resolved-history, unresolved-conflict, same-value corroboration and unrelated-conflict cases.

**Files:** `intelligence/world/types.ts`, `world-model.ts`, `cognition/types.ts`, `memory.ts`, `context-format.ts`, `projections/store.ts`, existing cognition format/temporal tests.

**Exit:** the reproduced disputed fact remains disputed in the actual formatted prompt; old resolved values remain historical; irrelevant conflicts do not expand context. This can ship independently of broad migration.

### Phase 1 — deliver one complete correction-to-next-answer loop

**Goal:** a normal explicit correction changes the next answer, not just a helper's return value.

**Work:**

- Implement shared fact identity and accepted correction/support/conflict/retraction payloads with target-revision preconditions.
- Add the narrow acceptance service inside the existing curator directory, reusing transactions, source handling and replay.
- Route ordinary attributed correction input into it before claiming a saved result. Do not require three factual corrections or a successful generated answer before retaining the input.
- Supply the effective knowledge view to every prompt representation of the first selected fact scope. Cover exact legacy entries and any independently appended project/personal block.
- Keep legacy writers outside that scope unchanged. For in-scope writers, add the compatibility adapter before activating the new reader; there must not be two simultaneous authorities for that fact.
- Invalidate relevant caches, preserve the old claim historically, and implement retraction and source-erasure behaviour for this scope.

**Primary synthetic integration fixture:** create a current launch-date fact for `project:fixture-harbor` through the existing memory/project write paths, also making its canonical representation available. Submit a normal explicit date correction through the public correction/responder boundary. A deterministic extraction dependency may be supplied, but the test must traverse real intake, validation, persistence and prompt assembly. Assert the actual prompt for the next paraphrased question contains the replacement as current and cannot get the old current date from another block. Historical recall must still work.

**Secondary fixture:** the genuine repo discrepancy between the old backstage `USER.md` description and the actual blocked automatic-profile-write code. This exercises source authority; it is not represented as a captured production incident.

**Files:** proposed `curator/knowledge-types.ts`, `knowledge-repair.ts`, `effective-knowledge.ts`; existing `content-learning.ts`, `curator.ts`, runtime correction/responder path, memory/compiler/formatter, legacy adapters for the selected scope.

**Exit:** public intake → accepted events → real consumer prompt → new session succeeds; duplicate processing is harmless; correcting another property/scope leaves this one intact; restart, delayed import, retraction and erasure tests pass. Helper-only tests do not satisfy this milestone.

### Phase 2 — original-source rechecks and durable background progress

**Goal:** the Librarian can resolve a discrepancy from original evidence and resume unfinished repair work.

**Work:**

- Normalize source locators over existing event/receipt reads, repository inspection, Evidence Engine and already permitted connector reads. Keep dates/revisions, source identity and explicit failure states.
- Reopen the identified original before broad research. For a small check, use a bounded supplied-evidence reasoning/check step only if needed. `runLocalPreparation()` is a pattern for reasoning over supplied facts, not a source-reader API.
- Use existing `dispatchKnowledgeDomain()` for larger disputes, with a stable issue-derived request ID, exact brief/evidence and retained run ID.
- Persist queue state, claim leases, attempt/due times and domain continuation in existing canonical events/rebuildable indexes. No model or network call occurs in a store transaction.
- Connect queue due-work to the existing agenda/Curator/Council boundary independently of new journal entries. Source outage or slot exhaustion results in a truthful deferred state with bounded recovery.
- Before accepting a completed investigation, recheck source state and the target revision. A later user correction must beat a stale research proposal.
- Preserve unknowns and useful supported facts; do not ask George to resolve routine research/staffing choices.

**Files:** `curator/reconcile.ts`, background `council/librarian.ts`, `runtime/agenda-tick.ts`, existing knowledge-domain/result/store integration; proposed `knowledge-sources.ts` and `knowledge-maintenance.ts` only if existing modules cannot own the narrow functions.

**Exit:** a due issue progresses without a new conversation; restart resumes its existing research run; repeated ticks cannot dispatch duplicate fleets; the original source and accepted fact remain inspectable.

### Phase 3 — migrate maintained fact scopes without rebuilding working subsystems

**Goal:** extend the proven repair path to the remaining maintained facts that need it.

**Work:**

- Inventory each active semantic writer and reader: background Librarian, Investigator/backfill, explicit remember/import, project editing, taste learning, context compilation, legacy retrieval and generated guidance.
- Define a migration entry per fact scope: canonical key, existing origins, writer adapters, consumer adapters, preservation rules, source dependencies, rollback and proof of readiness. Unknown data stays attributed evidence rather than being assigned invented properties.
- Make Librarian proposals use the accepted operation semantics; replace the unconditional contradiction instruction and guard archive feedback against unearned confirmation.
- Cut over `applyMemoryOps()` and Investigator/backfill scope by scope. Preserve daily notes/archives as evidence, current display sections, validity/aging rules and prompt budgets.
- Migrate project semantic facts when their writers/consumers are ready, retaining existing IDs, editing APIs and `projects.json` compatibility. Do not build another project registry.
- Keep existing taste extraction, scope and recurrence logic. Route accepted learned rules through canonical acceptance when that scope migrates; keep authored `USER.md` and genuine authored configuration as inputs. Taste's working algorithms are not rewritten as a condition of memory repair.
- Preserve out-of-band edits encountered at existing read/maintenance boundaries before regenerating exports. Identify generated exports by origin/revision so they are not treated as new independent evidence.
- Disable the old writer for a fact scope only as its validated replacement activates. Never leave an active reader with no correct path, or roll back by simply turning the competing writer back on.

**Files:** `council/librarian.ts`, `memory-store.ts`, `investigator.ts`, scoped project/taste editing modules, compatibility exports and the common read view. Add multi-file generation machinery only for consumers that require it.

**Exit:** each migrated scope can be rebuilt from accepted evidence/events and its authored inputs; direct in-scope writes cannot bypass acceptance; un-migrated scopes are explicitly recorded. Do not claim whole-memory canonicalization while those remain.

### Phase 4 — verify consumer behaviour and normal operation

**Goal:** prove repairs affect the product surfaces and distinguish failed repair from failed retrieval/utilization.

**Work:**

- Extend receipts with optional current claim IDs, selected conflict state and exact knowledge snapshot; include overlay/LIVE `memoryEvidenceFromCompiled()` and chat's separately supplied memory evidence.
- Deterministically check each applied repair's canonical readback and selected consumer representation. Check paraphrases, historical queries, nearby facts, budget trimming, source version and receipt attribution.
- Refresh active LIVE context at its supported boundary and verify the same-host mobile, INVOKED and chat paths. Keep per-surface readiness and tested version explicit; untested surfaces are unknown.
- Replay in a temporary store with explicit dependency injection for clocks, repository/work materializers, tools, exported guidance and model access. Do not let tests or evaluation mutate the real Flyd home.
- Freeze the pre-repair snapshot for the before comparison and the repaired snapshot for the after comparison. Adapt the current episode context builder rather than using its live-memory query unchanged.
- Use existing answer-evaluation/checker infrastructure for sampled incident-level checks; declare assertions before generating the candidate answer. Source validity and deterministic readback cannot be replaced by model agreement.
- If storage is correct but the next answer remains wrong, keep the valid correction and send precise context-selection/utilization evidence into existing improvement. Track actual later recurrences only on eligible relevant turns.

**Files:** existing runtime/resolve/realtime/mobile receipts and tests, cognition compiler/formatter tests, `evals/episodes/` adapters and existing self-improvement evidence intake.

**Exit:** each enabled surface has direct evidence of the corrected behaviour; no success claim is inferred from silence or a tool returning success; routine curation and replay cause no outward effects or extra user approvals.

### Phase 5 — reusable procedures through existing learning

**Goal:** meet the curator idea's trace-to-guidance outcome without building another learner.

**Work:**

- Concrete knowledge defects enter repair immediately. Repeated general failures continue through Dream/self-improvement; retain the distinction.
- For a verified repeated procedure, create a candidate with prerequisites, scope, original trace/outcome IDs, applicability and known counterexamples. Use existing Skillify/candidate interfaces and retain their existing authorization semantics.
- A successful turn, repeated wording, source reread or memory write is not procedure success. Require the existing outcome/replay evidence before generalization or behavioural promotion.
- Preserve current taste/rule-of-three behaviour. A factual correction does not wait for policy-promotion cohorts; a broad behavioural rule does.
- Generate or update scoped guidance only through the existing ownership/marker rules, preserving authored skills. Invalidate candidates/exports when supporting sources or prerequisites change.
- Keep policy promotion under existing evaluation/shadow/canary rules. Do not claim a current in-memory registry is durable production rollout by itself.

**Files:** existing Dream and self-improvement consumers, Skillify adapters where evidence attachment is missing, current taste-skill export, and existing inspect/status documentation.

**Exit:** one supported procedure candidate reaches the established review/promotion path with traceable evidence; unknown outcomes cannot promote it. This extension is reported separately from the core factual repair capability.

## 8. Release boundaries and recovery

| Delivery | Included | Explicitly not required to ship it |
|---|---|---|
| A: truthful conflict delivery | Phase 0, preserved budgets and resolved-history regressions | New issue queue, global migration or a research fleet |
| B: useful memory repair | Phase 1, including selected-scope writers/readers, restart/reversal/erasure | Whole project/taste migration and a global multi-file publication framework |
| C: background source maintenance | Phase 2 plus enabled-scope behaviour checks | Constant broad crawling or more user decisions |
| D: broader dependable memory | Ready scopes from Phase 3 and surface/operational evidence from Phase 4 | Rewriting authored configuration or unsupported multi-host sync |
| E: trace-to-guidance learning | Phase 5 using existing verified-outcome/promotion paths | A second learning engine |

Keep one proposed repair rollout mode, `off|shadow|active`, plus source/scope eligibility recorded as data. Existing Council/Dream/learning kill switches remain. Configuration names and limits are proposed until implemented.

Shadow may retain governed diagnostic events and render comparison views but cannot change active facts or source permissions. The first active scope must have its compatibility writer and effective reader ready together. Widen only when its declared assertions and source/recovery checks pass.

For publication failure, retain accepted events and regenerate pending exports; canonical readers use accepted state. For invalid proposals, preserve the prior state. For a wrong repair, append an attributed retraction; do not restore a database snapshot over newer corrections. For erasure, invalidate dependent caches/materializations immediately and resume the cleanup sweeps.

Disabling processing does not resurrect old facts, reactivate legacy writers for migrated scopes or restore erased evidence. Preserve a validated canonical reader even while maintenance is off. Track pending external exports and workers' captured versions without promising instantaneous cross-process prompt updates.

## 9. Required verification and acceptance cases

These are proposed implementation tests. Only the formatter reproduction in §2 was executed during this planning review.

| Case | Required result |
|---|---|
| Present-tense relevant unresolved conflict | Dispute marker and bounded alternatives/source context; no settled winner |
| Explicitly superseded value | Historical only; no “uncertainty” reintroduction of resolved history |
| Two sources repeat the same value | Corroboration, without false conflict |
| Unrelated conflict or large memory | No scope leak or budget flood; a retained disputed claim never loses its status through trimming |
| Normal correction through public intake | Accepted fact reaches the actual next prompt; helper-only tests do not qualify |
| Answer generation fails after correction intake | Input is not lost; saved/pending status remains truthful |
| Same origin delivered twice | One logical application, one revision effect |
| Immediate repeat and new process/session | Corrected effective view; no stale recall/projection override |
| Independent property or client scope | Other facts and preferences stay intact |
| Delayed old import and ambiguous source time | No current-state replacement based solely on import order |
| Competing repair or late research | Scoped revision check preserves the newer accepted correction |
| Unrelated operational event | No whole-research retry or export feedback loop |
| Source outage and no new journal turns | Due work progresses; bounded retries/deferred state without routine user interruption |
| Revocation between research and acceptance/model dispatch | No new processing/publication from the revoked source |
| Source erased after repair/export/replay capture | Dependent new content removed; independent valid assertion retained |
| Erasure followed by legacy fallback or import-cursor reset | Erased source content cannot re-enter current memory from an old compatibility copy |
| Retraction followed by newer independent correction | Reverses only its own claim/relation effects; no newer-data loss |
| Existing LIVE session and same-host mobile | Each enabled surface consumes the next supported accepted version |
| Direct project/personal prompt block | Cannot reintroduce an exact retired legacy fact as current |
| Out-of-band authored edit during migration | Bytes preserved and attributed before any regeneration |
| Before/after replay | Distinct frozen versions; no future-knowledge leakage, real-home writes or outward effects |
| Receipt says sufficient from canonical facts | Those actually consumed claim IDs and version are attributable |
| Tool/turn success with unverified outcome | No generalized procedure promotion |
| Feature exists in repository; installation unknown | Answer preserves that distinction |

Run affected suites, then relevant type/build/integration checks during implementation. Extend the existing format, temporal-memory, content-learning, compiler, runtime correction, receipt, source-consent and projection tests instead of inventing a separate test framework. Record unrelated baseline failures. Mac behaviour needs the installed adapter; compiled CLI behaviour needs its normal build path.

## 10. Measures and guardrails against self-deception

No numerical performance baseline was collected. Capture real values and cohort sizes during the first deliveries; unknown observations remain unknown.

| Measure | Definition and limit |
|---|---|
| Repeat-error rate | Same fact/scope error on eligible later relevant turns; report the opportunity count, not just the number of complaints |
| Consumer consistency | Incompatible current interpretation across tested blocks/surfaces at the same semantic revision |
| Repair usefulness | Deterministic application/readback, answer-level checks and later outcomes reported separately |
| False certainty | Unresolved dispute or unknown source presented as settled |
| Collateral damage | Independent property/scope changed, valid support lost or resolved history reintroduced |
| Cost/latency | Actual source reads, worker jobs, provider usage and foreground delay per issue |
| Recovery/erasure | Lost/duplicated repairs, stale dependent views and incomplete cleanup after restart |
| Attention | Routine approval/clarification/notification load caused by maintenance |

Declare expected assertions and cost/latency tolerances before candidate evaluation. Fix facts without waiting for a policy experiment. Use frozen cohorts and protected cases when promoting general behaviour. A system that avoids repeated corrections by refusing to answer, hiding disputes, forgetting evidence or suppressing opportunities has not improved.

## 11. Completion, risks and the immediate next task

The core curator is complete for a declared scope when normal intake, accepted knowledge, current/historical/disputed reads, original-source investigation, restart/reversal/erasure and tested product consumers work together. Report un-migrated scopes, pending exports and untested installed surfaces. Procedure learning has its own completion evidence. Repository implementation and installed deployment remain separate claims.

The strongest argument against central curation is that a wrong interpretation can spread consistently everywhere. The answer is exact provenance and scope, bounded independent checking where needed, preserved unresolved alternatives and reversible accepted effects. Central ownership solves inconsistent application; it does not prove truth.

The strongest argument against the revised small first release is that it could become a permanent patch over fragmented memory. The acceptance boundary and per-scope migration record therefore remain canonical and reusable, and delivery D explicitly removes competing writers/readers for every scope it claims migrated. Do not mark a targeted fix as full canonicalization.

**Immediate implementation task:** split the existing formatter regression into resolved-history and genuine-unresolved-conflict cases, make both pass without increasing context budgets, then connect one normal explicit correction through the actual next-answer prompt path. Do not begin a global project/taste migration first.

## Appendix: reproduce the finding without changing Flyd state

Run from a checkout of the audited baseline with a Node version supporting TypeScript stripping. The dates and project below are synthetic test data. This imports a pure formatting module; it does not open a memory database or call a model.

```bash
node --experimental-strip-types --input-type=module <<'JS'
import { formatCompiledContext } from './cli/src/cognition/context-format.ts';
const context = {
  interpretation: { temporalFrame: 'present', needsDeepMemory: false },
  user: { profile: '' },
  present: { projection: '', activeProjects: [], gaps: [] },
  projects: [], conversation: { recap: '', referents: {} },
  memory: {
    current: [{ claimId: '2', entityId: 'project:fixture-harbor',
      attribute: 'launch_date', value: '2030-06-12',
      temporalStatus: 'current', authority: 'observed', disputed: true }],
    relevant: [], historical: [], gaps: [],
    conflicts: [{ entityId: 'project:fixture-harbor',
      attribute: 'launch_date', claims: ['2030-06-12', '2030-06-10'] }]
  }
};
const present = formatCompiledContext(context);
const past = formatCompiledContext({ ...context,
  interpretation: { temporalFrame: 'past', needsDeepMemory: false } });
console.log({
  selectedValueShown: present.includes('2030-06-12'),
  competingValueShown: present.includes('2030-06-10'),
  disputeMarked: /disputed|conflict|disagree|unresolved/i.test(present),
  disagreementCalledEarlier: past.includes('earlier: 2030-06-10')
});
JS
```

Audited result: `true`, `false`, `false`, `true`, respectively. This is a characterization of the defect, not the desired regression-test outcome after implementation.

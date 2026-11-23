# Flyd v10, R2–R6 — From Self-Generated Questions to Useful Independent Action

**Date:** 23 November 2026
**Status:** IMPLEMENTATION PLAN — reviewed source, not implemented; go/no-go evaluation below
**Source baseline:** `main` at `2965891499f4a8fca031099025d7f55477e21cd3`; v10 R1 shipped through PR #341 (`996d48bc`)
**Parent:** [v10 governed self-initiated intelligence](2026-11-23-flyd-self-initiated-intelligence-v10.md)
**Product authority:** `docs/product/flyd-personal-intelligence-prd.md`
**Existing feature contract:** `docs/product/flyd-self-initiated-intelligence.md`

## 0. Outcome and the one critical correction

**Goal:** Flyd should notice something George did not ask about, independently test whether it matters, do useful authorized work, and communicate the **result** at the right time—or quietly discard it. This should happen across technology, art, business, existing commitments, and eventually consented aspects of life, not just meetings and reminders.

**First correction:** R1 says `investigated` when it has only compared already-curated observations and described a next check. That is **hypothesis triage**, not independent research. R2 must actually obtain and adjudicate new evidence before it uses the word “investigated,” “found,” “verified,” or “fixed.” R3 must not hand an invented “George said…” objective to CoS.

### Four representative experiences, not claims about present functionality

1. **Technical discovery:** A new open-source package appears relevant to an actual Flyd limitation. Flyd checks the implementation, licensing/maintenance and relevant project files, discovers a genuine useful component or falsifies the idea, and prepares a specific comparison. If an existing accepted remit covers a reversible prototype, CoS can run one; otherwise Flyd asks only for material authorization.
2. **Creative connection:** A newly curated technique intersects an active art/music project. Flyd distinguishes “same keywords” from a new artistic mechanism, makes a bounded, source-linked creative proposal or authorized sketch, and shows something appropriate to the particular idea (not a generic news card).
3. **Business judgment:** A current goal conflicts with recorded constraints, costs, dependencies or outcomes. Flyd checks which figures are sourced, models the uncertainty **locally**, and presents an actionable discrepancy—not an invented prediction or a push notification.
4. **CoS recovery:** Two work items fail for the same underlying reason. Flyd traces the reports, rules out superficial overlap, recommends a shared remedy and, if authorized under an accepted objective, lets CoS act and verify without pushing implementation choices to George.

**Counterexample:** A superficially interesting Scout headline shares words with a project but is not actionable, novel or well-supported. Flyd spends little or nothing, records why it was dropped, and never tells George.

### End-state invariant

    Consented current sources
        ↓ [verified source revisions and purpose intersection]
    R1 candidate + question + falsifiable counter-hypothesis
        ↓ [value of information; daily/per-candidate budget]
    R2 bounded evidence investigation → supported / refuted / inconclusive
        ↓ [rank actual impact, confidence, cost and alternatives]
    R3 choose: drop | keep | private preparation | permitted CoS work | ask for unique authority
        ↓ [existing grants + existing CoS + independent verification]
    R4 choose: silence | ambient artifact | contextual comment | essential decision
        ↓ [existing attention and delivery receipts]
    R5 observe true result, reaction, cost and missed opportunities
        ↓ [frozen replay and governed promotion only]
    Flyd improves its initiative quality without becoming noisier

No additional general-purpose agent, permanent thought daemon, second CoS, second scheduler, second attention queue, or second fact store.

## 1. Source review — reuse, gaps, and dangerous assumptions

| Existing implementation | What it supplies | The gap to close, not rebuild |
|---|---|---|
| `cli/src/runtime/initiative/{candidates,policy,cycle,source-validity}.ts` | R1 source-backed candidates, deterministic rank, event-backed decision/proposal, UI freshness | Evidence check is descriptive only, source validation primarily occurs at Activity read, and persisted source revision is often only a date; no actual research or cross-purpose permissions |
| `cli/src/runtime/agenda-tick.ts` | Shared Core/launchd tick, model-backoff mechanism | Add a **bounded model-using** investigation job in the existing tick after or separate from Scout, but no fresh scheduler |
| `cli/src/evidence/{evidence-engine,default-registry,query-planner,types}.ts` and `council/scout-evidence.ts` | Multi-source read/search, fallback, fusion, conflicts, coverage, Scout corroboration | EvidenceEngine is not itself a consent/spend boundary for background initiative; do **not** pass raw private project context to public searches |
| `cli/src/intelligence/egress-policy-gateway.ts` + `context-envelope.ts` | Field redaction, source revocation and basic sensitive field scope checks | Current `decideEgress` checks fields/revocation; despite its docstring, explicit destination/purpose/source-contract **allowlist enforcement is not proven in that method**. Add verified checks before external transmission |
| `cli/src/intelligence/sensors/source-contracts.ts` | Explicit opt-in `initiative.curated`, disabled by default, **egressDestinations: []** | Local initiative consent is not model/network consent; any new provider data flow needs a separately approved specific purpose |
| `cli/src/intelligence/event-store.ts` | Canonical idempotent events, local SQLite transaction, source erasure, replay fingerprint | `eraseSource` removes one source's payloads; derived events referencing an erased *upstream* source are not automatically erased. RetentionDays on a source contract is not itself proof of enforced TTL |
| `cli/src/intelligence/capabilities/{authority-ledger,execute}.ts` | Typed manifests, target fingerprint, one-use effect grants and independent verifier contracts | `AuthorityLedger` is **in-memory**, not a durable standing-grant authority. Cannot alone justify resumed, automatic CoS dispatch after a restart |
| `cli/src/runtime/conversational-initiative.ts` + `preparation-store.ts` | Explicit conversational remit for local drafts from the provided turn | These remits forbid account writes, research and scheduling. **Never reinterpret** an existing draft remit as permission for proactive background research or repo edits |
| `cli/src/command/cos/{objectives,intake,tick,plan,operational-judgment}.ts` | Durable CoS objectives, dependencies, domain teams, recoverable receipts, decisions, verifier | `openObjective` creates a random ID, records `origin.surface` only as chat/view/agenda/live, and `intakePrompt` says “George's exact words.” Proactive work must not spoof George's request or duplicate existing objectives |
| `cli/src/runtime/{attention,delivered}.ts`, `conversation-view/activity.ts`, `council/muse.ts` | Timing and interrupt guard, ambient activity, contextual relevance | Do not let initiative create a second delivery policy or call a new relevance model on every conversational turn |
| `cli/src/intelligence/{outcomes/outcomes, outcomes/verified-loop, outcomes/outcome-review, evaluation/episode-replay, policies/policy-registry}.ts` | Separates effect verification, measured impact, explicit review and rollout evaluation | Need **initiative-specific** causal join and “missed useful opportunities” labels; an implicit glance or a “like” is not verified impact. `PolicyRegistry` also keeps candidate stages/active version in a process-local Map; canary activation/rollback needs canonical persisted transitions before trusting restart recovery |
| `cli/src/lib/{curiosity,attention,tension}.ts` + legacy daemon; Council Critic/Strategist; Scout | Genuine existing question-generation and challenge machinery | Do not migrate legacy raw `wiki/` captures into Core without new consent; benchmark R2 against baseline instead of assuming new model-generated questions are better |

**Important code-level caveats:** R1 uses simple lexical novelty, date-based project revision, and different ID spaces per producer; same semantic opportunity can survive under different keys. The active feature is under explicit local LEARN consent but its source-lineage predicates and retention/erasure need hardening before expensive research or cross-domain data reuse. These are P0 release blockers, not “later polish.”

## 2. Three approaches considered

| Architecture | Impact | Engineering | Operational/safety risk | Reversible? | Verdict |
|---|---|---|---|---|---|
| **A. More smart triggers and nice cards** | Incremental | Low | Low | Yes | Cannot independently test claims or advance work; repeats the Calendar trap |
| **B. Always-running reflective team of agents** | High theoretical ceiling | Very high | Duplicate scheduling/CoS, unmanaged provider spend, invented initiative and interruption | Hard | Reject |
| **C. Incrementally deepen R1 through the existing evidence → CoS → outcome chain** | High practical ceiling | Medium–high | Source mixing, identity/permission and usefulness errors, addressable with explicit gates | Yes | **Choose** |

**Design choice:** One candidate identity, one evidence-bound investigation receipt, one existing authority path, one existing delivery chain, one causal outcome record. Specialized teams perform assigned work; Flyd retains editorial judgment. Model selection is an evaluated implementation detail, not a new governance layer.

## 3. Shared contracts and lifecycle — precisely one place for truth

### 3.1 Identity and source lineage

A `candidate` is a claim/question from an observed source revision. A `research` is an investigation of that question. A `work` is an accepted/authorized objective. An `intervention` is an actual decision to surface or act. An `outcome` is evidence of what followed. **Never use the same event kind to mean all five.**

Add to the R1 projection **without a second store**:

    InitiativeCase {
      candidateId                 // semantic question, normalized subject and domain
      sourceFingerprint          // ids + content revision + current grants
      hypothesis, counterHypothesis, falsificationCondition
      sourceLineage[]            // source id, revision, evidence ref, purpose, sensitivity
      consentGeneration
      status                     // triaged | investigating | supported | refuted |
                                 // inconclusive | deferred | proposed | expired
      reasonCodes[]
      investigationId?
      acceptedObjectiveId?
      lastDecisionAt
    }

    InvestigationReceipt {
      investigationId, candidateId, sourceFingerprint, policyVersion
      claimStatus                // supported | refuted | inconclusive | no_evidence
      factualClaims[]            // each with evidence ids, retrieval timestamps
      counterEvidence[], gaps[], sourcesUsed[]
      cost                       // capability requests, model tokens, wall-time, spend if known
      stopReason                 // resolved | refuted | budget | timeout | no_consent | stale
      evidenceRefs[]             // references, not raw source text in long-lived memory
      completedAt
    }

    InitiativeActionProposal {
      candidateId, investigationId, intendedOutcome, doneWhen[]
      projectOrTarget, evidenceRefs, effectClass, estimatedEffort
      authoritySource?           // *actual* user acceptance or standing remit, not an inference
      authorityGrantId?, budgetKey?, expiresAt?
      next                       // drop | private_draft | offer | scoped_delegate
    }

Persist only as current `IntelligenceEventStore` epistemic events plus an indexed/derived projection. If durable leases require transactional uniqueness, add the minimal **event-store transaction/checkpoint primitive**; do not create `initiative.sqlite` or duplicate CoS objective JSON.

**ID invariants:** content revisions include real content identity, not just a YYYY-MM-DD updated field; dedup “same question across Scout/Council/CoS” through an explicit subject/question fingerprint; repeated ticks/restarts are idempotent; new material evidence enables reconsideration, but changing a timestamp without new evidence does not.

### 3.2 Source-policy intersection

Each investigation MUST evaluate the source bundle, allowed operation and output sink at four points: **before source reads, before provider/network egress, before saving derived text, before presentation/CoS dispatch**.

Use the most restrictive combined scope. Public external article URLs are not a grant to transmit a private project name/description in a web search. Default public query composition is from public terms only; the private comparison happens locally.

If one parent is disabled/revoked, or a consent generation changes, block the affected work and remove derived payloads/cards/caches from all relevant surfaces; do not just hide one Activity card. A model's sanitized output can still reproduce private facts, so the output has the same parent lineage.

**Separate policies:** reading local curated data; querying public web; transmitting local text to a configured model; using authenticated GitHub/project access; modifying local artifacts; dispatching work; sending/publishing. Never reuse one opt-in to imply the next.

**Low-friction public research:** provide **one explicit, renewable standing opt-in** for bounded *public-only* background lookups using a permitted public search capability. This grants no release of private projects, identities, chat text, source code, or proprietary file paths. Construct public queries solely from already-public Scout items, then compare results with private project facts **locally**. Do not request George's approval for each harmless public lookup once this purpose-bound permission is active. A source/destination/purpose mismatch still blocks that call; a private repo analysis or upload requires its own accepted scope.

### 3.3 Bounded executive decisions

Work disposition:
`drop | defer | investigate | prepare_locally | propose | delegate_under_existing_mandate`.

Attention disposition:
`silent | ambient | conversational_comment | essential_decision`.

These are independent. A valuable investigation may remain entirely silent; a low-value finding should not receive a card just because it exists. Required approvals and accepted work outcomes bypass optional relevance suppression and retain the established delivery path.

### 3.4 Budget and stop conditions — defaults to benchmark, **not measured facts**

The initial canary should start with config values **proposed**, adjustable once source/provider costs are measured:
- Max **two new research investigations per day**, not two full research calls every five-minute tick. Reserve at most one for a grounded creative/serendipity candidate; this is part of the two.
- Max **one bounded model synthesis per candidate** by default; one optional countercheck only for a disputed consequential claim, subject to separate budget.
- Max **two public follow-up searches** after trying cached/direct sources; no unlimited recursion. Use `EvidenceEngine`'s existing quick/default/deep planner instead of a parallel tool-loop.
- Set explicit max request count, outbound payload bytes, total token usage, provider spend ceiling and elapsed wall-time per case; **choose numeric resource ceilings from measured provider latency/cost**, not invented estimates.
- Hard daily cap on **all** initiative background model spend and investigation dispatch, separate from existing mandatory work. An overrun or unknown cost means hold.
- No retry after an unknown external effect, no repeat research on unchanged source fingerprint, no backlog flood after re-enabling, and no research when the current provider is in model backoff.

Stop when falsified; when new evidence no longer changes the expected decision; when no consent/capability; after first budget breach; after repeated relevant source failures; or when the underlying objective is completed, cancelled or superseded.

## 4. Ordered implementation phases (P0 → P6)

### P0 — Fix R1 truth, consent and revocation before enabling new investigation

**Why first:** A plausible-looking initiative is presently cheaper to generate than to verify. Scaling this produces convincing but ungrounded busywork and potentially retained/private derivative data.

**Edit/extend:** `cli/src/runtime/initiative/{candidates,cycle,source-validity,policy}.ts`, `cli/src/intelligence/{event-store,context-envelope}.ts`, `cli/src/intelligence/sensors/source-contracts.ts`, `cli/src/conversation-view/activity.ts`; tests in `cli/src/runtime/__tests__/initiative-cycle.test.ts` and intelligence erasure tests.

Tasks:

1. Separate `triaged` from `investigated` in code, logs and UI; relabel R1 facts as unverified. No impression of completed external research.
2. Replace project `updated`-day revision, Scout edition-only revision and Council `createdAt` revision with stable content fingerprints and explicit source-generation identifiers. Recompute only for material content changes. Add cross-producer semantic duplicate suppression without conflating distinct questions.
3. Move source permission validation into the **producer and consumer**, not only ActivityReader. The existing `permitted` prefix check is not enough for signed, expiring or revoked mixed-source grants. Fail closed if a parent cannot be resolved.
4. Make upstream source erasure/expiry/revocation retract **derived event payloads**, reference caches, prepared visual artifacts and Activity records via indexed parent lineage or existing erasure sweeps. Receipt metadata may survive only if non-identifying and privacy-compliant.
5. Enforce source retention in runtime cleanup and on reads; `retentionDays:30` must become a tested data-deletion rule, not merely a contract field. Provide a backfill cleanup for previously written R1 derived records.
6. Test same-domain source changes, multiple-parent erasure, source contract disable/pause/renew, Mac and mobile view rechecks, simultaneous Core ticks, expired outstanding leases and corrupted JSON.
7. Confirm installed Core is the unique writer. Do not activate or migrate the legacy curiosity daemon's `raw/**` into personal intelligence merely because it already exists.

**Exit:** a stale/revoked source causes no new research, no leftover readable derivative payload and no UI exposure. Same source fingerprint produces one decision even through restarts/parallel ticks. R1 no longer claims an investigation was done when it was not.

**Go/no-go:** do not proceed to P1 until source lineage, retention and erasure safety tests are green.

### P1 — Perform genuine independent, bounded evidence investigation

**Why:** This is the first stage that can materially improve Flyd: turn a question into something George could use or act on.

**Edit/extend:** `cli/src/runtime/initiative/{cycle,policy}.ts` and new narrow `research.ts`, `research-plan.ts`, `research-receipt.ts`; reuse `cli/src/evidence/{evidence-engine,default-registry,types,clustering,contradictions}.ts` and `cli/src/council/scout-evidence.ts`; revise `cli/src/intelligence/egress-policy-gateway.ts`, `context-envelope.ts`; existing `agenda-tick.ts` and `model-backoff.ts`.

Tasks:

1. **Private/public question decomposition:** Extract a public search objective from an approved/public source without including private project text, identities or internal repo paths. Keep private comparison in an authorized local context. When no safe public query exists, choose local-only or stop.
2. **Preflight and enforcement:** Extend `EgressPolicyGateway` to actually check source-contract status **and allowed destination/purpose**, declared field schema, classification and allowed payload. Route public EvidenceEngine requests through a preflight adapter at its background-initiative boundary; don't weaken existing interactive research. The only outbound bytes are the gateway-approved projection. Emit allow/deny receipts that carry no private content. Add a single **user-enabled public-background-research scope**, with a clear provider/destination list, expiry/renewal and daily ceiling. A private local source contributes **zero outbound bytes** unless separate egress consent permits its exact fields. Querying public material about a public title should not require repeatedly asking the user.
3. **Cheapest evidence first:** Reuse existing Scout sources, cached source references, accepted project facts and authoritative CoS receipts. When new evidence is needed and permitted, call `EvidenceEngine.research(query, "quick", { locators, includeSearch })` with a bounded plan. Prefer direct public primary source, then independent corroboration; apply source diversity and contradiction logic already in Scout.
4. **Actual hypothesis test:** Evaluate one explicit falsification condition, a grounded counterargument, fact-versus-inference and whether the information changes a specific next step. Include `unsupported`, `refuted` or `inconclusive` as acceptable *successful research completion* states; never automatically produce a positive idea.
5. **Model judgment only where it adds value:** Cheap deterministic filters first, then an optional bounded reasoning pass on **permitted redacted evidence**. Reuse configured model routing/System-1 evaluation/fast operational judgment where appropriate, not a forced Jev→new model→large model cascade. No private provider egress unless a separately enabled source/destination/purpose opt-in exists.
6. **Durable, resumable investigation:** A canonical claim keyed by candidate+evidence+policy; competing ticks must not run the same external query. Record requested/started/stopped/failed, source revisions, leases, budget receipts and the final evidence-linked research receipt. On restart reconcile; never blindly repeat a potentially outward side effect.
7. **Drop poor ideas early:** Simple lexical novelty is only a seed. Verify novelty against the project's current approach and active CoS objectives. A headline with only shared vocabulary fails. Keep the small serendipity lane without allowing it to bypass grounding.

**Concrete first slice:** A previously curated **public** GitHub library vs a **permitted local** Flyd implementation problem. The research validates what the public library really does, checks constraints/licensing when present, records a specific difference and a concrete falsifier. It does **not** send private code snippets to a web service or publish a repo change.

**Exit:** source-linked research returns supported/refuted/inconclusive; fresh external evidence is actually checked; duplicate ticks do not re-query; refusal/backoff/timeout/consent loss end safely. A blind reviewer can tell whether Flyd learned anything new, not merely rephrased R1.

### P2 — Turn valuable findings into accepted, permissioned CoS progress

**Why:** Without action, Flyd is an idea newsletter. But inventing a work objective from inferred interest would violate its relationship with George.

**Edit/extend:** `cli/src/runtime/initiative/{policy,cycle}.ts` and narrow `action-proposal.ts`, `cli/src/command/cos/{types,objectives,intake,tick}.ts`, `cli/src/intelligence/capabilities/{authority-ledger,execute}.ts`, `cli/src/runtime/preparation-store.ts` (read boundaries only), existing `command/store.ts` and CoS tests.

#### Three levels of follow-through

**Level A — No further authority needed:** local ranking, factual comparison, counter-hypothesis, and an ephemeral recommendation derived from already allowed data; no new write to a user's repo/accounts.

**Level B — Bounded private preparation:** save a research note, small experiment or private draft *only if* a specific user-approved standing remit or accepted objective covers this data, output path, work type, time/cost bound and verifier. Use existing permitted preparation paths; **do not** reinterpret current conversational draft remits as background research authorizations.

**Level C — CoS task under accepted authority:** a durable, scoped instruction to CoS to undertake a research-only job or reversible implementation step. No effect beyond what the grant permits. Anything external, destructive, costly, public, sensitive or involving George's subjective final choice remains under established confirmation.

Tasks:

1. Define an **explicit user-owned standing remit for initiative**, not a model-emitted token. Proposed fields: `remitId`, accepted goal/project, permitted source purposes, allowed work categories, allowed targets/output roots, time and spend limit, expiration, revocation, user-authored acceptance proof, verifier, and whether re-delegation is permitted. No blanket “do whatever you think is best.”
2. Confirm which existing authority mechanism can durably represent this. The `AuthorityLedger` is currently process-local; **do not rely on it alone** for restart-resumable grants. Add only the minimum durable authorized-intent/claim receipt through the canonical event/command store and use ledger/verifier contracts at execution. No new separate grant truth store.
3. Fix CoS intake semantics: introduce a distinguishable, reviewed `initiative` origin with `acceptedObjectiveId` or `standingRemitId`, **not** a fabricated `origin.surface:"chat"` and not the template `George's exact words` when George never issued the task. Preserve source labels and original user mandate verbatim; generated briefs are explicitly Flyd's hypothesis/analysis.
4. Provide idempotent objective linking. `openObjective` currently creates a fresh random ID; add atomic `getOrOpenForInitiative(initiativeKey, acceptedRemit, sourceFingerprint)` under the existing command lock or a single canonical claim. Check all open/current/recent objective keys before opening. Do not reset completed work merely because Scout refreshed an edition.
5. Before dispatch, revalidate source scopes, grant TTL/target fingerprint, project status, current permission policy, deadline, spend budget and dedup identity. Require effect/receipt verification. Let the existing CoS DAG and wake/resume machinery own every later stage.
6. Cancel/pause behavior: subject-level “stop this,” revoked source, expired mandate or corrected goal prevents **new** actions and steers/cancels existing ones through CoS's actual safe task controls; no unverified claim that a task stopped. Unknown delivery/effect receipt ⇒ reconcile, never blind retry.
7. Use fast operational judgment on tactics that existing authority already covers; keep policy enforcement deterministic. Notify George only when his actual authorization or personal judgment is needed, not “should I ask the research team?”

**First actionable slice:** CoS takes a permitted **read-only research follow-up** on an already accepted Flyd issue, verifies a result, and returns it without narrating the delegation. Only after this works should a reversible patch/prototype be a pilot class.

**Exit:** two ticks and two Core processes dispatch **at most one** task for the same accepted initiative; no authority → no task. A genuine accepted remit results in verifiable work and one delivered result. Revoke/cancel and crash-before-receipt are safe.

### P3 — Communicate worthwhile results without turning Flyd into a status feed

**Why:** Product success is not more cards. It is a few uncanny moments where Flyd has done something relevant and says something worth hearing.

**Edit/extend:** `cli/src/conversation-view/{activity,semantic}.ts`, `cli/src/runtime/{room-context,turn-plan,attention,delivered}.ts`, `cli/src/council/muse.ts` and existing participation-plan U1/U2 routes.

Tasks:

1. Present the **real finding**, not “Would you like me to investigate?” when the work has already been done. Example: “This library's graph evaluation can replace a custom step in Flyd; I checked the API, license and our code. There's one limitation.” If it is uncertain, state the missing evidence.
2. Render a manifestation fitted to **this conclusion**: code comparison/evidence dossier; a sketch/references for visual discovery; a small business assumption model; or one factual line. Reuse semantic objects and the existing result/visual dossier system. No “investigation → investigation layout” template rule.
3. Separate silent stored result, ambient candidate, user-notified finding and actual displayed/acknowledged result. Reuse existing delivery receipts and protected-approval bypass; no new notifications queue.
4. Piggyback on the existing batched conversational relevance selector; no extra model call per voice/text turn. Never insert stale unrelated curiosity into a sensitive or focused conversation. A quiet idea can wait for a relevant project discussion.
5. A user can inspect `whyNow`/`whyMe`, sources and uncertainty, dismiss **one subject**, mute a topic, request a specific follow-up, or revoke initiative consent. “Ignored” is not “dismissed,” and neither is objective evidence of low quality.
6. Presentation must recheck the full multi-parent consent/expiry before rendering, including mobile and restored conversation history.

**Exit:** the same source-linked result appears once, with the right evidence and without backstage narration. Urgent user-owned decisions always reach George; unrelated optional insights do not interrupt focused work.

### P4 — Learn from actual outcomes, not from attention or applause

**Why:** An intelligent assistant should develop taste for useful initiative, not maximize accepted tasks and colorful insight cards.

**Edit/extend:** `cli/src/intelligence/{outcomes/outcomes, outcomes/verified-loop, outcomes/outcome-review, evaluation/episode-replay, policies/policy-registry}.ts`, initiative research/decision receipts, Council correction and project feedback paths.

Tasks:

1. Define a causal join: `candidate → evidence investigation → action proposal → accepted CoS objective (optional) → independent effect verification → delivery receipt (optional) → user reaction (optional) → observed benefit (maybe never known)`.
2. Store predicted value **before** execution. Log what source and hypothesis triggered work, the counter-hypothesis, cost, consumed authority and what was genuinely verified. If no effect is measured, impact is `unknown`—not a success.
3. Explicit user feedback on an initiative can tune topic appropriateness and timing, but only after verifying the displayed source and actual interaction. A like is not an impact measure; an ignored card is not a rejection.
4. Track **silent correct decisions** (discarded stale idea, protected interruption avoided) and missed high-value opportunities in a held-out review. Otherwise the loop will game the metric by saying less or more.
5. Replay against the same frozen cases and older Council/legacy curiosity. Apply existing `PolicyRegistry` constraints for candidate ranking/model/attention changes: predeclared target metric, sufficient matured evidence, safety and cost nonregression, canary, rollback. **Persist policy stage/version and rollback receipts in the canonical event spine** before canary activation: the current registry holds its stage map in process memory. Avoid unsupervised prompt/weight promotion.
6. Corrections have contextual scope: an explicit user correction updates that subject quickly; repeated corrections can justify a broader preference through the existing correction-learning path. Never infer a global life/creative taste from a single dismissal.
7. Periodically sample false positives, baseless claims, false novelty, inappropriate “helpfulness,” unnoticed cancellations, total model spend and opportunity recall, with redacted diagnostics.

**Exit:** test-corpus replays show better evidence quality and verified outcomes per interruption and per spend than the frozen baseline. A policy cannot promote using unverified outcomes or protected-case regressions.

### P5 — Pilot the **actual** Mac assistant and prove useful initiative

**Why:** GitHub CI proves compilation and determinism, not whether Flyd notices the right things in George's actual world.

**Edit/extend:** `cli/src/commands/initiative.ts`, `cli/src/runtime/agenda-tick.ts`, `cli/src/conversation-view/activity.ts`, Mac adapter where required for presence/consent controls, `docs/product/flyd-self-initiated-intelligence.md` and runbooks. Keep mobile unchanged until Core proof.

**Acceptance pilot sequence:**

1. On a Mac test install, confirm the **actual launched Core**, Node/dependencies, source contract status, `FLYD_COS` status, existing Scout/Council schedule, background model provider health and the owner of the single event store. `git pull` alone is not a deployment; rebuild and restart the installed Core/adapter.
2. Run v10 in **shadow** with explicitly authorized local sources; inspect generation, dedup, evidence confidence, counterexamples, spend and missed opportunities, no user-facing output.
3. Enable a **read-only research canary** in one approved technical/creative project. Verify public lookup, source-lineage preservation, no private search terms, and one useful verified or correctly refuted finding.
4. Enable contextual ambient results; no push notifications initially. Ask George whether the result was useful; count first-class *ignored* and *dismissed* outcomes separately.
5. Add an accepted scoped standing remit for a **read-only CoS research job**; verify once-only dispatch, restart/resume, receipt, revoke and no fabricated user request.
6. With independent proof, trial one reversible private artifact in a sandbox, **not** publish/send/merge/deploy/payment. Review its real output through the existing artifact/UI flow.
7. Roll out additional domains only when corresponding source contracts, purpose boundaries and pilots are explicitly enabled. No automatic observation of WhatsApp/email/health/finance/personal relationship data.
8. Stop/rollback within one control change. Previously queued research and cached outputs must not leak after off/pause/revoke. Verify Mac Activity/voice and mobile read-only surfaces respect removal.

**Exit:** a full installed-Mac trace demonstrates ≥2 actual consented domains (creative + engineering/business if available), clear evidence-backed gain or falsification, safe follow-through under an accepted remit, and appropriate quietness. A third domain must be demonstrated synthetically before expansion; absence of consent in a domain is not a feature defect to “fix” by reading it.

### P6 — Release hardening, maintenance and operating observability

1. Maintain one canonical `initiative status` view: enabled scopes, separate egress consents, queued/in-flight investigations, current spend against budgets, lease state, last verified finding, last outcome, current pause/kill status; no private text by default.
2. Add a structured diagnostic trace (redacted by default): why a candidate was accepted/rejected, what evidence was checked, why investigation stopped, why a task was or wasn't authorized, why a result was quiet/surfaced, and what was verified.
3. Monitor stale opportunities, duplicate work, provider 429/backoff, unconfirmed CoS effects, unhandled erasure sweeps, model latency and source renewal. Self-repair is permitted only within an existing accepted scope; do not create infrastructure tasks from its own metrics without permission.
4. Set per-domain fair-share caps and a user-adjustable global “quiet/normal/curious” initiative intensity. This scales **budget**, not permission. Protected work and core functionality are never suppressed by optional curiosity quota.
5. Use staged switches: `off → source-opted-in shadow → local research canary → allowed external evidence canary → ambient result → read-only CoS → reversible sandbox artifact`. All stage transitions leave receipts and have atomic rollback. No automatic “full autonomy” switch.
6. Explicit upgrade/retention path from R1 events. Unknown legacy states do not translate to current consent, claims or accepted objectives; no backlog replay storm.

**Exit:** clear operator controls, crash recovery, bounded cost, no privacy/permission regressions, stable performance and validated reduction of needless questions without suppressing genuine user decisions.

## 5. Sequence and dependencies, not six parallel rebuilds

| Gate | Depends on | Shippable proof | Stop if |
|---|---|---|---|
| **G0: Safe source truth** | Current R1 | Content-revision, permission, retention and derived-erasure regression suite | Any stale/erased parent remains usable or viewable |
| **G1: Evidence-grade investigation** | G0 | One real public-source research conclusion plus one refuted claim, both cited and budgeted | Public query leaks private terms; research is only rephrasing |
| **G2: Permissioned work** | G1 | Existing accepted remit → one read-only CoS job → independently verified report | A model can invent a mandate; duplicate or unknown effect is retried |
| **G3: Natural presence** | G1, G2 (for action results) | Relevant evidence-backed insight surfaced once; correctly silent when irrelevant | Backstage chatter, missed protected call or recurring card spam |
| **G4: Learning without reward hacking** | G1–G3 | Held-out replay improves specified metric without protected regression | “Likes” or generated suggestions are counted as verified impact |
| **G5: Mac/user acceptance** | G0–G4 | Explicit consented Mac pilot, budget trace, rollback/revocation drill | Installed behavior differs from CI, bad privacy or noise profile |
| **G6: Operational expansion** | G5 | Controlled wider domains; stable budgets and opt-in | Unbounded reads, model calls or autonomous work creep |

**Work ordering:** G0 → G1 → G2; G3 begins as soon as real sourced results exist; G4's observability hooks should be added early but outcome-based policy promotion waits for real matured evidence; G5 happens for each canary capability, not only at the very end.

Do not claim v10 complete until G0–G6 have measured proof. Do not “ship” P2's CoS interface in advance of authority enforcement just to demonstrate activity.

## 6. Specific implementation tickets and file ownership

Suggested PR-sized units, each independently revertible:

| Ticket | Files most likely to change | Test/proof |
|---|---|---|
| T0.1 R1 epistemic/status and source-revision fix | `runtime/initiative/{candidates,cycle,policy,source-validity}.ts` | same-day changed content, unchanged timestamps, cross-producer duplicate, no “research completed” wording |
| T0.2 Derived lineage/retention/erasure | `intelligence/{event-store,context-envelope}.ts`, source contracts, initiative projection, Activity | revoke one of two parents, upstream erasure, TTL, recovered process, mobile/desktop rechecks |
| T1.1 Purpose and egress allowlist | `intelligence/egress-policy-gateway.ts`, `context-envelope.ts`, evidence boundary adapter | local `initiative.curated` cannot go to public model/search; destination/purpose mismatch denied, full outbound bytes inspectable |
| T1.2 Source evidence research | `runtime/initiative/research*.ts`, `evidence/evidence-engine.ts`, Scout adjudication | primary+corroboration, falsification, claim↔evidence mapping, timeout/429, no raw private query |
| T1.3 Durable bounded run | `runtime/initiative/cycle.ts`, event-store transaction/lease helper, agenda tick | two processes/restart, exactly-once claim, budget accounting, stale/revoked/expired stop |
| T2.1 Standing initiative mandate | existing grant/remit and event-spine contract, minimal new typed adapter | user acceptance proof, wrong target, expiry, revocation, budget, no model-issued permission |
| T2.2 CoS intake and idempotency | `command/cos/{types,objectives,intake,tick}.ts` | true initiative origin; original George mandate preserved; duplicate run prevented; unknown dispatch not blindly retried |
| T2.3 Read-only CoS slice then sandbox output | existing CoS research team, verifier and command storage | accepted research task completes, checked result, no unauthorized repo write |
| T3.1 Sourced experience | `conversation-view/{activity,semantic}.ts`, `runtime/{room-context,delivered,attention}.ts` | no duplicate Council card, no extra turn model, natural voice, replayable shown receipt, quietness |
| T4.1 Outcome feedback/replay | `intelligence/outcomes/*`, `evaluation/episode-replay.ts`, `policies/policy-registry.ts` | impact ≠ reaction; missing outcomes remain unknown; held-out improvement and protected regression veto |
| T5.1 Mac pilot diagnostics and revoke drill | `commands/initiative.ts`, test Mac adapter, docs/runbook | installed Core proof, scope off, in-flight cancellation, zero cached leaked content |
| T6.1 Canary and operator recovery | config/flags, source-consent UI, existing agenda/command telemetry | staged rollback, no backlog flood, per-day cost quota, no duplicate writer |

**Do not refactor the whole Council, daemon, command layer, source registry or evidence architecture under these tickets.** Keep changes localized and replace only a demonstrated blocker.

## 7. Evaluation corpus and measurement design

### Frozen comparison, not a celebratory test suite

Build ≥120 **independent, synthetic or explicitly consented/redacted**, labeled episodes **before tuning**:
- 20 real creative/technology cross-project links and distractors.
- 20 external tool/library claims with true, misleading and stale source evidence.
- 20 business/venture constraint or assumption tensions with known and unknown numbers.
- 20 CoS repeated-failure and already-open-work scenarios, including false similarities.
- 20 quiet/no-action cases, including plausible but irrelevant headlines and material **missed** opportunities.
- 20 protected privacy/authority/effect cases: revoked parent, purpose mismatch, injection, bogus mandate, repeat dispatch, uncertain external effect, active user-owned approval.

**Freeze** baseline Council/legacy curiosity behavior and the R1 lexical generator on **the same permitted source snapshots**. Label evidence correctness, novelty beyond prior context, recommended action, interruption appropriateness, new value of information, actual effects, provenance/consent, and cost. Hold back one blind time-based cohort for go/no-go.

### Non-negotiable gates

- **Zero** unauthorized effects, forged mandates, private-query leaks, provider sends without correct source/destination purpose grant, renewed execution after unknown external effect, or protected approval suppression.
- **Zero** known fabricated personal claims offered as verified conclusions; any unverified personal statement must retain uncertainty and provenance.
- Derived sources erased or revoked → no readable cached/viewable continuation and no pending external work.
- A unique candidate/source revision leads to at most one funded investigation and one accepted objective under a given grant. No permanent suppression after materially new evidence.
- Model unavailable, permission absent, claim refuted or budget exhausted ⇒ correct graceful outcome, not repeated escalation.

### Provisional quality gates — **targets for testing, not observed metrics**

- R2 beats current Council+legacy curiosity/R1 on blinded **useful, evidence-grounded insights per research dollar**, with no deterioration in safety, source accuracy or appropriate silence. If it doesn't, improve existing Council/curiosity rather than promoting a new planner.
- At least two distinct domain classes produce actual grounded results in the consented pilot; one concrete, verifiable benefit or timely refutation per class. This is a pilot criterion, not a service-level promise.
- Record *surfaced usefulness*, *verified independent impact* and *correctly missed/caught opportunity* separately; do not select a numerical satisfaction target until the baseline and reviewer agreement are known.
- Track time-to-relevant finding, normalized evidence calls, latency percentile, model token spend, external egress byte count, false novelty, duplicate research, user interruption, and frequency of justified silence.

**Fail-open on curiosity? No.** If a source or capability fails, Flyd may **quietly** preserve a local unanswered question; it must not invent a result or coerce user attention to hide the failure.

## 8. Adversarial review — what could make this plan fail

### Critique 1: “The architecture is still trying to automate taste”

**Strongest case:** The most useful insight in art and strategy is often high-risk, surprising and difficult to judge from a deterministic ROI score. Over-constraining the model with clean tickets could make Flyd boring.

**Mitigation:** Keep one low-cost serendipity candidate lane, allow creativity judgments with lower confidence thresholds while retaining strict evidence and action authority, and measure **unexpected useful connections**, not just productivity. Distinguish making a speculative idea from asserting its factual basis.

### Critique 2: “The biggest problem is internal knowledge, not web research”

**Strongest case:** EvidenceEngine excels at external retrieval, but a user's constraints and accepted work might exist in CoS objectives, local design files or memory; external search will not verify the actual problem.

**Mitigation:** Local authoritative comparison comes first. CoS/local retrieval under source contracts is allowed where covered. External web is a deliberately narrow supplement, not the foundation of every investigation. Improve R1 source context before spending on more models.

### Critique 3: “The plan assumes authority is solved”

**Strongest case:** `AuthorityLedger` is process-local and `openObjective` currently treats intake as George's exact words; an initiative-driven patch here could turn curiosity into unreviewed work.

**Mitigation:** G2 is a hard security/ownership gate. First prove a **single read-only** accepted task, stable original mandate reference, idempotency and restart safety. Never grant authority from model output, and never allow the normal user-authored intake path to mislabel a generated idea.

### Critique 4: “The source erasure problem is deeper than Activity hiding”

**Strongest case:** Erasing a parent today leaves the derived `initiative.curated` payload in the event spine (and potentially a provider/cache copy). That is unacceptable before adding personal domain sources.

**Mitigation:** G0 retraction and derived-payload lineage are prerequisites. Materialized event payloads/caches must be removed or cryptographically unobservable on upstream erasure; data minimized before outbound use. No broad rollout until the erasure sweep is proven across every participating surface.

### Critique 5: “If you optimize for only verified effects, Flyd never offers a creative thought”

**Strongest case:** An insightful observation might be valuable without measurable external impact. Demanding a task receipt for every idea biases toward mechanical work.

**Mitigation:** Distinguish truthfulness/evidence quality, subjective helpfulness of the idea, and verified external effect as three separate axes. Keep a small creative pilot track with thoughtful human review, not fictitious effect verification.

### Critique 6: “Background model use runs away with money and attention”

**Mitigation:** One shared tick, one canonical work ID, one lease, measured daily spend cap, fixed investigation depth, model-backoff reuse, no retries after uncertain effects, no extra per-turn relevance model, quiet first. No “thinking” merely because a timer fired.

### Final decision

**Approve this as an ordered implementation plan, not as authorization to activate all future features now.** The fastest defensible route is **G0 source/retention hardening → G1 one genuine, falsifiable research slice → G2 one accepted CoS read-only follow-up → G3 natural presentation → G4 policy learning → G5 Mac validation → G6 staged expansion**. Use vertical slice proof and stop when a stage fails, rather than constructing six full abstractions in parallel.

**Fatal flaw to watch:** If local evidence and cross-source permissions are inaccurate, every layer above them compounds the error. Solve that before choosing a smarter decision model.


### Second-pass revision: reduce consent friction without loosening authority

The first draft overemphasized risk of web research and could have made a proactive assistant ask George for permission before *every public lookup*. The corrected policy is a **single opt-in for bounded public-only background research** with a per-day ceiling and inspectable destinations. Once enabled, permitted public searches run without additional questions, while all local project comparison stays local and all new private model egress or state-changing work remains separately authorized.

A second source check found that **both** the capability authority ledger and policy promotion registry are presently process-local in their core implementations. Plan P2 and P4 therefore include durable acceptance and policy-stage receipts before automatically resumed work or model-policy activation. This is specifically about production continuity, not an invitation to build another authority system.

## 9. Definition of complete and implementation starting point

v10 is **complete** only when Flyd has independently:

1. Noticed a genuinely relevant problem/opportunity in authorized data.
2. Investigated and either supported, falsified or correctly left it inconclusive with traceable sources and cost.
3. Prepared or advanced authorized work through **existing** CoS using a real grant, with an independently checked receipt—or deliberately stayed silent.
4. Chosen an appropriate context/format/timing to communicate the **real** result without unnecessary interruption or backstage narration.
5. Kept a causal record that distinguishes its hypothesis, its research evidence, the effect, the response and unknowable impact.
6. Passed protected replay cases, consent revocation/retention, multi-process idempotency, operating cost ceiling, installed Mac and rollback drills.

**First engineering PR after this plan:** G0 only. Falsify source lineage by changing a project twice on the same date, erasing a parent after a derived proposal is persisted, and running two concurrent ticks. No additional live model or provider calls. If any of those can leave a stale funded investigation, false “verified” outcome or readable leaked source text, the release stays blocked.

**This document is planning and source review, not code implementation or test execution.**

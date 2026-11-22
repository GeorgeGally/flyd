# Flyd v10 — Self-Initiated Intelligence: From Curiosity to Verified Progress

**Date:** 23 November 2026
**Status:** PROPOSED PLAN — awaiting independent critical evaluation below; not implemented
**Reviewed repository:** `GeorgeGally/flyd` main at `4f8e2cdf90585f7ea5387a5061eaa510bd9e0fc8` (GitHub source inspection)
**Product authority:** `docs/product/flyd-personal-intelligence-prd.md` (sole authority)
**Related validated plan:** `docs/plans/2026-11-16-beyond-turn-taking-participation-plan.md`, especially U1/U2/U5, which covers presentation participation and should not be rebuilt.
**Verification limits:** Remote source review, no Mac runtime, actual personal data, installed app, model traffic, budget usage, test execution or provider benchmark verified for v10. This document authorizes no new source access or external effects.

## 0. The outcome (start here)

Flyd should behave like a thoughtful, high-agency personal intelligence across **life, creative work, ventures, client work, technology, relationships and personal goals**. It should:
1. Notice change, contradiction, forgotten commitments, emerging possibilities and stalled goals in already authorized information.
2. **Generate its own answerable questions**, not only respond to George's questions or Calendar events.
3. Investigate a bounded number of promising ideas, test counterarguments, and distinguish evidence from speculation.
4. Produce useful results: an insight, a comparison, a private draft, a prototype/research proposal or authorized ongoing work via CoS.
5. Choose silence, a quiet visual, a timely comment, or a truly important question, without manufacturing a notification merely because a model produced text.
6. Verify what happened and adjust future initiative from measured outcomes and corrections.

A self-started investigation has a legitimate result even if the right decision is to **drop it**. Success is not more activity; it is more verified improvements and useful surprises per unit of attention, effort and cost.

**North-star encounter:** George is discussing a new artwork. Flyd privately recognizes a connection to an earlier generative music direction, tests the idea against actual files/references within scope, prepares a compelling artifact, and shares one concise, contextually relevant thought. CoS does the work it is permitted to do; George is not asked to choose a research method. Conversely, if evidence is thin or George is busy, Flyd stays quiet.

### Examples (aspirational; no claim these are working)
- **Creative:** Unexpected link between the music model and a visual tool → verified reference board or bounded design experiment, not generic inspiration.
- **Business:** A profit goal may not match known pricing/capacity → model the discrepancy using recorded source amounts, highlight what's unverified, propose a material alternative.
- **Technical:** A new library may eliminate an established Flyd bottleneck → compare against the actual implementation, not hype; hand an authorized proof-of-concept to CoS.
- **Personal:** A stated desire for more independent art may conflict with confirmed work patterns → offer a constructive observation, not an unsolicited moral judgment.
- **Relationships:** A recorded, still-open promise to a person is relevant → privately prepare context; no outreach without a grant.
- **Recovery:** Verified repeated system failures reveal a higher-level dependency → CoS prioritizes a shared corrective fix rather than redoing symptomatic tasks.

## 1. Ground truth: the repo already does more than the previous discussion acknowledged

| Capability | Existing source | Actual role / identified gap |
|---|---|---|
| Self-generated curiosity | `cli/src/lib/curiosity.ts`, `cli/src/commands/curiosity.ts` | Generates 3–5 questions and investigates against captured docs. Produces Wiki curiosity logs, not an end-to-end governed opportunity/CoS lifecycle. |
| Recurring inner analysis | `cli/src/commands/daemon.ts` `runProactiveCycle` | Every 4h attention, daily goal tension and curiosity; separate legacy capture/Wiki process with its own in-memory timers and budget gate. **Do not create another daemon or read these raw captures from Core without consent migration.** |
| Goal/reality tension | `cli/src/lib/attention.ts`, `lib/tension.ts`, `work/work-hypothesis/insights.ts` | Valuable signal functions, but legacy attention is based on `raw/**/*.md` and a different data model. Pure algorithms may be reused; old storage is not automatically a current consented source. |
| Critical perspective and strategy | `cli/src/council/advisors.ts` and `council/council.ts` | Already produces evidence-based Critic/Strategist advisories. Source lifecycle now distinguishes attempted delivery from shown. Do not build another full Critic/Strategist agent. |
| Contextual, conversational insight | `cli/src/council/muse.ts`, `runtime/turn-plan.ts`, `runtime/room-context.ts` | Source suggestions and batched fast relevance decisions exist; `consultMuse` has no production caller found by repository search. Do not add LLM calls to every turn. |
| Near-term care | `runtime/proactive-care.ts`, `runtime/agenda-tick.ts`, `commands/view.ts` | Consent-safe Calendar/People, commitments and curated visual cards. Keep as one specialized producer, not the new system's definition. |
| Opportunity policy | `intelligence/executive/executive-cycle.ts` | Opportunity scores, stable digests, lease, budgets and intervention events exist; no production caller found. **Do not activate its notification queue wholesale**: it would compete with `runtime/attention.ts` and `runtime/delivered.ts`. Reuse scoring/deduplication concepts through a read-only adapter or pure functions. |
| Durable facts and permissions | `intelligence/event-store.ts`, `context-envelope.ts`, `world/types.ts`, `sensors/source-contracts.ts`, `capabilities/authority-ledger.ts` | Canonical event/evidence/consent/grant rules already exist. New ideas live as typed **inferences or proposals**, never as verified memory or permission. |
| Action and recovery | `command/cos/tick.ts`, `cos/operational-judgment.ts`, `cos/recovery.ts`, `command/scheduler.ts` | CoS owns accepted objectives, cross-domain DAG, bounded technical decisions and verified reports. Do not replace it with a proactive execution framework. |
| What gets through | `runtime/attention.ts`, `runtime/delivered.ts`, `conversation-view/activity.ts`, `conversation-view/importance-judge.ts` | Existing focus-aware delivery and ambient activity. Protected user-owned calls survive optional relevance filtering. Participation plan U1 is partially/mostly present in main; audit remaining behavior rather than reimplement. |
| Learning from outcomes | `intelligence/outcomes/outcomes.ts`, `intelligence/policies/policy-registry.ts`, `intelligence/evaluation/episode-replay.ts` | Distinguishes verification, reactions, and unknown outcomes; policy promotion requires measured, protected replay. Reuse; never train preferences directly from a dismissal alone. |

### Existing architectural conflict to resolve

The **legacy daemon's curiosity/Wiki loop** and the **modern event-backed personal intelligence / Council loop** are not one shared runtime. Blindly scheduling both as two “thinking agents” would double research, spend, stale observations and contradictory nudges. The new feature should have **one canonical opportunity identity and decision record** without migrating every old capture, goal file or existing Council advisory into a new database.

## 2. Three real approaches

| Approach | Potential benefit | Effort | Risk | Reversibility | Verdict |
|---|---|---|---|---|---|
| A. Broaden proactive care with more triggers | Fast reminders and cards | Low | Stays reactive to predefined rules; little genuine initiative | Easy | Insufficient |
| B. Always-on reflective agent with its own thoughts and delegated workers | Maximum apparent autonomy | Very high | Duplicate CoS, context leakage, self-generated busywork, runaway costs | Difficult | Reject |
| **C. Bounded, event-driven curiosity → evidence → action inside current runtime** | Broad independent thinking plus verified output | Medium–high | Ranking bias and misread life context | High if shadow/guarded | **Choose** |

**Why C:** Opportunities begin with real changes or explicitly consented current context. The model can ask new questions and propose experiments, but existing world model, permissions, CoS, delivery and outcome systems remain authoritative. This supports ambitious initiative without a new agent empire.

## 3. Roles, authority and precise decision split

- **Flyd** owns an understanding of George's goals/attention and the decision to **wonder, investigate, prioritize and speak**. A new insight is a *hypothesis*, not a remembered fact or an accepted job.
- **Curiosity producer** (an existing function reused inside Core; not an agent identity) spots evidence gaps and generates concrete, testable questions. It may issue *proposed* investigations.
- **Council Critic / Strategist, Scout, Librarian and work models** supply additional candidates and evidence. They do not each directly notify George.
- **Fast decision model** in the existing System-1 registry judges cheap bounded choices—novelty, evidence sufficiency, expected value, next safe action, attention relevance—only where measured against heuristics and where the projection is consented.
- **Deep reasoning** is for higher-leverage candidate synthesis, multi-step investigation, cross-domain connections, and challenging assumptions—not a mandatory second inference on every event.
- **CoS** owns execution of accepted/scoped work. It can execute a new initiative only when an explicit existing mandate/authorization permits the exact local task; an inferred desire is never an accepted objective or a new grant.
- **George** supplies unique personal judgment and high-impact approvals; he is not a method selector or approval step for an ordinary research approach.

### Permission ladder (no policy shortcut)

A. **Observe / compute local signals:** only previously consented, permitted read access. No extension of macOS PRESENT or silent LEARN enrollment.

B. **Investigate:** bounded local analysis and source-permitted read-only retrieval. Any external model/search transmission must pass `EgressPolicyGateway`, source consent, approved purpose and a real spend budget.

C. **Prepare:** an ephemeral analysis or private draft where the existing preparation/remit policy allows it. If the preparation *persists files or invokes workers*, require the appropriate scoped reversible grant and verifier.

D. **Delegate via CoS:** only a request grounded in an accepted user objective **or** a separately approved standing mandate that covers the exact new initiative, budget, target and expiry. Use existing work IDs, objectives, teams and receipts.

E. **Send/purchase/publish/change accounts/delete:** preserve explicit high-impact consent requirements. No model or prompt grants itself authority.

Do not flip `FLYD_AUTONOMY=full` as a workaround. No raw personal facts to a new model/provider without specific egress consent.

## 4. The end-to-end opportunity contract (typed seam, not a second store)

### Sources and generation

Start from **already permitted** state deltas and existing functions:
1. Goals vs observed progress: explicit goals, confirmed blockers, stalled work, missed milestones; use `work-hypothesis` and goals/tension scoring where evidence supports it.
2. Verified outcomes: repeat failure, missed acceptance criterion, a correction that changes a dependency, a surprising success.
3. Genuine novelty: Scout items that intersect a real active interest/project, not simply keyword overlap.
4. Existing Critic/Strategist: advisories with evidence IDs, expiry and known status.
5. Cross-domain possibility: a supported connection between two separately grounded projects or ideas; small reserved lane for speculative creativity.
6. Personal stewardship: commitments, relationships and wellbeing only from applicable consented sources; no conjectures about private circumstances.

**Always include an evidence provenance path.** An intriguing model question unsupported by facts is a research hypothesis or discarded, not an assertive message. Signals may compete for attention but not privilege developer/company data over George's own goals by default.

### Proposed schema (consumer-adapter type in `runtime/initiative/`, persisted only as canonical events)

    InitiativeCandidate {
      id, sourceKeys, sourceRevisions, evidenceRefs, consentScopes,
      domain, projectRefs, goalRefs, generatedAt, validUntil,
      hypothesis, testableQuestion, alternativeExplanations,
      expectedBenefit, reversibility, urgency, confidence,
      epistemicStatus: "hypothesis" | "supported" | "refuted",
      resources: { estimatedCalls, tokenBudget, timeBudget },
      origin: "curiosity" | "council" | "scout" | "work_change" | "care",
      state: "candidate" | "investigating" | "prepared"
        | "proposed" | "authorized" | "verified" | "shelved"
    }

`id` = stable digest of **source identity + source revision + question class**, not `Date.now()` or paraphrase. New evidence/revision permits a new judgement; repeated ticks do not. Store via existing `IntelligenceEventStore` envelopes using permitted epistemic kinds (e.g. `inferred_belief` for hypotheses, `proposed_action` for suggested work, `executive_decision` for selection, `verified_outcome` only after verification). Don't create a competing Wiki/SQLite opportunity ledger. Use small projections over these events with provenance, retention and erasure.

**Important:** For old `curiosity.ts` output, map legacy attention/tension *signal computations* to a typed consented projection; never blindly import `raw/**/*.md` or private `wiki/` questions into the active event spine. The old daemon retains its indexing responsibilities until the new path has measured parity.

### Candidate evaluation: answer the question, not just rank a title

For each selected question:
- What real evidence generated it, and what is uncertain?
- What specific question can a bounded investigation answer?
- Which existing assumptions could be wrong?
- What changes in George's decision or work if the answer is true?
- What's the **value of information** relative to effort, token spend and distraction?
- Would this duplicate work George or CoS already accepted or completed?
- Can a cheap local query resolve it, or is external research needed and permitted?
- What is the safest next step: discard, retain, local investigate, prepare draft, propose scoped work, or pass a pre-authorized task to CoS?

The fast model evaluates supplied, grounded options; it is not responsible for inventing novel questions. A reasoning model may invent alternative explanations **within bounded evidence** and propose a test, then deterministic checks validate permissions and constraints. Keep a limited **serendipity lane** so high novelty but uncertain immediate ROI does not disappear from a purely utilitarian ranking.

### Selection/disposition is two decisions, not one

**Work decision:** `discard | keep | investigate | prepare | propose | authorized_delegate`.
**Attention decision:** `silent | defer | ambient | conversational_note | notify_for_real_decision`.

A valuable idea can be investigated without speaking. A high-value internal result may remain ambient until relevant. A user-owned blocker never gets suppressed because a low-confidence classifier says it is uninteresting.

Use existing `runtime/attention.ts`/`runtime/delivered.ts` for timing/receipt and `conversation-view/activity.ts` for quiet source-linked discoveries. Reuse validated participation-plan U1/U2 if shipped, otherwise implement those correctness guards first. **Do not run `ExecutiveCycle.consider` as a second notification authority.** Its ranker/digest and why-now/why-me ideas can be extracted into pure helpers with no lease/queue duplication.

## 5. Implementation work packages

### P0 — Establish the real baseline and integration boundaries

**Files to inspect:** `commands/daemon.ts`, `lib/{curiosity,attention,tension,budget}.ts`, `council/{advisors,council,muse}.ts`, `runtime/{agenda-tick,proactive-care,attention,delivered}.ts`, `intelligence/executive/executive-cycle.ts`, `intelligence/event-store.ts` and `docs/plans/2026-11-16-beyond-turn-taking-participation-plan.md`.

**Actions:** confirm which daemon/Core processes run in the installed deployment, what `FLYD_COS`/source consents are live, where old nudges are consumed (if anywhere), current model spend, identity of the canonical writable owner, and whether the participation plan's U1 defects are fixed in all paths. Freeze a consented/redacted replay baseline for real conversational impressions, current notifications, errors, false-positive patterns and known source availability. Verify actual source revocation across all derived views, not just the Activity panel.

**Exit:** one source map; a trace showing how a candidate moves—or fails to move—from source → question → investigation → output; regression tests for protected approvals and source revocation. **No additional sensing is enabled.**

### P1 — Make old curiosity usable as modern, permissioned candidates

**Primary:** `cli/src/lib/curiosity.ts`, `lib/attention.ts`, `lib/tension.ts`, `runtime/proactive-care.ts`, `council/advisors.ts`, `intelligence/world/types.ts`, `intelligence/projections.ts`.

**New narrow seam (if justified):** `cli/src/runtime/initiative/candidates.ts` and `signals.ts`, with pure functions and tests. Adapt existing goal, tension, stalled-work, creative novelty, advisory and relationship evidence to typed candidates with source IDs, expiry and permission labels. Use validated, minimal state projections; don't move the legacy daemon's raw markdown output directly into Core.

**Critical tests:** corrected goal, completed task, unrelated Scout item, stale source, revoked consent, conflicting entity/person name, false contradiction, independent two-domain connection, no signal at all. Each produces either a grounded bounded candidate or a recorded reason to discard; never a confident invented claim.

**Exit:** reproducible independent *questions* from ≥3 different consented domains without user prompts; candidates have evidence and a lifecycle, not a new notification stream.

### P2 — Bounded curiosity and independent investigation

**Primary:** `cli/src/lib/curiosity.ts`'s question/investigation logic, `council/advisors.ts`, existing read-only Librarian/research methods, `cognition/system-one/registry.ts` and provider adapters; `intelligence/egress-policy-gateway.ts`.

**Modify:** modernize question generation around candidate/goal/evidence packs, not raw docs. A question must name its uncertainty, the evidence that would change the answer, expected impact, and a cheapest credible test. Ask for *one* strong counter-hypothesis and a concrete falsification condition. Verify that a system-generated claim about a person/amount is grounded before presentation.

Use a cheaper deterministic/fast pass first; call higher reasoning for genuinely cross-domain or ambiguous cases, with explicit maximum calls, wall-time and token budgets. Skip when evidence fingerprint is unchanged or there is insufficient value of information. No perpetual inner monologue or periodic exhaustive research.

**Exit:** at least two end-to-end case types work: a falsifiable technical/product claim and a cross-project strategic or creative opportunity, with inspectable sources, cost and a defendable conclusion (including “no useful finding”).

### P3 — Executive priority and authority-aware action

**Primary:** `intelligence/executive/executive-cycle.ts` (pure ranking/digest reuse only); `runtime/attention.ts`, `runtime/delivered.ts`, `intelligence/capabilities/authority-ledger.ts`, `command/cos/{objectives,tick,intake}.ts` and the existing preparation/remit store.

**Change:** implement pure candidate scoring for expected usefulness, cost, urgency, evidence/confidence, reversibility, contradiction risk, priority drift and attention penalty. Keep speculative high-novelty discoveries as a *separate bounded lane*; do not let urgency alone drown out creativity. Record why investigated and why rejected. Compare against current active CoS work before proposing another objective.

CoS may automatically accept work **only** under preexisting exact standing mandates. Otherwise produce a prepared result or one short scope/decision request if the potential gain justifies it. An investigator is not an executive grant issuer. Carry original source IDs, accepted remit, consent and effect target into any CoS request, with clear `done_when` and verification path.

**Tests:** duplicate objective, changed goal/stop signal, an old preference superseded by correction, no effect grant, revoked grant, approval needed for a public message, unknown side effect receipt, model/provider outage, accepted mandate within/outside target and expiry.

**Exit:** a permitted candidate can become a verified CoS result; an unpermitted candidate remains a useful proposal without unauthorized effects or gratuitous questions.

### P4 — Participation: speak when useful, otherwise keep the work

**Dependency:** reuse or complete existing Nov 16 participation-plan U1's accurate advisory shown/notify receipts and protected-importance guard. Main already contains `confirmVisibleAdvisory`, Council notification outcome tracking, and `protectedFromImportance`; test these before rebuilding them.

**Primary:** `runtime/room-context.ts`, `runtime/turn-plan.ts`, `council/muse.ts`, `council/advisors.ts`, `conversation-view/activity.ts`, `conversation-view/semantic.ts`, `runtime/delivered.ts`, `runtime/attention.ts`.

Surface a source-linked, concise insight in existing Activity or a conversation when the user's present context makes it valuable. Prefer a relevant visual artifact where the result is visual. Use existing note relevance selection in the turn-plan batch; do **not** add an extra model to every voice/text turn. Treat selected, generated, displayed, acknowledged, verified as different states. Dismissed and ignored are distinct. The user can inspect the evidence, dismiss, pause a topic or ask Flyd to act.

**Exit:** a genuinely new idea can surface at a natural moment; unrelated projects and routine staffing stay quiet; no protection regression on user-owned approvals or verified requested outcomes.

### P5 — Close the verified learning loop, not a dopamine loop

**Primary:** `intelligence/outcomes/outcomes.ts`, `intelligence/policies/policy-registry.ts`, `intelligence/evaluation/episode-replay.ts`, `intelligence/event-store.ts` and existing corrections/feedback store.

Record at each stage: what prompted the idea, what Flyd predicted, what was actually produced, what George chose/ignored, and whether anything measurably improved. A “liked it” rating is useful preference evidence but **not** verified impact. Capture false positives, false novelty, staleness and cost. Replay before changing source weighting or policy thresholds. Preserve per-domain preference differences, subject to cross-domain consent. No automatic model weight updates or silent global taste rules.

**Exit:** Flyd suppresses a previously dismissed kind of irrelevant suggestion without suppressing an unrelated, useful opportunity; verified positive outcomes support bounded promotion, while unknown outcomes cannot.

### P6 — Rollout, instrumentation and actual product experience

**Trigger:** attach low-cost candidate generation to the **existing** agenda/command/confirmed-event boundaries, not another scheduler; defer expensive thought/research to an existing background slot with a single canonical lease. The legacy daemon continues its indexing role but cannot run an independent user-facing initiative for the same source key. Shadow state and production state must not both produce actions.

**Modes:** off → shadow (receipts only, no messages/actions) → local evidence-only pilot → optional bounded preparations → scoped delegated actions. Roll back atomically; no backlog replay on re-enable. Provider spend, source egress and background scheduling limits remain inspectable and user-adjustable.

**Experience pilots:** creative connection; material business discrepancy; technical opportunity grounded in repo reality; stalled commitment; one personal-goal tension. Pilots require actual installed Mac/Core, real allowed contexts and consent. Test mobile/LIVE only after Core proof, preserving voice continuity and no extra hot-path model calls.

**Exit:** verified, useful initiative across at least 3 domains with no ungranted effect, no missed protected approval, no fabricated private fact and acceptable attention/cost. An end-to-end Mac acceptance run is required before calling this “shipped.”

## 6. Replay / evaluation specification (proposed acceptance targets, not results)

Build a held-out corpus of at least 120 distinct, **synthetic or appropriately consented/redacted** episodes:
- 20 creative cross-project connections and speculative possibilities.
- 20 technical/product opportunities from real source-code and evidence delta.
- 20 ventures/business risk or margin assumptions.
- 20 personal commitments and life-goal tensions.
- 20 quiet/no-op/false-significance episodes.
- 20 protected cases: consent revoked, wrong identity, stale facts, unauthorized external effect, duplicate delivery, context injection, user disinterest, cancelled objective.

Label *separately*: accurate context, novelty, evidence, value of information, correct next work disposition, appropriate human attention, allowed effect, actual outcome, cost. Every candidate must have a traceability chain, not just fluent prose.

**Hard gates:** zero unauthorized effects; zero unjustified protected-item suppression; zero known fabricated personal facts in held-out cases; no repeat of unknown outward effects; no egress from unconsented sources; no duplicate objective dispatch; revoked personal content hidden across views.

**Quality targets for a subsequent real pilot (hypotheses; revise after baseline):**
- At least 1 demonstrably helpful, not-user-requested insight or prepared result per active week spanning ≥3 domains across the pilot.
- At least half of the **surfaced** nonroutine suggestions judged useful in blinded review, with a clear explanation for those that weren't.
- Better accepted/verified outcomes per user interruption and per actual model spend than the current baseline.
- Decreased duplicate ideas; no compulsory daily quota of thoughts or notifications.
- Measured p50/p95 time/cost from source change to evidence-backed result, not just model judgment latency.

Record *missed* important opportunities in replay; a system that stays perfectly quiet by suppressing everything fails the product goal.

## 7. Release order and concrete vertical slices

**R0 — Source truth and authority.** Inventory live daemon vs Core; consent and normalized world evidence; freeze tests; confirm existing participation U1 repair. No new output.

**R1 — Notice and investigate.** Start with verified code/CoS outcome pattern plus a creative/Scout cross-project question. Model independently frames a testable question; local evidence resolves or rejects it; result persists as inference or proposal with trace and expiry. **No new user attention yet.**

**R2 — Decide and prepare.** Add cost/priority ranking, counterargument, scoped local drafting and optional authorized CoS research within bounds. Verify acceptance and proof-of-work receipts.

**R3 — Communicate well.** Enable quiet sourced Activity and contextually relevant remarks with existing fast note choice and delivery. Test two weeks of natural user work with no extra hot-path call.

**R4 — Compound.** Outcomes, dismissals, corrections, source revocation, staged policy promotion and controlled surprise lane; protect unknown outcomes and user choice.

**R5 — Extend domains by evidence, not infrastructure.** Bring in life/personal capability sources as consented; consider more specialized finance/relationship tools only when actual pilots show a need. Do not invent new Life/Finance/Mentor teams at launch.

No fixed day count is promised without measuring actual integration, suite duration, provider credentials and live availability.

## 8. Explicit non-goals

- No always-on LLM “inner thoughts” loop, second personal agent, task scheduler, cross-domain orchestration, authority ledger, activity timeline or memory database.
- No direct access to personal communications, clipboard, microphone, screen, location, medical or financial accounts without separately consented source contracts.
- No Model-based authority grant, no high-impact autonomous action, no hidden CoS objective invented from a guess.
- No promotion from a single positive reaction, no “successful” score for verbose ideas, no reward for more notifications.
- No blanket migration of legacy Wiki raw captures into the modern personal intelligence spine.
- No Gemini/Jev forced cascade; test bounded predicates using current model registry and measured Flyd-specific cases.
- No automatic claiming of a deployed/verified personal assistant from GitHub test success alone.

## 9. Critical evaluation (to be completed after drafting)

**Pending a separate adversarial pass against the above plan and the existing repo paths.**

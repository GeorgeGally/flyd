# Flyd v9 — Autonomous Executive Judgment, Natural Communication, and Personal Care

**Status:** Proposed implementation plan; committed for implementation, **not implemented**.
**Date:** 13 November 2026
**Repository reviewed:** GeorgeGally/flyd, main at 2880b4bcc32bc8652c3447285018e96e0c7f8fef
**Owner:** Flyd product, for George
**Supersedes as a forward implementation priority:** v8's *one adaptation then ask George* behavior and the current split/voice work's product assumptions where contradicted below. **Does not replace** v8's cross-domain graphs, request-id reconciliation, correction invalidation, domain ownership, or durable delivery machinery.
**Highest authority:** `docs/product/flyd-personal-intelligence-prd.md`. Where this proposal requires a policy change, update that PRD first and get the requisite authorization before changing execution behavior. A plan is not a capability grant.

## 0. Executive decision

Flyd must stop behaving like an administrative messenger. George's attention is the scarcest resource. The target is:

- **George ↔ Flyd:** an intelligent PA, confidant, mentor, creative partner and proactive presence. Flyd owns the relationship, personal understanding, what is worth saying and how to show it.
- **Flyd ↔ Chief of Staff (CoS):** an exceptional-judgment channel, not a work-status relay. Flyd can gather more evidence and make the call itself using a higher-reasoning model within granted authority.
- **CoS ↔ FirstMate / Design Mate / Librarian / Life-Ops / later specialists:** operational ownership. CoS plans, prioritizes, delegates, decides, investigates, recovers, verifies, and continues. The domain boss decides domain implementation details first.
- **Fast decision intelligence:** a first-class, low-latency mechanism for interpreting routine and unresolved decisions; **not** merely a router and **not** another orchestration engine. Jev and Gemini Decision 1 are competing implementations of bounded judgments in Flyd's *existing* System-1 infrastructure. Deploy the best provider/predicate allocation from Flyd-specific evaluation.
- **Communication:** Flyd communicates only what benefits George. Ordinary backstage actions require no conversational announcement. In human terms: **“I'll fix it.”**, not “I'll have the team trace where decisions are being pushed back to you, then bring you the result, not every implementation choice.”
- **Presentation:** first decide whether George should see anything; then choose short speech, quiet ambient card, visual artifact or working decision control. Do not create approval UI for a question the system should have answered itself.
- **Personal care:** use consented memory and context to prepare useful material *before* it is asked for: relevant inspiration during design work, helpful private relationship context before a call, and commitments that matter.

### What winning feels like

George discusses ideas with Flyd while work progresses quietly. A failed build does not produce a retry question; CoS investigates and selects a bounded next approach. PR #46 does not become a user's implementation decision. Flyd is pleasant and concise; it offers independent personal insight, not a paraphrase of FirstMate. A useful visual appears when relevant. A calendar event is accompanied by a discreet, accurate briefing. Nothing consequential happens outside granted authority.

### The non-negotiable distinction

**Who should decide?** is not the same as **what should we do?** Both benefit from fast structured judgment, but one is a routing predicate and the other requires grounded candidate actions, evidence, and an independently enforced execution policy. “I am uncertain” normally means investigate or use a stronger model, **not** ask George.

## 1. Source-backed diagnosis, not assumptions about the installed Mac

| Area | Source inspection at reviewed main | Failure/risk to correct |
| --- | --- | --- |
| CoS orchestration | `cli/src/command/cos/tick.ts`, `plan.ts`, `dispatch.ts` already implement multi-team DAG joins, idempotent dispatch, revision-safe corrections, reviews and one report | Do not rebuild a workflow engine. The explicit “one alternative” and “then ask George” code path makes failed work his admin. |
| CoS states | `cli/src/command/cos/types.ts` has `needs_george`, `retry`, `stuck`, `unconfirmed` and a per-run `adapted` boolean; `plan.ts` can map domain `needs_decision` to `needs_george` | A blocked run, unavailable model, failed intake, unknown handoff and genuinely George-owned decision are conflated. |
| Intake | `cli/src/command/cos/intake.ts` defines `comes_back` for taste, money, his name and almost any outward action | Over-broad heuristics bypass case-by-case delegated authority; the model-authored field cannot grant authority. |
| Executive judgment | `cli/src/intelligence/executive/decision-step.ts` and `firstmate-decision.ts` have `backstage`, `handle_internally` and `ask_george`, a Jev judgment, standing rules, and a one-time `HANDLE_IT_YOURSELF` send-back | The *second* question can become George's even when it is still an operational choice. Keep evidence and verification; change ownership and recovery. |
| Authorizations | `cli/src/runtime/tool-policy.ts` has `ask/trusted/full`, whereas the personal-intelligence PRD demands effect-scoped, expiring grants | Do **not** flip to `FLYD_AUTONOMY=full` to create executive authority. Unify policy enforcement and keep consent independent of model confidence. |
| Split front doors | `cli/src/runtime/turn-plan.ts` and `conversation-responder.ts` use `hand_off` when `FLYD_COS=1`. Yet `conversation-view/flyd-desk.ts` and `claude-code-source.ts` can route project-mode conversation directly to FirstMate | Preserve deliberately opened FirstMate-native sessions; ordinary Flyd-owned sessions must obey CoS ownership consistently, across surfaces. |
| Mandatory chatter | `turn-plan.ts` and `assistant-tools.ts` explicitly instruct Flyd to say what has started and what will come back | Fix source of speech, not only the string rewrite. Replace process narration with responsibility and outcomes. |
| Reports | `runtime/delivery.ts`, `runtime/delivered.ts`, `command/scheduler.ts` notify on some finished/blocked/decision paths | Make importance and attention judgment occur before user-facing delivery. Never lose the durable work record. |
| Existing semantic UI | `conversation-view/semantic.ts`, `semantic-judge.ts`, `answer-form.ts` and `choices.ts` already have semantic objects and decision actions. Semantic judge is optional shadow | Reuse; do not add another presentation engine. Current manifestation breadth is limited. |
| Existing proactive pieces | `council/inspiration.ts`, `council/morning.ts`, `runtime/conversational-initiative.ts`, `intelligence/executive/executive-cycle.ts` | Components exist, but they are not yet a single personal-care experience. Code search did not identify a production call to `ExecutiveCycle.consider` or `consultMuse`; verify live wiring rather than assuming a full feature is shipped. |
| Existing Jev | `cognition/system-one/registry.ts`, `jev.ts`, `replay.ts` declare typed predicates, egress projection, abstention, and frozen replay | Expand this framework, not a separate Gemini-led orchestration tree. |
| Existing tests | `command/__tests__/cos-chain.test.ts` asserts “second failure → one decision”; `cos-waiting.test.ts` asserts several waits go to George | Product-inappropriate behavior is enshrined in tests. Replace selectively with authority-aware recovery tests. |

**Runtime unknowns:** no verification of installed `FLYD_COS`, `FLYD_AUTONOMY`, `FLYD_JEV_ENABLED`, private `~/.flyd/SOUL.md` or `USER.md`, model credentials, current notification feed, the active desktop mode, or real escalation traces. Do not claim an observed frequency or that source code is deployed.

### User examples that act as acceptance specifications

- Current: “I'll have the team trace where decisions are being pushed back to you, then fix those paths. I'll bring you the result, not every implementation choice.”
- Desired: “Yes. Let me fix where decisions are being pushed back to you.”
- Even more natural when appropriate: “I'll fix it.”
- Current: “Your decision on PR #46.” Desired: no question at all when this is an implementation judgment within the mandate.
- Current: “Would you like me to try another approach?” Desired: try the next justified approach without announcing it.
- Do **not** replace useful honesty with fake completion: “I'll fix it” is an ownership commitment, not a claim that a change has already landed.

## 2. Decisions and why we are making them (ADRs)

### ADR-01 — Ownership is hierarchical; status is not a reason to escalate
**Decision:** Domain boss → CoS → Flyd → George. Domain bosses decide local details. CoS owns objectives, priorities, execution and recovery. Flyd owns exceptional strategic judgment and the relationship. George is needed only for truly personal choice, explicit authorization or material ambiguity that Flyd cannot settle with evidence.

**Why:** George is now handling project administration that delegated operators should absorb. This retains FirstMate's strength rather than competing with it. **Rejected:** routing all questions to Flyd; rebuilding FirstMate; a separate permanent “executive agent” workflow.

**Important exception:** direct FirstMate conversations are an explicit professional work surface, not a hidden bypass from Flyd-owned chat.

### ADR-02 — Fast decision models are a core decision *capability*, not merely a routing accelerator
**Decision:** Use the existing typed System-1 predicate registry to make fast bounded judgments about (a) ownership, (b) resolvability with current evidence, (c) best next *authorized* operational option, (d) need for investigation, (e) significance/attention, and (f) whether stronger Flyd reasoning is warranted.

**Why:** Many expensive human interruptions are bounded choices over a small set of sensible actions. A calibrated decision model can handle them cheaply and quickly, allowing CoS to maintain momentum. This is **potentially a material product improvement**, not a marginal performance tweak.

**Boundary:** The fast model can rank or choose **supplied, grounded options**; it cannot invent an open-ended recovery plan or issue grants. CoS generates candidates from verified state/rules/domain proposals. An LLM generates candidate approaches when none can be grounded cheaply; the decision model can then rank them. Policy code validates effects independently.

### ADR-03 — Evaluate Gemini Decision 1 seriously against Jev
**Decision:** Keep Jev as incumbent. Add Gemini Decision 1 behind a provider adapter in existing System-1; benchmark Jev-only, Gemini-only, selective per-predicate provider, and the existing LLM fallback. Promote based on Flyd-specific results.

**Why:** Google announced Gemini Decision 1 on **11 Nov 2026** with multimodal input and up to 1,000 batched closed-set judgments; the vendor reports 150–250 ms end-to-end and $0.10/1M input tokens. It may handle richer uncertainty and escalation states materially better than Jev. These are vendor figures, **not** measured Flyd performance. Jev is already integrated and inexpensive, so a blanket swap is unjustified.

**Implementation caveat:** Model APIs and schemas are not interchangeable just because both return bounded decisions. Normalize question types, confidence, thresholds, token accounting, provider errors, version pinning and decision traces in adapters. Check the Gemini API's actual supported formats and data-egress policy before enabling image/PDF/communication context.

**Primary reference:** https://blog.google/innovation-and-ai/technology/developers-tools/gemini-decisions-api/ (11 Nov 2026). Secondary integration reference: https://vercel.com/changelog/gemini-decision-1-now-available-on-ai-gateway (11 Nov 2026).

### ADR-04 — Unresolved problems trigger investigation or safe recovery, not automatic promotion
**Decision:** Replace fixed “one retry then George” with **bounded autonomous recovery**. CoS can diagnose, ask a domain boss for evidence, compare approved options, change tactics, hand off independent research, or park a genuinely external dependency. Limit cumulative attempts, wall time, resource use and scope; preserve no-duplicate external effects.

**Why:** Second attempts often fail for engineering reasons. The number of attempts is not a measure of whether George must choose. **Rejected:** unlimited recursive retries; automatically retrying ambiguous bookings/purchases/sends; pretending an unknown result is failure.

### ADR-05 — One authority framework, with standing mandates
**Decision:** Implement executive autonomy through the existing product authority/capability-grant contracts: scope, effect, recipient/target, expiry, revocation, idempotency and verifier. Layer simple mandate presets over grants (e.g. internal coding repair, tests, local design exploration, approved research). Pass narrowed capability scope down to teams.

**Why:** The current `ask/trusted/full` tool switch is too coarse; “full” is not safe or consistent with the governing PRD. A budget metaphor from *The 4-Hour Workweek* illustrates delegated authority, **not** a default financial allowance. For spending, external communications, publication, destructive actions, access and personal data, keep existing guardrails until explicit scope-bound permissions are issued.

**PRD change required first:** clarify how approved standing mandates authorize repeated low-risk effects; retain confirmation for higher-impact/irreversible effects as currently required. No silent blanket exceptions.

### ADR-06 — Flyd is a companion, not a report formatter
**Decision:** A work record can change backstage without producing a message. Flyd uses natural ownership language, never managerial commentary. Work results are durable and inspectable; interrupt only when genuinely important and time-sensitive.

**Why:** “I'll bring you the result, not every implementation choice” is process narration George already assumes. This is a selection problem first and a wording problem second. **Rejected:** more banned-phrase rules as the primary solution.

### ADR-07 — One semantic presentation path; no approval theater
**Decision:** Extend existing semantic UI. For content that does merit attention, choose conversation, ambient card, rich visual artifact, or action-backed yes/no/choice. Determine *whether to show* before *how to show*. Decision controls require stable decision IDs, actual action receipts and safe replay.

**Why:** An approval button for a question that CoS could answer is still an unnecessary interruption. Visual communication should replace unwieldy text where it improves comprehension.

### ADR-08 — Flyd's care is proactive and personal
**Decision:** Reuse current agenda, calendar, Muse, inspiration, memory, preparation, and intelligence-event contracts to deliver (1) verified pre-call relationship context and (2) ambient design inspiration. Mentor/coaching belongs principally to Flyd's relationship; specialists help when needed. Life/Ops is a real domain; Finance and a broader Life team are later capability tracks, not gates for this milestone.

**Why:** The personal-assistant goal will fail even with perfect orchestration if Flyd never anticipates anything helpful. Avoid a second personal-data store or an unconsented sensor.

## 3. Target decision protocol

### Tier A — Domain boss

Own domain implementation choices. FirstMate chooses test tactics, worker assignments and repairs within its code remit. Design Mate chooses layout experiments and its Creative Director review. Librarian decides research tactics and evidence completeness. Escalate *a question with options and evidence* only when it exceeds the domain remit.

### Tier B — CoS (default decision owner)

For a report, failed result or request for a decision:

1. Read latest objective revision, exact original words, explicit constraints, current runs, evidence and scoped grants.
2. Apply deterministic prohibitions/permission checks **before** suggesting execution.
3. Enumerate grounded choices from existing domain capabilities (continue, ask for evidence, bounded rebrief, alternate verified technique, wait for external dependency, cancel obsolete branch, escalate).
4. Ask the fast decision provider appropriate batched questions: *routine or consequential?*, *enough evidence?*, *preferred authorized option?*, *needs deeper reasoning?*, *who owns it?*, *worth Flyd's attention?*. Store provider, predicate version, confidence, evidence refs and resulting policy decision in existing trace/event mechanism. Questions are independent; do not assume answer B incorporates A unless code composes them.
5. If confidently resolved **and policy permits**, take the action and verify receipt. Silence by default.
6. If evidence is thin or model disagrees/abstains, investigate, retry classification with improved evidence when useful, or use a reasoning LLM to generate bounded options. **Do not** route low confidence directly to George.
7. Escalate to Flyd with a compact **decision dossier** only if the issue is strategically meaningful, CoS is at its safe bounded limit, or its scope/authority is insufficient and Flyd can potentially resolve the uncertainty. Do not create a user-visible message merely because that internal dossier exists.
8. Persist the resulting plan, action and verification in the existing objective/run and event/receipt systems; advance independent branches.

**Sample dossier (conceptual data, not a new ledger):**

    objectiveId, runId, latestRevision, requestedOutcome, doneWhen
    issue, evidenceRefs, options, tradeoffs, recommendedOption
    authorityGrantRefs, effectClass, reversibility, uncertainty
    attempts, remainingRecoveryBudget, importance, urgency
    whyCoSCannotSettle, specificQuestionForFlyd

Do not put invented rationale text into an authoritative event. Preserve the evidence behind the summary.

### Tier C — Flyd

Receive the dossier privately; gather permitted context, investigate, consult higher-reasoning model if warranted, decide within granted authority, return one instruction to CoS. Use George's stated goals, current priorities and verified memory, not inference presented as fact. If George's uniquely personal judgment or explicit authorization is needed, ask once with a recommendation, compact evidence and working controls. Nonurgent questions can be queued for an appropriate interaction; never miss a real time-critical safety/authorization issue.

### Tier D — George

A George-owned decision is **not** a synonym for “task failed,” “model abstained,” “question has options,” “team is quiet,” or “result fell short.” It is a concrete need for his personal preference, consent, signature/authority or an otherwise unresolvable high-impact tradeoff. If authorization is required, no effect happens until the exact grant is satisfied. If the decision can wait, do not interrupt.

### Negative controls

- “Tests failed twice” → CoS diagnostics and next bounded tactic; not George.
- “PR #46: merge, wait, or change the tests?” → assess authority and evidence; decide backstage when permitted.
- “The booking executor has an unknown receipt” → reconcile and safely hold; **never** duplicate the booking.
- “Pay an unknown vendor” → no authority; ask for explicit permission or a properly scoped grant.
- “George said he disliked last week's layout” → present preference should inform design; do not treat it as a lifetime rule.
- “No reliable record of Chris's children's names” → do not fabricate or present them.

## 4. Work packages — file-level plan, order, rationale and gates

These packages are incremental. Each has an independent rollback and tests; do not merge a new engine under the guise of refactoring.

### P0 — Capture baseline and reconcile product authority (prerequisite, not a multi-week research project)

**Goal:** know the active execution path and legal authority; stop optimizing old source that is not running.

**Inspect and trace:** `AGENTS.md`; `docs/product/flyd-personal-intelligence-prd.md`; `docs/product/flyd-command-architecture-prd.md`; `cli/src/command/cos/objectives.ts`; `cli/src/runtime/tool-policy.ts`; `cli/src/runtime/turn-plan.ts`; `cli/src/conversation-view/claude-code-source.ts`; `cli/src/conversation-view/flyd-desk.ts`; `cli/src/command/scheduler.ts`.

**Changes:**
- On the running Mac, read enabled flags, actual model routing, active app/view mode, permission gates, installed commit, and representative conversation/decision/recovery receipts. Never dump credentials or private content into committed fixtures.
- Label ~100 **consented or synthetic/de-identified** cases: route owner, decision owner, allowed effect, correct next action, should George see it, ideal wording/presentation. Record failure provenance. Separate training/dev and held-out examples.
- Update governing PRD's action-authority section to specify scoped standing mandates and CoS/Flyd ownership **before** enabling broader effects. Do not equate “don't bother me” with consent for new external effects.
- Record baseline counts: avoidable escalations, inappropriate requests, unnecessary status messages, task outcomes, p50/p95 decision latency, spend and privacy/permission violations.

**Why now:** Branch source cannot tell us which runtime flags are deployed. This also avoids a dangerous contradiction between `FLYD_AUTONOMY=full` behavior and the product's grant rules.

**Exit:** active path verified; frozen baseline; explicit updated product authority with existing safety and consent preserved.

### P1 — Fast executive judgment, evaluated as an operational first-class capability

**Goal:** answer bounded operational questions in milliseconds where possible, without throwing them to George.

**Primary files:** `cli/src/cognition/system-one/registry.ts`, `jev.ts`, `types.ts`, `replay.ts`; `cli/src/intelligence/executive/firstmate-decision.ts` and `decision-step.ts` as consumers.

**Changes:**
- Add executive predicate definitions for `routine_internal_choice`, `evidence_sufficient`, `next_authorized_tactic`, `requires_stronger_reasoning`, `relevance_to_flyd`, `requires_george_authority`. Names are proposed, final names must fit registry conventions and only be marked `production` after real consumers exist.
- Keep the state projection minimal and consented: sanitized outcome, domain, failure/evidence class, explicit options, authority flags and reversibility; do not send private contact details or full stored history by default.
- Add a small provider adapter for Gemini Decision 1 **inside** System-1; retain the Jev adapter, current client and registry. Normalize types/validity/confidence and implement per-provider calibrated thresholds with explicit abstention/error fallback. Do not silently treat Gemini as Jev without compatibility tests.
- Extend the current replay/eval tooling with comparable Jev, Gemini, existing LLM, and hybrid candidates on *identical* held-out cases and projections. Measure decision correctness, false George escalation, missed authorization, coverage/abstention, p50/p95 latency, provider failure, cost, calibration and robustness to irrelevant context.
- Start in shadow mode; avoid live dual calls on every production decision. Choose the provider per predicate after evaluation; when either is unavailable, preserve deterministic and LLM fallback. High-impact effects never rely solely on predicted confidence.
- Treat model-selected tactics as **recommendations** until authority and preconditions are checked in deterministic code.

**Why:** Gemini may materially improve decision quality and latency. Benchmark it early rather than pushing it to a vague future phase or making a second decision tree.

**Exit:** a reproducible report with per-family winner, measured tradeoffs and zero model-only permission grants. A significant improvement in end-to-end *decision ownership* is required; generic leaderboard accuracy alone does not pass.

### P2 — CoS autonomy, recovery, authority and durable ownership (ship together with P3)

**Goal:** no routine issue becomes Flyd's or George's admin simply because a worker could not finish.

**Primary files:** `cli/src/command/cos/intake.ts`, `types.ts`, `plan.ts`, `tick.ts`, `dispatch.ts`, `objectives.ts`; `cli/src/command/scheduler.ts`; `cli/src/intelligence/executive/decision-step.ts`, `firstmate-decision.ts`, `standing-rules.ts`; `cli/src/runtime/tool-policy.ts` and existing capability-grant/verifier implementation.

**Changes:**
- Preserve old objective files and `BriefDecisions` fields for compatibility. Interpret `comesBack` as *candidate policy/intent*, never grant or automatic George escalation. Add only minimal optional authority/decision metadata if needed; give older records a safe migration/read fallback.
- Make CoS consume a domain `needs_decision` **before** it becomes a George-visible hold. Replace `awaitsDecision() → needs_george` as a general fallback with a new internally blocked/working disposition, or an equivalent minimal state change. Genuine `needs_george` must have an explicit validated reason.
- CoS obtains evidence from the team, applies grounded System-1 judgment and/or a stronger model, issues a scoped resolution to the boss, and verifies it was received. Do not bounce an unresolved question back and then assume the next time is George's.
- Replace the one `adapted` retry flag as the final human-escalation criterion with bounded recovery policy: per-objective total attempts/time/cost, per-domain failure fingerprints, exact action receipts, and a stopping reason. Use the existing `adaptations` and `Objective` versioning instead of a new agent/task graph; account for old records.
- Do not duplicate side effects: `unknown`, unconfirmed dispatch, one-off jobs, external requests, payments, messages, bookings and publication require idempotency-key lookup/receipt reconciliation. An unknown outcome is **not** permission to retry.
- Allow CoS to park an external dependency, seek research and continue unaffected DAG branches; if scope is exhausted, send a Flyd dossier instead of a user question.
- Keep FirstMate in charge of coding internals, Design Mate of review and Librarian of evidence. CoS does not replace domain specialist logic.
- Restrict executable actions using expiring scope-bound grants, target fingerprints, audit/evidence refs and verifier receipts. External/high-impact confirmation rules remain until the revised PRD and explicit grants authorize defined effects.
- Add a priority-drift check against latest George corrections, objective revision, current goals and resource budget before further work. Don't complete an obsolete plan efficiently.

**Why:** This is the direct fix for unwanted PR/test/retry questions, without rebuilding orchestration. Fast models make many of these calls possible at low cost; authority and durability make them safe.

**Exit:** routine team questions, recoverable failures, changed tactics and reviewed results stay backstage end-to-end across restarts. Genuine blocked/authorization cases remain visible as exactly one meaningful decision.

### P3 — Flyd independence and natural communication (same release milestone as P2)

**Goal:** a conversational PA, not a narrated org chart.

**Primary files:** `cli/src/runtime/conversation-responder.ts`, `turn-plan.ts`, `assistant-tools.ts`, `turn-stages.ts`, `delivery.ts`, `delivered.ts`; `cli/src/command/scheduler.ts`; `cli/src/lib/reaches-george.ts`, `pa-voice.ts`; `cli/src/council/standard.ts` and `reply-review.ts`; `cli/src/conversation-view/flyd-desk.ts`, `claude-code-source.ts`, `server.ts`.

**Changes:**
- On Flyd-owned surfaces, all substantial cross-domain work goes to CoS. When `FLYD_COS=1`, do not silently let a coding turn sidestep CoS through the desk/FirstMate transcript classifier. Preserve a clearly explicit FirstMate-native mode as a user-directed exception. Audit desktop, project view, mobile and LIVE for parity; do not claim parity until exercised.
- Remove *mandatory* post-handoff speech from `turn-plan.ts` / `assistant-tools.ts` (“tell him what started/what will come back”). Record the receipt and return natural optional acknowledgment, e.g. “I'll fix it.” Do not say “done” without verification.
- Distinguish work *state*, *outcome*, *genuine request for George*, *urgent issue*, *ambient opportunity*. Before a notification, choose silent/ambient/digest/interrupt using existing `reaches-george`, attention and delivery logic. Preserve a retrievable work history and never silently suppress a deadline-critical permission request.
- Separate dialogue context from task-state telemetry: only include work status when George asks, a genuine important decision arises, or a result directly matters to the current personal discussion.
- Review non-chat surfaces as well: jobs cards, decision card headings, voice and LIVE, Liesel board summaries, mobile notifications. Recent PRs #285, #287 and #290 added cards/buttons/phrase improvements; build on them rather than redoing them.
- Replace unhelpful canned phrases **at their generating instructions**, not only downstream banned-word rewrites. The QA standard tests for *relevance and unnecessary narration*, not merely “no machine jargon”.
- A direct question gets an answer. A request for action gets action/ownership. A personal conversation can remain a conversation. Never end by asking permission for an obvious next step. Use one sentence when one sentence is enough.

**Examples / golden replies:**
- Requested code fix: “I'll fix it.” (after durable handoff; not a fabricated completed change)
- A verified result, asked for: “Fixed.” or the actual result with its link, not a lengthy implementation report.
- Routine CoS decision: no Flyd message.
- An actual financial authorization: “This payment is outside my approved limit. I recommend [verified option]. Approve?” with correct decision action.
- A personal conversation: respond to the substance, without mentioning workers, the Council or the current repo.

**Why:** This is as important as executive intelligence. Better decisions do not help if Flyd still feels like FirstMate's spokesperson.

**Exit:** blind conversation tests show meaningful reduction in unnecessary explanations, unwanted questions and backstage leaks; important facts and approvals are not lost.

### P4 — Semantic visual manifestation and decision UI

**Goal:** Flyd chooses the *right medium* for the meaning, not just shorter text.

**Primary files:** `cli/src/conversation-view/semantic.ts`, `semantic-judge.ts`, `answer-form.ts`, `choices.ts`, `artefact.ts`, relevant `screen/` patterns and view/server action bindings.

**Changes:**
- Input: known communicative intent and evidence. Select **none / compact conversation / ambient item / visual artefact / interactive choice**. Prefer no output for backstage decisions.
- Extend existing manifestation cases (currently prose/diagnosis/comparison) only as warranted: visual references, before/after, option comparison, compact timeline, meeting card and genuine one-click approval.
- Design inspiration is visual and sourced, not a prose list. Work-status visualization is quiet; no “needs you” cards unless authority is validated. Buttons actually resolve the named decision and verify receipt; stale/double clicks do not act twice.
- Test screen, mobile and voice fallbacks. Accessible plain-text equivalent remains available. Do not assume the semantic judge's shadow result already drives UI.

**Why:** A beautiful, relevant interface is more useful than a wall of text; however, the first UI improvement is not showing unnecessary choices.

**Exit:** real representative decisions and inspiration appear in useful forms without raising interrupt rate.

### P5 — Personal care and anticipation

**Goal:** move beyond task completion to “Flyd looks after me.”

**Primary candidates to integrate:** `cli/src/runtime/conversational-initiative.ts`, `preparation-store.ts`, `agenda-tick.ts`, `session-briefing.ts`; `cli/src/council/morning.ts`, `muse.ts`, `inspiration.ts`, `scout.ts`; `cli/src/intelligence/executive/executive-cycle.ts`; existing memory/source contracts, consent gate and canonical events.

**Two vertical slices:**

1. **Call preparation:** when a consented calendar event is approaching, resolve the person to grounded contact/memory data, check freshness and provenance, prepare a discreet briefing with verified personal context (children, birthdays, prior conversations, promises) and surface it only when timing and relevance justify. Never fabricate an identity or intimate detail; no new email/contact access without source consent.
2. **Design companionship:** while George explores a visual/design topic, silently commission permitted reference gathering, curate a strong and small visual set, and make it available ambiently. Don't interrupt the discussion or write a bland “I've found inspiration” announcement.

**General mechanism:** candidate generation → consented context/provenance → relevance and timing assessment (fast decision model where it proves useful) → choose silence/ambient/digest/interrupt → verified action/artefact receipt → feedback outcome. Reuse existing executive-cycle semantics where integrated; confirm callers, tests and control-plane safety first.

**Why:** This is the core product distinction. An assistant that only dispatches and reports remains a messenger.

**Exit:** both vertical slices work reliably with actual permissioned context and meaningful controls; usefulness measured without incentivizing more notifications. Mentor relationship remains with Flyd; specialists and future Finance/Life teams extend capacity later.

## 5. Test and evaluation design

### Benchmark strata (100 initial labelled cases; proposed sample, not a claim of coverage)

| Stratum | Cases | Ground truth |
| --- | ---: | --- |
| Routine implementation/testing decisions | 25 | Domain/CoS decides, no user attention |
| Failure/recovery/unknown outcomes | 20 | Best authorized tactic vs safe hold vs investigation |
| Cross-domain conflicts/priorities | 15 | Correct owner, objective revision and next action |
| Strategic ambiguity | 10 | CoS/Flyd boundary and quality of deeper reasoning |
| Genuine personal/authorization decisions | 10 | George only when essential; no unauthorized effect |
| Proactive relevance and communication | 10 | Valuable/silent/ambient/interrupt and minimal reply |
| Adversarial/privacy/duplicate-execution cases | 10 | Fail-closed authorization, consent, idempotency |

**Test rules:**
- Build synthetic fixtures from real failure classes; only use real personal traces for evaluation when consent, retention and egress explicitly permit it. No raw private conversations in git or third-party benchmark calls.
- Label separately: (a) correct outcome, (b) permitted effect, (c) decision owner, (d) attention relevance, (e) wording/presentation. Avoid optimizing accuracy at the expense of actual usefulness.
- Compare Jev, Gemini, existing LLM and selective hybrid **with the same evidence**; score calibration and abstention, not only percent correct.
- Evaluate *end-to-end* behavior: domain boss → CoS decision → dispatch/recovery → verifier → Flyd user-facing output. A good classifier with poor integration fails.
- Measure 80% fewer **avoidable** interruptions from an observed baseline as a proposed target; zero authorized-effect bypasses and no missed critical approval in the protected test suite. Track task completion quality, delay and cost, so silence is not purchased by dropping work.
- Blind-review before/after reply examples with George's style requirements. Check false promises, forced acknowledgments, needless process lines, repetition and failures to use visual form.
- Ensure source consent, provider egress, revoked grants, erasure, prompt injection and unknown-result reconciliation retain their established protections.

### Must-change tests

- `cli/src/command/__tests__/cos-chain.test.ts`: replace unconditional “second failure → George” expectations with bounded recovery + legitimate authority exception cases.
- `cli/src/command/__tests__/cos-waiting.test.ts`: preserve snooze and duplicate-action protection; only genuinely George-owned waits become user questions.
- `cli/src/command/__tests__/cos.test.ts` and `cos-steer.test.ts`: intake refusal investigation, corrections, status, actual ownership.
- `cli/src/intelligence/__tests__/executive-cycle.test.ts` and existing executive/standing-rule test suites: decision ownership, attention/relevance, and authorization.
- `cli/src/conversation-view/__tests__/flyd-desk.test.ts` plus response, view and choice tests: no silent direct FirstMate bypass of Flyd-owned paths; explicit FirstMate session still works; one-line natural acknowledgments.
- `cli/src/cognition/system-one/` replay suites: Gemini/jev adapter contract, provider failure and threshold calibration.
- `cli/src/runtime/__tests__/conversation-responder.test.ts` and `assistant-tools.test.ts`: no mandatory org-chart narration; false completion prohibited.
- Add explicit external-side-effect duplicate/unknown-receipt tests, privacy/erasure tests for any new context use, and end-to-end cross-domain tests.

**Suggested validation commands (verify package scripts first):** from `cli/` run `npm test`, `npm run lint`, `npm run build`; run existing relevant synthetic decision/route evals and targeted suites first. No test success is claimed by this plan commit.

## 6. Release order, rollout gates, and rollback

**Release A — Executive and voice (first, highest impact):** P0 + P1 + P2 + P3. Execute as vertical slices:
A1 route a genuine routine FirstMate decision to CoS; have a fast model evaluate grounded tactics; verify an authorized decision; **no Flyd/George message**.
A2 fail the run, recover within bounded budget; preserve request ID and no duplicate external effects.
A3 exercise one genuine Flyd escalation; reasoning model resolves and resumes CoS; only a real approval reaches George.
A4 run George's representative chat turns, eliminating managerial narration while maintaining precise receipts.
A5 verify all relevant chat/view/mobile/LIVE ownership paths or mark an unverified surface explicitly unsupported for rollout.

**Release B — Interfaces:** P4. Move useful outcomes from text to existing semantic/visual surfaces while preserving verified action semantics.

**Release C — Care:** P5. Ship meeting prep and design inspiration, then expand cautiously toward Life and Finance capabilities with their own consent/authority contracts.

**Suggested flags, to be finalized only after checking runtime conventions:**
- Reuse `FLYD_COS=1` as the existing command-owner cutover. Do not silently turn it on in production.
- Add a reversible `FLYD_EXECUTIVE_JUDGMENT_V2` shadow/live rollout and a registry-controlled choice of Jev/Gemini per predicate; do not require both providers for every decision.
- Add a narrow `FLYD_NATURAL_DELIVERY_V2` feature flag for communication gate changes, retiring it after safe rollout. Retain existing safe fallback.
- Leave `FLYD_AUTONOMY` unchanged; never deploy `full` as a shortcut.
- New proactive behaviors are consent-gated and independently disableable.

**Safety rollback:** turn off new judgment/voice/proactive flags without discarding existing objective state, receipts or review history. Unknown external effects remain unknown; no rollback can authorize a duplicate execution. Previous user decisions and revocations stay authoritative.

### Exit gates and failure criteria

- Release A fails if CoS routinely asks George for testing, retries or technical method; Flyd narrates every handoff; a provider outage blocks work; important approval gets suppressed; or any action executes without matching permission.
- Release B fails if buttons don't actually perform the recorded decision, if cards are more verbose than the original text, or if ambient content hijacks conversation.
- Release C fails if a briefing invents personal facts, private context crosses an unapproved provider boundary, or “proactive” primarily means more noise.

## 7. Explicit non-goals

- No new general workflow engine, orchestration graph, event ledger, routing store or always-on executive agent session.
- No replacement of FirstMate, Librarian or Design Mate.
- No mandatory Jev → Gemini → LLM cascade. Choose the cheapest reliable path, escalate *computational effort* before escalating *human attention*.
- No blanket financial limit or silent high-impact permission inferred from “don't bother me.”
- No new giant Mentor/Finance/Life teams as prerequisites; let demand and consent justify them.
- No rewriting George's private SOUL.md/USER.md or storing raw personal traces in the repo.
- No priority to cosmetic phrase filters over removing the source of unwanted messages.

## 8. Decisions to revisit only with evidence

1. Whether Gemini beats Jev enough on executive judgments to replace it for particular predicate families.
2. Whether live proactive opportunities should use `ExecutiveCycle` as an active scheduler or whether one existing scheduler already provides the required trigger and attention path. Avoid duplicate schedulers.
3. Which *specific* outward effects George wishes to pre-authorize as standing mandates; no inferred permission.
4. Whether the explicit FirstMate-native project view should advertise its separate ownership in UI more clearly.
5. Whether bounded recovery parameters should differ by domain, based on measured completion, resource cost, and duplicate-effect risk—not an arbitrary global number.

## 9. Implementation checklist

- [ ] Confirm live config, reproduce escalations and freeze held-out cases.
- [ ] Reconcile the one authoritative PRD with delegated autonomy, preserving privacy and scope controls.
- [ ] Register typed executive predicates and evaluate Gemini vs Jev in the existing harness.
- [ ] Implement authority-aware CoS decisions and bounded recovery; replace unconditional second-failure escalation.
- [ ] Eliminate Flyd-owned surface bypasses while retaining intentional FirstMate-native sessions.
- [ ] Remove mandatory handoff/status narration at the source; relevance gate before delivery.
- [ ] End-to-end test first release with strong negative controls and crash/replay cases.
- [ ] Extend semantic presentation, not a second UI pipeline.
- [ ] Wire permissioned pre-call context and design inspiration; evaluate attention quality.
- [ ] Run tests/build, runtime pilot, blind voice review and staged release gates before declaring success.

## 10. The first engineering move

**First working slice:** A domain worker asks a routine question → CoS obtains grounded options → a fast decision model chooses a permissible next tactic → a deterministic authority check permits it → CoS sends a verified instruction and resumes the run → George sees nothing, and Flyd remains available for natural conversation.

Then deliberately fail that path, test recovery without a human retry question, and finally test a genuine approval that *must* reach George. This single slice proves the architecture and the user experience together.

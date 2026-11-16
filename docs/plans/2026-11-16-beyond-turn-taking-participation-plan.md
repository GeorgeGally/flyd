# Flyd — Beyond Turn-Taking: Participation, Attention & Persistent Context

**Date:** 16 November 2026
**Status:** Implementation plan, not implementation or rollout
**Source audited:** `GeorgeGally/flyd`, `main` at `b5c6844ec4f1e3096f7a58c9e66078255fb72bc4` (includes conversation timeline PR #315 and response PR #314).
**Research:** Bruce Liu, *Beyond Taking Turns in Human-AI Interaction*, UCLA PhD dissertation (2026), especially Visual Captions, Inner Thoughts, Doki.
**Product authority:** `docs/product/flyd-personal-intelligence-prd.md`; `AGENTS.md` governs repo/workflow. Do not implement against the retired Rails product.
**Verification boundary:** GitHub source inspection and prior repo documentation; no local checkout, installed Mac/permissions test, live provider call, runtime config inspection, or test execution was performed for this plan.

## 1. The actual goal

Flyd should be able to **notice, think, prepare, choose whether to contribute, and preserve useful work** while George continues talking or working. It should feel like one intelligent presence, not a chat app plus notifications.

The immediate engineering goal is narrower: give existing proactive sources a **shared, observable participation decision** that can choose silence, holding for the right moment, a private conversational note, an ambient manifestation, or a justified interruption. Do not grant additional execution powers. Keep human and AI working with the *same persistent objects* instead of constructing a second stream of disposable messages.

**Success example:**
- During a conversation about a design project, a freshly curated, credible visual reference may appear quietly; Flyd does not narrate the background process.
- A privately formed advisory is raised only if it materially changes the current conversation. If irrelevant now, it is retained until relevant or expires.
- Verified work completes while George is focused elsewhere; existing delivery policy holds it until a natural break, without losing its durable result.
- A genuine time-critical, user-owned blocker reaches him; an implementation question goes back through CoS, not to George.
- If he says he is venting, Flyd talks to him; it does not invent an objective or prepare unauthorized work.

## 2. What the new repo already has — and the remaining gap

| Capability | Source inspected (main @ b5c6844) | Reuse / gap |
|---|---|---|
| Single product + authority | `AGENTS.md`, `README.md`, personal-intelligence PRD | Swift Mac adapter + TypeScript Core are active. Rails is archived. Keep one owner for each action. |
| Conversational understanding | `runtime/read-the-room.ts`, `conversation-presence.ts`, `turn-stages.ts` | Knows vent/think/decide/do/ask/chat and can choose one backstage note. Today this is centered on a user turn. |
| Cheap relevance selection | `runtime/turn-plan.ts` with `note_relevant` in existing Jev batch; `runtime/room-context.ts` | Already routes and filters up to ten notes with no extra call. Preserve the fast path. |
| Candidate memory | `council/advisors.ts`, `council/muse.ts`, Scout and preparation stores | Advisories are open/shown/dismissed/expired, deduped and bounded. No need for a new perpetual 'thought stream' database. |
| Bounded self-started preparation | `runtime/conversational-initiative.ts`, `preparation-store.ts` | Requires existing explicit remit, verified source turn, local draft scope, cancellation. Do not weaken. |
| Operational ownership | `command/cos/tick.ts`, `operational-judgment.ts`, `recovery.ts` | CoS already manages a durable DAG, request-ID reconciliation, verification and bounded recovery. Do not schedule tasks from presentation logic. |
| Delivery timing | `runtime/attention.ts`, `command/scheduler.ts`, `runtime/delivered.ts` | Focus/meeting holds, dedupe, batching and receipt-backed delivery exist. Preserve especially user-owned/blocking cases. |
| Executive opportunity scoring | `intelligence/executive/executive-cycle.ts` | Has benefit/confidence/interruption scoring and reasons, but search found no production caller to `new ExecutiveCycle` / `pendingInterventions`. Fixed daily interruption budget conflicts with newer adaptive timing direction. **Do not activate it wholesale**; harvest its policy concepts. |
| Proactive work already on agenda | `runtime/agenda-tick.ts`, `runtime/proactive-care.ts` | Existing five-minute tick drives consensual meeting briefs, creative references and dated commitments. They quietly use activity records; installed Mac pilot still unverified. |
| One living surface | `conversation-view/semantic.ts`, `placement.ts`, `page/script-timeline.ts`, `importance-judge.ts` | Timeline is now home, jobs inline, one composer, canonical Needs/Moving/Done. ImportanceJudge can hide confident non-relevant items. Do not invent a new scene renderer, panel system or 'thought inbox'. |
| Canonical state and learning | `intelligence/event-store.ts`, `context-envelope.ts`, `intelligence/dream/cycle.ts` | Reuse append-only idempotent spine, provenance, consent, erasure and policy promotion. No parallel mutable truth store. |

**Diagnosis:** This is primarily a **cross-path consistency and timing** problem. The room reader, Council, proactive care, CoS reports, Jev presentation judgement and UI placement each independently decide whether something deserves attention. They do not consistently record *why now, why not, what was suppressed, what later became useful*. New LLMs and screens are not the missing ingredient.

## 3. Research translated into Flyd-specific decisions

1. **Inner Thoughts (priority 1):** candidate → evidence/relevance → reasons to contribute **and reasons not to** → timing/manifestation. Important: the thesis studies social conversational participation; it does **not** demonstrate safety for autonomous external actions. In Flyd this is an attention decision only, never an authority decision.
2. **Visual Captions (priority 2):** useful information can appear *in parallel* with conversation/voice. Default to **private, quiet, reviewable** surfaces rather than unsolicited speech. The study found tradeoffs among auto-display, auto-suggest and on-demand control. Do not continuously animate or shove cards into an active user task.
3. **Doki (priority 3):** human and AI should revise the **same canonical representation**, not regenerate independent UI outputs. Flyd already has stable `SemanticObject` identities, activity/report records, the event spine, and timeline reply attachment. Extend their source links and lifecycle; do not import Doki's video-document structure.

### Alternatives

| Option | Impact | Effort | Risk | Reversibility | Verdict |
|---|---|---|---|---|---|
| A. More prompts + always show proactive cards | Quick copy changes; little consistency | Low | Spam, hallucinated 'insight', no provenance | Easy | Reject as architecture |
| B. Independent continuous 'inner thoughts' agent + its own clock/queue | Broad ideation | High | Duplicates Council, CoS and agenda; costs and source-consent risks | Poor | Reject |
| C. Wire existing `ExecutiveCycle` into production as-is | Reuses code | Medium | Its fixed interruption budget and queue conflict with `attention.ts` / `delivered.ts`; multiple decision owners | Medium | Reject wholesale activation |
| **D. Normalized contributions + pure participation policy at existing event boundaries** | Directly improves relevance and silence without changing user-facing machinery | Medium | Inconsistent gates during rollout | High with shadow + kill switch | **Choose** |

## 4. Architecture and hard invariants

```text
Sources (already running, already consented)
  Council advisories  /  Scout & care  /  CoS verified reports  /  finalized conversation
                     |
          Normalize candidate + evidence
                     |
        Participation policy (pure, cheap)
          Why contribute? Why stay quiet?
                     |
          ┌──────────┴──────────┐
          |                     |
    Current conversation   Background occasion
    existing note_relevant existing attention/timing
          |                     |
   private relevant note    silence / hold / ambient / notify
          └──────────┬──────────┘
                     |
         canonical event/delivery receipt
                     |
     existing SemanticObject + placement + timeline
```

**Boundaries:**
- **Only CoS/domain owners decide and execute work.** Participation selects presentation; it cannot call workers, mint grants, retry an uncertain outward effect, or invent a permission.
- **No new model call on the hot voice/text routing path.** Reuse the existing Jev note batch and room fallback; if unavailable, use deterministic safe defaults.
- **No new scheduler.** Use Council/agenda tick and the existing CoS/delivery triggers. Never turn PRESENT into a sensing or network source.
- **One canonical identity.** A candidate references existing advisory, task, artifact or care source identity; new presentation records are not a second task.
- **Epistemic separation.** A suggestion/inference is not a verified outcome, a user intention, or a permanent memory. Preserve exact evidence refs and source permissions.
- **Fail safe without hiding critical work.** Never suppress an already-grounded, user-owned approval, urgent blocker or verified result based only on uncertain model relevance.
- **Consent is checked when publishing and reading.** Revoking a sensitive source hides previously staged content, just as current care-card visibility does.
- **Quiet is a first-class, reasoned output.** Do not add a fake 'thinking...' bubble or a status item for a suppressed thought.

### Suggested typed contract (conceptual, refine during U1)

```typescript
type ContributionOrigin = 'advisory' | 'care' | 'cos_report' | 'conversation';
type ParticipationDisposition =
  | 'silent'         // irrelevant, duplicate, stale, blocked by policy
  | 'retain'         // might be useful later, still valid
  | 'private_note'   // may enrich current answer without interruption
  | 'ambient'        // quiet, editable/openable current surface item
  | 'notify';        // only if existing attention/delivery policy allows

interface ContributionCandidate {
  key: string;                   // stable source identity + source revision
  origin: ContributionOrigin;
  sourceId: string;
  evidenceRefs: string[];
  createdAt: string;
  expiresAt?: string;
  project?: string;
  content: string;               // bounded, source-grounded; never provider instructions
  epistemicKind: 'observation' | 'inferred_belief' | 'verified_outcome';
  sensitivity: 'operational' | 'personal' | 'sensitive';
  existingDeliveryKey?: string;  // preserve CoS/delivery idempotency
}

interface ParticipationDecision {
  candidateKey: string;
  policyVersion: string;
  disposition: ParticipationDisposition;
  reasonsFor: string[];          // relevance, information gap, impact, urgency
  reasonsAgainst: string[];      // duplication, uncertain provenance, intrusion, stale
  contextRef?: string;           // current turn/focus snapshot, not raw ambient screen
  evidenceRefs: string[];
  decidedAt: string;
}
```

Keep records of material decisions in existing `IntelligenceEventStore` via validated `ContextEnvelope`, with **bounded retention** and idempotency. Avoid logging unchanged 'silent' decisions on every five-minute tick. Do not introduce a second SQLite/JSONL brain.

## 5. Implementation units (in order)

### U0 — Prove the current wiring and establish a replay baseline

**Files to inspect/run:** `runtime/turn-plan.ts`, `turn-stages.ts`, `room-context.ts`, `council/advisors.ts`, `command/scheduler.ts`, `runtime/attention.ts`, `conversation-view/importance-judge.ts`, `conversation-view/server.ts`, `page/script-timeline.ts`, `intelligence/executive/executive-cycle.ts`. Reuse `cli/src/intelligence/evaluation/episode-replay.ts`, `cli/scripts/eval-conversational-initiative.ts`, and relevant unit tests.

**Tasks:** Verify in a runnable checkout the exact call paths and flags; freeze source SHA and a replay fixture corpus from consented/redacted or synthetic scenarios; measure current conversational notes shown, quiet care cards, deferred delivery, latency, repeats and missed urgent reports. Verify whether `ExecutiveCycle` has any runtime use missed by code search. Verify actual current on-screen behavior of Nov 16 timeline separately from what tests assert.

**Acceptance:** A reproducible baseline report distinguishes shipped source, verified unit behavior, installed Mac behavior and unknowns. No new feature enabled. This is a blocking prerequisite.

### U1 — Add one pure participation-decision policy

**Create:** `cli/src/runtime/participation-policy.ts`, `cli/src/runtime/__tests__/participation-policy.test.ts` (exact module location may adjust after U0).
**Reuse:** `runtime/attention.ts`, `council/advisors.ts`, `intelligence/context-envelope.ts`, existing source consent.

**Tasks:**
- Normalize *existing* advisory and care candidates first, with stable source/revision keys, TTL, evidence and sensitivity. Add CoS reporting adapter **only** after its current delivery contract is tested.
- Deterministically gate expired, duplicated, withdrawn, disallowed, ungrounded, unrelated and out-of-context content; compute two explicit groups of reasons (for/against participation). Prefer no model call by default.
- Output *recommendation*, not direct UI action. Only existing delivery/timing code can issue actual user notifications.
- Version policy and include a no-op off switch. Use a shadow path with identical inputs to existing behavior.

**Tests:** irrelevant news remains quiet; fresh project advisory retained for later; same advice across restarts is not resurfaced; low confidence cannot suppress verified user-owned work; revoked consent blocks display; hostile quoted content cannot become an instruction or task.

### U2 — Make conversational participation smarter without another turn

**Modify:** `runtime/room-context.ts`, `runtime/turn-stages.ts`; minimal changes to `runtime/turn-plan.ts` and `council/advisors.ts` only when necessary.
**Tests:** `runtime/__tests__/read-the-room.test.ts` / `turn-plan.test.ts`, `council/__tests__/council.test.ts`, plus new participation tests (use actual filenames from U0).

**Tasks:** Run pure eligibility/expiry checks **before** submitting candidate notes to existing `note_relevant` batch. Keep its ability to choose zero or one note; preserve room fallback and source refs. Retain relevant but unspoken advisories until their existing expiration or meaningful state change. Mark shown/dismissed through current advisory lifecycle only after a truthful presentation receipt.

**Tests:** a live conversation can raise one genuinely relevant novel insight; a venting turn adds no work; a remark about a different project gets no off-topic intrusion; fast Jev route and slow room reader agree on safe defaults; no added hot-path provider call, no change to tool routing or grants.

### U3 — Evaluate off-turn participation at existing background/report triggers

**Modify:** adapters next to `runtime/agenda-tick.ts` / `runtime/proactive-care.ts` / `command/scheduler.ts`, **not** a new timer. Reuse `runtime/delivered.ts` and `runtime/attention.ts`.
**Create:** a small `runtime/participation-receipt.ts` only if existing `IntelligenceEventStore` call sites cannot cleanly own the typed decision.
**Tests:** new `runtime/__tests__/participation-delivery.test.ts` plus existing attention/delivery/CoS suites.

**Tasks:** First emit **shadow** participation dispositions correlated to actual source and actual delivery outcomes; compare differing choices. Preserve CoS report ownership, request IDs and `placeOf`. Fold useful executive scoring concepts (`whyNow`, `whyMe`, positive/negative evidence) into the pure decision policy; **do not turn on the legacy ExecutiveCycle notification queue or its fixed daily cap**. After replay proof, allow the new policy to choose only among non-critical ambient/retain/silent outcomes. Leave urgent/user-owned notification timing to existing code.

**Tests:** report arriving in a meeting holds and resurfaces after; relevant currently focused project report appears as existing policy specifies; unknown outward send is never retried; an unapproved user-owned decision remains in Needs You however old; two concurrent sweeps do not duplicate an item; app restart cannot re-ring a shown item.

### U4 — Persistent shared work, no new UI framework

**Modify selectively:** `conversation-view/semantic.ts`, `activity.ts`, `show.ts`, `server.ts`, and existing presentation adapters. **Preserve** `placement.ts` and `page/script-timeline.ts` as the home.
**Tests:** `conversation-view/__tests__/semantic.test.ts`, `activity.test.ts`, `placement.test.ts` (or current analogous suite), `page.test.ts`.

**Tasks:** For promoted ambient insights, reuse stable `SemanticObject` identity and source links. An investigation remains an `investigation`; a finished result remains an `artifact`; an ongoing action remains an `activity`. No synthetic jobs or demands in Needs You. Follow-up replies reference the same object and revised provenance; source expiry/supersession makes the old visual stale or removes it, never rewrites canonical history. Use existing media/article previews where sources permit, without fresh asset generation.

**Acceptance:** One visual is quietly available **while** a conversation continues, and users can inspect or reply without losing the conversational timeline. Returning to the view rehydrates from current facts rather than a detached ChatGPT-style reply; consent revocation hides private material immediately.

### U5 — Optional LIVE/voice parallel visuals only after text pilot succeeds

**Inspect before implementation:** `runtime/turn-stages.ts`, `resolve.ts`, realtime session handling under `cli/src/`, `mac-adapter/Sources/Bridge/LiveAudioBridge.swift`, `LiveSessionController.swift`, and the Conversation view bridge.
**Tasks:** Keep LIVE speech separately user-directed. A grounded reference may arrive as a quiet visual in the already-open conversation surface; do not automatically interrupt or speak over George. Confirm source finalization, cancellation, session context ownership, reconnect and current voice latency. Do not add new calls on the live audio hot path or expand microphone/screen sensing.

**Release gate:** No LIVE implementation until U0–U4 produce a tested and useful text-only improvement. A voice-specific latency, interruption and stale-card replay suite is mandatory.

### U6 — Frozen evaluation, canary, learning and rollback

**Reuse:** `intelligence/evaluation/episode-replay.ts`, System-1 registry/replay, `intelligence/dream/cycle.ts`, existing policy-promotion/versioned rollouts.
**Add:** synthetic/consented frozen evaluation fixtures covering at least 100 independent cases, including protected privacy/permission/partial-receipt/restart/meeting/venting cases; the 100 is a *proposed benchmark size*, not a claim that results have been run.

**Compare:** current behavior (control) vs new shadow decisions; then opt-in canary. Count *useful additional contributions*, *irrelevant or intrusive contributions*, *important items missed*, *duplicate resurfacing*, *provenance errors*, p50/p95 time overhead, model calls/tokens, and revoked-source visibility. Require **zero protected regressions** and no increased hot-path model calls. Measure real provider variance only in a consent-approved run. Don't label a source-level green test as a deployed Mac outcome.

**Flags/rollback:** one scoped `FLYD_PARTICIPATION=off|shadow|canary` gate (or existing policy-rollout control if it already fits), default `off` or `shadow`. Kill switch prevents new candidates from being published without deleting existing canonical work. Canaries fail back to current delivery; never backfill a burst of suppressed alerts. No automatic policy promotion without frozen replay.

## 6. Build order and dependency gates

1. **U0** baseline and observed wiring (blocker).
2. **U1 + U2** source-normalized candidate policy and better conversational note selection. Lowest-risk meaningful increment.
3. **U3** shadow decision receipts at background/CoS triggers; compare before altering presentation.
4. **U4** surface only validated ambient contributions through the existing semantic timeline. Do not conflate a thought with a task.
5. **U6** measured opt-in canary and feedback.
6. **U5** LIVE visuals later, conditional on text pilot and real Mac verification.

Do **not** make the AgentRun DSL experiment, Jev-versus-Gemini switch, new long-running worker, a new storage engine, native UI redesign, or new permissions prerequisites. Those are separate proposals with their own measurement gates.

## 7. Main technical objections and how this plan can fail

1. **Over-filtering can hide something important.** Existing `importance-judge.ts` fails open on uncertainty, and CoS has distinct user-owned/urgent obligations. New policy cannot turn a doubtful model verdict into hidden user work. Protect those cases and audit false negatives.
2. **Two authorities for attention can disagree.** Reuse `attention.ts` for actual notification timing and `placement.ts` for object location. New participation disposition is advisory until rollout; no dual delivery queues or quiet-hour clocks.
3. **Continuous thinking may just be continuous noise/cost.** Avoid a free-running model loop. Learn from event opportunities already generated by Council, live turns, CoS and care; default to silence, dedupe and expire. Do not promote LLM-generated advisory text into confirmed memory.
4. **Ambient UI can become a disguised dashboard.** The latest timeline already unifies chat + work. Keep one composer and open/reply affordances; do not populate the foreground with activity just because something happened.
5. **The research does not validate autonomous actions.** The thesis supports interaction designs in constrained studies. Flyd's production permission, source provenance, unknown-effect and real-time voice risks require their own tests.

## 8. Definition of done

- A relevant new advisory can improve an ongoing answer without a new user prompt specifically requesting it, and an irrelevant one remains private.
- A grounded, consented off-turn insight can appear ambiently in the existing timeline without speaking or creating fake work.
- Work outcomes retain canonical identity, evidence, existing delivery receipts and their original owner. Old user-owned questions never vanish due to relevance scoring.
- Replay and live pilot establish the benefit, cost and interruption tradeoffs versus current source behavior; no protected safety, authority, privacy or verification regression.
- Off/shadow/canary rollback is real; no extra scheduler, independent agent or legacy Rails dependency.
- Installed Mac, TCC, and real provider behavior are **explicitly verified before claims of production completion**.

**First engineering move:** run U0 on current `main`, producing a concrete source-to-user visibility trace for (a) Council advisory raised in a conversation, (b) proactive care visual card, (c) CoS report held during focus/meeting, and (d) genuine user-owned blocker. Freeze those as protected replay cases *before* changing policy.

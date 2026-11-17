# Flyd — Beyond Turn-Taking: Participation, Attention & Persistent Context

**Date:** 16 November 2026
**Status:** VALIDATED WITH CORRECTIONS against main at 75558499faa6aca8d71a497557eec5554d31f3d3 on 17 November 2026. Implementation has NOT started.
**Source audited:** `GeorgeGally/flyd`, `main` at `b5c6844ec4f1e3096f7a58c9e66078255fb72bc4` (includes conversation timeline PR #315 and response PR #314).
**Research:** Bruce Liu, *Beyond Taking Turns in Human-AI Interaction*, UCLA PhD dissertation (2026), especially Visual Captions, Inner Thoughts, Doki.
**Product authority:** `docs/product/flyd-personal-intelligence-prd.md`; `AGENTS.md` governs repo/workflow. Do not implement against the retired Rails product.
**Verification boundary:** GitHub source inspection against 75558499 (new PRs #316–#324) and the matching GitHub CI success (run 44003441193, completed 17 November 2026). No local checkout, installed Mac/permissions test, live provider call or runtime configuration inspection was performed. CI success is a source/build/test baseline, not proof of the new participation feature.

## 0. Revalidation verdict (17 November 2026)

**Decision: keep the event-driven approach, but fix three existing correctness faults before constructing the shared policy.** This validation supersedes any inconsistent ordering or presentation assumption later in this document.

Review scope: main at 75558499, including the November 17 interrupted-question retry, finished-work links, voice loader, scroll-position stability, and conversation continuity changes, plus the November 16 independent checking and CoS acceptance hardening. [CI run 44003441193](https://github.com/GeorgeGally/flyd/actions/runs/44003441193) succeeded on that commit. This validation did **not** run tests locally or operate an installed Flyd.

### Source-backed corrections

1. **An advisory can be lost without ever reaching George.** In runtime/conversation-responder.ts (around 1485–1490) an advisory chosen for the model is marked shown after a successful final answer even if the final text does not contain it. resolve.ts (around 884–889) similarly marks it shown on a non-empty model resolution. Selection, inclusion in generated output, UI emission, and verified receipt are different events. Change these transitions and tests **before** introducing a new relevance gate. A model-selected but omitted insight must remain eligible later, with retry/deduplication to prevent nagging.
2. **Council bypasses receipt-aware attention.** council/council.ts (around 123–136) directly calls notify('Flyd', text), catches failure, increments its per-day count regardless, and puts the advisory into the notified array. runCouncilInBackground uses runtime/agenda.ts notifyMac, whose Promise<void> discards the richer deliverNotificationLine outcome. Existing notifyMacOutcome/deliverNotificationLine distinguish shown, kept, idle, backstage, placeholder, repeat and undelivered. Use this outcome or the established delivered ledger for Council; decide semantics for screened/undelivered/duplicate cases explicitly. Preserve source identity and the existing maximum as a *candidate throttle*, not proof of receipt. Council notices currently travel with the generic 'deliverable' default; check whether that classification is appropriate before changing notification frequency.
3. **ImportanceJudge can hide a user-owned call.** conversation-view/server.ts (around 676–700) filters show.items **and show.calls** when ImportanceJudge returns false. importance-judge.ts has no deterministic protected-class exception. Add a structural guard for genuine user decisions/required approvals and verified requested outcomes, then regression tests, *before* enabling any new suppression logic. Keep soft relevance scoring on optional information only.
4. **The new timeline is not an ambient publication stream.** page/script-timeline.ts draws from frontJobs; workInTimeline includes actual needs, running items, and recently done non-bare work. Proactive-care cards are ActivityRecord items in the Activity panel, not job messages. For v1, publish quiet insights there (or as a genuine artefact when the user opens one); **never fake an AgentTask, Needs You request, or job to get an idea into the timeline**. Defer a new inline, non-job 'insight' object until a separate interaction/design test justifies it.
5. **The semantic snapshot is a projection, not durable Doki-style shared state.** conversation-view/semantic.ts derives identities from ShowItem and source adapters; server.ts composes per-refresh snapshots. Activities already persist in activity/records.jsonl, while executive reports and delivery receipts use the intelligence event spine. Don't assert a universal persisted semantic workspace or force a storage migration. Preserve source IDs/refs and derive the view from authoritative stores.
6. **Potential over-filtering already exists independently of this plan.** ImportanceJudge currently re-asks Jev per changed ShowItem with an in-memory cache; it may show candidate items while waiting, then remove them. New participation filtering must not add oscillation to that asynchronous view. Tests should cover stabilizing the reader's position, the new auto re-ask interrupted questions, and rehydration after restart.
7. **The existing fast path is sufficient for user-turn note selection.** turn-plan.ts already batches note_relevant with turn routing/skill selection; room-context.ts already bounds eligible advisories. Do not add a new System-1 predicate or extra full-model call to every conversation. Off-turn Council and care are separate producers, not candidates for per-token reasoning.
8. **A source-level CI success is not a production pilot.** Native Mac Calendar consent, on-screen visibility, source revocation, delivery receipts, current flags and real provider latency still require an installed-app run.

### What stays unchanged

One Core; one CoS objective owner; one permission and egress policy; existing agenda, Council, command scheduler and attention timing; existing source stores and event spine; no new always-on LLM; no new independent inbox; no extra hot-path call; the single conversation composer.

### What the revised pilot should prove

A real grounded insight is either (a) actually displayed and acknowledged in source state, (b) quietly held for another appropriate moment, or (c) explicitly rejected with a reason; no arbitrary marking as 'shown', duplicate ringing, new demands on George, or disappearance of user-owned work.

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
| One living surface | `conversation-view/semantic.ts`, `placement.ts`, `page/script-timeline.ts`, `importance-judge.ts` | Timeline is home for real work items, not ambient insights. The semantic snapshot is derived on refresh, not durable persisted workspace. ImportanceJudge currently can hide calls; fix that. Keep one composer; reuse Activity for ambient. |
| Canonical state and learning | `intelligence/event-store.ts`, `context-envelope.ts`, `intelligence/dream/cycle.ts`, `conversation-view/activity.ts` | Canonical intelligence events and existing Activity JSONL coexist; do not pretend Activity is in the event spine. Correlate stable source IDs and minimal decision receipts; no new parallel truth store or migration. |

**Diagnosis:** This is primarily a **cross-path consistency and timing** problem. The room reader, Council, proactive care, CoS reports, Jev presentation judgement and UI placement each independently decide whether something deserves attention. They do not consistently record *why now, why not, what was suppressed, what later became useful*. More importantly, present source shows inaccurate 'shown' and 'notified' transitions and optional relevance hiding real calls. Fix those first. New LLMs and screens are not the missing ingredient.

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
- **Existing action owners (CoS/domain teams and authorized direct tools) decide and execute work.** Participation selects presentation; it cannot call workers, mint grants, retry an uncertain outward effect, or invent a permission.
- **No new model call on the hot voice/text routing path.** Reuse the existing Jev note batch and room fallback; if unavailable, use deterministic safe defaults.
- **No new scheduler.** Use Council/agenda tick and the existing CoS/delivery triggers. Never turn PRESENT into a sensing or network source.
- **One stable source identity.** A candidate references an existing advisory, task, artifact or care source key and revision. SemanticObject is a derived presentation projection; it is not the authoritative durable object. New presentation records are not another task.
- **Epistemic separation.** A suggestion/inference is not a verified outcome, a user intention, or a permanent memory. Preserve exact evidence refs and source permissions.
- **Fail safe without hiding critical work.** Never suppress an already-grounded, user-owned approval, urgent blocker or verified result based only on uncertain model relevance.
- **Consent is checked when publishing and reading.** Current care-card visibility is an implementation precedent, not universal coverage. New staged sensitive content needs source-specific revocation checks before any pilot; disable/hide does not silently erase historic records.
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

## 5. Revised implementation units, in dependency order

### U0 — Baseline, protected paths and current runtime wiring (required)

**Inspect:** runtime/turn-plan.ts, turn-stages.ts, room-context.ts, conversation-responder.ts, resolve.ts; council/{council,advisors,muse}.ts; runtime/{agenda,attention,delivered,proactive-care}.ts; command/scheduler.ts and CoS tick; conversation-view/{server,importance-judge,activity,semantic,placement}.ts and page/script-{timeline,messages}.ts.

**Run in an isolated checkout:** npm test, npm run lint and npm run build under cli/; inspect installed Mac only with explicit access and source-consent approvals. Confirm whether the ExecutiveCycle is actually uncalled (default-branch code search finds no production caller).

**Freeze replay fixtures:** advisory selected but omitted from final; advisory genuinely shown; Council notice shown, screened, undelivered, repeated; meeting/focus delivery hold; user-owned call scored irrelevant by Jev; care record hidden after revocation; same project insight across restarts; auto re-asked interrupted question; scroll-preservation on redraw. Use synthetic or consented redacted data. This is not a request to read George's installed private records by default.

**Gate:** record exact function calls, flags, source keys, timing and output surfaces. Distinguish CI-tested, locally reproduced and installed-Mac verified. Do not report a feature as shipped from source inspection alone.

### U1 — Repair truthful delivery and protected attention before new policy

**Change A: Council receipt correctness.** In council/council.ts, use an outcome-bearing notification adapter (runtime/agenda.ts notifyMacOutcome or the existing runtime/delivered ledger, only if it matches Council's semantics). Treat *shown* as demonstrated delivery. Keep screened/held/undelivered distinct. Do not count an attempt as seen, and do not retry without stable advisory identity and idempotent claim. Decide whether an unreceived urgent advisory should be retained for a later relevant moment; no surprise burst of backlogged notifications. Preserve the Council output schema or version migration for consumers. Verify title and advisory kind pass reachesGeorge and screenBeforeDisplay correctly.

**Change B: advisory consumption truth.** In runtime/conversation-responder.ts and resolve.ts, separate 'candidate handed to answerer' from 'actually surfaced'. A completed answer is not proof of inclusion. Only mark shown when a real, source-linked visible contribution is confirmed; otherwise retain open with an explicit bounded attempt/cooldown. Prefer explicit structured inclusion/visible source identity where feasible, not brittle keyword matching or extra hot-path LLM calls. Prevent cross-session repetition by stable advisory identity and TTL. Do not treat a mere resolved model prompt as an on-screen receipt.

**Change C: protected visibility.** In conversation-view/server.ts and importance-judge.ts, prevent false relevance judgements from removing genuine user-owned decisions, unresolved required approvals, and verified requested deliverables. Use deterministic facts from decision/outcome/source state before the model filter; don't rely on words alone. The model may still downgrade optional hints. Do not change placement.ts.

**Tests:** extend council/__tests__/council.test.ts, conversation-view/__tests__/importance-judge.test.ts, runtime/__tests__/read-the-room.test.ts and turn-plan.test.ts, plus notification and conversation-view integration cases. Test thrown notify, 'kept'/'repeat'/'undelivered', selection-but-omission, no duplicate resend, source revocation, model confidence false on true user-owned call, and no new conversation tool grants.

**Gate:** no lost advisory from a false shown flag; no false Council notification receipt; no user-owned call suppressed by Jev. U1 should be independently mergeable and releasable, before any new participation feature.

### U2 — One narrow participation decision, shadow-first

**Build:** runtime/participation-policy.ts (pure) with test fixtures; a typed adapter for *existing* Council advisory and care candidates only. Reuse their source keys, TTLs and consent policies; do not build an independent thought repository.

**Input:** stable source ID + revision, minimal evidence reference, confidence (if actually available), expiry, optional project, known context/focus, and existing optional/notifiable class. Candidate data is bounded, classified and user-visible text from already approved sources; never ingest raw emails, mic/screen or secrets by accident.

**Output:** a versioned reasoned recommendation: suppress invalid/duplicate; retain valid-but-not-now; consider an optional private note on a current turn; surface an already-supported quiet Activity item; or pass a genuinely eligible notification to the existing attention/delivery decision. 'Silent' must distinguish policy rejection from 'valid but deferred' so useful work is not discarded. It grants no actions and makes no delivery claims.

**Ownership:** the existing attention.ts decides timing for CoS reports; the existing Council/agenda and Activity writers own their source lifecycle; the participation policy never owns a timer, notification queue, semantic object database or external effects. Do not switch on ExecutiveCycle.consider as a second owner.

**Tests:** 100% pure deterministic fixtures for expiry, source-consent revocation, dedupe, mistaken relevance, unspecific evidence, context change, and stable idempotent reasons. In shadow mode, never suppress or introduce a visible item.

### U3 — Improve current-turn initiative using the existing fast route

**Modify minimally:** runtime/room-context.ts, runtime/turn-stages.ts; modify turn-plan.ts only when a failing regression fixture proves necessary. Keep current note_relevant in the already batched Jev route and LLM fallback; no new full-model call and no new Jev predicate simply for participation.

Apply source eligibility, explicit user intent, expiry and recent-consumption guard *before* building the ten-note pool. Select zero or one advisory, and record selection separately from inclusion/delivery (U1). A venting or unrelated turn should not prepare work or narrate a status. Remits in conversational-initiative.ts remain explicit, scoped, cancellable and orthogonal.

**Tests:** advisory is relevant but omitted -> retained, not marked shown; actually surfaced -> shown once; another project -> quiet; venting -> no unauthorized work; cross-session callback -> no repetition; no regression on tool routing, fallback or hot-path model count.

### U4 — Off-turn awareness through existing producers, no new scheduler

**Pilot Council first, care second.** Normalize Council's already-produced advisories into U2 shadow decisions at runCouncilPass. Compare the Council notification outcome to what participation *would* have chosen, after U1 is correct. Then shadow existing proactive-care records from agenda-tick.ts and conversation-triggered prepareCreativeForConversation in commands/view.ts. Keep consent, daily limits and existing Activity display unchanged while in shadow.

**Only later** compare CoS reports in read-only shadow mode, keyed to the report/decision and the runtime/delivered receipt. Do not let the participation policy suppress, retry, delay or alter CoS's legitimate user-owned/blocking work. Avoid breaking its unknown external effect recovery, acceptance checker and Nov 16 verified-result semantics.

**Tests:** repeated Council ticks, screened-but-counted attempts, Mac unavailable, focus/meeting holds, no duplicate cross-process notifications, an expired design reference, consent revoked after recording, same creative topic across turns, and an unapproved user-owned question retained in Needs you.

### U5 — Ambient manifestation with actual source identity (not fake jobs)

**Use:** conversation-view/activity.ts, existing left-column/rail cards and the current source URL/evidence media display. Preserve page/script-timeline.ts, placement.ts, frontJobs and the single composer as-is for v1. An ambient insight is not an AgentTask, WorkFact, decision or a 'Done' report.

The source stays authoritative in Council or care. The ActivityRecord is a legacy display record, not canonical event-spine truth; do not silently migrate it. Minimal participation decision receipts can go in IntelligenceEventStore with source IDs/policy version and without raw sensitive content. Existing semantic.ts can project valid activity/monitor/artefact objects when appropriate, but a rendered SemanticObject is not by itself persisted Doki-style state.

Add a source-linked inspect/reply affordance only if the existing Activity/rail contract can support it with a read-only interaction; otherwise defer that interaction and keep today's ambient cards. Check that disabling care or revoking source permissions removes sensitive cards from *every* derived view, not just the ActivityReader. Ensure content stays still during updates (PR #321) and the new interrupted-question retry (#324) does not duplicate ambient items.

**Gate:** a useful insight quietly appears in Activity without inventing work or reordering the conversation; it is source-grounded and expires/revokes correctly. Only then consider a separate design exploration for inline non-job insight messages.

### U6 — Frozen replay, live Mac pilot, staged activation and later LIVE

**Test suites:** runtime/__tests__/proactive-care.test.ts and attention.test.ts; council/__tests__/council.test.ts; conversation-view/__tests__/{importance-judge,activity,semantic,page}.test.ts; command scheduler/CoS integration tests; intelligence event-store and sensor-consent tests. Extend rather than add a large duplicate evaluation harness. The 100-case holdout is a *target corpus*, not measured evidence.

**Measure:** additional useful contributions, selected-but-omitted notes, false 'shown' transitions, missed protected items, duplicate notifications, private-data exposure, p50/p95 response overhead, background calls/token cost, actual notification outcomes, interface movement and source revocation. Protected reliability and privacy cases must show zero regressions relative to current tested behavior. Optional relevance may be A/B compared only after U1.

**Activation:** an opt-in 'off/shadow/canary' switch using existing policy promotion where applicable; control behavior remains default. Shadow must not mutate advisory 'shown' state or send extra notifications. Rollback never replays a backlog of suppressed notices and must not erase known work.

**LIVE comes last:** after successful text/Activity pilot, inspect the realtime transport and Mac Swift bridge with actual final transcript/reconnect/cancellation behavior. A quiet visual may coexist with voice only if it does not add an audio hot-path model call, capture PRESENT context, or speak over George. Require real installed-app proof; no claim of LIVE parity from backend tests alone.

## 6. Corrected release order

1. **U0:** current-main fixtures and runtime baseline; latest CI is green but installed Mac remains unverified.
2. **U1:** repair the *existing* Council receipts, advisory consumption, and protected-call visibility; ship separately.
3. **U2 + U3:** shadow-only policy and current-turn filtering via existing note route. No new user UI.
4. **U4:** Council off-turn shadow; then care; CoS read-only shadow only after trusted receipt correlation.
5. **U5:** optional ambient improvements in the **Activity** surface, no fake timeline jobs.
6. **U6:** canary + replay + installed-Mac validation. LIVE visuals deferred until value is proven.

The critical change from v1: do not start with a new generalized abstraction; first fix misleading 'shown/notified' signals. Everything else depends on their correctness.

Do not make AgentRun, Gemini/Jev provider switching, another worker, another scheduler, a new database, new sensing, Rails, or a scene redesign prerequisites. They are separate choices.

## 7. Main technical objections and how this plan can fail

1. **Over-filtering can hide something important.** Existing `importance-judge.ts` fails open on uncertainty, and CoS has distinct user-owned/urgent obligations. New policy cannot turn a doubtful model verdict into hidden user work. Protect those cases and audit false negatives.
2. **Two authorities for attention can disagree.** Reuse `attention.ts` for actual notification timing and `placement.ts` for object location. New participation disposition is advisory until rollout; no dual delivery queues or quiet-hour clocks.
3. **Continuous thinking may just be continuous noise/cost.** Avoid a free-running model loop. Learn from event opportunities already generated by Council, live turns, CoS and care; default to silence, dedupe and expire. Do not promote LLM-generated advisory text into confirmed memory.
4. **Ambient UI can become a disguised dashboard.** The latest timeline already unifies chat + work. Keep one composer and open/reply affordances; do not populate the foreground with activity just because something happened.
5. **The research does not validate autonomous actions.** The thesis supports interaction designs in constrained studies. Flyd's production permission, source provenance, unknown-effect and real-time voice risks require their own tests.

## 8. Definition of done

- A relevant new advisory can improve an ongoing answer without a new user prompt specifically requesting it, and an irrelevant one remains private.
- A grounded, consented off-turn insight can appear in the existing **Activity panel** without speaking or creating fake work. Inline non-job insights are deferred.
- Work outcomes retain source identity, evidence, existing delivery receipts and their original owner. Old user-owned questions never vanish due to relevance scoring. Council's 'notified' and advisers' 'shown' states never mean merely attempted/composed.
- Replay and live pilot establish the benefit, cost and interruption tradeoffs versus current source behavior; no protected safety, authority, privacy or verification regression.
- Off/shadow/canary rollback is real; no extra scheduler, independent agent or legacy Rails dependency.
- Installed Mac, TCC, and real provider behavior are **explicitly verified before claims of production completion**.

**First engineering move:** run U0 on main at 75558499 (or rebase to a newer head), then implement U1's three correctness fixes. Specifically reproduce (a) adviser selected-but-omitted yet marked shown, (b) Council notify failure counted as delivered, and (c) user-owned call suppressed by Jev. Freeze these as protected regression cases before touching the generalized participation policy.

# Generative UI: recovered intent, current implementation, and Jev failure reporting

Date: 2026-11-23 (Bali)
Source reviewed: main at `8dc6d665722a42f620116640f018e99116897cf1`.
Status: source audit complete; Jev failure reporting implemented with this change. The communication-intent pipeline remains unimplemented.

## What George asked for

> Flyd understands what it is trying to communicate, then generates the appropriate interface for that specific thing.

This is a communication problem. A semantic kind describes what is happening; it must not prescribe the interface. An investigation that explains a failure may need a cause, a contrast and evidence. Another investigation comparing possible fixes may need alternatives, criteria and a recommendation. They retain the same semantic kind.

The required separation is:

`SemanticObject → CommunicationIntent → ManifestationPlan → Renderer`

- SemanticObject: what the thing is, with stable identity and grounded evidence/actions.
- CommunicationIntent: what George needs to understand or do in this particular situation. Goals can combine, such as `explain_cause`, `contrast_expected_actual`, `show_evidence`, `identify_fix`, or `compare_options`, `recommend`.
- ManifestationPlan: the structure that makes those particular goals understandable, including evidence and action bindings.
- Renderer: presents that plan and keeps its interactions connected to the actual work.

Jev's intended role is a bounded semantic decision about communication goals and the appropriate supported manifestation. It is not arbitrary code/CSS generation and it is not another classification of the object's kind.

Evidence limits: conversation retrieval returned summaries of the original thread, not a complete transcript of all sections after “Make Jev the manifestation decision-maker.” George's quotation in this conversation is authoritative. Additional implementation proposals below are recommendations based on that quotation and the current source, not reconstructed quotations from missing messages.

## Where main actually is

| Area | Current source | Verdict against the intent |
|---|---|---|
| Semantic identity and lifecycle | `cli/src/conversation-view/semantic.ts` | Useful existing foundation: native activities, decisions, artifacts, monitors, stable identities, canonical snapshot and lifecycle events. Reuse it. |
| CommunicationIntent | No contract or producer found in active `cli/src` | Missing. Current kinds and answer forms do not fill this role. |
| ManifestationPlan | `conversation-view/semantic.ts` | A discriminated answer-body type: prose, diagnosis, comparison, gallery, briefing. Useful renderers exist, but this is not yet a plan derived from composable communication goals. |
| Meaning-to-pattern catalog | `screen/meaning.ts`, `screen/patterns.ts` | `meaningOf` can accept an explicit plan, but otherwise maps kinds/phases to one of eight fixed patterns. `server.ts` calls `fillScreen(object)` without supplying an answer plan or communication intent. |
| Use of those screen plans | `conversation-view/page.ts` and its imported `page/script-*.ts` | Server attaches `screen` metadata; the active page scripts do not consume its `pattern`, `blocks`, `action` and `visual` plan. Direct card/decision rendering remains. Screen CSS and fixture tests are not evidence of a connected production renderer. |
| Flyd's own answer | `commands/view.ts:answerAsFlyd` → `answer-shape.ts` → `flyd-desk.ts` → `server.ts` → `answer-form.ts` | Writes prose, optionally detects a legacy diagnosis, asks Jev `answer_form`, then makes another model call to reshape the prose. This is retrospective formatting. A validated form does reach `answerHtml` in the message view. |
| Diagnosis behavior | `commands/view.ts`, `answer-form.ts:workingReply` | The view deliberately avoids exposing internal Expected/Observed/Cause/Evidence/Next reports as the default answer. Do not undo that in the name of generative UI; support a diagnostic visual only where the particular communication calls for it. |
| Continuous evolution | `semanticEvents`, keyed decisions in `page/script-brief.ts` | Stable objects and some keyed updates exist. An intent-led manifestation updating evidence/actions in place is not demonstrated by the current path. |
| Native Mac outcomes | `resolve.ts`, `server.ts`, `mac-adapter/Sources/UI/AugmentPanel.swift` | Native/augment/compose already exist. The proposed conversation manifestation contract is not a shared implemented planner across these outcomes. No installed-Mac validation was performed here. |

The implementation is further along than the old 99-line patch, but it has not completed the requested architecture. Replacing the old patch with another fixed kind-to-layout mapping would repeat the same mistake.

## The six workspace repairs, evaluated against today's code

The original `semantic-workspace` / `semantic-context` client stage and its Watching control are no longer present in the current page scripts. Do not recreate them to repair an old snapshot.

| Requirement | Today's position |
|---|---|
| Exhaustive grouping and explicit failed state | The semantic model has `failed`; the old grouping function is gone. Current left-column visibility filters intentionally hide some failures/paused items. A lifecycle field alone does not prove every actionable failed object is accessible. |
| Remove dead Watching button | Old control is absent. No reason to introduce another. |
| One semantic source for counts and destinations | `server.ts` derives `show.needs` from canonical semantic objects, but excludes semantic focus. `script-brief.ts` draws from `show.decisions`, while its indicator uses `show.needs` when present. These are still different lists; the invariant is not established for the current UI. |
| Keyed context edge / retain focus | Old edge is gone. `drawSemanticDecisions` now has stable object selection and a `needsDrawn` content key. This is useful reuse, not proof of the removed stage's acceptance conditions. |
| Useful readouts | `page/script-session.ts` restores plan/context usage; `page.test.ts` exercises context percentage and session/week remaining. Do not replace this with another readout system. |
| Stop chrome work | Preserve the current surrounding UI; repair concrete current regressions separately from the communication pipeline. |

## Where Jev is actually used

| Use | Input and gate | Role and fallback |
|---|---|---|
| `answer_form` | `utterance`, completed `answer`; chosen probability ≥ 0.70; client truncates/redacts strings | Chooses a single answer form after prose. Failed/uncertain calls leave prose. Diagnosis selection is explicitly not reshaped by `answerAsFlyd`. |
| `semantic_object_kind` | Bounded item fields; `FLYD_SEMANTIC_JUDGE=1` plus `TYPESAFE_API_KEY` | Optional kind judgment. It does not choose a communication intent. |
| `reply_artefact_kind` | Existing reply; TypeSafe key, unless `FLYD_ARTEFACT_JUDGE=0` | Steps/options/text classification for ambiguous numbered replies; failure becomes text. |
| `matters_to_george` | Bounded item plus recent user words; key, unless `FLYD_IMPORTANCE_JUDGE=0` | Relevance/attention filtering; failed/uncertain calls retain the item. Protected decisions/results bypass suppression. |
| Chat turn routing | `runtime/turn-plan.ts:routeWithJev`; key, unless `FLYD_JEV_TURN_ROUTE=0` | Batched route/domain/code/skill/note decisions. This is existing routing, not a manifestation planner. |
| Other runtime work | `cognition/interpret.ts`, curator/memory, router, executive/CoS recovery, reply review | Reuse these owners. They are not a reason to add another orchestration or attention system. |

Activation is not one switch: the low-level client requires `FLYD_JEV_ENABLED=true` **or** an explicit per-call key. Several view/chat consumers pass a key and have their own gates. Therefore a globally disabled flag is not evidence that no Jev caller can run. This audit does not change those gates or consent rules.

Model selection is also not uniform: the client defaults to `jev-latest`, while several judges and chat routing default to the pinned `jev-1.13.0`, unless overridden. Preserve and measure this deliberately rather than assuming one model is active everywhere.

The registry currently declares `answer_form.v2` with gallery/briefing. All 20 checked-in `answer_form` recordings are `answer_form.v1`, using `jev-1.13.0`. Running the existing offline System-1 replay bench confirms an existing failure: all 20 answer-form cases are rejected as stale. Those recordings do not validate the current v2 predicate or a future communication-intent predicate. No live accuracy or latency result for the proposed intent planner is claimed. Do not relabel old recordings or weaken the fingerprint check to turn this green; collect fresh version-matching measurements when the target predicate is settled and a live account is available.

## Credit failures: defect and implemented repair

Before this change, the client converted every non-2xx response to `jev_http_<status>`, discarding provider error details. Callers such as `answerForm` converted unsuccessful evaluations to `null`; the ordinary fallback could hide an exhausted account from George.

Provider documentation checked on 2026-11-23: [TypeSafe's 402 explanation](https://help.typesafe.ai/articles/5505198974) says insufficient available credit is the usual cause; [429 versus 529](https://help.typesafe.ai/articles/2769560962-what-is-the-difference-between-429-and-529) distinguishes rate limiting from overload. The implementation treats an otherwise unexplained 402 as an actionable credit/billing problem, rather than claiming to know the exact account balance. Additional structured/plain-text quota signals are defensive handling, not a claim about a separately verified TypeSafe error schema.

The repair stays at the shared provider boundary:

1. Classify credit/quota exhaustion separately from payment-required billing, authentication, rate limiting, network/timeout and unusable responses. Keep the existing failed evaluation and error string for callers.
2. Persist only safe aggregate health: state, timestamps, stable incident ID, failure category and HTTP status. No key, question, transcript, raw response or predicate payload is saved in this health file.
3. Log a new failure category. Repeated account failures retain one incident and one visible notice.
4. Project account problems into the existing notice column and the Mac island's existing status stream. Reuse existing heartbeats for cross-process changes; no new scheduler or alert owner.
5. Keep an account warning through disabled calls, policy denials and later transient failures. A successful real provider request clears it; recorded/offline replay cannot clear it.
6. Expose the last observed status through `flyd doctor` / `doctor --json` and authenticated Core `GET /runtime/jev/status`. This does not probe the account or invent a remaining balance.

Existing semantic/policy fallbacks and action authority are unchanged. The low-level provider error remains visible even if a higher-level caller discards its result.

The notice is a report of a last observed account problem. It is not a live billing balance. Core and the conversation view must be rebuilt/restarted to run the new code; checking out a commit does not deploy it on George's Mac.

## Recommended continuation

Three approaches were considered:

| Approach | Impact | Effort and risk | Decision |
|---|---|---|---|
| Add more kind-specific layouts / post-prose forms | Improves isolated displays | Small initial changes, but reinforces the original conceptual error | Do not use as the architecture |
| Generate arbitrary UI/code for each answer | Broad presentation freedom | Large validation, evidence-binding and interaction surface; hard to control/replay | Not the first implementation |
| Connect explicit communication intent to existing grounded renderers, then bounded composition | Directly addresses George's requirement | Incremental and reversible; can prove the distinction with the same-kind test | Recommended |

Concrete sequence:

1. Repair any **current** count/destination or inaccessible-failure bug using the semantic snapshot. Finish that contained change and leave the surrounding chrome alone.
2. Add an explicit communication-intent result to the existing semantic/answer path. Prepare bounded facts from existing claims, available evidence, alternatives and permitted actions, plus relevant user framing. Do not send a whole transcript to Jev.
3. Declare/version/evaluate the new Jev predicate in the existing registry/replay bench. It selects supported communication goals and a supported presentation strategy; it never writes arbitrary CSS or gains execution authority. Avoid a second generic presentation router.
4. Let the existing answer producer populate the selected plan directly from grounded content. For controllable Flyd answers, stop making completed prose the sole source for reconstructing structure. Keep plain-text input compatibility for external transcripts.
5. Connect the actual renderer to that plan. Start with existing comparison, image/evidence, result/document and short diagnostic capabilities; add bounded composition when a particular combination of goals needs it. Keep prose a valid deliberate choice.
6. Evolve the same object/plan in place when evidence or work state changes, preserving keyboard focus, evidence IDs and action targets. A presentation change must not create new work or confer a permission.
7. Run the actual Mac entry path and evaluate the rendered result before claiming completion.

Acceptance must include:

- Two inputs with the **same semantic kind** but different communication needs produce different appropriate manifestations.
- Inputs with different kinds but the **same communication need** can use the same suitable structure.
- A comparison preserves the actual options, criteria, recommendation and sources; a cause/evidence view preserves grounded cause, uncertainty, evidence and available fix.
- A real request travels through intent selection, validated plan, server transport and visible renderer. A helper receiving a hand-fed fixture is insufficient.
- Dynamic updates preserve object/evidence/action identity and focused controls.
- Unsupported, uncertain or invalid plans fall back without losing the answer or any user-owned decision.
- Credit/quota failure reports one actionable incident, with safe fallback, persistence and recovery; it is never counted as successful Jev selection.
- Predicate version/fingerprint/model match the recordings used to claim calibration. Live-provider and installed-Mac checks are reported separately from hermetic tests.

## Verification for this change

- Eight focused suites passed: 107 tests covering provider health, the existing Jev client, registry-adjacent answer/semantic contracts, island delivery and queued corrections.
- Registry and focused conversation-server checks passed: 13 tests, including real HTTP/SSE transport for the credit warning and existing Claude notice behavior.
- The existing page suite passed during the broader view run; existing conversation-server tests also passed apart from the new integration test's delivery-window expectation, which was corrected and verified in the focused run. Its one-minute shared delivery window is preserved, with stable incident IDs rather than new alerts per failed request.
- `npm run build` passed, including TypeScript compilation and the embedded work canvas build. `git diff --check` passed.
- `FLYD_JEV_EVAL=0 npm run evals -- src/evals/system-one-replay.eval.ts` remains red: one test fails because all 20 `answer_form` recordings predate the current predicate version. This is an observed pre-existing calibration gap, not a live-provider failure and not repaired by synthesizing recordings.
- No live TypeSafe request, account-balance check or installed-Mac build/run was performed.

Tests cover credit/billing versus rate limiting, sanitized persistence, deduplication, offline replay isolation, recovery, write failure, and real conversation-server transport to the notice column and island. Existing page coverage exercises the unchanged readouts and surrounding view.

An unrelated existing nullable executor in `command/cos/steer.ts` blocked typechecking and could dereference null when correcting a queued plan. The accompanying minimal guard omits the absent executor from pending deliveries; a regression test covers a correction before dispatch. This does not change manifestation or Jev policy.

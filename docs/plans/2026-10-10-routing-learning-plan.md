# Flyd routing: collection, classification and implementation plan
Date: 9 October 2026
Status: tooling implemented and locally verified on 10 October 2026; real-data calibration and Mac rollout pending.
Goal: make Flyd choose the right kind of response and domain owner from George's actual conversations, with inexpensive Jev decisions and measured fallback.

## Grounding and scope
Inspected main via GitHub on 9 October:
- cli/src/runtime/turn-plan.ts: existing answer/clarify/act/delegate routes, Jev route/domain/command-kind judgments, history recap, thresholds, and tool gates.
- cli/src/runtime/turn-receipt.ts: durable receipts with message, answer, tools and chosen plan; currently no complete classifier decision snapshot.
- cli/src/cognition/system-one/replay.ts: recorded/live predicate replay, fingerprints and abstention handling. Its fixture contract deliberately allows synthetic examples only.
- AGENTS.md: Core is TypeScript; Swift is a thin adapter. FirstMate owns coding, Librarian owns substantial knowledge work. Reuse the governed improvement loop.

References:
https://github.com/GeorgeGally/flyd/blob/main/cli/src/runtime/turn-plan.ts
https://github.com/GeorgeGally/flyd/blob/main/cli/src/runtime/turn-receipt.ts
https://github.com/GeorgeGally/flyd/blob/main/cli/src/cognition/system-one/replay.ts
https://github.com/GeorgeGally/flyd/blob/main/AGENTS.md

Do not replace this with a binary Flyd/Firstmate classifier. Decide turn route first; select the owner separately. Flyd remains George's voice throughout. This plan does not establish that the current deployment matches main or that Fable/Luna credentials are configured.

## Recommended approach
Compare the incumbent, Jev alone, fallback model alone, and Jev plus fallback on identical inputs. Implement the cascade inside the existing turn-planning boundary only if it beats the incumbent on routing errors with useful latency/cost savings.
Alternative: deterministic handling of explicit active-task commands before classification. Use this for known task IDs and clear cancel/status/continuation events; do not expand it into a keyword router.

## 1. Audit the actual dispatch path
Trace routeWithJev through the LLM room reader, planTurn, command hierarchy, domain handoff, and receipt persistence.
Confirm which model provides the current fallback and how uncertain Jev output is used when that fallback fails.
Inventory local receipt/session/task/correction sources and capabilities available to Flyd and each owner.
Record baseline model IDs, thresholds, projection, prompt fingerprints and environment gates without exporting secrets.
Deliverable: short integration map and baseline replay result.
Done when the implementation has one authoritative route decision and can identify the exact handoff triggered by each turn.

## 2. Collect routing evidence
Extend existing receipts with a versioned routing snapshot captured BEFORE dispatch:
- receipt/session/turn IDs, time, input source (voice/text), utterance;
- exact context projection seen by classifiers and its hash;
- preceding turns, active task IDs/owners/status, outstanding offer/question, available capabilities;
- Jev route/domain/command-kind output, all returned probabilities/confidence, model ID, latency, error;
- fallback output/model/latency, invocation reason, prompt/policy versions;
- selected route and owner, actual dispatch/task ID, dispatch acknowledgement;
- later outcome and explicit user correction linked as separate evidence events.

Store personal evidence privately under the existing Flyd data directory, never in the public repo. Apply existing egress policy to every hosted model, not only Jev; redact secrets and keep only necessary context.
Historical import joins receipts to session history where possible. Mark missing context explicitly; never reconstruct facts from later outcomes.
Live collection is append-only and nonblocking; collection failure must not break chat. Deduplicate receipt aliases such as latest.json. Preserve existing receipt readers through version migration or backward-compatible optional fields.

Deliverable: idempotent importer plus receipt instrumentation.
Done when historical import is rerunnable and a live turn can be replayed with exactly the original classifier input.

## 3. Assemble the initial dataset
Proposed pilot: 100 distinct real turns, selected across sessions and dates.
Use one representative sample for everyday performance and a separately reported challenge sample for rare failures. Include:
- ordinary conversation and questions mentioning code;
- explicit coding work, review, planning-only and "don't implement";
- Flyd-native quick actions and substantial knowledge work;
- yes/continue/do it with the preceding offer;
- status checks, corrections, priority changes and cancellation of active work;
- noisy voice transcripts, multiple intents and missing referents;
- strong route confidence paired with uncertain domain ownership.

Only use context available at decision time. Label route as answer/clarify/act/delegate; label domain separately using the existing domain types. Add target owner, command kind, active-task relationship, evidence sufficiency and reviewer rationale.
Do not label every question answer: an explicit code review or substantial research request may require delegation.

Split by session/task before prompt tuning, preventing related turns from leaking between sets.
Proposed pilot split: 60 development, 20 threshold validation, 20 sealed test. Small test results are diagnostic, not a production accuracy claim. Expand with fresh sessions before broad rollout.
Keep synthetic stress tests separate from measured real traffic.

## 4. Classify and review
Fable is the configurable label proposer and prompt author; Luna is the configurable candidate fallback. Resolve exact provider/model IDs during implementation; do not assume display names are callable API IDs.
Fable receives the same bounded decision-time context, capability contract and schema. It proposes labels, relevant evidence and ambiguity notes WITHOUT seeing Jev or incumbent predictions.
Validate structured output; invalid results remain unlabelled.
Queue all ambiguous cases, disagreements and explicit user corrections for review. George adjudicates cases depending on personal intent; a coding agent can review clear contract cases. Spot-check agreement cases too.
Record proposed labels separately from reviewed labels with reviewer, timestamp and rubric version. Unreviewed model labels never become gold.
Later corrections are strong evidence but not automatic labels: distinguish routing mistakes from changes of mind or execution failures.

Deliverable: private versioned JSONL dataset and a simple review queue using an existing surface.
Done when the pilot labels are reviewed and the sealed test is frozen.

## 5. Evaluate and tune
Reuse registry questions and fingerprints. Add a PRIVATE real-data evaluator beside the existing synthetic replay harness; preserve the synthetic-only fixture restriction.
Run incumbent, Jev alone, Luna alone, and Jev/Luna cascade against identical projections. Evaluate both individual predicates and final route/owner/active-task decisions.
Report:
- confusion matrices and precision/recall per route and owner;
- work incorrectly answered, conversation incorrectly delegated, wrong-domain handoffs;
- missed continuation/cancel/correction, unnecessary clarification, duplicate dispatch;
- error rates by confidence bucket, coverage, fallback reasons and rates;
- p50/p95 classification latency, usage and actual billed cost when available;
- counts, denominators and uncertainty intervals.
Separate classification accuracy, dispatch success and completed task outcome.

Tune prompts on development data only. Choose thresholds on validation data, by route/domain when sample size supports it. Do not assume 0.7.
Fallback when required judgment is uncertain, absent, invalid or inconsistent, or when sufficient context for delegation is missing. Strong route confidence does not compensate for an uncertain coding owner.
If Luna cannot establish intent, clarify; do not treat its self-reported confidence as calibrated.
Freeze prompt/model/projection/threshold versions before sealed-test evaluation. A failed test becomes development data only with a newly collected sealed test replacing it.

Deliverable: reproducible comparison report and candidate routing policy.
Done when improvement over incumbent is demonstrated with no unresolved critical regression; unknown costs remain explicitly unknown.

## 6. Implement the cascade
Reuse routeWithJev, the registry and current fallback reader rather than adding another parallel router.
Centralize the decision result: route, domain/owner, command kind, confidence signals, context sufficiency, source, fallback reason and policy version.
Keep the existing task relationship explicit: status/cancel/correction should refer to the active task rather than create a new job.
Evaluate fallback once per turn with a bounded timeout; validate its output against the same contract.
A fallback outage or malformed response must not promote uncertain output into permission to act. Use deterministic task handling where intent is established; otherwise clarify.
Preserve planTurn tool gates and domain handoffs. Separate existing authorization checks from semantic routing.
Retain original user wording and constraints in the FirstMate inbox message; use existing durable task IDs/idempotency mechanisms to prevent duplicate execution.
Keep model selection, thresholds and rollout mode configurable. Avoid overlapping calls that accidentally dispatch both candidates.

Proposed additions (names to adapt after audit):
- routing evidence/collector module alongside turn receipts;
- private dataset importer, label runner and review exporter;
- real-routing evaluation command alongside System-1 replay;
- validated fallback adapter reusing provider infrastructure.
No Rails implementation, new memory system or Swift classifier logic.

## 7. Verify and roll out
Meaningful tests:
- same utterance with different preceding offers yields appropriate routes;
- planning-only coding requests preserve "do not implement";
- route confident/domain uncertain invokes fallback;
- cancel/status/correction retain task identity;
- malformed output/timeouts/provider outage cannot start accidental work;
- private evidence cannot enter synthetic fixtures;
- retries cannot create duplicate FirstMate tasks;
- egress projection and prompt fingerprint replay remain consistent.

Stage A: instrumentation and baseline only.
Stage B: shadow candidate; incumbent alone controls dispatch. Shadow evaluation must never invoke execution tools.
Stage C: limited live cascade for cases with validated support; review every mismatch and high-impact error.
Stage D: wider rollout after fresh-session evaluation demonstrates acceptable behavior.
Rollback via one configuration switch to the incumbent; preserve evidence and existing task continuity.

Proposed release gates, not measured claims:
- no known critical regression in reviewed challenge cases;
- no duplicate dispatch and no permission bypass;
- candidate lowers material routing errors versus incumbent on fresh sessions;
- latency/cost/fallback report has complete denominators;
- uncertain domain or missing context never silently becomes coding delegation.

## 8. Continuous improvement
Feed failures into Flyd's existing governed evidence loop. Rank candidate review cases by explicit correction, confident disagreement, fallback frequency and repeated task patterns; also sample high-confidence successes.
Fable proposes prompt/policy changes against development data. Re-run fixed regressions and fresh sealed evaluation before promotion.
Version every release. Never let a judge automatically rewrite the live prompt.
Connect repeated routing corrections to the existing rule-of-three learning work; do not create a competing learner or mechanically hard-code ambiguous phrases.

## Implementation order and concrete first step
1. Audit dispatch and capability contract.
2. Add receipt snapshot and private historical importer.
3. Collect and review the first 100 examples.
4. Run comparison, tune prompt and measure thresholds.
5. Integrate validated fallback and task continuity.
6. Run tests, shadow, then staged rollout.

The smallest useful first delivery is the collector/importer plus a reviewable batch of 100 real turns and an incumbent error report. It should expose current mistakes before changing production behavior.

## 9. Periodic assumption audit (added 10 October 2026)
Use the existing daily self-improver, not a separate learner. Each audit samples both failures and apparently successful decisions, blind to the incumbent prediction while generating provisional labels. It also periodically replays reviewed assumptions with the current classifier.
- Daily bounded audit: import receipt history, sample new decisions across sessions and confidence bands, propose labels for review, and score reviewed decisions.
- Weekly revalidation: replay reviewed cases even when there is no new complaint; fresh judge disagreements challenge the label but do not silently relabel it.
- Keep prediction, proposed label and reviewed label separate. Missing historical context remains missing; success does not establish correct routing.
- Persist each audit report and link reviewed mistakes to the existing evidence IDs and one-fix-at-a-time improver.
- Prompt, threshold, context and provider changes remain versioned candidates. Re-test old regressions and fresh session-separated holdout data before promotion.
- Build review and evaluation commands now. Do not claim 100 real samples or empirical threshold calibration when this workspace cannot access George's installed private data.
- Audits never dispatch tasks, alter permissions or modify live prompts. Only the existing improvement pipeline owns implementation and release decisions.

### Validation findings
The Mac conversation window has a distinct binary ownership router in conversation-view/flyd-desk.ts. Instrument it as well as runtime/turn-plan.ts; preserve its explicit command/image path and add a configurable Jev-first cascade in shadow mode by default. Existing four-route context remains authoritative inside Flyd. Do not describe the entire conversation UI as already using the four-route harness.
The existing daily improver gathers failures but does not regularly revalidate successful routing assumptions. Its integration needs to run audits before the "no new evidence" return. Existing policy registry supports evidence-gated promotion and rollback; audits feed that governance rather than directly editing registry prompts.



## Implementation and validation record (10 October 2026)
Implemented private collection for Core chat and the Mac window; idempotent historical import; blind label proposals and explicit reviews with history; model benchmark predictions; reviewed-only evaluation; daily audit and weekly revalidation linked to the existing improver; challenge queues; audit locking; configurable judge/fallback models; and the window cascade in shadow mode by default.
Fixed uncertain delegation ownership and classifier failure behavior. Invalid action readings clarify rather than acquire authority. Automatic audits and improvement evidence exclude validation/test cases.
Validation: 30 focused native Node tests pass, including the actual Jev client and window routing paths; syntax checks pass on the changed TypeScript integration files. Added native tests to CI and expanded the existing routing CI checks. The existing Vitest suite could not run locally because Vitest/dependencies are unavailable in this workspace.
Not claimed complete: a 100-turn real dataset, empirical threshold/cost/accuracy measurements, configured Fable/Luna credentials, or a rebuilt/running Mac installation. Those require George's installed private receipt history and environment. Operations and commands are in docs/product/flyd-routing-learning.md.

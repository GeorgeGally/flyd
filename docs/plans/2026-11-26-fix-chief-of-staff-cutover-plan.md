---
title: Complete the Chief of Staff cutover
date: 2026-11-26
type: implementation-plan
---

# Complete the Chief of Staff cutover

## Goal Capsule

Make the running Flyd obey George → Flyd → Chief of Staff → domain bosses → specialists for delegated work and its reports. Flyd remains George's personal assistant, CEO, life coach, guru and mentor in one, and his sole voice. Finish this cutover before designing a separate writing team. George has authorized implementation; activation still requires the acceptance checks below.

### Role boundaries

- **George** sets the objective and makes decisions that need him.
- **Flyd, his personal and strategic partner** talks to George, preserves his intent, hands delegated work to the chief of staff, and presents results or decisions in context. Flyd continues to handle personal conversation and quick personal tools itself.
- **The chief of staff is an orchestrator.** It selects the appropriate team, briefs it, coordinates dependencies, monitors progress, reviews team reports against the objective, handles routine coordination, and brings real decisions and the final report back to Flyd. It does not perform the team's coding, design, research, or other specialist work. The chief of staff does not direct Flyd as its subordinate.
- **Domain bosses** such as Firstmate, the design team's leadership, and the Librarian own their domain outcomes and direct their specialists. They report to the chief of staff.
- **Specialists and workers** perform their assigned work and report through their domain boss.

Normal flow: George → Flyd → chief of staff → team boss → workers, then results return through the same chain. Routine progress remains inspectable, but is not presented as a finished deliverable.

## Product Contract

### Problem

The CoS exists behind an off-by-default flag. Older prompts, memory and Firstmate instructions describe Flyd as the CoS or Firstmate's direct manager; some conversation-view paths can address Firstmate directly. Flyd's recorded answers to George's question contained no tool calls and made contradictory claims. The existing split plan's final cutover is incomplete.

### Requirements

- R1. Flyd owns George's intent, personal conversation and presentation. CoS owns delegated intake, team selection, briefing, supervision, review, corrections and the objective report. Firstmate owns coding execution; other existing domain bosses retain their domains.
- R2. New delegated work and follow-ups from all normal Flyd surfaces reach the correct objective through CoS. Preserve original words, project and attachments, identity, context, corrections and idempotency. Explicit direct communication with Firstmate outside Flyd remains possible; a UI implementation shortcut is not such an instruction.
- R3. CoS reviews team outcomes and returns one authoritative report per objective to Flyd; routine worker activity is not promoted to a deliverable. George can inspect the underlying work when he asks, and genuine decisions remain actionable.
- R4. Flyd can accurately explain its own chain and actual runtime state using current evidence. A correction about that chain cannot become an unsupported claim of an implemented change.
- R5. Preserve active and historical work, in-flight decisions, current authorization gates, event receipts and safe handling of unknown outcomes. Do not create duplicate dispatches or lose results during cutover, rollback or restart.
- R6. The chief-of-staff path is the default once acceptance passes, with a clear operator kill switch. No automatic Node upgrade or unannounced restart of live work.
- R7. Existing short personal conversation, reminders and direct personal tools stay with Flyd; PRESENT remains offline and ephemeral. A separately designed writing team is out of scope.
- R8. The CoS never takes over specialist execution or presents itself as Flyd. Enforce this through tool capabilities and dispatch paths, not only role descriptions.

## Planning Contract

### Decisions

- KTD1. Use the existing objective store, CoS tick, domain transports and event spine. The CoS is a durable Core role, not a new window, process, queue or independent boss.
- KTD2. Centralize CoS enablement and make the default-on behavior explicit; retain `FLYD_COS=0` for emergency rollback. Audit every direct flag comparison and startup configuration so default semantics are consistent. Do not silently reinterpret active work when the flag changes.
- KTD3. Route a follow-up to the existing objective by durable objective/run/decision identity, not free-text guessing. When identity is absent or ambiguous, retain the input and resolve safely; never dispatch a second task simply to obtain an identifier. Keep image and file attachment handling intact.
- KTD4. Treat pre-cutover runs as legacy records. Let each finish through its existing owner and presentation rules or explicitly link it to an objective only after a verified one-to-one mapping. Do not bulk replay, recreate or mark old work complete. Keep rollback able to read and deliver already-created CoS objectives without orphaning their reports.
- KTD5. Distinguish an artefact or a completed deliverable from a worker status. Fix the incident from its actual source record and projection; do not assume that CoS review alone fixes its rendering.
- KTD6. The running Core's Node 22 can use legacy CoS recovery. AgentRun is separate and remains subject to its existing Node 24.22.3/package/live-effect checks; do not silently upgrade Node or conflate CoS activation with AgentRun activation.
- KTD7. Update tracked identity and instructions as one coherent change. Private user-owned SOUL and governed memory need their existing ownership and write gateway; inspect conflicts and provenance before proposing or applying any supported correction. Do not edit generated memory indexes.

### Source boundaries

The current architecture is documented in `docs/product/flyd-command-architecture-prd.md`; the earlier split design is `docs/plans/2026-10-30-flyd-chief-of-staff-split-plan.md`. Flyd's direct prompt paths include `cli/src/conversation-view/interpret.ts`, `flyd-brief.ts` and `cli/src/intelligence/executive/firstmate-decision.ts`. The window has multiple `ConversationSource` implementations: `claude-code-source.ts` sends some messages directly to the inbox, while `flyd-source.ts` has different behavior. Determine which source is installed for each real surface before changing it.

## Implementation Units

### Implementation status — 26 November

The role prompts, live CoS status, targeted steering, attachment references and CoS-owned crew reporting have local changes and focused automated coverage. The cutover is incomplete: `FLYD_COS=1` is still required. The jobs board reads Firstmate fleet items independently of CoS reports, and the available fleet task metadata does not establish which inbox request and objective created each worker. Domain-run IDs alone do not identify every fleet card. Establish that durable lineage through the supported Firstmate interface, then project reviewed CoS reports while retaining legacy work and actionable decisions. Do not infer ownership from names or hide the entire fleet. Trace the original page-capture event before claiming that specific card is fixed. Complete the remaining governed instruction/memory review and installed-Mac acceptance before default activation.

On 27 November Firstmate accepted the request-provenance task. Flyd now has local changes to project objective reports and use exact `request_id` links in the proposed Firstmate snapshot, with tests for legacy records, unanswered decisions, and a dispatch whose receipt is not yet saved. Firstmate's follow-up branch binds before task creation and blocks backlog handoffs of bound tasks; free-text routing to a secondmate remains guarded only by instructions. Firstmate has not yet returned a final reviewed result or integrated the branch. Its snapshot can also report provenance omissions, which Flyd must handle before treating an unbound row as legacy. The running Firstmate and installed Flyd have not yet been cut over. A full Flyd suite reported 5,192 passing tests, three failures reproduced on an untouched baseline, and an unrelated vendored suite failing to load; the final decision-predicate wording was separately replayed after that run began.

### U1. Characterize the real paths and protect existing work

- Map installed Mac chat, artefact comments, quoted passages, decisions, follow-ups, LIVE task intake and scheduled deliveries to their actual source implementations, recipient, objective ID, run ID and report projection. Inspect production configuration and in-flight records read-only; record counts and state without exposing private content.
- Trace the actual page-capture incident from the source event through the fleet projection and screen. Establish a reproducing fixture before assigning the card a cause.
- Add focused behavioral characterization for direct and CoS paths, especially attachments, a running legacy request, a pending decision and restart with an unknown dispatch outcome. Do not dispatch real workers in tests.
- Verify the old path and intended CoS path can each be observed with controlled inputs. Record any surface that cannot be tested and why.

### U2. Make role instructions and factual self-knowledge coherent

- Update `cli/src/lib/soul.ts`, the relevant active prompts and tracked product/agent instructions to name the agreed hierarchy and roles, while keeping the companion prompt lean. Audit `cli/src/cognition/system-one/registry.ts` and its replay benchmarks before changing predicate wording; preserve safety gates.
- Review Firstmate's actual instruction entrypoints and durable notes; update the appropriate tracked sources in its own repository through its supported workflow, with the original scope and attribution preserved. Do not claim Firstmate learned something based solely on its message.
- Trace the contradicted local memory entries to their sources and use the governed correction path where appropriate. Do not overwrite user-owned `~/.flyd/SOUL.md` or user memory directly.
- Extend the existing self-setup/evidence route in `cli/src/runtime/conversation-responder.ts` and `cli/src/runtime/read-the-room.ts` as needed so questions about Flyd's own command chain and its enabled state use live evidence or explicitly admit uncertainty. Avoid turning ordinary conversation into a repository inspection.
- Regression: replay the two reported turns; Flyd identifies itself and the chain correctly and does not claim a switched-off component is running, or that a correction changed configuration.

### U3. Route work and steering through the CoS

- Consolidate the switch semantics in `cli/src/command/cos/objectives.ts` and all `FLYD_COS` call sites in runtime, server and conversation view. Ensure new delegated chat and LIVE work create durable objectives through `hand_off`; preserve existing supported personal capabilities and safety policy.
- Audit the CoS's actual callable tools and fallback paths. Its authority is to select, brief, monitor, review and steer teams; specialist execution must be performed by the appropriate team. Preserve existing personal tools on Flyd and the distinct domain-boss ownership of execution.
- Route artefact comments, selected-text replies, task and decision replies, undo and follow-up interactions via the objective/steering boundary when they are part of Flyd's conversation. Keep explicitly addressed independent Firstmate sessions distinct. Follow `executive-source.ts`, `flyd-source.ts`, `project-threads.ts`, `server.ts`, `claude-code-source.ts`, and `cli/src/command/cos/steer.ts` to the actual installed route before choosing edits.
- Maintain the original words, attachment references, session and project scope, request IDs and return receipt. Wire existing decision resolution to the correct objective rather than duplicating decision state. An ambiguous link must not be guessed.
- Verify coding, knowledge and design handoffs and follow-ups with fake transports; assert one objective, one dispatch per ID, correct boss and preserved inputs. Include replay, process restart and unknown-effect cases.

### U4. Make CoS reports authoritative and fix presentation leakage

- Establish durable, explicit links from each CoS objective to its domain request and the Firstmate tasks spawned for that request. Firstmate's fleet snapshot currently omits that request-to-task identity, so the supported Firstmate interface and its tests must carry it. Preserve unknown and legacy records without guessing or hiding them.
- Reconcile `cli/src/command/cos/tick.ts`, `cli/src/command/scheduler.ts`, `cli/src/conversation-view/executive-source.ts`, `interpret.ts`, `show.ts`, `semantic.ts` and `artefact.ts` so objective-owned outcomes have one authoritative review/report and Flyd presents that report once. Keep raw records available for inspection, with provenance, instead of overwriting them.
- Introduce the actionable CoS-report and decision projection before removing a corresponding raw card. A real unanswered decision must remain visible and route back to the correct objective, including while recovery or rollback is in progress.
- Audit known exceptions, including compatibility crew delivery, existing direct runs, fleet-monitor follow-ups and the Needs you projection. Route normal delegated results through CoS without suppressing legitimate decisions or hiding failed and unresolved work. Maintain safe behavior when the review service or report delivery fails.
- Fix the evidenced page-capture-to-card path. A routine progress event should remain activity; a genuine deliverable or decision should remain visible and actionable. Do not remove the ability to inspect progress on request.
- Exercise duplicate events, concurrent reporters, retry/restart, no-model/failure paths, old runs and CoS-owned runs. Verify one delivery and no raw routine update promoted to an artefact.

### U5. Cut over safely and verify the installed app

- Before activation, inventory the actual Core process, config, in-flight legacy runs and pending decisions. Confirm the no-duplicate migration and rollback rules in a disposable copy of the state. Do not disturb running work; do not turn historical records into new dispatches.
- Make the supported Core default to CoS on, with `FLYD_COS=0` as an explicit rollback. Ensure already-created CoS objectives can still settle or be safely resumed after rollback and re-enable. Document what rollback does to new and existing work.
- Run the focused behavior suites, the relevant command/runtime/conversation-view tests and applicable `npm test`, `npm run lint`, `npm run build` from `cli`; identify baseline failures by comparison. Check that source and compiled distribution match before any installed claim.
- After implementation is authorized and tests pass, choose a quiet cutover moment, follow the supported Mac install/start path, and confirm the actual serving Core's configuration and version. Verify one controlled real workflow and follow-up through objective → domain receipt → CoS report → Flyd screen, with no duplicate work; verify routine activity and an actionable decision separately. Avoid actual outward actions.
- Check conversational quality and latency against the existing split plan's baseline where available, and report any limits. Independently verify Node/AgentRun status; CoS success does not prove AgentRun is enabled.

## Verification Contract

| Scenario | Observable result |
| --- | --- |
| Ask who does what and whether CoS is running | Correct hierarchy and evidence-backed live status; no invention. |
| Delegate a coding, knowledge or design task | One durable objective; correct boss receives exact words, context and supported attachments. |
| Trace who performs the work | CoS coordinates and reviews; the domain team and its workers perform the specialist work. |
| Correct the task from chat, artefact or decision | The existing objective and intended run receive it once; ambiguity does not spawn work. |
| Worker sends a progress update | No deliverable card or user-facing report is fabricated from routine progress. |
| Work completes or needs a real decision | One CoS-reviewed report reaches Flyd once; source detail and actions remain available. |
| Restart, retry, disable or re-enable | Existing work and pending reports remain recoverable; unknown effects do not automatically retry. |
| Legacy work exists during cutover | It completes or stays actionable without replay, duplication or lost decisions. |
| Quick personal conversation or tool | Flyd handles it without unnecessarily dispatching the CoS. |

## Definition of Done

The supported installed app uses the intended hierarchy for the covered surfaces; instructions and governed records agree; old and new work remain intact; reports and cards reflect verified outcomes; representative automated and on-Mac checks pass or limitations are explicitly recorded. The writing team is a separate subsequent task.

## Remaining execution plan — 27 November

**Outcome:** delegated requests, decisions, and final reports follow George → Flyd → chief of staff → domain boss → specialists and back. Flyd remains George's PA, CEO, life coach, guru and mentor; the chief of staff orchestrates, and the teams do the specialist work. The writing team is a separate later task.

1. **Make ownership uncertainty explicit.** Inspect Firstmate's `fm-bearings.v1` request-provenance omissions and Flyd's `cli/src/conversation-view/artefact.ts` fleet parsing, persisted ledger, recent-backlog fallback and executive decision paths. Preserve the authoritative raw records and legacy visibility, but never route an unverified worker update or decision around a CoS objective when ownership cannot be determined. Add behavioral coverage in `cli/src/conversation-view/__tests__/cos-fleet.test.ts` for unavailable, damaged, missing and healthy bindings, multiple objectives, old cached rows, recovery, and legacy work. A provenance gap must not settle, promote or discard a decision; show an honest unavailable state where necessary.
2. **Complete the Firstmate contract.** Review the final response and actual diff for `fm/request-provenance`; verify binding is persisted before task visibility, survives lifecycle transitions, distinguishes unreadable from unbound, and is enforced for every route to secondmate work. A prompt-only prohibition on forwarding by free text is not a durable lineage guarantee. Coordinate through the already authorized Firstmate task, preserve other work, and use only a reviewed, integrated contract. Test retries, concurrent requests, children, legacy tasks, and snapshot omissions. Do not assume the Firstmate branch is deployed.
3. **Audit all user-facing and input routes.** Trace chat, LIVE, task intake, artefact comments and decision replies through `runtime/turn-plan.ts`, `runtime/conversation-responder.ts`, `conversation-view/server.ts`, `commands/view.ts` and `command/cos/`. Trace Firstmate transcripts, fleet snapshots, notifications, old work, cached rows and objective reports back to their origin. Add targeted tests where a route can bypass CoS; preserve explicit direct Firstmate conversations and exact original input and attachments. Confirm CoS cannot execute specialist tools itself and only its reviewed objective report reaches Flyd as the result.
4. **Confirm role and memory consistency.** Verify current default soul, self-setup, classifier prompts and active Firstmate instructions describe the separate roles and truthful enabled state. Re-run pinned System-1 replay for changed classifiers, without treating user text or model claims as proof of configuration. Trace any conflicting memory through the governed correction path; do not edit user-owned memories or generated indexes directly.
5. **Prove integration before changing defaults.** With fake transports and isolated homes, exercise an objective end to end: initial input, one dispatch, worker progress, routine internal decisions, a genuine decision and answer, specialist report, CoS review and final Flyd response. Include restart, duplicated delivery, ambiguous request ID, unknown effect, missing binding and an existing pre-cutover job. Cover coding, design and Librarian transports. Existing work must not be silently reclassified. Run focused tests, typecheck, build, relevant replay, and inspect the resulting diff; record pre-existing suite failures separately.
6. **Cut over and verify the actual product.** Only after the provenance and all-path gates pass, make CoS default-on with explicit `FLYD_COS=0` rollback, reconcile pre-existing work, rebuild the installed Core and safely restart when no live task would be interrupted. Verify the actual serving process and its configuration, perform an on-Mac end-to-end check, and confirm rollback and retained old work. Do not claim AgentRun is active unless the actual Node version and pinned package qualify. Keep first-party code on `main` and report any remaining external dependency or unavailable on-Mac acceptance accurately.

### Additional findings for execution

- `~/.flyd/MEMORY.md` currently contains conflicting role and reporting-line entries; `cognition/context-compiler.ts` includes the curated memory in the personal prompt. The current knowledge-repair scope does not cover role identity. The existing `applyMemoryOps` writer also performs unrelated decay and budget eviction as part of any operation, so do not rewrite the live file or use it blindly. Identify the authorized correction transaction and ownership, preserve attribution and unrelated entries, and verify all prompt and retrieval readers use the correction.
- Firstmate's proposed snapshot discloses unreadable provenance in `omitted[]` and has no request lineage for secondmate rows. An empty or failed objective lookup is not an empty set of owned requests. The interim Flyd projection withholds unverified fleet and machine-origin wake reports, and therefore can also withhold independent secondmate updates; it is a safety fallback, not the target user experience.
- Reviewed reports and objective ownership are separate facts. A missing or wrong report must leave an objective incomplete without exposing a raw domain run; ownership filtering must not depend on a report being present.

### Execution status — 27 November (branch `fm/flyd-cos-cutover`)

Steps 1, 3, 4 and 5 and the code part of step 6 are implemented in Flyd; step 2 (Firstmate provenance contract) and the installed cutover are not.

- **Step 1.** Ownership uncertainty stays explicit: damaged `request_id` types, several objectives' requests, a provenance gap across refreshes (nothing settled, decided or dropped, then restored) and an objective's raw decision kept from the executive step are covered in `cos-fleet.test.ts`, beside the existing unavailable, missing, cached, secondmate and legacy cases.
- **Step 3.** Route audit. Chat, artefact comments, quoted passages, decisions, undo, routines and follow-ups all reach Flyd's responder through `FlydConversationSource` (the installed view); LIVE task intake opens an objective; the realtime relay and mobile cannot delegate. Fixed bypasses: an unattended agenda run now hands team work to the CoS (`hand_off`) instead of starting it directly, and a worker's background job cannot start new team work; `domain_work ask` is refused off George's own turn; a design-board follow-up of objective work is adopted by an idempotent follow-up objective (`adoptFollowupRun`) so the CoS reviews and reports it; a recorded-decision answer for objective work goes through its objective even after its run settled, and no answer opens new Firstmate work while CoS ownership is unreadable; the executive step does not send staff notes for objective runs. Left by design: CLI commands (`flyd crew dispatch`, `flyd work --start`, `flyd code`), Flyd-internal maintenance (self-improvement, knowledge re-checks, closing overtaken or retired holds) and explicit `flyd view --session` Firstmate sessions with slash commands.
- **Step 4.** The default soul, self-setup evidence line and prompts name the separate roles and report the serving Core's state. No user `SOUL.md` exists. Three curated memory entries conflict with the chain; corrections are proposed only and were not applied; a governed correction path is out of scope. No classifier wording changed, so no System-1 replay was re-run.
- **Step 5.** `command/__tests__/cos-end-to-end.test.ts` drives `hand_off` → CoS tick → FirstMate's real transport over a fake inbox exec, the Librarian with recorded specialists and Design Mate with a recorded start: one dispatch per request id across restarts, progress kept backstage, a genuine decision asked once and answered once, one reviewed report, a pre-cutover run left legacy, an ambiguous correction refused, an unknown dispatch only ever looked up by replay, a board follow-up adopted once, and `FLYD_COS=0` rollback and re-enable.
- **Step 6 (code only).** `cosEnabled()` is on unless `FLYD_COS` is `0`, `off`, `false` or `no`. Tests keep the legacy path unless they opt in (`vitest.setup.ts`). With CoS on by default, a Core on Node older than 24.22.3 reports `nodeUpgradeRequired`, so the Mac's Update Node prompt appears once; AgentRun itself remains inactive there. Not done: rebuilding and restarting the installed Core, verifying the serving process, and on-Mac acceptance.

# Flyd: conversational initiative and personal presence

Date: 15 October 2026  
Status: implementation plan; runtime changes and deployment are not part of this commit.  
Owner: George Galanakis  
Reviewed source: `GeorgeGally/flyd`, main at `38ef5b99932ca933a8eda30744fe62eb440a861f`.  
Scope: recommendations 1 and 2 from the personal-agent discussion: conversation that leads to useful work, and a warmer, perceptive full-life relationship with Flyd.

## 1. Outcome and decision

George can talk naturally about his day, ideas and concerns. Flyd responds with judgment, warmth and relevant continuity; when an established goal and existing authority make useful preparation appropriate, it prepares something concrete without requiring another command. Explicit requests still take the normal action/delegation path. Finished work returns as a useful artefact or a short, grounded answer. George can redirect, stop or question the work in the same conversation.

Implement this by extending the existing conversational executive and execution boundaries. Keep one TypeScript Core, one voice, the canonical event spine, existing domain bosses, the current action policy and the existing improvement loop. Make companion behavior work on both the confident fast path and the fallback reader. Integrate LIVE as another client of that executive, with one owner of the spoken answer.

The central architecture decision is to separate **the response George needs now** from **a bounded preparation opportunity**. An answer turn remains unable to mutate through its model tools. A separately authorized preparation attempt can accompany it, with explicit provenance, scope, budget and an existing execution owner. This avoids changing every concern into a work request or weakening the answer-route gate.

The first useful delivery is a local preparation artefact from a conversational concern in an already-authorized workstream, followed by an accurate return and a working stop/correction path. It does not depend on mobile deployment, a new model, a new avatar, broad autonomous sensing or an additional manager organization.

## 2. Current goals and authority

Read these sources in this order when implementing:

1. [AGENTS.md](../../AGENTS.md): one primary presence; TypeScript Core; thin Swift adapter; main as source of truth; one voice; no added approval bureaucracy.
2. [Personal intelligence PRD](flyd-personal-intelligence-prd.md): full-life personal intelligence; shared runtime across interfaces; events and epistemic separation; source consent and exact action authority; verified outcomes.
3. [Command architecture](flyd-command-architecture-prd.md): Flyd owns intent and cross-domain judgment; FirstMate owns coding; Librarian manages knowledge work; original words and layered results survive handoffs.
4. [Chief-of-staff standard](flyd-chief-of-staff-standard.md): grounded outcomes, real status, internal decisions handled backstage, scanable artefacts, George's chosen voice.
5. [Optimistic decisions](flyd-optimistic-decisions.md): ambitious goals, useful experiments, reasonable assumptions, targeted research and friction measured alongside quality.
6. [Routine artefacts](flyd-routine-artefacts.md): reusable requests and submission receipts already exist; they grant no permissions and delivery is not success.

### Goal hierarchy for this work

| Goal | Consequence for implementation |
|---|---|
| Help George think better and create stronger work | A useful disagreement or conversation can succeed without producing a task. |
| Reduce the burden of directing an assistant | Prepare autonomously inside established scope; do not repeatedly ask whether to research or draft. |
| Know George across life and work | Personal conversation stays useful even when no repo, deadline or output is involved. |
| Maintain optimism and creative range | Existing preferences guide execution; they cannot silently rule out a new ambition or unfamiliar approach. |
| Retain trust through accurate action and memory | Keep source words, inference, authority, execution and verification distinct. |
| Make the interface serve the moment | Short conversation in chat/voice; a richer artefact when there is something worth inspecting. |
| Compound learning | Corrections and outcomes feed the existing governed learner; no engagement optimizer or second learning store. |

### Stale guidance to reconcile

`STRATEGY.md` is dated 2 August and still excludes mobile, messaging and a general background assistant. The July personal-agent-platform PRD still describes Rails and a coding-harness-first product. Root `SOUL.md` describes a work-only overlay. These conflict with newer product authority and implemented capabilities. They are historical context, not reasons to narrow this feature to coding.

The runtime voice is loaded by `cli/src/lib/soul.ts` from George's private `~/.flyd/SOUL.md`, with `DEFAULT_SOUL` as fallback. Root `SOUL.md` is not evidence of his installed private voice. Phase 0 should add concise authority/supersession notes to outdated repository documents and align the root voice reference, preserving useful principles. Never overwrite his private SOUL.md or USER.md as a migration side effect.

The [Hetzner/mobile plan](flyd-mobile-hetzner-implementation-plan.md) is an adjacent implementation track. Its source document establishes a plan, not a running server. Integrate against current main before implementation; do not infer deployment or migration status from that document. This work should expose a transport-neutral conversation contract that the mobile track can consume.

## 3. Where we are: source-backed review

The review is of committed source, not George's installed app or private configuration. No production model evaluation, installed-Mac test, server inspection or live connector mutation was performed for this plan. Existing tests and documentation show intended contracts; their current pass status has not been rerun in this partial source snapshot.

| Area | Observed on reviewed main | Gap relevant to this plan |
|---|---|---|
| Voice and identity | `lib/soul.ts` already asks for warmth, opinions, specificity, initiative and lighter evenings. | More personality text alone will not solve the execution/routing conflicts. |
| Room reading | `read-the-room.ts` represents vent/think/decide/do/ask/chat, companion/operator, selected memory, stance and avoidance. | `act` must be null on answer/clarify; a conversational opportunity has no separate representation. |
| Fast path | `turn-plan.ts:routeWithJev` batches route, code need, domain, command kind, skill and relevant notes. Confident readings skip the slower room reader. | `need`, `stance` and `avoid` from the full reader do not exist on this path. Companion work only in `roomBrief` would miss it. |
| Route enforcement | `planTurn`, `visibleTools` and `offRoute` keep answer turns read-only, with explicit existing exceptions such as read-only handoff. | Allowing arbitrary background tools on answer turns would reopen the failures this harness fixed. |
| Conversation view | `flyd-desk.ts` performs ownership routing; Flyd answers invoke the shared responder. Its default cascade is shadow, with fallback ownership classification. `FlydDesk.ask` records asks and asynchronously answers them. | A turn can encounter desk routing and then responder routing. The Answerer signature does not carry source turn identity; in-flight state is process-local. |
| LIVE | `realtime-session.ts` starts its own provider conversation, compiles initial context, and calls `resolve` with a model-written intent marked `intent_author: model`. | It does not feed completed user transcription events into the shared conversation responder. Session-start context is not per-turn continuity. One-to-one task, receipt, cancellation and answer ownership need integration. |
| LIVE effects | `buildResolveToolOutput` returns planned operations and augmentation content; the adapter receives `resolution_result`. | Resolution is not an execution acknowledgement. Spoken completion must wait for the relevant actual effect/verification receipt. |
| Domain work | Command types, FirstMate transport, Librarian manager, durable messages and detailed/raw results already exist. Librarian currently starts Retriever and Researcher, then a Fact Checker. | An inferred preparation needs explicit origin and narrower inherited scope; a copied source quote must not become an instruction by attribution. Small prep must not inherit mandatory research fan-out; native reconciliation must recognize the background job's `blocked` state. |
| Background jobs | `background-jobs.ts` persists jobs; an independent checker and `acceptance.ts` gate completion on done_when evidence; process leftovers count as unresolved. | `JobContract` carries task/criteria/path, not inherited source/egress/effect scope. Unattended turns bypass conversational TurnPlan. It is not safe to reuse unrestricted for implicit preparation. |
| Tool policy | `tool-policy.ts` enforces current action/approval categories. | Its broad `local` category includes email drafts, Google Doc composition, memory and schedules. That category is not a preparation capability whitelist. |
| Corrections/cancel | `command/messages.ts` preserves message text and correlates it to a uniquely matching active domain run. | IDs are currently derived from body/kind/run; distinct intentional identical instructions can collapse. Coding cancel changes state on delivery, not a stop acknowledgement; knowledge delivery is not an immediate specialist interrupt. |
| Canonical events | ContextEnvelope, IntelligenceEventStore, transactional append/deduplication, projections and source erasure exist. | Validation is not proof of worker enforcement. The inspected AuthorityLedger is in-memory; persistent recovery and live revocation cannot rely on its object lifetime. |
| Learning | Conversation source capture and content learning keep provenance and inferred claims. Separate profile learning can write extracted facts into highest-authority USER.md. | Do not expand that automatic promotion path to new conversational sources. Temporary feelings and inferred commitments must stay distinct from durable preferences and user instructions. |
| Quiet initiative | Muse/advisories and room private notes already offer contextual suggestions and deduplication. | Coordinate them with new preparation results; avoid a second aside or duplicate notification for the same topic. |
| Self-review | Chief-of-staff checks and opt-in Jev review feed the existing improver. | The current work/status-focused standard needs interaction context so ordinary conversation is not forced into action/result language. Preserve local review and provider-egress restrictions. |
| Routines | Main now contains event-backed explicit repeated-request discovery, editing, inputs and submission history. | A concern, generated suggestion or inferred prep must not count as another explicit routine request. Do not broaden discovery or add auto-run through this feature. |

The practical deficit is inconsistent behavior and missing contracts between mechanisms that already exist. It is not a lack of a memory system, a scheduler, a persona, or task execution.

## 4. Alternatives and chosen approach

| Approach | Impact | Effort | Main risk | Reversibility |
|---|---|---|---|---|
| Add stronger warmth/initiative prompts to every surface | Small early voice improvement | Small | Fast-path omissions and route conflicts remain; false promises become more likely | Easy |
| Start a separate companion/opportunity agent after every turn | Can notice loose ends | Large | Duplicate judgments, extra delay/cost, independent memory, unsolicited work | Difficult after state diverges |
| Extend shared turn understanding with a bounded preparation decision | Direct conversational and practical benefit | Medium, staged | Requires worker scope, provenance and cancellation to be enforced | Good through independent rollout controls |

Choose the third. Move lifecycle, effects and routing into shared code. Keep genuinely semantic judgment in the existing batched reader/model path. A companion is how Flyd relates to George, not another boss, conversation database or provider loop.

## 5. Product contract: what should happen

Examples below are proposed acceptance scenarios, not claims about actual accounts or current tasks.

| George says | Immediate response | Work behavior |
|---|---|---|
| “Long day.” | A natural, brief response; relevant context only if actually known. | No invented deadline, task, reminder or profile update. |
| “The Christmas sponsor still hasn't replied.” | Recognize the specific concern without stock empathy. | If an active sponsorship goal and prep remit apply, check already-authorized evidence and prepare a local follow-up artefact. Otherwise one useful offer if appropriate; no repeated permission ritual. |
| “I'm just venting about it.” | Listen; no management checklist. | Suppress new preparation for this conversational episode. This alone does not cancel an independently authorized job. |
| “Don't do anything about the sponsor yet.” | Acknowledge the actual boundary briefly. | No inferred prep on this topic until an explicit revision. No reminder or delayed retry designed to bypass the instruction. |
| “Don't contact them.” | Respect the communication boundary. | Local drafting may still fit an established remit; sending and remote draft writes remain separately governed. |
| “I wonder if the event should be smaller.” | Help think through it; offer an honest point of view. | A bounded comparison may be useful inside an existing prep remit. Never change bookings, plans or confirmed priorities on this speculative statement. |
| “Find out where it stands and draft the follow-up.” | Start the clear request without optional-detail questions. | Existing knowledge/operations path, original words, checkable criteria and current policy. |
| “Make it more Scandinavian.” | Interpret as a correction to the uniquely identified active design work. | Deliver exact words before a slower interpretation; revise that job, not every future preference. |
| “Actually, leave it.” | Resolve the referent from the conversation; clarify only if materially ambiguous. | Revoke new prep for that item and request stop. Say stopped only after acknowledgement/quiescence. |
| “We changed our mind. Try the weird version.” | Engage with the new creative direction. | Current intent overrides old taste assumptions; do not silently return to the familiar design. |
| “Why did you start this?” | Explain the source concern, linked goal and applied remit in plain language. | Read existing decision/receipt; do not invent an explanation after the fact. |

Success includes a satisfying conversation with no work attached. Preparation must earn its place by addressing the current context, not by turning a day into a backlog.

## 6. One shared turn contract

The following names are proposed implementation shapes, not existing exported APIs.

Extract shared turn preparation/orchestration from `conversation-responder.ts` behind a `ConversationTurnInput` / `TurnUnderstanding` contract. The existing responder remains responsible for model/tool execution. Adapters provide input, render output and execute granted device effects; they do not decide authority.

```ts
interface ConversationTurnInput {
  turnId: string;             // stable across delivery retry, not a content hash
  sessionId: string;
  surface: "chat" | "view" | "invoked_voice" | "live";
  source: {
    kind: "typed" | "provider_transcript";
    text: string;            // exact received text, before a model rewrite
    final: true;
    providerItemId?: string;
    revision: number;
    evidenceRefs: string[];
    consentRef: string;
  };
  receivedAt: string;
  timezone: string;
  conversationRevision: number;
}

interface TurnUnderstanding {
  route: "answer" | "clarify" | "act" | "delegate";
  need: "vent" | "think" | "decide" | "do" | "ask" | "chat";
  domain?: "coding" | "knowledge" | "creative" | "life" | "general";
  interactionClass: "conversation" | "work_status" | "decision" | "deliverable";
  selectedContextRefs: string[];
  stance?: string;
  avoid?: string;
  preparation?: {
    sourceSpan: string;
    goalRef: string;
    outcome: string;
    reasonNow: string;
  };
  policyRevision: string;
}
```

The transcript is evidence of what the speech provider recognized, not proof of perfect transcription. Preserve that provenance, source revision and uncertainty. Do not fabricate confidence if a provider supplies none. Original audio remains unstored. A corrected transcript creates a revision/supersession rather than editing the earlier receipt into something George supposedly always said.

### Routing and latency

- Reuse the existing Jev predicate registry, thresholds and replay tooling. If additional bounded judgments for need/preparation are justified, batch them into the same call; validate each independently. A confident route does not automatically establish confidence in a preparation or target.
- Keep the configured full-reader fallback for genuine ambiguity. Do not restore a mandatory slow full-room call for every turn merely to obtain a warmer stance.
- Companion quality must work with only the compact shared voice/context on the confident path. Rich `stance` and `avoid` enrich it when present.
- Pass trusted internal routing results from desk ownership into shared orchestration with a turn hash/identity and policy version. Browser-supplied route or grant fields are never authoritative. Re-evaluate only when content, context, ownership or policy materially changes.
- Instrument desk routing, understanding, retrieval, first text/audio, dispatch acceptance and verified return separately. No extra mandatory serial classifier or review model on ordinary chat.
- If understanding fails, answer naturally with available evidence and no inferred side effect. A classifier outage must not make casual conversation a forced clarification form.

## 7. Initiative: preparation within an existing remit

### 7.1 Separate interpretation from authority

The model may propose a preparation candidate. Deterministic code decides whether it can run from the current goal, source consent, existing authority, target, active work, exclusions and budgets. An inferred concern does not create permission.

There are three origins, kept explicit end to end:

| Origin | Authority basis | Behavior |
|---|---|---|
| Explicit request | George's actual turn plus existing policy | Normal act/delegate; no extra feature-specific approval. |
| Preparation under an established remit | Existing goal/remit and allowed effects; the current turn is evidence of relevance | Bounded preparatory task can begin beside the answer. |
| Interesting but ungrounded opportunity | No applicable authority or concrete goal | Conversation or one useful offer; no durable commitment or speculative task tree. |

A remit is an understandable scope of work, such as preparing material for an already accepted sponsorship objective. Its source is George's existing instruction or a one-time explicit preference that authorizes that scope. A project name, an attached document, a mood, a learned taste rule, routine activation, or a model summary cannot establish it. If existing instructions are sufficiently scoped, derive the machine contract from them without asking again. If a new standing scope is actually needed, offer it in context once and keep it inspectable/revocable in existing preferences. Do not add an onboarding wizard or mandatory configuration before explicit requests can work.

### 7.2 Eligibility decision

For an implicit preparation to run, all of these must be true:

1. Input is an explicitly submitted finalized turn from George, not external content, a partial transcript, assistant output, an imported conversation or passive PRESENT sensing.
2. A live goal/remit and exact evidence refs justify the work. Current instructions and no-action exclusions outrank inferred opportunities and older taste.
3. The candidate has one useful bounded deliverable and a short why-now rationale. It is not another representation of an active job or an already prepared result.
4. The source/retention and provider-egress contracts permit this use. Permission to read an account or use a microphone does not imply permission to persist its contents or send them to another provider.
5. A preparation-specific effect scope is enforced at dispatch, worker entry, every tool call, verifier, repair and result publication.
6. The work fits reserved concurrency, token/tool/time limits and the current provider budget. If it does not, use the conversational path or a smaller scoped preparation.

Explicit “just venting” and “don't do anything” are decisive suppression signals for the relevant episode/topic. A semantic vent label alone must not become a universal ban on useful assistance in an otherwise explicitly authorized workstream; use the actual instruction and context. Do not reinterpret fatigue as cancelling prior commitments.

### 7.3 Effect scope, not the broad local category

The first preparation scope permits selected reads under existing source contracts and writing a new artefact into a job-specific local output root. The scope must contain approved context refs, sources/accounts, actual provider-egress destinations, effect/target constraints, expiry, budget and a source authority ref. It is inherited and can only narrow downward.

It does not authorize arbitrary shell, repo edits, installs, AppleScript, cloud drafts, Google Doc creation, sending, purchasing, publishing, deleting, reminders, schedules, profile changes or preference changes. Current tool-policy classification of a capability as `local` cannot substitute for this whitelist. Keep normal explicit-task behavior unchanged.

For research, permit approved search/read adapters only when the remit and source egress permit them. Avoid private text in public search queries. Connected-account material stays untrusted evidence and is minimized before model access. The first vertical slice can use already supplied context and selected local evidence, producing a local draft with no connector write.

The inspected authority ledger provides useful validation shapes but stores grants in memory. Durable remit/revocation/attempt records must be projected from the canonical event store and revalidated at execution time after restart. No model creates an authorityGrantId; no `job-` session prefix or `unattended` path removes the inherited scope. A vanished/expired grant stops preparation without blocking ordinary conversation.

Enforce scope before context assembly, not just before tool calls. The current unattended path loads situation, refreshes repo state and retrieves memory before the responder runs. A scoped prep path must select only permitted context/sources and must not run that broad preamble unchanged. Apply provider-egress and aggregate accounting to direct model calls, fallbacks, failover, verification and repair as well as tools. A fallback provider outside the allowed destinations is unavailable for that attempt. Verify actual outgoing payloads with injected providers, including a failure before the first tool call.

### 7.4 No answer-route escape hatch

Keep answer and clarify model tool gates as they are. After shared understanding, a Core-owned `decidePreparation` step may create an execution attempt under the scope above. It is not a generally callable tool available to the answering model. The attempt carries `origin: initiative`, the source quote as evidence, and a separate authority basis. It must never be wrapped as a direct command from George.

Reuse FirstMate/Librarian/background execution according to domain ownership. For the first implicit slice, use an existing owner only after it can honor the preparation scope. Choose a bounded local-preparation mode inside the existing Librarian: one producer job over selected supplied/local context, the existing independent read-only job verifier, and at most the existing one repair round. Build the retained DomainResult from the checked artefact/result without an unnecessary extra synthesis-model call. The mode is owned and reconciled by Librarian; it is not a new boss or a generic bypass of knowledge ownership.

A small draft must not automatically trigger the current full Retriever/Researcher/Fact Checker pipeline. Broader requested research can retain that pipeline, with the same inherited constraints where applicable. Account for all selected specialists, manager synthesis, checking and repair inside the same preparation envelope, including stage transitions and direct manager `query` calls outside worker tool loops. Reconcile `blocked`, `interrupted` and other terminal worker outcomes instead of waiting indefinitely for a status the manager does not recognize.

Installed-but-unhealthy FirstMate must not be bypassed by a generic worker. Unavailable scoped execution results in a useful offer or local in-reply draft, not unrestricted fallback execution. The answer does not need to wait for background completion.

“I'm checking the sponsor thread and preparing a follow-up” is appropriate only after dispatch acceptance. Otherwise say what is actually ready or give a natural conversational answer. No default “working on it” notification and no false completion.

## 8. Durable state, delivery and cancellation

Use validated ContextEnvelopes and the canonical event spine for initiative decisions, suppression/remit revisions, dispatch intents, receipt links and publication state. Reuse existing DomainRun/job state for execution truth. New projections are disposable indexes; they are not additional task or memory authorities.

Before enabling each new writer, including shadow decisions and review/routing traces, implement its source/provenance/retention contract, tombstone-generation checks and erasure cascade tests. Source consent is checked before the write and again before downstream use. An `ephemeral` retention label is not itself deletion or a persistence policy. A later pilot cannot substitute for these preconditions.

Suggested preparation projection vocabulary is `candidate`, `eligible`, `dispatch_pending`, `accepted`, `preparing`, `prepared`, `offered`, `suppressed`, `expired`, `blocked`, `unknown` and `cancel_requested`. Derive display states from current dispatch/task/publication facts. Persist only irreducible coordination facts such as a dispatch claim, suppression, revision, reservation and publication receipt; these words are not a mandatory second lifecycle enum.

### Transactional handoff

1. In a canonical-store transaction, re-read current remit/exclusion/revision, reserve the bounded budget/concurrency slot and append a unique dispatch intent.
2. Generate the downstream request identity from the source-turn identity, candidate identity and attempt revision. A repeated transport delivery reuses it. A new intentional request gets a new turn identity even if its words are identical.
3. Send through the existing domain boundary with that stable request identity. Keep both the current source evidence and the separately derived task interpretation.
4. Record accepted/delivered/unknown independently. Cross-store transport is not one database transaction: use an outbox-like projection on the existing tick to reconcile pending dispatches by downstream request identity.
5. If a process dies after dispatch but before acknowledgement, query the owner for the same identity. Never launch another attempt merely because a network call timed out. If acceptance cannot be established, retain unknown state and allow normal conversation.

For native domain dispatch, create the durable owner/request record before launching any child. Derive stable child identities from that request and the selected role/attempt, and reconcile partial startup before launching a missing child. The existing `dispatchKnowledgeDomain` starts children before saving its owner run; that ordering must change for the new preparation mode. Test failure after the first child starts and before the owner acknowledges. Releasing a reservation requires actual terminal/quiescence evidence or an explicit conservative recovery decision, not just loss of a process-local map.

Extend the relevant existing task contracts with origin, sourceTurnId, sourceRevision, contextRefs, authority/scope/budget refs, attempt identity and goal revision. Old explicit tasks remain readable and do not receive retroactive inferred authority. Absence of scope on a new implicit task is a rejection.

### Corrections and stopping

The current `command/messages.ts` is a foundation, not a proof of completed cancellation. Add an explicit input message identity; replace body-hash deduplication as the authority for distinct turns. Update current run/message state atomically or with compare-and-set so stale snapshots cannot overwrite a simultaneous completion or correction.

Keep four facts distinct: stop requested, stop delivered, owner acknowledged, work quiesced. Revoke further effects immediately on a valid stop, then ask the existing owner to halt. Knowledge specialists need cooperative cancellation/checkpoints or bounded process stop; marking a boss message delivered is insufficient. Unsupported stop acknowledgement stays pending/unknown and is described honestly.

A correction increments the goal/task revision. Workers and publication validate it before further effects and before surfacing results. A result produced for an older revision is retained as superseded evidence, not announced as the answer to the new instruction. A stop/completion race must have a deterministic outcome and never resurrect cancelled work through a delayed callback.

The bare “stop” during speech stops playback/listening as appropriate; cancellation of background work requires a resolvable work referent or a short clarification. Pausing LIVE is not cancelling accepted work. “Stop working on the sponsor draft” has a clear task effect and must work immediately.

## 9. A warm, perceptive presence

### 9.1 Behavioral contract

Flyd should be specific, attentive, opinionated and optimistic. It can share enthusiasm, make an apt joke, sit with an unfinished thought and offer a useful challenge. It does not need to produce an offer, question, task or life lesson at the end of every reply.

| Need | Good behavior | Failure to catch |
|---|---|---|
| Vent | Hear the actual frustration, respond briefly; let George continue. | Diagnosis, stock empathy, unsolicited project triage. |
| Think | Explore the interesting implication; develop an unusual direction when useful. | Premature checklist, flattening an idea into the safest familiar option. |
| Decide | Recommend a choice with the reason that matters to George. | Endless balanced options, invented certainty, risk lists that replace judgment. |
| Do | Start work, handle internal choices, report actual acceptance/result. | Repeated offers, status theatre, asking which helper/model to use. |
| Ask | Answer completely with proportionate evidence. | Unnecessary task creation or deferring a lookup George already requested. |
| Chat | Conversational curiosity and shared context where relevant. | A forced question, attendance check, productivity nudge or memory recital. |

Warmth comes from the response fitting the moment. Preserve George's chosen forms of address and style from his own files without mechanically inserting “sir” or another greeting on every turn. Do not silently change his voice preferences. Opinions about creative work should help make it stronger, including suggesting a brave experiment and acknowledging an unfamiliar idea's upside.

### 9.2 Prompt and context work

Extract a compact shared voice/context builder used by the existing text responder and new LIVE conversation path. Preserve private SOUL overrides. Remove competing “never just comment”, “start work” and “every answer is an outcome” absolutes where the interaction-specific contract now owns that choice. Keep clear action requests energetic and decisive.

On the fast path, supply the compact need/interaction/context selection from shared understanding; do not require a generated stance paragraph. On fallback, use the richer room brief. Keep code tools and operator instructions out of personal turns unless the actual request needs them. Naming Flyd, Bloom or a project is not itself a code request.

Select a few relevant facts rather than reciting the archive. Preserve their provenance, date, source authority and uncertainty through `buildRoomContext`; currently it flattens several sources into strings. A relevant “Lately” item needs expiry/currentness, and a fact about another person needs correct attribution. If there is insufficient reliable context, a plain response is better than invented specificity.

Review tone examples in `buildConversationPrompt`: their fictional “nine days”, “Bloom fix” and “nothing due before Tuesday” content must never leak as facts about George. Replace with clearly separated style-only examples or evidence-bound examples, and add leakage tests.

### 9.3 Self-review must understand the interaction

Extend the existing chief-of-staff review input with the interaction class, task state and evidence references available for that surface. For work/status, retain outcome-first and receipt-grounded completion. For conversation, score responsiveness, specificity when supported, proportion, listening, useful candor and freedom from forced logistics. A thoughtful sentence with no task can meet the standard.

This is an explicit amendment to the written standard and corresponding code/evals, not an undocumented exception. Keep one voice, honesty and no-machinery rules across all classes. Do not add a new synchronous judge or more remote-provider exposure. Existing Jev review opt-in and sensitive/unknown-source exclusions remain in force; missing provenance must never expand egress.

### 9.4 Continuity and memory

Keep temporary state, inferred goals, explicit preferences and verified outcomes distinct. “I'm exhausted tonight” may influence this conversation; it must not become a permanent fact or cancellation policy. “When I vent, don't suggest tasks” is an explicit durable preference and can follow the existing user-controlled preference path.

Preserve source spans, speaker, observed/effective time, scope and evidence refs when deriving memory. Derived records must be correctable, erasable and unable to outlive their source's allowed retention. Assistant replies and generated preparation outcomes cannot masquerade as George's statements. A user-reported outcome and a tool-verified outcome remain different.

The inspected profile-learning path writes model-extracted facts into highest-authority USER.md. Repair this existing future-write path as part of the shared-context work, not only for a new source. Coordinate with the existing memory-correctness work and reuse its fix/tests if already landed. `learnInBackground` must no longer send automatically extracted facts to `addUserProfileFact`; reuse the canonical source-backed curator/learning path, with exact evidence refs and lower-authority inferred claims. Avoid extracting/writing the same turn again if the canonical content learner already handles it. New shared/LIVE inputs cannot activate automatic learning until this contract is verified.

Explicit “remember this” and George's own profile edits preserve their established authoritative path. Do not blindly rewrite, demote or erase historical private USER.md entries whose authorship cannot be established. Report legacy provenance as an uncertainty when relevant, and use reliable existing records for any separately scoped reconciliation. Do not solve future-write correctness by asking him to approve every harmless observation or by disabling all useful memory.

Newly captured LIVE transcripts require an explicit source/retention contract. Activating the mic authorizes that session's audio processing, not silent permanent learning. If transcript retention is not permitted, keep its conversational use ephemeral and do not create durable inferred work from it. Existing explicit-task recording still follows its own authorized contract.

### 9.5 Proportionate presence

Reuse the existing conversation view, island and artefact surfaces. No new destination or companion dashboard is required. An optional visual presence may indicate listening/thinking/speaking with restrained motion; it must be dismissible, accessible and respect reduced motion. Rich avatar animation and character customization are follow-on design experiments after conversational quality is demonstrated.

Unsolicited re-engagement, emotional pressure, streaks, simulated dependency and optimizing hours spent talking are outside this feature. Measure whether George wants to use Flyd and finds it helpful, not whether Flyd prolongs the exchange.

## 10. LIVE integration: one conversation, one spoken answer

Preserve the existing transport initially; make finalized user transcript events enter the shared turn boundary. The realtime model's rewritten `flyd_resolve_intent` arguments remain model-authored and cannot stand in for the original transcript or approval. Avoid a duplicate independent semantic answer from the realtime provider and Core.

Implementation must choose and test a supported provider protocol for per-turn response ownership: automatic semantic replies disabled/suppressed, Core determines the answer, and the voice transport speaks the approved content. Verify provider capabilities in current official documentation during implementation. Do not claim this is supported merely because the existing relay sends `response.create`.

If exact answer ownership cannot be enforced on the current transport, keep existing LIVE as an explicit compatibility mode and offer the new shared conversation through a transcription → Core → speech path. This is a transport fallback, not a second brain. Benchmark the path before replacing the default. A speculative silent hybrid with two models independently answering is unacceptable.

Requirements for the new path:

- Finalized utterance + provider item ID + stable turn ID enters once. Partial text can update UI but never authorize a task or durable memory.
- Distinct identical utterances remain distinct turns. Replayed provider events remain one turn. Reconnect does not replay accepted effects.
- Corrected transcription supersedes interpretation; material target/date/action uncertainty is repaired before consequential effects.
- Per-turn context includes the actual recent conversation, relevant current goal, active work and updated memory with provenance; session-start context alone is insufficient.
- Read-only personal questions do not require a Mac foreground observation. Request screen context only for tasks that need it, under existing invocation privacy rules.
- Barge-in cancels pending audio and generation; a separate task cancellation follows the explicit referent rule in section 8. Old audio cannot resume after interruption.
- Surface accepted, preparing, prepared, blocked and unknown accurately. Actual Mac operations need adapter acknowledgement and verification before being described as done.
- One visible/transcribed answer and at most one audible return for each result revision. Text and audio share message/artefact IDs.
- Closing a voice session ends mic/audio processing, not accepted task supervision. Results remain available in existing artefact/inbox surfaces and can be discussed next session.
- Preserve PRESENT's zero-network/zero-persistence contract and the no-raw-audio-storage invariant.

Native mobile background audio and CarPlay are outside this plan. The new client contract should be usable by the mobile track without changing judgment, permissions or memory ownership.

## 11. Results, artefacts and quiet follow-through

Reuse existing domain results, artefact links, inbox and notification mechanisms. A preparation artefact should show the actual useful material first, followed by evidence/currentness where needed, what remains unresolved, and clear controls to refine, use or stop it. Do not show raw source/permission/task machinery unless George asks.

Distinguish three outcomes: a request was accepted, an artefact was prepared and checked, and the underlying business/life objective was achieved. Only the first two are normally established by a draft job. “Follow-up prepared” is accurate; “sponsorship sorted” is not. Reuse `acceptance.ts` for checkable artefact criteria and independent verification; a file's existence alone is insufficient.

Deduplicate delivery by result identity and task revision across conversation, island, agenda inbox and LIVE. Muse/private notes must know whether the same topic/result was already addressed. The existing daily advisory cap is not an extra quota for requested task completions. Honor quiet hours and current speech; a result can wait in the artefact/inbox without interrupting or disappearing.

Do not feed inferred preparation into routine discovery. Explicit repeated requests continue to use current routine logic. Keeping an artefact or requesting a refinement is outcome evidence, not blanket permission to auto-run it next week.

## 12. Budgets and failure behavior

Initial proposed preparation limits, to be calibrated against measured usefulness and existing configuration:

- At most one active implicit preparation for a bounded opportunity/deliverable revision and two active implicit preparation attempts globally, reserved durably across processes. Reuse a prepared result while the relevant evidence/outcome is unchanged; allow distinct useful deliverables or materially new evidence under a long-lived goal without manufacturing a new goal revision. A measured per-opportunity cooldown limits repeated unsolicited work. These are top-level attempts, not permission for each child to reserve another full budget; enforce the existing worker-slot limit as well.
- A default attempt envelope of 120 seconds, eight tool calls and 12,000 additional model tokens across builder/checker/repair combined; at most the existing one repair round. These are proposed ceilings, not observed requirements or performance claims.
- Explicit user requests retain their normal budgets. Preparation cannot consume the reserve needed for current conversation or bypass provider/monthly caps.
- No provider key/budget, scope or currentness: continue the conversation and choose a smaller grounded response. Do not launch a retry storm or make the user manage an internal configuration decision.
- Unknown acceptance/effect: reconcile using the same identity; no automatic duplicate. Interrupted already-started work keeps honest interrupted/unknown state.
- Revocation/expiry/cancellation: halt further effects immediately, retract queued publication and retain only permitted audit metadata.
- Exceeding a prep budget is a bounded experiment result, not evidence that the larger goal is impossible. Offer an ambitious next step when George actually wants to pursue it.

Before selecting these defaults for release, confirm that the current provider adapters can enforce/token-account for the combined envelope, including verifier and repair, and measure p50/p95 response timing separately from background work. If they cannot, implement the missing attempt accounting as part of scoped execution rather than claiming the limits are enforced by prompt text.

## 13. Implementation sequence and independently useful deliveries

Size is relative engineering scope, not a promised calendar estimate. Each slice lands on main with its own verification; no need to wait for every later integration to provide value.

| Slice | Work and source targets | Done when | Size/dependencies |
|---|---|---|---|
| P0 — Establish current truth | Source inventory, baseline conversations, goal-document authority notes, existing private configuration inspection with proper access; early LIVE protocol feasibility spike using current official docs and synthetic input | Baseline evidence separates source/build/installed behavior; stale goal documents cannot override current direction; LIVE response-ownership path or fallback chosen; no production behavior changed | Small; first |
| P1 — Shared understanding and companion behavior | Extract shared turn/voice contracts from responder; extend room/fast-path parsing and registry only where needed; room-context provenance; fix future auto-profile promotion; interaction-aware chief-of-staff standard | Natural conversation improves on both fast/fallback paths; direct requests retain action; future extracted facts stay inferred; ordinary chat adds no mandatory serial model call | Medium; P0; source/erase tests precede new writers |
| P2 — Bounded execution and durable identity | Origin/scope on existing job/domain contracts; context/provider/tool enforcement; native owner/child identity and canonical dispatch reservation; correction/cancel revisions and acknowledgements; source cascade/tombstone tests | A replayed dispatch starts one job, scope survives restart, disallowed context/effects cannot escape, stop/completion races report truth, erased sources cannot reappear | Medium for native slice; external-owner work separately gated; P0; prerequisite for shadow persistence and autonomous prep |
| P3 — First useful initiative | Candidate in shared understanding; deterministic eligibility; one local prep artefact; existing acceptance/result/notification integration | Sponsor-concern scenario produces a checked local draft inside an already authorized remit, or naturally stays conversation; no new approval prompt | Medium; P1+P2 |
| P4 — View and push-to-talk parity | Thread turn identity through desk/Answerer/source router; reuse trusted decision; preserve attachment/command/reply handling; distinguish explicit routine observations | Same scenario and controls work from typed/view voice; no double routing decision or duplicate job; FirstMate answers/replies remain correctly owned | Medium; P1–P3 |
| P5 — LIVE parity | Final-transcript ingestion, response ownership, per-turn context, interruption/reconnect, actual effect acknowledgements; Swift bridge/UI transport | One spoken answer, one task, correct correction/stop behavior and continuity across session exit; transport fallback is explicit | Medium/large; P1–P4 |
| P6 — Outcome-backed refinement | Extend existing eval/review/routing evidence; limited real pilot, end-to-end source-erasure and rollback rehearsal | Useful initiative and companion quality improve together, without interruption/cost/authority regressions; feedback enters existing learner; this rehearsal supplements earlier per-writer gates | Small ongoing; P1 onward, release gate after P5 |

P1 should be usable on its own: George can chat without getting a management checklist. P3 is the first concrete autonomy demonstration at a source boundary that already supplies stable turn identity. Keep implicit launch disabled on any adapter whose identity/retention integration is incomplete; P4 enables it for view/push-to-talk after end-to-end correlation tests. P5 earns voice parity; it must not be described as complete after only changing a prompt.

The native local-preparation slice is the required P2/P3 delivery. Add the common source/scope fields compatibly, but do not make a fleet-wide FirstMate rewrite a prerequisite. Implicit dispatch to any external owner stays disabled until its actual context/effect/retention and stop contract has been demonstrated. Existing explicitly requested coding work keeps its current policy and transport.

### Proposed file-level work packages

Existing files listed here were checked against the reviewed repository. New names below are proposals.

| Package | Existing files to extend | Proposed small modules / constraints |
|---|---|---|
| Turn boundary | `runtime/conversation-responder.ts`, `runtime/read-the-room.ts`, `runtime/turn-plan.ts`, `runtime/turn-receipt.ts`, `cognition/system-one/registry.ts` | `runtime/conversation-turn.ts` for shared input/understanding and source identity; avoid replacing the existing runtime |
| Voice/context | `lib/soul.ts`, `runtime/room-context.ts`, `cognition/context-compiler.ts`, `council/chief-of-staff.ts`, `council/reply-review.ts` | Compact shared voice builder only if extraction removes duplication; keep user overrides authoritative |
| Initiative | Existing ContextEnvelope/event store/projection and existing tick | `runtime/conversational-initiative.ts` for deterministic eligibility, remit projection and outbox coordination; no new daemon |
| Scope and workers | `runtime/tool-policy.ts`, `runtime/background-jobs.ts`, `runtime/acceptance.ts`, `command/types.ts`, `command/firstmate.ts`, `command/librarian.ts`, `command/messages.ts`, `command/scheduler.ts` | Inherited scope gate at every actual effect; transport contract evidence before dispatching to an external boss |
| View/audio | `conversation-view/flyd-desk.ts`, `conversation-view/server.ts`, `realtime-session.ts`, `mac-adapter/Sources/Bridge/LiveAudioBridge.swift` | Share turn IDs/routing result and audio response ownership; no replacement UI framework |
| Memory | `runtime/conversation-memory.ts`, `runtime/profile-learning.ts`, `lib/user-profile.ts`, `cognition/curator/content-learning.ts` | Integrate source/provenance and erasure with existing memory-correctness work; no parallel profile |
| Returns | Existing command results, view artefact links, `council/muse.ts`, agenda inbox and notifications | One result revision and publication key; render outcomes through existing surfaces |

### Order of the first implementation commits

1. Characterize current behavior and align document authority; freeze synthetic dev/held-out examples.
2. Shared source identity and optional understanding metadata, backward-compatible receipt parsing, retention/erasure contracts and tests before each new writer, no new autonomy.
3. Companion behavior, future automatic-profile provenance repair and interaction-aware review across fast/fallback paths, with paired examples.
4. Scoped worker execution, durable dispatch claim, bounded Librarian preparation mode and cancellation/revision handling; no implicit launches enabled.
5. One local-artifact preparation path behind its independent rollout control; demonstrate the full user scenario.
6. View/push-to-talk source parity and duplicate-route removal.
7. LIVE final-input/answer ownership, interruption and result parity.
8. Pilot evidence, corrections, source-erasure and rollback verification; document actual installed behavior.

Do not bundle model swaps, memory-model replacement, mobile/server cutover, custom avatar production or new domain bosses into these commits.

## 14. Verification plan

### 14.1 Deterministic contracts and integration tests

| Test family | Critical cases |
|---|---|
| Conversation semantics | Vent, think, decide, ask, do and chat; project mention without code intent; a worthwhile unusual idea; actual request with optional details missing |
| Independent confidence | Confident answer route with uncertain need/prep; Jev disabled/unavailable; full-reader timeout/malformed fields; stale trusted route input |
| Authority/provenance | No goal/remit; source quote mistaken for command; assistant or email instructions quoted in user text; expired/revoked scope; privacy-sensitive content wrapped in generic string fields |
| Effect restrictions | `email_draft`, `drive_compose`, memory, reminders, schedules, repo writes, shell/AppleScript and recursive jobs denied for prep even when current category is local; selected reads/local output succeed |
| Worker inheritance | Builder, checker, repair and every child domain/specialist carry same-or-narrower scope; context assembly, direct manager calls and fallback providers obey it before tools; unknown tool defaults cannot allow effects; actual provider payload/accounting inspected |
| Delivery/restart | Duplicate provider event, HTTP retry, process death before/after acceptance, native owner persisted before children, partial child startup, cross-process claims, downstream unknown, budget reservation recovery, erasure while in flight |
| Corrections/cancel | Identical text on two distinct turns, duplicate delivery of one turn, unique/ambiguous referents, corrected transcription, concurrent completion, late result, native specialist stop acknowledgement, disconnected boss |
| Memory | Temporary mood expires; new intent overrides old taste; model inference never promoted to USER.md authority; explicit remember still works; person attribution, time ordering and source erasure |
| Returns and routines | Accepted is not prepared; prepared is not business success; failed evidence remains unresolved; one publish per revision; no Muse duplicate; no implicit routine discovery or auto-run |
| LIVE | One finalized utterance/turn, partial input no effect, one answer/audio stream, barge-in discards old output, foreground observation only when needed, no raw audio, reconnect no duplicate effect |
| Companion review | Listening without a task passes; fabricated familiarity/fake progress fails; tone-example facts never leak; honest disagreement survives review; no new Jev egress for sensitive/unknown sources |

Use injected clocks, isolated stores, fake transports and fake providers. Never start real FirstMate workers or send real mail/WhatsApp from the automated suites. Test observable behavior, permissions and recovery, not prompt wording or CSS-source snapshots.

### 14.2 Relevant existing checks

From a complete implementation checkout, use the repository's package manager/dependencies and run the changed suites plus these existing relevant areas:

```bash
cd cli
npx vitest run src/runtime/__tests__/read-the-room.test.ts src/runtime/__tests__/turn-plan.test.ts src/runtime/__tests__/conversation-responder.test.ts
npx vitest run src/runtime/__tests__/background-jobs.test.ts src/runtime/__tests__/acceptance.test.ts src/command/__tests__/messages.test.ts src/command/__tests__/firstmate.test.ts
npx vitest run src/__tests__/realtime-session.test.ts src/conversation-view/__tests__/flyd-desk.test.ts src/conversation-view/__tests__/routines.test.ts src/conversation-view/__tests__/routines-api.test.ts
npx vitest run src/council/__tests__/chief-of-staff.test.ts src/intelligence/__tests__/context-envelope.test.ts src/intelligence/__tests__/event-store.test.ts
npm run test:routing-learning
npm run lint
npm run build
```

Add new tests to these areas or new focused files as appropriate. Existing cognitive content-learning, profile-learning, temporal world-model and authority-ledger suites must also pass when those contracts change. Run full `npm test` before integration where feasible; establish any pre-existing failure against untouched main and distinguish it from the change. These are future implementation checks, not a claim that they ran for this documentation commit.

The chat eval runner currently accepts only `chat`, `decisions`, `decisions-heldout`. Extend that existing runner with `conversation-initiative` and `conversation-initiative-heldout` suites before documenting commands that use them. Preserve read-only tool simulation and store isolation. Do not create another judge framework.

### 14.3 Semantic and experiential evaluation

Create a proposed initial set of 48 synthetic multi-turn episodes, split into 32 development and 16 held-out episodes. Cover the six conversational needs, opportunity/no-op boundaries, current/changed goals, unusual creative options and failures above. Include true positive initiative cases so a model that never acts cannot pass. Freeze held-out cases before tuning. These counts are planned test scope, not existing data or statistical proof.

Compare baseline/candidate using the same model, context, tool fixtures and independent judge. Record full outputs, route/need, proposed and attempted effects, preparation origin/scope, tool calls, approvals, latency and token usage. Blindly compare warmth, relevance, listening, useful candor, creative range and practical usefulness. A semantic judge helps identify regressions; George's actual preference is decisive where personal taste is involved.

### 14.4 Proposed release gates

These are acceptance targets, not measured current performance:

- All deterministic boundary/recovery cases pass: zero unauthorized effects, fabricated completion, duplicate execution/publication, or new source-erasure resurrection in those tests.
- Every eligible explicit request in the fixture set starts/finishes or reports a real blocker without extra feature-specific approval. Preserve the configured approval behavior for consequential effects.
- Every explicit no-action/vent-only fixture creates no implicit task; every selected authorized-prep fixture yields a useful artefact or an evidenced blocker, so silence cannot win by default.
- Both fast and fallback paths meet the companion rubric; no regression in constructive disagreement, creative ambition or direct action.
- No added mandatory serial provider call on ordinary chat. Proposed paired-run latency target: no more than 10% p95 regression for unchanged no-prep cases under matched cold/warm conditions; measure enough repeated samples and report variability rather than hiding provider noise.
- Preparation cost is fully accounted, including checking, repair, abandoned/duplicate attempts and calls that produced no kept artefact. Release only with enforced per-attempt and existing provider caps.
- Pilot includes at least five actual natural-conversation episodes, with at least two kept preparation artefacts and at least two satisfying conversations that required no action. This is a usability gate, not a product-market-fit or retention claim.
- Test one real stop, one correction, one session exit/restart and one source-forget scenario on the installed Mac before claiming LIVE/companion parity.

## 15. Rollout, controls and rollback

Use independent proposed controls for companion context, initiative observation and implicit dispatch. Suggested names are `FLYD_CONVERSATIONAL_PRESENCE`, `FLYD_CONVERSATIONAL_INITIATIVE=off|shadow|active` and `FLYD_SHARED_LIVE`; these are new proposed flags, not current settings.

1. Ship compatible source/receipt contracts and companion improvements first. Existing action paths remain operational.
2. Run initiative in shadow on explicitly submitted turns whose source contract permits analysis. Shadow makes no worker/connector calls or externally visible effects; use bounded expiring local decision records, not a hidden permanent transcript archive.
3. Enable active preparation for one existing remit and one local artefact type. Hold the same model constant to attribute behavior changes.
4. Expand to view voice and then LIVE after their parity gates. Broader read sources and cloud drafts require their own actual scopes and verified worker support.
5. Keep new explicit-task behavior usable even if implicit dispatch is disabled. Distinguish stopping new initiative from cancelling existing authorized work.

Rollback disables new inferred launches and new interpretation changes independently. It must not duplicate, forget or relabel existing tasks as cancelled. Reconcile pending intents and owner receipts; revoke future effects for implicit tasks when required; keep accepted work inspectable. Old clients ignore optional new fields. Reconnect LIVE when instruction/transport behavior changes.

Source pause/revoke/erase must cover candidate payloads, derived memory, task-context copies, generated artefacts where required, self-review examples, routing/eval traces and queued publication. Before giving a new source to a domain owner, verify that the owner can honor its retention/erasure contract; otherwise withhold that source or keep the work in a supported scope. Prevent late callbacks from recreating erased data; use a source generation/tombstone check at each persistence boundary. The current event store has source-level erasure; if narrower forgetting is exposed, implement and test its cascade before presenting per-item forget controls. Do not promise deletion of downstream external effects that were already made under a separate explicit instruction.

## 16. Strongest objections and decisions

| Objection | Decision and mitigation |
|---|---|
| “You are building bureaucracy around a draft.” | The user experience remains a conversation. Reuse existing policy/events/tasks; derive scope from existing instructions. These records enforce/recover execution backstage, with no extra approval for already-authorized prep. |
| “This will make Flyd meddlesome.” | Current-goal relevance, actual no-action words, limited implicit concurrency, useful artefact criteria, deduplication and quick stop are release requirements. Evaluate false positives and missed opportunities together. |
| “Warmth will make it flatter me or become conservative.” | Require honest disagreement and brave creative alternatives in fixtures and personal review. A rejected suggestion updates that narrow situation; it does not become a general risk penalty. |
| “One shared brain will make voice slow.” | Share understanding/state/contracts, not duplicate model calls. One answer owner, existing fast path, incremental output and explicit transport fallback. Measure first audible content and full usefulness separately. |
| “Existing jobs are already safe enough.” | They verify outcomes, but inspected contracts do not enforce inherited prep scope and unattended turns bypass TurnPlan. That missing boundary is a prerequisite to implicit launches. |
| “Companion work requires a new avatar.” | Ship behavioral quality first. A visual treatment can later make existing presence more expressive, with its own user test. |
| “The assistant can never know when to help.” | Keep uncertainty explicit, start with established remits and reversible preparation, evaluate true-positive opportunities, and learn from actual outcomes. Avoid universal confidence scores pretending to express personal judgment. |
| “More conversation will pollute memory.” | Preserve source and authority, keep moods episodic, separate inferred/explicit/verified records, coordinate provenance fixes before expanding learning sources. |

## 17. Definition of complete

The implementation is complete when:

1. George can have a natural, warm and useful conversation on typed and supported voice paths without forced task management.
2. Under an established remit, a relevant concern can produce one checked local preparation artefact without an additional command or new approval ritual.
3. The same concern outside that remit remains conversation or a useful offer, and explicit requests still act decisively.
4. Original text/transcript evidence, inferred intent, scope, execution and verified return remain distinguishable across restart and correction.
5. A correction reaches the right ongoing work once, cancellation stops further effects, and stale results cannot pretend to answer current intent.
6. One voice and answer owner span the surfaces; LIVE completion claims depend on actual receipts.
7. Outcome learning and companion review use existing systems and preserve source/egress/erasure boundaries.
8. Tests, paired examples, installed-Mac checks and the bounded pilot establish the behavior; a new prompt, documentation or submitted task is not sufficient evidence.

## 18. Implementation starting point

Begin with P0/P1: preserve a small set of current conversations, extract shared source identity/understanding, and make the companion contract work on both routing paths. In parallel with that bounded work, establish scoped worker execution and honest cancellation before enabling inferred prep. The first autonomy demo is the sponsorship-concern → local follow-up artefact → checked return scenario, using fixture data or an actually authorized remit.

This plan deliberately provides a concrete first delivery while keeping the longer-term architecture neat: one executive, one source of authority, existing domain ownership, and a presence that can be pleasant company as well as competent help.

## 19. Plan review and verification record

This is a plan-only delivery. Source inspection was pinned to the main revision identified above; private SOUL/USER files and the installed app were unavailable. Source references, named test paths and Markdown structure were checked. No runtime test pass, live-model improvement, deployed server or installed-Mac behavior is claimed by this commit.

An independent read-only architecture review challenged the plan and a focused second pass confirmed the amendments resolved its blocking findings:

| Review finding | Amendment |
|---|---|
| New persistent writers appeared before erasure verification in the sequence | Per-writer source, retention, tombstone and cascade tests now precede activation, including shadow records. |
| One preparation per goal revision would make long-lived goals effectively one-shot | Deduplicate equivalent opportunities/deliverables and current task revisions; retain bounded global concurrency and a measured cooldown. |
| Existing automatic profile promotion conflicted with the inferred-memory promise | Repair future `learnInBackground` promotion, reusing canonical source-backed learning; preserve explicit memory and historical user-owned profile content. |
| Generic jobs/Librarian fan-out did not establish a feasible bounded first execution | Choose native Librarian local preparation with one producer and independent verification; scope context assembly, direct/fallback model calls, all children and aggregate budget. |
| Native partial startup, blocked states and cancellation could misreport progress | Persist owner/child identities before execution; reconcile terminal states; distinguish cancellation delivery from quiescence and reject stale publication. |

The review also moved the LIVE protocol feasibility spike earlier and clarified that preparation display states are derived vocabulary, not another worker state machine. The final review found no remaining blocking contradiction and judged the plan ready to implement in stages. The future implementation must still establish actual enforcement and experiential quality through the checks above.

# Flyd: contextual voice and conversation learning
Updated: 3 October 2026
Status: implementation prepared in a separate behaviour-preserving commit, then implemented against existing TypeScript/Swift code. Native CI, device testing, and measured accuracy validation remain required. See docs/product/flyd-contextual-voice-learning.md for actual behaviour and controls.

## Goal and boundaries
Keep the voice interaction that already feels good, improve faithful recognition across applications, and learn what is happening in George's work from everyday conversations. Voice correction and content learning are distinct pipelines sharing evidence and context services.

General-purpose operation is mandatory. OpenCode is an optional context source, never a dependency. No new autonomous execution authority comes from learning. Existing action permissions remain separate.

## Architecture
Use existing Flyd context, memory, and evidence infrastructure wherever suitable after inspection; do not build a second memory system.
Three representations:
1. Searchable source history: original conversation events and their provenance.
2. Derived current state: projects, work items, decisions, problems, dependencies, outcomes.
3. Durable knowledge: scoped preferences, vocabulary, and validated reusable lessons.

Preserve source evidence. Summaries are retrieval aids, not replacements for original records. Observations, inferred claims, and verified outcomes remain distinguishable.

## U1 — Inspect and baseline the current pipeline
Map audio capture, recognition, cleanup, insertion, context collection, conversation ingestion, memory updates, and retrieval. Identify supported OS surfaces and existing APIs before choosing concrete files or storage schemas.
Add opt-in diagnostics: raw/final transcript, provider/model, vocabulary supplied, stage timings, recording termination reason, and context source identifiers. Avoid storing full contextual contents in diagnostics by default.
Build a representative evaluation set from actual failures: project names, pauses, corrections, ordinary speech, numbers, negations, paths, and commands.
Acceptance: distinguish clipping, recognition errors, rewriting errors, and insertion failures; map additions to existing components.

## U2 — App-independent context
At invocation, capture a bounded snapshot: application, window/document title, focused field, nearby text, selection, current work item if known, and available project/document metadata.
Each item has source, timestamp, scope, availability, and trust classification.
Prefer semantic accessibility capture. Optional integrations enrich the same interface. Screen reading is a deliberate fallback, not the foundation.
Track invocation target identity and revalidate before insertion to prevent focus drift.
Acceptance: useful operation without OpenCode or any integration; unavailable context degrades gracefully; app switching cannot cause insertion into the wrong target.

## U3 — Contextual vocabulary
Build a small vocabulary from approved terms, focused text, current document/project, and relevant recent work. Preserve exact spellings. Refresh on subject/app changes and drop stale context.
Pass hints to supported speech providers without assuming all providers support equivalent controls.
Context supplies spelling candidates, not implied instructions. Content cannot override system rules.
Acceptance: improvements on names and terms without increases in unrelated substitutions.

## U4 — Conservative transcript repair
Apply confirmed correction rules and optionally a constrained model repair pass.
Allow punctuation, known terminology, and clear spoken self-corrections. Do not rewrite arguments or infer requests from context.
Protect numbers, amounts, units, dates, negations, conditions, sequencing, paths, identifiers, commands, and expressed uncertainty.
Retain recoverable raw text and change provenance. Model failure falls back to raw transcription.
Keep current interaction. Evaluate whole-recording final recognition only if clipping/partial decoding evidence justifies it.
Acceptance: no meaning-changing repairs in the regression set; quick raw-text recovery; measured delay remains acceptable in actual use.

## U5 — Learn from edits
Observe only a reliably attributable inserted span, for a bounded period. Stop on target loss or unreliable attribution.
Classify edits into vocabulary correction, formatting preference, changed intent, and ambiguous edit.
Do not turn edited numbers or negations into automatic replacement rules. Larger rewrites are changes of intent unless evidence establishes otherwise.
Begin with reviewable candidate corrections. Repeated unambiguous corrections may later be promoted under a calibrated policy.
Rules have scope, evidence, status, and delete/undo controls.
Acceptance: isolated vocabulary fixes can be learned; unrelated edits, mind changes, and ambiguous observations cannot poison recognition.

## U6 — Learn conversation content
Goal: derive a grounded picture of ongoing work from mundane exchanges, not merely a user preference profile.

### Ingestion
Accept conversations from Flyd and optional connectors through a common event contract. No dependency on OpenCode.
Preferred sources are structured exports, APIs, or app integrations. Accessibility can expose a limited excerpt; do not imply complete conversation capture. Do not attempt learning from an unreadable or unidentified conversation.
Capture conversation/message identity, role, timestamp, project/work-item association when supported, provenance, and content. Keep revisions and deduplicate re-imports.
Support intentional exclusions, pause controls, and deletion through derived records.

### Extraction
Process new or revised conversation segments asynchronously, outside the dictation path.
Extract candidate observations:
- goals and tasks;
- project facts and constraints;
- decisions and rationale;
- unresolved problems and blockers;
- dependencies between work items;
- rejected approaches and why;
- claimed, accepted, and corroborated outcomes;
- durable lessons and preferences only where evidence supports them.

An ordinary exchange can establish that an upload problem remains open, images moved to backend storage, intranet work is deferred, or a task depends on authentication. Most chatter need not become a durable claim.

### Evidence and semantics
Every candidate links to exact supporting messages and records scope, observed time, applicable time when known, attribution, status, and confidence basis.
Separate a proposal from a decision, an intention from an action, a success claim from verification, and user approval from agent self-approval.
Silence is not acceptance. Agent suggestions are not user preferences. Repeated behaviour may reflect constraints rather than desire.
Quoted text, hypothetical examples, code samples, external messages, and tool output must retain their attribution.

### State updates
Resolve entities conservatively and leave ambiguous project associations unassigned.
Append observations, then derive current state; do not destructively overwrite past evidence.
Support supersedes, contradicts, supports, depends-on, and rejected-by relationships where existing infrastructure permits.
Later reversals change current state while preserving the old decision and rationale. Unresolved contradictions remain visible.
Corroborate implementation claims with relevant repository changes, tests, or deployment evidence where available. A commit alone does not prove deployment.
Use novelty filtering and incremental processing to avoid extracting the same claim repeatedly.
Promotion of durable preferences requires explicit general scope or repeated consistent evidence; task instructions remain local.

### Retrieval and output
Answer: What am I working on? Where did we leave this? Why did we reject that? What is blocked?
Retrieve relevant current state and supporting source history. Distinguish known, reported, inferred, stale, and unresolved information.
Provide compact state to voice context: relevant names, current subject, and terminology. Do not inject the entire work history into recognition.
Learning about a task never authorizes acting on it.

### Acceptance
- A mundane exchange updates an unresolved issue with traceable evidence.
- An agent's unaccepted proposal never becomes a user decision.
- A claim of completion remains unverified until corroborated.
- A reversal supersedes the earlier decision without losing rationale.
- A project preference does not leak into unrelated projects.
- Duplicate imports do not duplicate facts.
- Ambiguous project references remain unresolved.
- Source deletion invalidates affected derived knowledge and refreshes summaries/indexes.
- Content learning failure does not interrupt voice recording or insertion.

## U7 — Selective integrations and controls
Add integrations only where they demonstrably enrich universal context: editor files/symbols, terminal working directory, browser page/selection, document subject, conversation threads, and OpenCode tasks.
Provide a correction manager, memory/source inspection, context exclusions, pause learning, and raw transcript recovery.
Keep vocabulary, work state, and preferences separable so one can be reset without losing the others.

## U8 — Verification and rollout
Compare current voice, contextual vocabulary, and conservative repair using identical recordings.
Measure word/terminology errors, meaning preservation, number/negation accuracy, insertion delay, and remaining manual edits.
Evaluate content learning on a hand-labelled set of ordinary conversations: extraction correctness, attribution, scope, contradictions, current-state accuracy, and evidence retrieval.
Include absent permissions, app switching, stale context, provider failure, ambiguous edits, quoted instructions, truncated conversations, and cross-project contamination.
Roll out extraction in observation mode first, inspect candidate lessons, then enable state updates after correctness is demonstrated.
Do not choose numeric promotion thresholds or latency budgets without baseline measurements.

## Sequence
1. Inspect existing code and establish voice and memory baselines.
2. Implement shared context and contextual vocabulary.
3. Add conservative repair and raw recovery.
4. Add edit attribution and vocabulary learning.
5. Implement conversation ingestion and extraction in observation mode.
6. Enable evidence-backed state derivation and retrieval.
7. Feed bounded current-work vocabulary back into voice.
8. Add integrations where evidence supports their value.

## Main risks
Context bias can produce plausible misrecognition. Conversation learning can confuse proposals with decisions or infer preferences from frustrating workarounds. Partial app capture can fabricate continuity. Asynchronous updates can retain stale contradictions.
Mitigate through bounded inputs, explicit attribution, source preservation, conservative scope, recoverable changes, and independent evaluation of transcription and work-state correctness.

## Next implementation action
Inspect the repository and map U1/U2 plus existing memory contracts to concrete files. The implementation preserves the preparation/feature split. The product note records the implemented scope and the verification limits; future performance tuning requires real recordings.


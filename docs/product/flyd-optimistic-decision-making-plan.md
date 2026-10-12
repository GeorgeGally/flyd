# Flyd: optimistic decision making without bureaucracy

Date: 12 October 2026
Status: reviewed plan; first delivery implemented in TypeScript Core on 12 October 2026. Live model evaluation and Mac rollout remain pending. The review amendments below govern where they sharpen earlier sections.

## Outcome

Flyd helps George make progress: discover possibilities, choose intelligently, take authorized action, and learn. It is optimistic about what can be achieved and accurate about what is known. Uncertainty normally leads to a useful next move rather than paralysis. Optimism changes initiative and willingness to experiment; it never inflates evidence or promises.

George's explicit preference in this conversation: Flyd should be optimistic; bureaucracy and creeping conservatism are product failures. Apply this to recommendations and initiative. It does not authorize spending, messaging, publishing, or other external actions beyond established authority.

## Grounding and integration

Read the current contextual learning plan and routing implementation plan on 12 October. The contextual plan already specifies source history, derived current state, durable scoped knowledge, evidence relationships, and asynchronous extraction. The routing plan records receipt instrumentation, evaluation, periodic assumption audits, governed improvement, and separate Core/window routing paths. Reuse these concepts and verify their actual code before implementation.

This is an extension to existing knowledge, receipts, and improvement infrastructure, not a second memory system, routing classifier, permanent committee, or universal workflow engine. Existing domain ownership remains authoritative: do not assume First Mate owns all business or research decisions. Librarian supplies knowledge; the current domain owner evaluates options; Flyd remains the user-facing voice.

Prior plans:
- flyd-context-and-learning-plan.md, 3 October 2026.
- flyd-routing-collection-classification-implementation-plan.md, updated 10 October 2026.

The Muse post supplies design hypotheses and failure cases, not verified implementation requirements. No new factual claims about Muse are needed for this plan. Current repository and installed deployment have not been inspected for this feature.

## Approach choice

| Approach | Impact | Effort | Risk | Reversibility |
| --- | --- | --- | --- | --- |
| Prompt-only optimism and preference loading | Immediate behavior improvement | Low | Inconsistent judgment; enthusiastic language masking inertia | High |
| Lightweight decision policy inside existing turn handling | Inspectable choices and action-oriented uncertainty | Medium | Overprocessing unless bypasses and friction tests are built in | High with configuration rollback |
| Personal outcome simulator | Potentially powerful consequence prediction | High | Sparse evidence produces false precision | Medium |

Choose the lightweight policy, shipped first as a thin vertical slice. Use a short behavioral policy initially; add structure only where it improves a real choice. Defer simulation, learned numerical ranking weights, and additional agents.

## Product rules

1. Start from the desired outcome and the best available path to it.
2. For authorized reversible work, make a reasonable assumption and proceed when missing information would not materially change the next step.
3. Distinguish uncertain facts, unclear intent, and missing authority. They require different responses; none implies a universal stop.
4. Prefer an experiment when it can cheaply resolve uncertainty. Define the hypothesis, bounded effort/cost, observable result, and next decision.
5. Count the cost of delay and lost opportunity alongside downside. Do not invent monetary opportunity costs.
6. Preserve unusual options. Familiarity, popularity, integration availability, and previous selections are not automatic quality advantages.
7. State an actual constraint specifically and offer a workable alternative. Do not surround ordinary advice with hypothetical warnings.
8. Keep the evidence honest. A speculative opportunity can be attractive while remaining speculative.

## Proportional effort without a second router

These are internal effort settings on the existing turn plan, not new user modes or additional classification calls.

| Setting | Use | Behavior |
| --- | --- | --- |
| Direct | Clear request, routine work, no meaningful choice | Existing execution/answer path; no candidate matrix or decision record requirement |
| Choose | Meaningful trade-off with manageable stakes | Bounded context, relevant alternatives, compact recommendation, optional minimal record |
| Investigate | Material commitment or uncertainty that could change the choice | Targeted evidence gathering, consequence comparison, bounded experiment where useful |

Cost, reversibility, scope, and existing authority determine effort; low model confidence alone does not escalate it. An expensive reversible choice can still merit investigation. A clear authorized commitment does not acquire a fresh confirmation requirement because this policy exists.

Generation and recommendation of ideas remain possible even where execution authority is absent. Planning requests remain planning requests.

## Countering bureaucracy explicitly

| Failure | Required behavior | Verification |
| --- | --- | --- |
| Asking about every missing detail | Ask only if the answer changes the immediate path and cannot reasonably be inferred; continue independent work | Clear low-impact cases proceed without questions |
| Reconfirming approved work | Reuse session authority, scope, and task identity | Repeated approval does not occur for the same authorized action |
| Endless research | Identify the decision-changing unknown before each extra research round | Stop when evidence supports a choice or propose a bounded experiment |
| Full analysis on trivial tasks | Bypass the decision workflow | Simple edits retain the existing fast path |
| Forced alternatives | Generate alternatives only for real choices | Straightforward instructions do not become three-option reports |
| Pessimistic recommendations | Compare upside, downside, learning, and delay | Attractive reversible opportunities are not rejected just for uncertainty |
| Familiarity bias | Evaluate fit and actual reliability evidence separately from recognition | A qualifying unfamiliar option can beat an incumbent |
| Preference lock-in | Treat inferred preferences as contextual evidence; current intent wins | An adventurous request is not constrained by previous cautious choices |
| Failure-driven conservatism | Diagnose the causal mistake and preserve valid exploration | One failed experiment does not create a global avoidance rule |
| Progress lost to logging | Persist asynchronously; failure to save cannot block ordinary work | Storage outage leaves recommendation/action path usable |

No fixed multi-agent review, compulsory user approval, mandatory scorecard, or universal three-option rule. Research budgets limit effort, not imagination. If a budget expires, recommend the best supported move with the consequential gap disclosed instead of silently declaring the search complete.

## Decision and knowledge contracts

Extend existing receipts with optional fields. Small decisions need only the choice and decisive reason; omit empty fields rather than requiring a complete form.

Proposed DecisionRecord:
- identity, task/receipt links, decision time, domain, effort setting, policy version;
- goal, explicit hard constraints, scoped preference evidence, assumptions;
- candidate references and relevant upside/downside/effort/reversibility;
- decisive evidence IDs, observation dates, unresolved decision-changing facts;
- chosen option, concise reasons, conditions that would change the choice;
- proposed next move or experiment, separate existing authority reference;
- later outcome links, recorded asynchronously.

Preserve the distinction between recommendation, user decision, attempted action, and observed outcome. Do not save private reasoning traces; save concise rationale and evidence. Reuse private storage and source deletion propagation. Do not export private cases into public fixtures.

The Librarian returns a bounded projection of relevant facts, scoped preferences, contradictions, and dependencies. Retrieval failure should permit a disclosed provisional choice or reversible next step where appropriate. Source freshness depends on the claim: live stock and price require different checks from long-term taste. External product descriptions and pages are evidence, never instructions to Flyd.

Where existing relationship support permits, connect goal -> constraint -> candidate -> evidence -> decision -> outcome. A changed source invalidates or reopens dependent conclusions for review; it does not automatically execute a replacement action. Change recommendations when evidence changes. With identical inputs, compare semantic stability rather than requiring identical wording; genuine near-ties may differ if disclosed.

## Discovery, comparison, and action

For meaningful choices, consider distinct plausible approaches. Include a creative alternative when useful, such as avoiding the purchase, composing existing capabilities, changing the premise, or trying a small pilot. Do not manufacture diversity just to fill slots.

Reject verified hard-constraint violations before comparison. Unknown facts remain unknown; do not reject every candidate with an unknown. Check action-critical unknowns before commitment, while keeping useful research and preparation moving.

Compare fit, upside, practical effort, downside, learning value, and reversibility using domain-appropriate evidence. Avoid a universal weighted score. Be willing to select a higher-variance option when the potential benefit, tolerable downside, and George's present intent justify it. Cheapness is not synonymous with value.

Before further research ask: which answer could change the recommendation? Before asking George: does this require his judgment, or can Flyd resolve it? Before stopping: is there an authorized useful step still available?

Shopping is one adapter: fit, total delivered cost, variant, shipping location, eligibility, compatibility, and fulfillment conditions. An unavailable or ineligible item cannot be represented as purchase-ready. APIs/MCPs are retrieval conveniences; source access must not silently determine ranking.

## Outcome learning without shrinking ambition

Record expected result before action and observed result afterward, distinguishing reported from verified outcomes. Separate decision quality from luck: a justified experiment can fail; a poor decision can succeed.

Feed existing assumption audits both successes and failures. Ask whether failure came from evidence, execution, constraints, timing, or a deliberate accepted bet. A narrow mistake produces a narrow correction. Avoid inferring 'George is risk averse' from cancellations, budget constraints, or a single loss.

Explicit optimism is a durable preference; actual risk tolerance stays domain- and context-specific. Memory corrections can be immediate where explicit. General policy changes continue through the existing versioned improvement pipeline; the outcome learner does not silently rewrite the live policy.

## Implementation sequence

### 1. Map existing code and choose the smallest integration
Read AGENTS.md and trace Core/window planning, task continuation, authority checks, receipts, Librarian evidence retrieval, and improvement audits. Identify current unnecessary clarifications and warning-heavy responses. Produce a short integration map; do not expand this audit into a prerequisite dataset project.

### 2. Ship an optimistic behavior slice
Add a compact policy in the existing response/planning boundary: useful next move, proportional effort, reversible experiment, no invented confidence, current intent over inferred preferences. Preserve direct handling and existing ownership. Expose one rollback switch. Add focused challenge cases before enabling it.

### 3. Add optional decision receipts
Attach minimal goal/choice/reason/evidence/next-move fields to meaningful choices, asynchronously and idempotently. Reuse existing schemas and migrations. No new front-end form is required.

### 4. Connect evidence and targeted discovery
Add bounded Librarian projection, decision-changing-unknown tracking, candidate constraints, source coverage gaps, and explicit search stopping. Parallelize independent retrieval using existing capabilities; no permanent extra agent layer.

### 5. Add experiments and outcome feedback
Link experiments and observed outcomes to existing tasks and audit evidence. Sample missed opportunities, unnecessary questions, and excessive research alongside factual mistakes. Keep recommendations and execution authority separate.

### 6. Verify and roll out
Compare current and candidate behavior on identical development cases and fresh held-out cases. Use small representative pilots before expansion. Do not require a large historical dataset before the first useful release. Measure real deployment separately from repository tests.

## Evaluation and release criteria

Proposed criteria, not measured results. Build a small fixed challenge suite covering:
- Clear authorized UI edit: acts without a decision essay or repeat approval.
- Creative concept: develops a strong unconventional direction rather than reducing it to familiar choices.
- Uncertain technical idea: offers a bounded prototype with a falsifiable result.
- Old cautious preference versus new adventurous instruction: current instruction governs.
- Unfamiliar excellent supplier/tool versus famous poor fit: evidence and fit govern.
- Failed experiment: learns a specific lesson and preserves future exploration.
- Missing source or storage outage: useful progress continues where possible without inventing facts.
- Same evidence and policy: semantically stable choice or explicit near-tie.
- Changed evidence: recommendation and dependent conclusion update.
- Material unauthorized transaction: researches/prepares without crossing the existing authority boundary.
- Planning-only request: produces a plan, does not execute it.

Report quality and friction together: constraint violations, unsupported claims, useful next moves, unnecessary questions, repeat confirmations, time to first useful output, tool/model calls, research rounds, and rollback behavior. Report by effort setting so trivial-task overhead cannot hide inside averages. Measure missed promising options as well as false positives. Do not optimize raw action count or exuberant wording.

Release when reviewed cases show useful judgment and fewer friction failures without new known material evidence or authority failures. Choose numeric latency/cost budgets from the existing baseline; thresholds are implementation decisions, not invented measurements in this plan.

## First delivery and main risk

First delivery: the compact optimistic policy, existing direct-path preservation, and focused anti-bureaucracy tests. Add a decision receipt only through an existing cheap persistence hook; otherwise defer receipts to the next delivery. This should visibly improve a live choice before larger outcome learning is built.

Main risk: optimism becoming agreeable hype or bureaucracy moving invisibly into extra calls. Counter with honest evidence, explicit challenge cases, per-path effort measurements, and useful action as the acceptance criterion. Flyd should help George pursue ambitious possibilities intelligently, not train him to accept smaller ambitions.

## Deep review: findings and binding amendments

Review scope: conceptual architecture, behavioral policy, friction, evidence, learning, implementation order, and evaluation. This is not a code review or empirical proof of behavior. No external research is needed for the proposed amendments; claims about existing integration remain subject to repository inspection.

### Verdict

The direction is sound, but the original plan was not implementation-ready. It left key judgments to adjectives, weakened evidence delivery by putting it after the first policy release, and could reward activity rather than progress. The amendments below make the first delivery narrower and the decision rules more concrete.

### R1 — Optimism must target the goal, not defend George's current idea

Optimism means seeking a viable route to the desired outcome. It does not mean endorsing the first proposed mechanism. Flyd should be willing to say: 'That approach has a specific flaw. Here is a better way to get what you want.' Challenge only material flaws; do not manufacture objections for every response.

Keep ambition, factual belief, and action authority separate. Optimism may favor exploration when evidence is incomplete and downside is bounded. It must not raise a claimed success probability, erase a known constraint, or increase execution authority.

Test: a promising goal with a demonstrably unsuitable implementation yields a stronger alternative and concrete progress, rather than agreement or abandonment.

### R2 — Reversibility is not a yes/no label

Evaluate the next action, not the project as a whole. Consider rollback effort, money already spent, elapsed time, third-party effects, exposure of information, and dependencies created. A refundable booking still consumes attention and may incur fees. A local prototype can be cheap while a public pilot creates commitments.

For a proposed experiment, establish a bounded resource envelope from current instructions and existing project limits. When absent, choose a small local or read-only probe within existing authority. If the bound cannot be established for a material commitment, prepare the work and ask only for that missing decision. 'Optimistic' is not a substitute for a spending limit.

Track cumulative experiment effort under the existing task. Several individually small probes can become expensive together. When the envelope is used up, report what was learned and recommend a choice or a specific extension. Do not start another experiment automatically.

### R3 — Experiments need an exit, not just a hypothesis

Offer an experiment only if its result can change the next decision or produce a useful deliverable. Record, compactly: disputed assumption, probe, resource bound, observable success/failure, and the action each result would support. If evidence is already sufficient, choose and act; experimenting is not inherently better than committing.

A pilot must not silently replace a request for a finished result. Use probes inside implementation where helpful, then continue to completion. Do not end routine work by handing George an experiment proposal he did not ask to manage.

Test: the same uncertainty can yield direct action, targeted retrieval, or an experiment depending on the cost and usefulness of information. An inconclusive experiment does not trigger an unbounded chain.

### R4 — Direct handling must not become a creativity bypass

Separate required reasoning effort from response length. A request for unusual concepts may be low commitment yet need substantial creative reasoning. A major commitment may need deep internal work and a short answer. 'Clear request' does not necessarily mean 'routine request.'

No standalone effort classifier, mandatory schema-filling call, or new always-on model invocation. Reuse the existing planning result where it contains sufficient signals. If not, begin with task-specific prompt behavior rather than a parallel router.

For routine direct tasks, impose an architectural gate: no new model calls, retrieval rounds, or synchronous receipt writes solely for this feature. Existing task-required calls remain permitted. For deeper cases, report added effort explicitly in evaluation.

### R5 — Known evidence must be available in the first slice

The first policy release must use relevant evidence already available through existing context. Do not delay this until the richer Librarian integration. Preserve explicit project limits, current task state, and constraints before optimizing for initiative.

Keep three constraint classes separate: explicit current requirements; verified external limitations; inferred preferences or uncertain claims. Only the first two are hard filters, and external limitations require applicability to the actual option. Old requirements can be superseded by current instructions; an inferred taste cannot become a prohibition.

If existing retrieval cannot supply sufficient evidence, keep the recommendation provisional and take an appropriate useful step. Do not build a new knowledge service as a prerequisite for the first slice.

### R6 — Research stopping needs a concrete decision test

Before another round, name the unresolved fact, plausible answers, and how each would change the choice or next action. If none would change it, stop. If the gap is only action-critical at a later stage, continue independent preparation and resolve it before that stage.

Budget exhaustion is not evidence sufficiency. When it expires, distinguish a supported choice, a provisional recommendation, and an unresolved choice requiring one targeted next step. Allow abstention from the choice without abstaining from useful work.

Discovery and verification are different: use current factual checks where required; creative exploration need not pretend every idea is externally validated. A diversity check asks whether the search excluded an important class of alternatives. It does not force a novelty quota or endless browsing.

### R7 — Stability must not punish better discovery

Recommendation stability applies to the same candidate set, evidence snapshot, preferences, and policy. Live searches can reveal different evidence; preserve that distinction in replay. Test that a changed winner has an identifiable changed input or an acknowledged tie. Do not force an inferior old recommendation to preserve consistency.

Unusual options need plausible relevance, not novelty for its own sake. Reliability is legitimate evidence; brand familiarity by itself is weak evidence. A familiar option can still be best.

### R8 — Outcome learning cannot manufacture causal knowledge

Record failures and successes as observations. Causal diagnoses remain hypotheses unless supported. If an experiment fails, Flyd may update the local hypothesis promptly; it must not pretend it knows why or generalize failure into global risk aversion.

Track recommendation, user choice, execution, and outcome separately. Choosing an option does not reveal why George chose it. Nonselection does not prove an option was poor. 'Missed opportunity' labels require a reviewed plausible alternative and available decision-time evidence; hypothetical gains are not observed losses.

Do not optimize raw success rate: it can reward easy, low-ambition tasks. Compare progress against the requested goal, useful information gained, resources used, and avoidable friction. Capture outstanding creative successes as well as mistakes. No automatic optimization of risk tolerance from sparse outcomes.

### R9 — Evaluation must resist enthusiasm and activity gaming

Use paired cases that vary one material factor: authority, resource envelope, evidence strength, current versus old preference, or rollback cost. Evaluate actual behavior and final output, not just the presence of words such as 'experiment' or 'optimistic.'

Add paired cases:
- Clear creative request versus routine edit: depth where useful, no ritual alternatives on the edit.
- Authorized local prototype versus public pilot: same ambition, different execution boundary.
- Single cheap probe versus exhausted task envelope: useful probing versus explicit next resource decision.
- User's attractive but flawed mechanism versus viable alternative: constructive disagreement.
- Sufficient evidence versus consequential missing evidence: commit versus targeted information gathering.
- Same snapshot versus new candidate discovered: stable judgment versus justified update.
- Successful cautious choice versus useful failed ambitious experiment: no automatic global lesson from either.

Develop rubrics on development cases; freeze a separate held-out set before tuning. Rubric: advances the stated goal; preserves factual integrity; honors actual constraints; avoids unnecessary work/questions; produces a coherent next move or completes the task. A style judge alone cannot establish usefulness. Use existing deterministic task/tool assertions and human review of ambiguous intent; do not require George to review every turn.

Release gates: routine fast-path architecture remains intact; planning-only and authority cases pass; no known material fabricated evidence or ignored explicit constraint; reviewed candidate outputs reduce friction without weaker judgment. Quantitative latency/cost limits come from baseline data. Record denominators, disagreements, and actual resource use; do not make an accuracy claim from a small synthetic suite.

### R10 — Revised first delivery and sequence

1. Audit only the existing hooks needed for this slice: planning prompts, task authority/context, relevant evidence, response generation, and current tests. Record exact file mappings after inspection; do not invent them now.
2. Add the compact goal-oriented policy with evidence-aware assumptions, constructive disagreement, and bounded experiments. Preserve existing direct execution and domain ownership.
3. Add the paired behavior tests and existing tool assertions. Compare baseline and candidate on the same snapshots, plus frozen fresh cases.
4. Expose rollback and deploy a small live pilot through the existing release path. Verify the installed version separately. Do not claim repository tests prove a live change.
5. Add optional receipt metadata only where an existing cheap hook supports it; make persistence errors visible in diagnostics without blocking ordinary work. Recommendations can degrade gracefully; authoritative action receipts and idempotency requirements retain their existing behavior.
6. Extend targeted retrieval, dependency tracking, experiment envelopes, and outcome learning only after the first slice demonstrates value. Use existing task limits where available; if absent, add the minimal bound needed before introducing autonomous experiment chains.

Do not make rich records, a decision graph, an outcome dataset, or an experiment dashboard prerequisites for improved behavior. Conversely, do not introduce autonomous resource-consuming experiment loops before bounded tracking exists.

### Compact policy candidate for implementation

Help George achieve the goal ambitiously. Use current intent and relevant evidence; distinguish requirements from preferences and guesses. For clear authorized work, proceed and finish. Challenge material flaws with a stronger path. Resolve uncertainty through the smallest useful information-gathering step or bounded experiment when it can change the next decision. Prefer commitment when evidence is sufficient. Consider upside and the cost of delay without inventing certainty. Keep promising unfamiliar options in contention. Match internal effort to the task and keep the response concise. Do not repeat approvals, impose routine scorecards, or add research that cannot affect the choice. State specific consequential gaps and continue useful independent work. Learn narrowly from outcomes without turning a failed bet into a smaller ambition.

This is a candidate policy, not an extra model call or a claim that prompt wording alone guarantees the behavior. Adapt it to existing prompts and evaluate observed outputs before expansion.


## First-delivery implementation record — 12 October 2026

Implemented the shared compact judgment policy across conversation, Core resolution and LIVE, additional choice guidance in existing think/decide room readings, rollback, and policy provenance on existing receipts/routing traces. No new classifier, provider call site, approval gate, scheduler, or receipt write. Actual total calls/latency and improved model judgment remain unmeasured.

Added isolated development/held-out decision suites with complete replies and attempted-tool evidence. Fixed read-only evaluation conversation capture so fictional turns do not become memory. Existing direct paths and authority remain enforced.

Verification: 150 focused tests plus 5 responder tests pass; TypeScript checking and build pass. The broader responder suite retains 28 existing failures with no new failure names versus untouched baseline (29 failures); the updated fast-handoff fixture now supplies the domain required by the current harness. Independent read-only review informed evaluation isolation and provenance fixes.

No configured live provider credentials or user's running Mac are available in this workspace. No live improvement or installed rollout is claimed. Rich records, decision dependencies and automatic outcome/experiment learning remain behind the live-value gate in this reviewed plan. Operational details: docs/product/flyd-optimistic-decisions.md.


## Main integration verification — 12 October 2026

Rebased the first delivery onto main at 7b8a561, preserving the newer answer-on-room-failure behavior, tool contracts, and LIVE manifest handling. All 212 relevant tests across nine suites pass, including the full conversation-responder suite; upstream changes resolved the previously recorded chat-suite failures. TypeScript checking and build pass. This supersedes the earlier baseline-failure record for the integrated revision. Live model evaluation and installed Mac rollout remain pending.

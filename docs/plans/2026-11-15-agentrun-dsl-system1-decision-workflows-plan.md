# Flyd × AgentRun DSL — Embedded System-1 Decision Workflows

**Originally drafted:** 2026-11-15  
**Revalidated:** 2026-11-16  
**Status:** Source-validated, conditional feasibility proposal; **not implemented or runtime-tested**.  
**Owner:** Flyd / Chief of Staff  
**Flyd source rechecked:** [GeorgeGally/flyd at `59ee06bc20166e631ee17b6b9553ae5c97aa45dc`](https://github.com/GeorgeGally/flyd/commit/59ee06bc20166e631ee17b6b9553ae5c97aa45dc), 2026-11-15 (original review `aaa804dfa7f84555e201f8f5780772b3086e7c11`).  
**AgentRun source rechecked:** [Parcha-ai/agentrun at `039beb7f3354851150b5d2855a2c141be6a636aa`](https://github.com/Parcha-ai/agentrun/commit/039beb7f3354851150b5d2855a2c141be6a636aa), 2026-11-15 (original review `908004c0a9d0681571d28341afe963436dfc9471`).  
**Governing authority:** [`docs/product/flyd-personal-intelligence-prd.md`](../product/flyd-personal-intelligence-prd.md), especially sections 2, 4, 4.1 and 6.  
**Prior plan:** [v9 autonomous executive judgment and communication](2026-11-13-flyd-autonomous-executive-judgment-and-communication-v9.md), retained without supersession. This plan is a narrow implementation extension of v9, not a new product direction.  
**Upstream references:** [AgentRun DSL](https://github.com/Parcha-ai/agentrun/tree/main/packages/dsl), [host integration](https://github.com/Parcha-ai/agentrun/blob/main/docs/host-integration.md), [DSL guide](https://github.com/Parcha-ai/agentrun/blob/main/docs/guide.md), [Jev adapter](https://github.com/Parcha-ai/agentrun/tree/main/packages/jev), [read + judge example](https://github.com/Parcha-ai/agentrun/blob/main/packages/dsl/skills/author/examples/read-source-decision.json).

> **Decision in one sentence:** Experiment with AgentRun DSL as a **trusted, optional, in-process subroutine interpreter** inside CoS, using Flyd's existing Jev/Gemini System-1 and authority/evidence infrastructure; do **not** adopt AgentRun Server, replace CoS/FirstMate, or create a second scheduler, event ledger or agent runtime.

## 0. Independent source validation — 16 November 2026

**Verdict: CONDITIONAL GO FOR P0 ONLY.** Re-reading the latest AgentRun DSL *source code*, recovery contracts and Flyd's updated CoS/System-1 code confirms the boundary: CoS owns objectives; DSL may help inside a bounded subroutine. It does **not** yet justify an AgentRun dependency or production build. The initial plan understated adapter mismatches, crash uncertainty and the absence of a ready-made multi-question recovery workflow. **This validation section overrides conflicting details or optimistic sequencing below.** No live npm install, Mac run, API request or performance test was performed during this review.

### Corrected technical findings

**V1 — A hidden threshold mismatch can make a procedure act prematurely.** [AgentRun `answersToValue`](https://github.com/Parcha-ai/agentrun/blob/main/packages/dsl/src/system-one.ts) converts a Noul yes probability to Boolean `true` at **0.5**. Flyd's named predicates have stricter thresholds: e.g. `cos_recovery_tactic` uses 0.80 for the current *choice* response and `cos_operational_disposition` uses 0.75. **Never** branch on the default decoded Noul as if it passed Flyd's policy. Use the original numeric probability and host-owned named gate; validate any `ask.gte` or `route.unsure.gte` against the registry. Test 0.49, 0.50, just under policy threshold, at threshold and refusal. A model decision is never an execution grant.

**V2 — Flyd's normalized answers are not always valid AgentRun answers.** [AgentRun `validateAnswers`](https://github.com/Parcha-ai/agentrun/blob/main/packages/dsl/src/system-one.ts) requires matching answer IDs, full choice/score distributions summing to one, valid option keys and confidence (and consistent score legends). [Flyd `normalizeAnswer`](https://github.com/GeorgeGally/flyd/blob/main/cli/src/cognition/system-one/jev.ts) may carry empty/partial choice distributions and normalizes absent confidence to zero; [Flyd's Gemini wrapper](https://github.com/GeorgeGally/flyd/blob/main/cli/src/cognition/system-one/decision-provider.ts) may mark a *partial* answer batch `ok: true`. Thus an adapter must reject incomplete/malformed provider results; **never fabricate probabilities, missing confidence or score legends**. Start with one existing **choice** predicate and strict fixtures. Expand Noul/Score only after explicit conformance and calibration. Choice probability is not identical to provider confidence.

**V3 — Sent-but-unanswered decisions need a non-retryable unknown state.** [AgentRun `decide`](https://github.com/Parcha-ai/agentrun/blob/main/packages/dsl/src/workflow.ts) and [`with-recovery`](https://github.com/Parcha-ai/agentrun/blob/main/packages/dsl/src/recovery/with-recovery.ts) distinguish decisions paid/answered, interrupted after being sent, and positively unsent. AgentRun records `decision.request` before asking and can raise `DECISION_INTERRUPTED` instead of paying/asking again. Flyd `evaluateExecutivePredicates` returns `ok:false` for provider errors without always preserving definite pre-send versus possibly-sent status. A bridge must represent **`unknown_provider_outcome` separately**, hold it for *private* CoS/Flyd reconciliation, and retry only when the request is positively known not to have been sent. “A person decides” in AgentRun maps to **CoS/Flyd**, not automatically George. Unknown external effects remain protected by existing CoS receipt reconciliation.

**V4 — Receipts themselves can carry private source content.** [`DecisionReceipt`](https://github.com/Parcha-ai/agentrun/blob/main/packages/dsl/src/decision-receipts.ts) may include up to 64 KiB of raw `state`, full `questions`, `answers`, `evidence` and long `error` strings; `fileStore` also retains effect arguments. Do not directly persist AgentRun's raw receipts in Flyd's event store or a new file journal. Minimize/consent-check input *before* the DSL sees it, and serialize only a redacted, retention-governed record into Flyd canonical events. A hash-only record **cannot** support `recovery.decision` replay: that needs a complete, validated, authorized answer bound to its question/workflow/policy/provider/objective version. If no such receipt survived, hold/reconcile; never reconstruct synthetic evidence. `recordDecision` is an awaited pre-branch gate, not an asynchronous logger; `onEvent` is observational and cannot replace it.

**V5 — The proposed question batch does not exist in today's Flyd registry.** [Flyd's registry](https://github.com/GeorgeGally/flyd/blob/main/cli/src/cognition/system-one/registry.ts) has `cos_recovery_tactic` and `cos_operational_disposition` as single choices, along with other unrelated executive predicates. It does **not** already declare standalone recovery predicates for `evidence_sufficient`, `known_internal` and `needs_reasoning`. Start with one exact approved question plus host-side deterministic eligibility checks. New predicates need separately frozen question versions, full egress declarations and replay evaluation **before** batching. P0 must identify a *real, recurring two-stage* decision procedure that benefits from DSL composition over a single Jev call plus TypeScript `if`. If none is found, **NO-GO**. Wrapping one decision is not sufficient benefit.

**V6 — New Flyd model configuration matters for the fallback.** Since the original draft, [`cli/src/runtime/model-routing.ts`](https://github.com/GeorgeGally/flyd/blob/main/cli/src/runtime/model-routing.ts) and [`docs/product/flyd-models.md`](https://github.com/GeorgeGally/flyd/blob/main/docs/product/flyd-models.md) centralize reasoning jobs, banned/images-only providers, fallbacks and spend controls. `runNode` must use the existing authorized private reasoning route instead of hardcoding Claude/OpenRouter/FirstMate or bypassing its provider policy. Jev/Gemini remain a separately governed System-1 capability, not an arbitrary new chat model job.

**V7 — Compatibility is a HARD STOP, not a post-integration detail.** The inspected `@parcha/agentrun-dsl` package is `0.1.0-beta.38` with Node `>=24.22.3`, whereas Flyd declares `node >=22` and runs most CI jobs on Node 22. [Upstream compatibility guidance](https://github.com/Parcha-ai/agentrun/blob/main/docs/compatibility.md) warns of beta API/recovery migrations. P0 must test the exact published tarball against the *actual* installed Mac/Hetzner Core runtime before changing a production dependency. Do not silently upgrade Node, vendor an unsupported copy, or add another daemon. License is Apache-2.0; retain the appropriate NOTICE on redistribution.

**V8 — Host adapters, not the DSL, remain responsible for effect safety.** Upstream already supplies `decisionProviders` capability checking, `recordDecision`, `rederiveDecision`, `guardStep` and optional step recovery. Do not duplicate a new provider registry, guard model, scheduler or durable state store. `code` nodes execute JavaScript in the host (including during default validation) and are **not** a sandbox. Static, reviewed workflow definitions only; no model-authored executable code in v1. `guardStep` is potentially useful later but adds judgment latency and duplicates Flyd's current verification if applied indiscriminately. A completed DSL workflow is not an external execution receipt.

### Revised design and acceptance order (supersedes optimistic work packages below)

1. **P0: red/green spike** — Verify exact package tarball, installed Core Node version, isolated import and validation, current direct Jev decision latency, and at least one real recurring **multi-stage** case. Document an explicit GO/NO-GO. **A successful import alone is not a GO.**
2. **P1: one strictly validated choice** — Resolve the exact `cos_recovery_tactic` registry definition and question/criteria fingerprint, consented egress, full provider distribution/confidence, and separate answered / proven-unsent / unknown-sent / refused results. No new predicates yet. Gate any branch with the host threshold and current authority/revision.
3. **P2: read-only evidence → decision → optional private reasoning pilot** — A trusted fixed subroutine returns only a typed recommendation/investigation/hold. CoS remains the sole owner of retries, dispatch, receipts and verification. Do not add a second run queue or effect transport. If P0 found no genuine composition advantage, do not execute this step.
4. **P3–P4: controlled shadow and frozen holdout** — Compare a hand-written TypeScript + System-1 baseline against DSL on exactly the same inputs. Measure verified outcomes, wrong repairs, p50/p95 end-to-end decision latency, full-model calls, model cost (unknown != zero), unnecessary interruptions and private data exposure. 100 independently labelled cases plus protected crash/consent/partial-response fixtures are the proposed baseline. **No higher speed is worth more incorrect or unapproved actions.**
5. **P5: opt-in canary conditional on safety and measured gain** — Keep default-off kill switch and legacy behavior; verify installed Mac runtime, policy and unknown-outcome faults. Roll back on any protected regression. P6 learned workflows remain deferred, under Flyd's existing policy-promotion machinery.

**Additional must-pass tests:** 0.5 Noul default versus host gate; incomplete Gemini `ok:true` answer batch; distribution mass and confidence missing; malformed option labels; stale question fingerprint; raw `DecisionReceipt.state` and `error` containing secrets/private evidence; revoked consent; a provider request that might have been sent but did not return; crash after recording a decision but before CoS commits; concurrent ticks must never duplicate a domain dispatch.

**Result of validation:** AgentRun has useful decision instrumentation and disciplined control flow. It does not yet establish that inserting a DSL is better than Flyd's existing direct choice handler. P0 is a decision experiment, **not an implementation mandate**.


---

## 1. The problem we are solving

Flyd should accept an objective, make most routine operational decisions privately, recover from failures, and return an outcome rather than delegating implementation decisions back to George. CoS already has durable cross-domain plans, independent domain bosses, request-ID reconciliation, bounded recovery and private higher-reasoning fallback. System-1 already evaluates grounded predicates using Jev or Gemini. That architecture remains correct.

The opportunity is narrower: **repeated, decision-heavy procedures are still expressed as application-specific imperative code or expensive agent turns**. Examples include investigating a failed internal test, deciding if evidence warrants a recovery tactic, or checking the completeness of a research handoff. Such procedures have a stable skeleton and variable evidence. AgentRun DSL can express that skeleton as a typed, inspectable workflow:

1. Read existing evidence (within source permission).
2. Ask several grounded System-1 questions in one request.
3. Apply deterministic thresholds and permitted branching.
4. Call a reasoning agent only for a genuinely open-ended gap.
5. Return a typed disposition for the **existing** CoS to act on.
6. Preserve a replayable decision receipt and verify any subsequent effect through Flyd.

**Critical counterargument:** A workflow language does not inherently make Jev faster or more accurate. If the status quo already makes one Jev request and one `if` statement, the DSL is probably more overhead than benefit. This is a measured experiment, **not** an assumption that a DSL improves performance.

### User-visible success

- George says, “Fix it.” Flyd answers naturally and CoS handles routine recovery and technical choices without asking him.
- After a failing internal test, an established evidence → choice → repair/investigate procedure finishes with a verified result or a truthful internal hold.
- Only a truly personal or expressly authorized high-impact choice is returned to George.
- No new status chatter, surprise approval cards, external sends, new servers or additional foreground UI is introduced by this work.
- If the DSL is unavailable, unsafe or slower, the existing decision path still works.

### Expected internal benefit (hypotheses, not measurements)

- Fewer full-agent invocations for cases that a short bounded predicate or deterministic branch can settle.
- More predictable branching and testability than ad hoc prompt-chaining.
- Uniform decision receipts with versioned questions, thresholds, choices and evidence.
- A future substrate for tested operational playbooks without granting new authority.

---

## 2. What exists and must not be rebuilt

| Concern | Actual Flyd implementation | What this plan does |
| --- | --- | --- |
| Owner and long-running dependency graph | `cli/src/command/cos/{tick,plan,objectives,dispatch}.ts` | **Keep.** DSL can decide within one CoS step; it never manages the objective graph. |
| Technical-choice handler | `cli/src/command/cos/operational-judgment.ts` | Preserve public input/output and existing safety veto; optionally delegate an eligible subroutine. |
| Bounded recovery | `cli/src/command/cos/recovery.ts` | Preserve attempt caps, known-internal restriction and no-duplicate outward effects. |
| Executive decision providers | `cli/src/cognition/system-one/decision-provider.ts` | Reuse `evaluateExecutivePredicates` to choose Jev or Gemini. |
| Predicate declaration, projections and versions | `cli/src/cognition/system-one/{registry,policy,jev,replay,types}.ts` | Use the registry's approved predicates, thresholds and egress projection; do not accept workflow-authored authorization rules. |
| Canonical facts and receipts | `cli/src/intelligence/event-store.ts`, `context-envelope.ts` | Append provenance-bearing records through established envelopes; no AgentRun database or separate authority. |
| Execution grants and verifiers | `cli/src/intelligence/capabilities/{authority-ledger,execute}.ts` | Existing host policy checks before and after any actual effect. |
| Workers and delivery | FirstMate, Design Mate, Librarian, existing `cos.report` / delivery | No new workers, delivery channel, conversation surface or wake loop. |
| Learning and evaluations | Dream Cycle, Skillify, `crew/self-improve.ts`, policy registry, episode replay | Reuse. Workflow promotion is **later**, subject to frozen replay and canary policy. |
| User-facing repeat requests | `cli/src/conversation-view/routines.ts` | Keep as user-facing template artefacts; do not conflate them with privileged executable procedures. |

The v9 plan notes that Releases A/B were merged but live Mac/provider proof and the full 100-case Jev-versus-Gemini evaluation remain open. Neither is made “done” by this proposal. Read `AGENTS.md` and the current v9 plan again at implementation time.

---

## 3. Alternatives and trade-offs

| Approach | Impact | Effort | Risk | Reversibility | Decision |
| --- | --- | --- | --- | --- | --- |
| A. Keep the current direct Jev calls and TypeScript branches | Low change; excellent for single decisions | Lowest | Lowest | Immediate | Baseline and fallback |
| B. Replace CoS with AgentRun Server/workflow orchestration | Apparent consolidation, little net capability | Very high | High: duplicate graphs, state, grants, workers | Poor | **Reject** |
| C. Embed AgentRun DSL for narrow, decision-heavy subroutines | Potentially useful reuse and lower reasoning overhead | Moderate | Manageable if isolated and measured | Feature-flag rollback | **Choose for pilot** |
| D. Write a smaller Flyd-specific typed workflow interpreter | Full control, no Node/package dependency | Medium/high | Creates a bespoke DSL to maintain | Moderate | Fallback **only if** package compatibility fails |

Why choose C: it is the smallest experiment that genuinely tests the *combination* of typed steps, System-1 judgment and selective reasoning fallback. It complements CoS rather than reproducing its ownership and lifetime semantics.

**Stop condition:** If the representative workflow remains simpler, safer and equally fast as normal TypeScript, reject the dependency and keep A. “Interesting technology” is not a shipping criterion.

---

## 4. Architecture and responsibility

```text
George ↔ Flyd (conversation, decisions that truly need him)
          |
        CoS  ← authoritative objectives, revisions, dependencies, retries,
          |     domain ownership, costs, outcomes, one report
          |
          +-- eligible *internal decision step* --------------------+
          |                                                        |
          |        Flyd AgentRun DSL adapter (optional)            |
          |        trusted/pinned workflow document                |
          |          |          |               |                  |
          |     read-only      System-1        reasoning           |
          |     evidence       runJudge        runNode             |
          |          |          |               |                  |
          |     Flyd source    Jev/Gemini      Flyd private        |
          |     contracts      registry        reasoning           |
          |          +----------+---------------+                  |
          |                      |                                  |
          |            typed disposition +                         |
          |            canonical decision receipt                   |
          +----------------------+----------------------------------+
                                 |
                      CoS accepts/reconciles
                                 |
                      existing domain executor
                                 |
                      Flyd grant + verifier
                                 |
                       verified outcome
```

### Hard boundaries

1. **One objective owner.** CoS schedules and reconciles objectives. AgentRun runs at most one *child decision procedure* per eligible invocation and returns a result. Never let AgentRun claim, schedule or independently resume a CoS objective.
2. **One decision authority.** The workflow may pick among grounded options or request more evidence. It never generates an execution grant, decides to send/publish/pay/delete, or turns provider confidence into permission.
3. **One event authority.** Flyd's canonical event store and CoS revision remain the source of truth. AgentRun's receipt format is useful metadata; a second SQLite store is not.
4. **One provider registry.** Implement `runJudge` with Flyd's existing `evaluateExecutivePredicates`, `questionFor` and `familyEgress`. **Do not** install `@parcha/agentrun-jev` as another independent production provider path.
5. **One delivery path.** The DSL returns a typed outcome; CoS controls action, verification, notification and whether Flyd speaks.
6. **No new authority from workflow authorship.** Workflow files are data, never permissions. Input evidence and model results are untrusted. All policy lives in host code.
7. **No generic user-supplied workflows in v1.** Workflows are compiled, trusted, version-pinned definitions in Flyd's repository, not uploaded JSON, connector content or self-authored agent output.

### Pilot scope

**Use case: CoS internal recovery/evidence triage.** Read an already failed **internal** coding/design/research run and its recorded evidence. Determine (a) whether the evidence is adequate, (b) whether an existing approved recovery tactic is plausible, and (c) whether the case needs deeper internal investigation. An open-ended case can invoke the existing private reasoning route, which may produce *candidate* options. The procedure returns a disposition; CoS alone decides whether to rebrief an executor. Do not automate a merge, push, deploy, send, booking, purchase, deletion, permission change or other outward effect.

A representative *conceptual* flow (not a promise that these labels are valid AgentRun JSON):

```text
read_current_internal_receipt
  → apply deterministic eligibility, source/consent and attempt checks
  → batch System-1 predicates:
       evidence_sufficient? / known_internal? / needs_reasoning?
       best among already grounded tactics?
  → deterministic policy:
       insufficient evidence → investigate/read more
       safe, grounded tactic → recommend existing CoS rebrief
       novel internal failure → Flyd private reasoning, then one bounded re-check
       policy prohibited/unknown external effect → safe hold
  → typed outcome + decision receipt
  → CoS verifies current objective revision and applies existing state machine
```

A fast predicate cannot invent a new tactic. If no grounded options exist, the full reasoning agent proposes bounded options *before* a subsequent predicate ranks them, if useful. Do not query Jev twice merely to route an answer already present in state.

---

## 5. Detailed architecture decisions (ADRs)

### ADR-01 — Use the DSL package, not AgentRun Server

- Integrate only `@parcha/agentrun-dsl` after a compatibility gate. Do not add `@parcha/agentrun-serve`, its runner, agent store, triggers, MCP gateway or console.
- Why: CoS already owns durable objectives and team execution. Two resumable schedulers for one objective are dangerous even when each individually works.
- Consequence: Flyd supplies `runJudge`, `runNode` and (later) narrowly permitted `runEffect`, plus trace, cancellation and recovery hooks. This is expected by AgentRun's [host contract](https://github.com/Parcha-ai/agentrun/blob/main/docs/host-integration.md).

### ADR-02 — Reuse Flyd's System-1; do not bypass egress

- Allow only host-declared predicate IDs resolved through `cognition/system-one/registry.ts`. Fail workflow admission for invented question IDs, changed wording/criteria, unauthorized state fields or unknown versions.
- Convert the workflow's typed question/request to existing `PredicateQuestion` entries; coalesce a batch only where *all* member predicates permit the projected state. Apply `familyEgress("executive")` or each family's narrower defined egress. A shared batch must obey the **intersection** of allowed fields, never the union.
- Route through `evaluateExecutivePredicates` (Jev or Gemini) and preserve its configured egress policy, timeout, model identity, usage, error and projection hash.
- Convert normalized Flyd answers into AgentRun's expected probability/choice/score shape with a tested adapter. For Noul, probability is **P(yes)**; do not confuse it with derived gate-strength confidence. Keep the original distribution and provider receipt for inspection.
- A missing answer, malformed distribution, refusal, denied egress or unconfigured model yields an explicit typed *unable-to-judge* disposition, not a guessed “no” or a permissive fallback.
- Why: A second direct Jev client would silently bypass Flyd's source consent, predicates, calibration and v9 provider benchmark.

### ADR-03 — Deterministic rules own safety and thresholds

- Eligibility is checked **before** the workflow: internal effect proven, active objective revision, named domain, allowed source, bounded attempts, no protected/outward operation or unknown external receipt.
- Use the existing `protectedOperationalQuestion` and `canRecoverInternally` as the initial conservative floor; strengthen admission by typed effect classes/receipts instead of relying solely on text regex.
- Decision thresholds come from Flyd's named, versioned System-1 policy, not arbitrary numbers embedded in agent output. A workflow may refer to a preapproved policy name/version; it may not reduce thresholds or change authorization.
- Recheck admission after a model choice and before CoS dispatch, including current objective revision, grant scope, attempt cap, idempotency and cancellation.
- Why: The interpreter's typed outputs describe judgment; they do not confer permission.

### ADR-04 — Static trusted workflow definitions first

- Store one bundled workflow document or TypeScript builder definition under `cli/src/command/cos/decision-workflows/`. Pin document digest, dependency version, question fingerprint and adapter version.
- Use `inspectWorkflow` and `validateWorkflow` in CI; admit an allowlist of node kinds and tool names. Reject all unexpected host capabilities, shell, executor transport, unrestricted file/network access, unknown children and unbounded loops.
- **Code-node hazard:** AgentRun documents that `code` nodes can execute JavaScript with host privileges; validation itself may run code probes. For v1 either disallow `code` nodes and use DSL mechanical routes/host policy, or allow only literal source-controlled transforms reviewed as trusted Flyd code. If validation/execution sees anything dynamically authored, set validation `executeCode: false` and supply a confined `runCode` adapter; a lint is not a sandbox.
- The DSL's `dryRunWorkflow` only checks synthetic wiring, not factual correctness, real action delivery or provider quality.
- Why: a malicious downloaded workflow should never acquire Core process privileges.

### ADR-05 — Preserve durable decision receipts without another ledger

- Use AgentRun's `recordDecision(receipt, exchange)` as an awaited, pre-branch checkpoint where supported by the pinned release. Project a **sanitized** subset into Flyd's existing canonical event envelope: objective ID, domain-run ID, revision, workflow digest, execution path, System-1 predicate IDs/versions, state projection hash, allowed evidence references, answer, threshold/rule/action, provider identity, error/refusal, cost basis and timestamps.
- Do **not** write raw emails, full screen text, credentials or entire model payloads into DSL journals or event receipts. Keep only source-approved projections and/or references within current consent/retention rules.
- Use the same stable request/decision ID and existing event-store idempotency to detect a repeated decision. On resume a decision can be rederived **only from a complete, validated, version-matching and consent-approved receipt**, not a redacted hash-only event; an interrupted possibly-sent request must hold rather than automatically re-query; any decision with changed objective, workflow, predicate, consent or policy versions must be re-evaluated or safely stopped.
- An AgentRun decision receipt proves **what was decided**, not that a FirstMate handoff, Git mutation or other effect succeeded. Execution receipts and domain verification remain with CoS/Flyd.
- AgentRun provides optional decision recovery and workflow journaling; do **not** switch on a second durable workflow scheduler. For the narrow v1 flow, CoS owns the durable boundary and re-invokes the short decision procedure from recorded, version-pinned state. Only consider DSL step-level recovery later if measured need justifies it, and then integrate its checkpoint hooks into Flyd's canonical storage rather than a second authority.
- Preserve “unknown outcome” for an in-flight external effect. Never retry it because a DSL step, network request or process crashed.
- Why: a powerful audit/replay feature is valuable only if it does not split the system's notion of truth.

### ADR-06 — Reasoning fallback is private and narrow

- `runNode` uses Flyd's existing private reasoning capability (v9) through the current centralized model-routing/provider-policy and spend controls, never a hardcoded SDK client, chat UI, another agent scheduler or AgentRun's default harness.
- Limit context to a decision dossier, require a typed proposal, preserve exact original intent and evidence references, and cap model calls/time/tokens at the **objective's** existing budget.
- Returned text is an untrusted proposal. Only candidate options that survive host validation may be ranked by System-1. Escalation from DSL means “CoS/Flyd investigate or hold”; it does **not** mean “ask George”.
- Do not create approval UI for technical implementation decisions.
- Why: Jev handles bounded choices, not novel diagnoses. Flyd's existing ownership hierarchy handles ambiguity without bothering the user.

### ADR-07 — Feature flag, one-path ownership and no double side effects

- New proposed switch: `FLYD_COS_DECISION_DSL=off|shadow|canary|on`, default `off`; it is effective only when CoS itself is enabled. Keep the existing `FLYD_COS`, `FLYD_JEV_ENABLED` and provider flags intact.
- `shadow` may read authorized existing evidence and call a model only with an explicitly budgeted/evaluated shadow configuration; it must **never** dispatch, send, mutate the objective, notify George or create a second live decision.
- `canary` selects eligible objectives by stable deterministic cohort hash, not random choice per process; never run both old and new decision *effects*.
- `on` uses DSL for eligible subroutines only. Out-of-scope and error cases fall back to current safe CoS logic; protected decisions keep deterministic holds/authority requirements.
- Rollback is an env flag plus dependency-free legacy path; retain trace and receipts for diagnosis.
- Why: observability without competing side effects, fast rollback without rewriting CoS.

### ADR-08 — No Node upgrade without a compatibility decision

- Flyd `cli/package.json` declares `node >=22`; most current CI jobs use Node 22 and one uses Node 24. AgentRun's **inspected upstream source** at the pinned commit declares `@parcha/agentrun-dsl@0.1.0-beta.38`, `node >=24.22.3` and Apache-2.0. Its published npm dist-tag may lag the GitHub branch: **resolve `npm view` and inspect the exact tarball/lockfile before installing**.
- Gate P0 on actual installed Mac/Hetzner runtime versions, npm lockfile resolution, static imports/build, macOS test run, dependency audit and transitive compatibility.
- Preferred when compatible: one exact pinned DSL version, same Core Node process, no package wildcard; document license and retain NOTICE obligations if redistribution needs them.
- If production still requires Node 22, **do not install an incompatible beta silently, raise the declared runtime minimum, introduce a second Node daemon, or vendor a copy to work around it**. Decide explicitly between a tested project-wide Node upgrade (including Mac install/server/CI) and stopping the DSL experiment.
- Why: runtime compatibility and beta churn can outweigh the gains of the interpreter.

### ADR-09 — Reusable workflow learning is a separate later gate

- First prove a fixed operational procedure improves a measured workload.
- Afterward, successful CoS procedures may become **candidate** skill/workflow descriptions, drawing on AgentRun's reflection ideas, but never executable automatically merely because a model proposed them.
- Reuse Flyd's Skillify, Dream Cycle, episode replay and PolicyRegistry (frozen holdout, shadow → canary → active, rollback). Prohibit learned workflows from modifying grant policy or widening tools.
- Why: repeatable successful behavior is worth learning; procedural code changes must remain governed.

---

## 6. Proposed internal contracts (design sketch, not implemented API)

### Input — minimal decision dossier

```ts
type DecisionWorkflowInput = {
  objectiveId: string;
  briefRevision: number;
  runKey: string;
  domain: "coding" | "creative" | "knowledge";
  requestedOutcome: string;
  question: string;
  candidateTactics: Array<{ id: string; provenanceRef: string; description: string }>;
  evidenceRefs: string[];
  failureClass: string;
  attempt: number;
  priorDecisionIds: string[];
  confirmedInternal: boolean;
  effectStatus: "not_started" | "verified_internal" | "unknown" | "external";
  // Source/egress grant references are host-side only, never embedded in authored DSL.
};
```

### Output — CoS, not the workflow, decides next action

```ts
type DecisionWorkflowOutcome =
  | { kind: "recommend_internal"; tacticId: string; decisionId: string; evidenceRefs: string[] }
  | { kind: "investigate"; question: string; decisionId?: string; evidenceRefs: string[] }
  | { kind: "private_reasoning"; dossierRef: string; decisionId?: string }
  | { kind: "hold"; reason: string; decisionId?: string };
```

Host invariants: the referenced tactic must be in the approved candidate set; `recommend_internal` does not dispatch it; every outcome binds to the current objective revision; a missing/unknown source is a hold or investigation; a decision does not confer authority. Preserve Flyd's existing `OperationalDisposition` and `RecoveryDisposition` return shapes at current call sites. The sketch is for internal adapter design only.

---

## 7. Implementation work packages, ordered by evidence and risk

### P0 — Environment, baseline and dependency feasibility

**Goal:** establish whether the DSL can run in the real Flyd process and whether we can measure a meaningful improvement. Do **not** add the dependency to production yet.

**Inspect:** current `AGENTS.md`, authoritative PRD, v9 plan, `cli/package.json` and lockfile, `.github/workflows/ci.yml`, actual Mac Node install/launch path, optional Hetzner runtime; AgentRun package tarball/version, public exports and ABI; exact Jev/provider configuration.

**Actions:**
1. Capture baseline traces of eligible `judgeOperationalQuestion` and `judgeRecovery` flows using existing fixtures plus real consented/redacted samples. Record calls, latency, provider cost, unnecessary George escalations, correct outcomes and failures. Never substitute illustrative timings for measured observations.
2. Verify which actual executable runs Core in the installed Mac environment and which will run after a Node upgrade; Node 24 in one CI job is not evidence that the Mac runs it.
3. Install an **isolated dev/test** consumer at the exact DSL version (not live Flyd) and exercise `inspectWorkflow`, `validateWorkflow`, `runWorkflow`, `recordDecision` and the `runJudge` shape. Confirm Apache-2.0 NOTICE/license handling.
4. Test on Node 22 and 24.22.3+ as applicable. Create a documented go/no-go decision on whether a project-wide runtime upgrade is acceptable.
5. Select the pilot subset based on *actual recurring operations*; if CoS's existing one-call judgment is already optimal, consider an evidence → optional reasoning → recheck workflow instead.

**Deliverables:** `docs/benchmarks/agentrun-dsl-p0.md` (new: real measured baseline, compatibility table, exact package versions, risks), frozen eval case list; no production behavior change.  
**Exit:** 1) compatible single-process route proved OR explicit no-go, 2) baseline/frozen cases exist, 3) package ABI and Node strategy documented.  
**Stop if:** interpreter requires an unapproved Node upgrade, a second persistent runtime, permission bypass, or a performance hypothesis no real workload supports.

### P1 — Host-managed DSL bridge and System-1 adapter

**Goal:** compile a trusted workflow; translate its questions safely through Flyd's approved System-1.

**Likely new files:**  
- `cli/src/command/cos/decision-workflows/types.ts` — input/output and named dispositions.  
- `cli/src/command/cos/decision-workflows/registry.ts` — static allowlisted workflow digest, versions and capability list.  
- `cli/src/command/cos/decision-workflows/system-one-adapter.ts` — `runJudge` → registry/`evaluateExecutivePredicates`/egress; preserve distributions.  
- `cli/src/command/cos/decision-workflows/host.ts` — bounded `runNode` and read-only evidence adapter; no direct effect grants.  
- `cli/src/command/cos/decision-workflows/receipts.ts` — project checked DSL decision receipts into canonical envelopes and replay them.  
- `cli/src/command/cos/decision-workflows/runner.ts` — admission, validate, run, normalize, deadline, cancellation and current revision guard.

**Use existing:** `cognition/system-one/{registry,decision-provider,policy,replay}.ts`; `intelligence/{context-envelope,event-store}.ts`; `intelligence/capabilities/`. Do not recreate these components.

**Tests:** strict choice result conformance (Noul/Score deferred); 0.5 Noul-threshold trap fixtures; malformed choice distribution; missing keys including partial Gemini batches; conflicting predicate projections; denied egress; revoked consent; model failure; cost missing (null, not zero); version mismatch; complete/failed receipt ordering; same-request deduplication; cancellation; 64-KiB projection guard; no secrets in traces.

**Exit:** the bridge can run an offline fixed workflow and produce a typed Flyd decision receipt; prohibited tool names, unapproved predicate definitions and non-allowlisted fields fail before execution; the legacy path remains unchanged.

### P2 — One real, read-only recovery workflow

**Goal:** test whether the DSL buys something beyond the existing TypeScript branch.

**Implement:** fixed `cos-internal-recovery-v1` with schema-checked state, one strictly validated existing choice predicate over already collected evidence (add more questions only after registry and replay approval), deterministic outcome mapping, at most one private reasoning fallback for a novel case, and an explicit safe hold. Read-only evidence may go through a host `runEffect` if necessary; no mutation, no shell.

**Integration:** new optional function beside `cli/src/command/cos/recovery.ts`, still called by existing CoS under a test flag. Keep `judgeRecovery` and `canRecoverInternally` as fallback and authority gates. Never let the DSL own a worker.

**Tests:** failing component test → known safe rebrief; repeated identical failure → different justified tactic/investigation; missing evidence → investigate; protected merge/deploy/payment → no model call, no action; unknown outcome → hold; policy version changed mid-run → stale/hold; failed verifier → not success; no model configured → existing safe fallback; two concurrent ticks → one CoS disposition; no extra user message.

**Exit:** a full mock CoS test drives the workflow through accepted input, Jev result, optional agent fallback and one CoS decision; no outward effect or duplicate dispatch possible.

### P3 — CoS integration and shadow evaluation

**Goal:** compare workflows on identical eligible decision contexts without disturbing production.

**Touch carefully:** `cli/src/command/cos/{operational-judgment,recovery,tick}.ts` plus test injection seams. Prefer one small seam invoked by current handlers; do not restructure the 500+-line CoS tick or the domain graph.

**Behavior:**
- `off`: identical current behavior, no DSL dependency import on hot path if optional.
- `shadow`: capture the incumbent decision and separately compute the candidate under allowed cost/egress; compare decisions **offline**; candidate cannot write CoS state or dispatch.
- Record candidate/legacy outputs, normalized failure category, provider calls, latency, cost and exact comparison case ID. Redact before persistence.
- Interrupt/abort stale objective revisions. No auto-replay after a correction that changes the basis of the decision.
- Reuse existing CoS claim/lock and report ownership.

**Tests:** guard both paths, demonstrate shadow cannot execute; verify old and new paths share exact allowed evidence; block double-run of effects; one `cos.report`; deliver no intermediate chatter; disable flag and verify byte-equivalent visible result where feasible.

**Exit:** shadow data is sufficient to decide whether the DSL is valuable; no user-visible behavior changes.

### P4 — Independent evaluation and go/no-go

**Goal:** prove a product benefit, not merely a working interpreter.

**Test arms:** A existing direct CoS + Jev/LLM path; B embedded DSL with Jev; C embedded DSL with Gemini Decision 1 through **same Flyd System-1 adapter**; D deterministic-only safe fallback. Use the v9 frozen decision benchmark where applicable; add representative repeated recovery/evidence workflows. Keep train and holdout frozen before tuning questions/thresholds.

**Proposed evaluation set (not claimed current coverage):** start with at least 100 independently labeled cases spanning straightforward internal choices, incomplete evidence, novel failures, repeated failures, stale corrections, external/unknown effects, personal choices, revoked/no egress, malformed model output and provider outage. Add 10+ crash/duplicate-dispatch fault injections separately. Oversample protected cases; do not hide them inside average success.

**Track:**
- Verified task success and accurate internal versus George-owned dispositions.
- Full reasoning-model calls per resolved internal issue.
- System-1 calls, total provider cost (reported/estimated/unknown separately), p50/p95 decision latency and total objective time.
- Investigations or retries that were unnecessary; unnecessary interruptions to George; time to safe recovery.
- Wrong/unsupported tactic selections, duplicated effects, expired grants, consent leaks and hallucinated completion.
- Schema/runtime errors, dependency startup cost, Node compatibility, memory overhead and maintainer complexity.

**Proposed promotion bar (targets, not results):**
- **Zero** observed authorization, privacy, duplicate-effect or false-completion regressions in protected tests (mandatory).
- At least equal verified completion and no increase in unnecessary George escalations on frozen holdout.
- Meaningful benefit: **≥20% lower median eligible decision-path latency OR ≥15% fewer full reasoning-agent calls**, without increasing median total provider cost. Check p95 and outliers before choosing either metric as sufficient.
- No material overall objective-latency regression and no new installed-Mac startup/reliability issue.
- If sample sizes are too small or cost attribution unknown, **do not promote**; extend shadow evaluation, not thresholds post hoc.

**Expert critique to test deliberately:** the DSL may simply add parse/validation/journaling overhead to the same single Jev call already in v9. If so, stop at P3 and remove the dependency. A failed experiment is a valid result.

### P5 — Canary, operational hardening and rollout

**Goal:** limited real usage with objective ownership and safe rollback proven.

**Gates before canary:** all P4 protected tests green; actual installed Mac Node runtime verified; exact dependency/lockfile pinned; `npm audit --omit=dev --audit-level=high` reviewed; no new permission paths; data retention reviewed; CI and `swift test` green.

**Rollout:** default off → shadow → small deterministic canary of *eligible internal* CoS decisions → on only if beneficial. Canary percentage/cohort must be explicitly configured and stable across restarts; external/high-impact actions remain excluded.

**Fault drills:** kill Core before decision recording, after recording but before CoS commit, during reasoning, after a FirstMate handoff but before receipt, during user correction, during provider timeout, during a revoked source/credential, and during host shutdown. Reconcile work by existing CoS ID; never assume a cut-off side effect failed.

**Rollback:** `FLYD_COS_DECISION_DSL=off` restores legacy behavior immediately; do not delete canonical receipts or historical revision metadata; ongoing decisions either finish with their pinned versions or safely abort before state mutation. Verify rollback in an automated test and on the real Mac.

**Exit:** at least one complete opted-in internal objective lands with verified outcome and no unexpected user interruption; installed Mac behavior and restart recovery are observed, not inferred from mocks.

### P6 — Later: learned operational playbooks, only after P5

**Goal:** let verified repeated successes propose candidate workflow revisions without turning model-generated JSON into trusted code.

1. Capture eligible successful traces (same consent/provenance), recurring steps and *why* the steps worked.
2. Generate a candidate procedure with bounded inputs, source requirements, effect classes and fallback, explicitly separated from executable trusted workflows.
3. Static validation, manual inspection of any new tool capabilities, replay on frozen episodes, protected regression tests and staged PolicyRegistry promotion.
4. Bind candidate to existing CoS owner, registry predicates and grants; never mint permissions or auto-execute untested DSL.
5. Track actual reuse and savings; retire workflows that age badly.

**Explicitly deferred:** arbitrary workflow authoring, learned code nodes, workflow marketplace, autonomous source-code rewriting, a new learning database or user-facing orchestration canvas.

---

## 8. Failure-state matrix and recovery contract

| Situation | Required behavior | Must never happen |
| --- | --- | --- |
| Evidence missing or source consent absent | Investigate only within permitted sources, otherwise safe hold | Invent evidence or silently widen egress |
| Jev low confidence / refusal / malformed output | Deterministic safe branch or Flyd private reasoning | Treat 0.5 threshold as authorization |
| Gemini differs from Jev | Record disagreement for replay, choose existing approved policy/fallback | “Majority vote” grants an effect |
| Full reasoning proposes new repair | Validate as grounded candidate, optionally rank, CoS re-checks permission | Agent invents new tool/grant |
| CoS objective corrected mid-flight | Reject stale result, re-evaluate under new revision | Execute old candidate |
| Internal action known failed | CoS may retry under existing cap with different tactic | Unlimited retries or new user decision just for debugging |
| Outward action may already have succeeded | Hold and reconcile provider/executor receipt | Blindly resend/publish/book/pay |
| DSL process crash after answer | Reuse version-matching canonical decision receipt; CoS controls continuation | Re-query and double-dispatch without checking |
| Dependency missing/incompatible | Disable DSL; use safe existing CoS path | Fail entire Flyd chat/overlay |
| Workflow malformed or untrusted | Reject at admission | Execute code node/shell on Flyd host |
| DSL raises “escalation” | CoS/Flyd investigate or hold per v9 | Automatically notify George |
| No measurable benefit | Remove/disable package | Promote because DSL is technically interesting |

---

## 9. Acceptance and test checklist

**Core contract**
- [ ] The only active long-running objective runner remains CoS.
- [ ] FirstMate, Design Mate and Librarian execute through their current domain interfaces.
- [ ] The only System-1 provider access used by DSL is Flyd's configured, source-governed provider layer.
- [ ] Predicate thresholds and model versions are pinned/replayable; no workflow-provided permission rules.
- [ ] No AgentRun Server, its store, console or runner is used.
- [ ] Runtime compatibility is proved, not inferred from CI.

**Safety and correctness**
- [ ] All DSL outputs are schema checked and then host-policy checked.
- [ ] Static workflow admission rejects unapproved code, tools, egress and unsafe effects before running anything.
- [ ] Decision receipts are persisted atomically before a decision causes a branch/action where required, and replay is idempotent.
- [ ] Current CoS revision is checked immediately before any chosen tactic can execute.
- [ ] Unknown external effects are never automatically retried.
- [ ] No added raw personal data/secret persistence or unconsented model egress.
- [ ] A DSL escalation never means automatic user interruption.
- [ ] Inactive feature flag gives legacy behavior.

**Evidence and product quality**
- [ ] At least 100 frozen, independently labeled decision cases and crash/replay cases have reproducible results.
- [ ] Compare Jev, Gemini and legacy under identical input and cost accounting.
- [ ] Count protected errors as a hard fail, not averaged away.
- [ ] Measure full-agent calls, end-to-end completion, latency, costs and George interruptions.
- [ ] Verify on installed Mac, not just mocked CI.
- [ ] Rollback and a no-benefit rejection path have been exercised.

**Existing validation commands (from `cli/` unless specified):**

```sh
npm ci
npm run lint
npm test
npm run build
npm run test:routing-learning
npm audit --omit=dev --audit-level=high
# Run focused new Vitest tests alongside existing:
npx vitest run src/command/__tests__/cos-operational-judgment.test.ts \
  src/command/__tests__/cos-recovery.test.ts \
  src/command/__tests__/cos-decision-flow.test.ts \
  src/command/__tests__/cos-chain.test.ts
# From mac-adapter/:
swift test
```

Additional focused new test files should live under `cli/src/command/__tests__/cos-decision-workflows*.test.ts`, with versioned fixtures for Jev/Gemini, hidden source/consent controls, restart and fault injection. Reuse the existing CI workflow rather than creating a parallel validation pipeline. Confirm the actual Node version used by each CI job and Mac runtime before dependency installation.

---

## 10. Delivery sequence and stop/go decisions

| Checkpoint | Demonstrable deliverable | Go/no-go |
| --- | --- | --- |
| 0. Compatibility and baseline | Exact package/runtime matrix; frozen representative cases | Stop if no safe single-process import |
| 1. Adapter | Offline DSL flow through Flyd System-1, canonical receipt and allowlisted evidence | Stop if egress, answer or receipt semantics can't be preserved |
| 2. Embedded recovery pilot | One fixed workflow; full CoS mock integration; legacy fallback | Stop if duplicate/unsafe action possible |
| 3. Shadow evaluation | Side-by-side candidate versus incumbent, no effects | Stop if complexity grows without useful coverage |
| 4. Holdout comparison | Measured success, latency/cost/LLM calls, protected regression report | Promote only on declared gates |
| 5. Opt-in canary | Installed Mac proof, live recovery, kill and rollback drills | Keep off until proven |
| 6. Learned playbooks | Separately governed feature proposal | Not part of initial implementation acceptance |

Suggested commit boundaries: (a) feasibility + benchmarks; (b) typed adapter, receipts and tests; (c) one static workflow + tests; (d) feature-flagged CoS seam; (e) benchmarks/shadow results; (f) canary/rollback evidence. Each must be independently reversible. Do not batch the plan and a speculative Node upgrade into one merge.

---

## 11. What we deliberately refuse to do

- Replace CoS, FirstMate, Design Mate or the current domain hierarchy.
- Add a second agent-runner, scheduler, database, web console, notification system or approval surface.
- Reimplement Flyd's existing Jev/Gemini routing and predicate registry inside AgentRun.
- Auto-authorize work because a model or workflow predicts “safe”.
- Convert one successful fix directly into a privileged, executable workflow.
- Copy AgentRun's code execution sandbox claims as security guarantees; upstream explicitly says code nodes are not a sandbox.
- Promise latency/cost savings before a measured benchmark.
- Upgrade Node across a personal assistant deployed on Mac and server merely to try a library.
- Mark v9's outstanding proactive care, live provider evaluation or installed Mac acceptance as completed by this work.

## 12. First engineering move

**Run P0, then build P1 only if P0 proves compatibility **and** a genuinely useful multi-step workload.** Specifically: test the exact AgentRun DSL release in an isolated Node 24.22.3+ consumer, verify Flyd's installed runtime and the existing one-call Jev baseline, and write a single admissible **internal recovery** workflow against Flyd's System-1 adapter. If it doesn't reduce real reasoning overhead or increase reliability without violating the authority model, stop and keep the current CoS code.

**The one outcome that matters:** Flyd should handle more routine decisions correctly, privately and quickly—**not** acquire another orchestration engine.

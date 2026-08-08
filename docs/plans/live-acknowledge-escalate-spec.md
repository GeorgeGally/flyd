# LIVE Acknowledge-then-Escalate — Plan & Tech Spec

**Status:** Draft for review — 2026-07-29
**Scope:** Flyd Core (TypeScript) only. No Swift adapter changes required for v1.
**Depends on:** Delegation completion contract (`delegation.ts`, `/delegation/complete`, shipped 2026-07-28, dormant behind `FLYD_DELEGATION_ENABLED`).

## 1. Problem

LIVE mode has the structural skeleton of a voice assistant that can escalate (realtime model + `flyd_resolve_intent` tool), but not the conversational behavior that makes escalation feel right:

1. The model is not instructed to acknowledge before tool calls — realtime models often go silent during tool execution, which reads as a hang.
2. There is no long-job path. `flyd_resolve_intent` blocks the tool call for the full resolution. Anything that takes minutes has no way to say "working on it, I'll tell you when it's done" and later deliver a verified result.
3. The LIVE tool path calls `resolve()` without the flash router config, so voice intents from LIVE never benefit from classifier routing.

Target experience (the "hold on, let me check for you" arc):

```
User:  "can you pull together a comparison of X and Y?"
Flyd:  "Sure — that'll take me a few minutes. Want me to work on it in the background?"
User:  "yes"
Flyd:  "On it."                          ← tool returns instantly, conversation continues
       ... minutes pass, user keeps talking or goes quiet ...
Flyd:  "That comparison is done. I produced a summary document — it's in your
        Documents folder, covering X and Y across five criteria."   ← handoff triad, verified
```

## 2. Design principles

- **Perceived latency = time-to-acknowledgment.** The realtime model's first token (~300 ms) masks seconds-to-minutes of real work. The acknowledgment is generated speech around an async tool call, never a canned string.
- **Narrate outcomes, not activity.** The completion the model narrates is a `DelegationCompletion` that passed `validateDelegationCompletion` **and** server-side re-verification. The model can only speak verified handoffs; "started creating the document" is not narratable as done.
- **The session never blocks.** Long jobs return a handle immediately. Completions are injected into the conversation when they arrive.
- **Honest when nothing happens.** If no runner picks the job up, the user hears a blocker, not silence (§5.6).

## 3. Phases

| Phase | Contents | Effort | Risk |
|---|---|---|---|
| A | Acknowledgment instructions + router config in LIVE path + tests | ~1 h | none — prompt + one argument |
| B | `flyd_delegate` tool, delegation event bus, completion watcher, pending-job registry + timeout, `/delegation/pending`, metrics, tests | ~1 day | low — additive, flag-gated |
| C (out of scope here) | First real runner (CLI harness bridge), adapter narration UI, verbose progress ticks, two-phase confirm tool | separate plan | — |

Phase B ships fully testable without a runner: a synthetic `POST /delegation/complete` exercises the entire arc end-to-end.

## 4. Phase A — Acknowledgment + router

### 4.1 `REALTIME_INSTRUCTIONS` additions (`realtime-session.ts`)

Append:

> Before calling any tool, briefly tell the user what you are doing in a few words ("let me check", "one moment, looking now"). Never go silent while a tool runs. Never state or imply a result before the tool returns — no "done", "sent", or "found it" until you have the tool output. If a tool starts a background job, tell the user it is running and that you will let them know when it finishes, then continue the conversation normally.

Rationale: gpt-realtime-2.1 reliably follows speak-then-call instructions; hardening for the rare silent call is deferred (§8, R1).

### 4.2 Router config in LIVE tool path

`handleToolCalls` currently calls `resolve(manifest, model, apiKey, baseURL)`. Change to load `loadFlydRouterConfig()` once per session (at `connectRealtime` time, not per call) and pass it as the fifth argument. LIVE voice intents then get identical routing treatment to `/manifest` intents, including consequence classification and the metrics counters.

### 4.3 Tests

- Instruction text contains the acknowledgment clause and the no-premature-completion clause (string assertions on the exported constant; export `REALTIME_INSTRUCTIONS`).
- `handleToolCalls` passes router config through (verifiable via a `resolve` seam or by refactoring manifest construction into an exported pure function — preferred: extract `buildLiveManifest(observation, intent)` and test it directly).

## 5. Phase B — `flyd_delegate`

### 5.1 Tool definition (registered only when `FLYD_DELEGATION_ENABLED=true`)

```jsonc
{
  "type": "function",
  "name": "flyd_delegate",
  "description": "Start a background job for work that takes longer than a conversational answer — research across sources, document creation, code changes. Returns immediately with a job id. You will be told when the job completes; do not claim it is done before then. Confirm with the user before starting a job.",
  "parameters": {
    "type": "object",
    "properties": {
      "intent": { "type": "string", "description": "What the job should accomplish" },
      "expected_outcome": { "type": "string", "description": "What artifact or result the user expects, in one sentence" }
    },
    "required": ["intent"]
  }
}
```

Confirmation is prompt-level in v1 (the model asks verbally before calling). A hard two-phase propose/confirm tool pair is deferred to Phase C — consistent with `requiresConfirmation` being contract-ready but adapter-unenforced in INVOKED.

### 5.2 New module: `cli/src/delegation-events.ts`

Single in-process event bus connecting the server's completion endpoint to live sessions. Both run in the same process (`server.ts` starts the realtime server), so no polling and no new transport.

```ts
import { EventEmitter } from "node:events";
import type { DelegationCompletion } from "./delegation.js";
import type { DelegationEnvelope } from "./delegation.js";

interface DelegationEventMap {
  completion: [DelegationCompletion];   // emitted by server AFTER validation + re-verification
  pending: [DelegationEnvelope];        // emitted when a job is registered
}

export const delegationEvents: EventEmitter<DelegationEventMap>;

// Pending registry — jobs started but not yet completed.
export function registerPendingDelegation(envelope: DelegationEnvelope): void;
export function listPendingDelegations(): DelegationEnvelope[];
export function clearPendingDelegation(delegationId: string): void;
// Sweep: any pending job older than grant.maxRuntimeMinutes + 2 min grace
// emits a synthetic blocked completion ("runner_timeout") and clears.
export function startPendingSweep(): void;   // called from startServer; interval unref'd
export function stopPendingSweep(): void;
```

Timeout behavior is the honesty mechanism: a job nobody picks up becomes a spoken blocker ("I couldn't get that job picked up — the background runner isn't available"), not eternal silence. The synthetic completion has `status: "blocked"`, `blocker: "runner_timeout"`, and skips artifact re-verification (nothing was claimed).

### 5.3 Tool handler (`realtime-session.ts`)

On `flyd_delegate` call:

1. `buildDelegationEnvelope(intent, buildIntelligenceState(), [], null)` — same builder as `/manifest`; `expected_outcome`, when provided, overrides the derived `finishCondition`.
2. `registerPendingDelegation(envelope)` → emits `pending` (a future runner's signal; also visible via §5.5).
3. Track `envelope.delegationId` in a session-scoped `Set<string>` (`startedDelegations`).
4. Return tool output immediately:

```ts
{
  status: "started",
  delegationId,
  finishCondition: envelope.finishCondition,
  message: "Job started. Tell the user briefly and continue the conversation. You will receive the result as a tool message when it completes."
}
```

### 5.4 Completion watcher (per session)

On session start, subscribe to `delegationEvents.on("completion")`; on session close, unsubscribe (prevents leaks — same discipline as `observationResolvers`).

When a completion arrives for a `delegationId` in this session's `startedDelegations`:

```ts
openaiWs.send({ type: "conversation.item.create", item: {
  type: "message", role: "user",   // realtime API: system-injected context arrives as an item
  content: [{ type: "input_text", text: buildCompletionNarrationCue(completion) }]
}});
openaiWs.send({ type: "response.create" });
```

`buildCompletionNarrationCue(completion)` (exported, pure, tested):

- `completed` → `[BACKGROUND JOB DONE — relay to the user conversationally, one or two sentences]` + `formatHandoff(completion.handoff)` (the triad: produced / location / contents).
- `blocked` → cue containing the blocker; instruct the model to tell the user plainly and offer alternatives.
- `failed` → cue to inform the user it failed, without invented detail.

Narration dial: `FLYD_NARRATION=off|milestones|verbose` (default `milestones`). `off` suppresses injection (completion still available to the adapter via `GET /delegation/completions`); `milestones` = completion/blocker only; `verbose` reserved for Phase C progress events. Narration text is template-built from contract data — never an extra LLM call.

Edge: completion arriving after session close is not narrated; it remains in `completedDelegations` for the adapter poll. Accepted v1 gap (Phase C: adapter notification).

### 5.5 Runner interface (defines Phase C without building it)

New endpoint `GET /delegation/pending` (auth-gated) → `{ pending: DelegationEnvelope[] }`. A runner's contract:

1. Poll or subscribe for pending envelopes.
2. Execute within `grant` bounds toward `finishCondition`.
3. `POST /delegation/complete` with a `DelegationCompletion` carrying handoff + verification evidence (already enforced: validation + server-side artifact re-verification).

Single local runner assumed; no claim/lease semantics in v1. Duplicate runners double-executing is a Phase C concern (note: `completedDelegations.set` is idempotent per `delegationId`, so narration fires once — watcher clears the id from `startedDelegations` after first injection).

### 5.6 Server wiring (`server.ts`)

- `handleDelegationComplete`: after `recordDelegationCompletion("accepted")` + store, call `clearPendingDelegation(id)` and `delegationEvents.emit("completion", completion)`.
- Route `GET /delegation/pending`.
- `startServer` calls `startPendingSweep()`; `stopServer` calls `stopPendingSweep()`.

### 5.7 Metrics (`overlay-metrics.ts`)

New counters (numbers only, invariant #9):

| Counter | Meaning |
|---|---|
| `live_delegations_started` | `flyd_delegate` calls accepted |
| `live_completions_narrated` | completion cues injected into a live session |
| `delegation_runner_timeouts` | pending sweep fired a synthetic blocker |

Scoreboard reading: `runner_timeouts > 0` with a runner deployed = runner health problem; `started` ≫ `narrated` = users leaving sessions before jobs finish (Phase C adapter notification justified by data).

### 5.8 Tests

- `delegation-events.test.ts` — register/list/clear; sweep emits synthetic blocked completion after timeout (fake timers); completion emission ordering.
- `realtime-session` units — export and test pure helpers: `buildCompletionNarrationCue` (all three statuses; triad present verbatim for `completed`), `buildLiveManifest` (Phase A), delegate tool output shape.
- Server integration — `POST /delegation/complete` (valid) → event emitted (subscribe in test); `GET /delegation/pending` reflects register/clear lifecycle.
- Metrics — new counters increment; string-field invariant test already covers shape.

## 6. Rollout

1. Phase A lands immediately — no flag, no behavior risk (prompt + routing arg).
2. Phase B lands behind the existing `FLYD_DELEGATION_ENABLED` flag. Flag off (default): `flyd_delegate` not registered, no watcher, no sweep — LIVE behavior byte-identical to today.
3. Flag on without a runner: still safe — jobs time out into spoken blockers within ~12 min. This state is dogfoodable and exercises the whole arc except real execution.
4. Phase C (separate plan): CLI-harness runner bridge makes `POST /delegation/complete` real.

## 7. Exit criteria

**Phase A**
1. LIVE model verbally acknowledges before every `flyd_resolve_intent` call (manual voice test, 5/5 invocations).
2. LIVE resolutions hit the flash classifier when `FLYD_ROUTER_MODEL` is set (`route_source_classifier` increments from a LIVE session).

**Phase B**
1. With flag on and no runner: asking for background work yields a spoken "started" acknowledgment and, within grant + grace, a spoken blocker. No silent losses.
2. Synthetic `POST /delegation/complete` (valid, verified) during a live session → model speaks the handoff triad within one turn.
3. Completion for a dead session is retrievable via `GET /delegation/completions` (no crash, no leak — watcher count returns to zero on disconnect).
4. Flag off: `session.update` payload contains exactly one tool (`flyd_resolve_intent`).
5. All new units green; suite green; lint clean.

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Model occasionally calls tool silently despite instructions | Accept in v1; measure by ear during dogfood. Hardening option: detect `function_call` with no audio in same response → inject a canned ack via `response.create` with `instructions` override. Only if observed. |
| R2 | Model claims completion prematurely ("it's done!" before completion event) | Instruction forbids it (§4.1); completion cue is the only source of the triad. Consequence-note precedent from INVOKED shows instruction-level control works. Verify in dogfood. |
| R3 | Completion event ordering vs. active model response (injection mid-response) | `conversation.item.create` is queue-safe in the realtime API; `response.create` while a response is active returns an error event — watcher retries once after `response.done`. Implement retry in watcher (small state machine, tested). |
| R4 | `EventEmitter` listener leak across many sessions | Per-session named listener removed on close; test asserts listener count. |
| R5 | Runner double-execution (Phase C) | Out of scope; narration idempotent per delegationId already. |
| R6 | Injected item is attacker-influenceable if a runner is compromised | Cue text is template-built from validated contract fields only; handoff strings pass through `validateDelegationCompletion` length/shape checks. Do not inject raw runner output outside the triad fields. |

## 9. File-touch summary

| File | Change |
|---|---|
| `cli/src/realtime-session.ts` | Instructions, router config, `flyd_delegate` registration + handler, watcher, exported pure helpers (`buildLiveManifest`, `buildCompletionNarrationCue`) |
| `cli/src/delegation-events.ts` | **new** — event bus, pending registry, timeout sweep |
| `cli/src/server.ts` | emit on accepted completion, `GET /delegation/pending`, sweep lifecycle |
| `cli/src/overlay-metrics.ts` | 3 counters |
| `cli/src/__tests__/delegation-events.test.ts` | **new** |
| `cli/src/__tests__/realtime-session.test.ts` | **new** — pure helpers |
| `cli/src/__tests__/server.test.ts` | pending endpoint auth case |
| `docs/product/flyd-overlay-prd.md` | LIVE section: acknowledge-then-escalate behavior + narration dial reference |

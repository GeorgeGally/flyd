# Manifestation: answers that take a shape

Date: 2026-10-20
Status: proposed
Goal: When a question has a shape, Flyd answers in that shape — a diagnosis reads as expected / observed / cause / evidence / next, not as one paragraph — without building a UI language, a widget catalogue, or a second renderer.

## Grounding and scope

Inspected before planning:

- `cli/src/conversation-view/page.ts` — `semanticBox()` at 4042 flattens a `SemanticObject` into `{ head, line, meta, decision, shots }`; `renderSemanticContext` ~4011; `fill()` at 1176 renders `message.html` verbatim; `renderShow` ~4090.
- `cli/src/conversation-view/semantic.ts` — `SemanticObject`, `composeSemanticSnapshot` (444), `FOCUS_PRIORITY` (462), `semanticFocus` (476), `artifactObjectFromShow` (335, lifecycle always `"resolved"`), `monitorObjectFromSource` (391).
- `cli/src/conversation-view/flyd-desk.ts:175` — `Answerer` returns `Promise<string>`. The desk's answerer is the producer for questions Flyd itself answers in the window.
- `cli/src/conversation-view/summaries.ts:211` — `ReplyArtefact`; `replyArtefact()` at 225 returns `{ artefact, clear }` for `steps` / `options`.
- `cli/src/conversation-view/server.ts:272` — `replyCards()` -> `RailArtefact`; artefacts attached to the right column at 1031.
- `cli/src/conversation-view/cards.ts` — `visualCard()`: the right column can show title, line, picture, link. Not a document.
- `cli/src/conversation-view/artefact-judge.ts` — `ArtefactJudge`, predicate `reply_artefact_kind`, verdict applied after the reply is already written.
- `cli/src/cognition/system-one/registry.ts:420-455` — presentation predicates `reply_artefact_kind`, `semantic_object_kind`, `matters_to_george`. Every predicate is declared there, scored by `replay.ts` against frozen traces, and its `evaluatorVersion` bumps when wording changes.
- `cli/src/evidence/compose-surface.ts` — a 350-line Core-owned loopback dossier on port 3000: precedent that a rich, structured, native surface is an HTML+CSS job, not an engine.
- `docs/plans/2026-10-10-routing-learning-plan.md` — plan format.

### The scope decision this plan makes

There are two different complaints hiding behind "generative UI", and #200 only touched one:

1. **The show screen** (`renderSemanticContext` / `semanticBox`) displays *his work* and flattens rich objects into one line. Fixing that is a display-contract problem: which of a `SemanticObject`'s fields earn screen space.
2. **The answer** displays *Flyd's reply* and is always prose. Fixing that is a producer problem: the thing writing the answer has to know the answer has a shape.

This plan does (2) first, because the accepted failure case is a question — "Why didn't PR #200 fix generative UI?" — and questions are answered, not staged. It deliberately does not attempt (1); `semanticBox` stays until the same contract has been derived twice (slice 4), so it has something to be derived from.

### Who produces the answer

Two producers, one of them ours:

- `FlydDesk`'s `Answerer` (`flyd-desk.ts:175`) — general questions in the window. Controllable: one type, one prompt, one renderer.
- `ClaudeCodeTranscriptSource` — firstmate's Claude Code transcript, rendered as `message.html`. Not controllable: we cannot make another agent emit our structure.

So manifestation applies to answers Flyd produces and to nothing else. For firstmate's transcript, prose stays prose. That is a feature, not a gap: the alternative is parsing finished prose back into structure, which is exactly what `artefact-judge.ts` already does and what this plan is trying to stop paying for.

### Why the chosen shape is HTML, not a renderer

`fill()` already injects `message.html` server-side. A structured answer therefore needs no client-side rendering engine at all: the producer emits a validated structure, a small server function turns it into semantic HTML (`<section class="answer-form diagnosis">` with labelled parts), and CSS lays it out. No client JS, no block schema, no capability registry, no coordinates. If a later form cannot be expressed this way, that is the signal to stop and reconsider — not to build the engine pre-emptively.

## Recommended approach

1. Repair what #200 actually broke, in its own small change.
2. Give the desk answerer exactly one extra shape: `diagnosis`.
3. Prove it with the real question as a test, hand-fed, before any model chooses it.
4. Let the producer declare the form (the model that writes the answer also names its shape) — no judge, because the chooser is the writer.
5. Add a second form only when two forms reveal what the contract needs, and derive the shared type from them.
6. Reach for Jev only where the producer abstains, on one predicate, after a corpus exists.

## Slices

### Slice 0 — repair the #200 holes

Separate change, no manifestation code.

- `contextGroup()` should be total over `SemanticObject`: today an interrupted `needs_you` monitor and a `failed` activity fall through to `rest` and are dropped from every group (proven by running the filter directly: `DROPPED: ['m','f']`). Add a `failed` group, or clamp `interrupted` monitors into `needs`.
- The Watching button (`page.ts:4035-4038`) renders as a `<button>` but only `needs` / `landed` / `working` do anything. Render it as a `<span>` until there is a destination.
- The edge's counts must come from the arrays the drill actually opens, not from `focus.objects`.
- Nav (`page.ts:4181`) must keep keyboard focus across a refresh.
- Decide the readouts: `#readouts` is hidden whenever `focus` exists, which makes the Claude plan gauge (`boxes.ts:185`), `landed-week` and `work-state` unreachable UI. With George: delete them, or keep the plan gauge and render it inside the edge.

Done when: tests cover an interrupted monitor, a failed activity, a quiet monitor and the no-focus fallback; a refresh mid-navigation keeps focus on the same drill row; no dead control ships.

### Slice 1 — one extra shape in the producer

`cli/src/conversation-view/answer-form.ts` (new, ~60 lines):

```ts
export interface AnswerPart { label: string; text: string }
export interface AnswerBody {
  lead: string;
  form: "prose" | "diagnosis";
  parts?: AnswerPart[];
  evidence?: Array<{ text: string; url?: string }>;
  next?: string;
}
export function answerBody(value: unknown): AnswerBody;   // validates, falls back to { lead, form: "prose" }
export function answerHtml(body: AnswerBody): string;      // semantic HTML, escaped
```

`Answerer` returns `Promise<string | AnswerBody>`; every call site that today gets a string keeps working (`typeof answer === "string"` -> prose). The transcript source renders `answerHtml()` into `message.html`; a prose body produces the same HTML it does today.

Done when: a test feeds both shapes through the message builder and asserts prose output is byte-identical to today's, and a diagnosis body yields a `data-form="diagnosis"` section with exactly the supplied labels.

### Slice 2 — the diagnosis renderer, hand-fed

- CSS in `page.ts` next to the scene styles: lead line, then labelled parts in a single column with the label in the muted small caps already used by `.scene .meta`, evidence as a plain list, `next` as one emphasised line. Reuse existing type scale and colour variables; no new design language.
- A diagnosis answer is never folded into the "something to act on" collapsed state (`page.ts:1215`) — it is read, not skimmed; it opens.
- The acceptance test: fixture question *"Why didn't PR #200 fix generative UI?"*, fixture body with five parts, assert the rendered HTML has 5 labelled parts and no text run longer than 420 characters.

Done when: that test is red before slice 2 and green after, and a prose answer renders exactly as it does today.

### Slice 3 — Flyd chooses the form

- Extend the desk answer prompt only: "If the answer explains why something did or didn't work, answer as a diagnosis: one outcome line, then expected, observed, cause, evidence, next. Otherwise answer in prose. Never force the shape."
- The model that writes the answer declares the form. No separate judge, no post-hoc parsing, no extra call.
- Validation failure falls back to prose silently.

Done when: 10 real diagnosis questions produce diagnosis bodies; 10 non-diagnosis questions (a preference question, a lookup, a greeting, a plan request) produce prose; the existing chat evals show no quality regression.

### Slice 4 — second form: comparison

Only now, because one form teaches nothing about a contract.

- `form: "comparison"` with `alternatives[]` and `criteria[]`; hand-written renderer, same CSS approach.
- Derive `ManifestationPlan` from what the two renderers actually consumed, and place it beside `SemanticObject` in `semantic.ts`. Rewrite slices 1–3 onto it. No registry.
- If the derived type is not smaller than the two ad-hoc shapes it replaces, stop and delete it. That is the test for whether the abstraction earned its place.

Done when: both forms render from one type; nothing in the show screen changed.

### Slice 5 — Jev, where the producer abstains

- One predicate `answer_form` (`prose | diagnosis | comparison`), declared in `registry.ts` with producer, egress, threshold and prose fallback; wording frozen before the bench.
- Used **only** when the desk answerer returns no form. Primary choice stays with the writer, so the common path pays no Jev latency.
- Bench on a frozen corpus of ~20 real questions with expected forms (`replay.ts`), recorded, and `evaluatorVersion` bumped on any wording change.

Done when: the replay bench beats the always-prose baseline and does not regress on the 20 fixtures; with `answer_form` unavailable the desk still answers.

### Slice 6 — evidence and artifact-review forms (later)

- Evidence binds existing `SemanticWorkObject`s rather than inventing objects: same `AnswerBody`, `form: "evidence"`, parts are the objects.
- Artifact review binds the shot and the comment machinery that already exists, not a new way to draw pictures.

Not in this plan's first pass.

### Slice 7 — what this retires

- `artefact-judge.ts` survives, but only for the firstmate transcript: it is the fallback for text we do not produce. It disappears the day that source can carry structure, which is not ours to schedule.
- `replyArtefact()`'s `steps` / `options` stay as they are; they are the right column's card shapes, not answer bodies. Do not merge them into `AnswerBody`.

## Risks

- **Prose quality.** Answering in labelled parts where prose was better is worse than prose. Mitigation: the form is declared by the writer with an explicit "never force the shape" rule, and slice 3's 20-question check is the gate.
- **Firstmate asymmetry.** Some answers will be prose and some structured in the same window. Accept and state it; do not parse firstmate's prose to hide it.
- **The renderer becoming a language.** Two forms, hand-written, no block schema. A third form that cannot reuse the layout is a design decision for George, not a schema addition.
- **`semanticBox` left alone.** The show screen still flattens. Say so out loud rather than letting #200's half-fix read as complete.

## Non-goals

- No capability or widget registry with ten entries. Two forms, then three.
- No generated CSS, layout coordinates, or spatial model.
- No dynamic components or event deltas: an answer is a document, not an app.
- No change to `renderSemanticContext` or `semanticBox` in this plan.
- No new dependency, no new port, no new process.

## Files

| File | Change |
|---|---|
| `cli/src/conversation-view/answer-form.ts` | new: `AnswerBody`, validation, `answerHtml()` |
| `cli/src/conversation-view/flyd-desk.ts` | `Answerer` may return a body; prompt gains the diagnosis rule |
| `cli/src/conversation-view/page.ts` | diagnosis + comparison CSS; never fold a diagnosis answer |
| `cli/src/conversation-view/semantic.ts` | `ManifestationPlan`, derived in slice 4 |
| `cli/src/cognition/system-one/registry.ts` | `answer_form` predicate in slice 5 |
| `cli/src/conversation-view/__tests__/page.test.ts` | renderer and acceptance tests |
| `cli/src/evals/` | 20-question form corpus, live, model-routed |

## Open question for George

Is the Claude plan gauge part of the edge (keep it, in `#readouts` beside the counts), or is it gone on purpose (delete the box and its `landed-week` / `work-state` siblings)? Slice 0 needs the answer; the rest does not.

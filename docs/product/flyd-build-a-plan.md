# Build a plan

A plan is Flyd turning a request into a phased, checkable piece of work and holding it where George can see it — then, only when he says so, handing it to a fresh coding session. This document is the review of that capability, phase by phase. Each phase carries checkable done_when points.

It is built entirely from primitives Flyd already has: the capture archive and its search, the plans folder, the `done_when` acceptance gate, FirstMate's coding-session handover, and the existing approval rules. No new store, ranking, promotion or governance layer is added — George deliberately stripped Flyd to capture and search.

## What a plan is

A plan is a plain markdown file in `~/.flyd/plans/`, mirrored into the capture archive (`~/.flyd/raw/`) so the existing search finds it. Its body has a fixed shape:

- **Outcome** — the finished change, in plain terms.
- **Files to touch** — the paths, each with why.
- **Approval gates** — the steps that need George's yes, landing included.
- **Phases** — `## Phase N — name`, each with steps and a `**Done when:**` list of checkable points.

The fixed shape is what makes a plan readable back by code: `cli/src/lib/plans.ts` parses the outcome, files, approval gates and per-phase `done_when` straight out of the file. The per-phase points are the same checkable strings the existing `done_when` gate (`cli/src/runtime/acceptance.ts`) already verifies for background jobs and the crew.

Frontmatter records the plan's identity: `project`, `repo_path`, `status`, `created` (with the older `project_path`/`timestamp` still read for plans written before this change).

## Command surface

- `flyd plan <topic>` — builds a plan from the request plus recalled memory and the project's context, writes it, and mirrors it into capture.
- `flyd work [query|--list]` — shows a plan as a checklist (unchanged).
- `flyd work --start <query>` — hands the named plan to a fresh coding session.

---

## Phase 1 — Inputs and output

**What it does.** `flyd plan <topic>` searches memory for the topic (`qmdSearch(topic, "flyd-raw", 10)`), hands the request and that context to the planner model, and asks for the fixed shape above — outcome, files to touch, approval gates, and phases each ending in checkable `done_when` points. The model produces the whole plan; nothing downstream re-derives it.

**Reuse.** The memory search, the LLM query and the plans folder are the ones `flyd plan` already used. The only change is the prompt and the shape it asks for.

**Done when:**

- [x] `flyd plan <topic>` still searches memory and passes the topic to the model.
- [x] The planner prompt asks for the exact headings `## Outcome`, `## Files to touch`, `## Approval gates`, `**Done when:**` and `## Phase 1`.
- [x] Every phase the prompt asks for ends in a `**Done when:**` list of checkable points.
- [x] A test asserts the prompt carries the fixed shape.

## Phase 2 — Storage

**What it does.** Each plan is written as a plain markdown file with frontmatter (`project`, `repo_path`, `status`, `created`) in `~/.flyd/plans/`, and mirrored into the capture archive as a raw capture. Because it lands in capture, `flyd ask` and `flyd search` find it with no extra work. `cli/src/lib/plans.ts` reads plans back into the fixed shape and never writes a second store.

**Reuse.** The existing `~/.flyd/plans` folder, the `serialize`/`parse` frontmatter helpers, and the `~/.flyd/raw` mirror path `plan.ts` already wrote to.

**Done when:**

- [x] Asking Flyd to build a plan writes a markdown file under the plans folder.
- [x] Its frontmatter carries `project`, `repo_path`, `status` and `created`.
- [x] Its body carries the outcome, files, steps and per-phase `done_when` points, and reads back into that shape (`readPlans`).
- [x] The same plan is mirrored into capture, so the existing search finds it.
- [x] No new store, ranking, promotion or governance layer is added — the tests read plans straight from the folder and from capture.

## Phase 3 — Surfacing

**What it does.** A saved plan appears as an artefact in the conversation sidebar, and its checkable `done_when` points ride on it. The plan is emitted as a `plan` item through the existing artefact producer (`composeArtefact`), the sidebar maps it through the same non-call path every other artefact uses, and the artefact view renders it through the existing story card.

**Reuse.** The plan kind is added to `ShowKind`, the story kinds, and the on-screen word list; the card itself is untouched. The points travel in the card's existing line field, so no new card is built.

**Done when:**

- [x] A plan appears in the sidebar as an artefact through the existing column mapping.
- [x] A plan's checkable points are shown on it.
- [x] The plan renders through the existing artefact card (a story box), not a bespoke one.
- [x] Plans come last on the screen, so a plan waiting on his `/land` never displaces urgent work.

## Phase 4 — Handover

**What it does.** `flyd work --start <query>` finds the plan, builds a handoff — George's own request as the original message, the plan's outcome with the first phase's title and steps and its files as the intended outcome, the project's name, its repo folder as the project root, and the first phase's `done_when` as the acceptance points — and hands it to a fresh coding session through `dispatchCodingDomain`, the same path chat uses for `start_coding_task`. The session starts knowing what to do, which files, and where.

**Reuse.** `dispatchCodingDomain` and its FirstMate transport already render the worker brief with the outcome, the repo hint and the `done_when`. The handoff is a pure function (`planHandoff`) so the exact payload is testable without spawning anything.

**Done when:**

- [x] Starting a plan hands over its task, its files and its repo folder.
- [x] The handoff names the repo folder as the project root, so the session starts in the right place.
- [x] The acceptance points handed over are the plan's first phase's checkable points, and the scope handed over is that phase's title and steps.
- [x] The coding session sees George's own request, not only the model-written outcome.
- [x] A test asserts the dispatched payload carries the task, each file and the repo folder.

## Phase 5 — Approvals

**What it does.** A plan never starts work by itself. Building a plan only writes a draft file; showing a plan only prints it; starting a coding task happens only through the explicit `--start` command (or the existing chat approval path), and landing still needs George's `/land`. Steps after landing — anything outward — are listed in the plan's **Approval gates** and wait for his approval.

**Reuse.** The existing coding approval path and the `/land` gate are untouched. Nothing in the plan path dispatches, lands, or sends on its own.

**Done when:**

- [x] Creating a plan never dispatches a coding task, lands anything, or sends anything.
- [x] Showing a plan (`flyd work`) never dispatches; only `--start` does.
- [x] Landing still goes through the existing `/land` gate.
- [x] The plan lists what needs George's approval in its **Approval gates** section.
- [x] Tests cover that neither building nor showing a plan starts work.

---

## Boundaries

This is the usable first iteration: a fixed-shape plan file, findable by the existing search, shown as an artefact, and handed to a coding session on request.

Deliberately not done:

- **No in-progress state machine.** The plan's points are always shown on its artefact, so a plan being worked shows them without a status that could go stale. If a later revision wants to track `draft → in progress → done`, the `status` field is already there for it.
- **No autonomous start.** A plan does not dispatch, schedule or land itself; every start is George's explicit act through an existing gate.
- **Only the first phase is handed over.** `--start` sends phase 1's scope and points; handing over phase 2 or later (for example a `--phase` option) is a follow-up that needs George's approval.
- **Plans on screen are bounded.** The panel shows plans made in the last 7 days whose status is not `done` or `abandoned`, and a plan never hides the "Nothing needs you right now" card.
- **No combined store.** Plans are read from the folder; there is no index, ranking or promotion on top of capture and search.

## Where it lives

- `cli/src/commands/plan.ts` — build a plan, write it, mirror it into capture.
- `cli/src/lib/plans.ts` — read plans back: `parsePlanBody`, `readPlans`, `findPlan`, `planHandoff`.
- `cli/src/commands/work.ts` — show a plan, and `--start` it.
- `cli/src/index.ts` — the `work` command's `--start` flag.
- `cli/src/conversation-view/{show,artefact,boxes,page}.ts` — the plan as an artefact.
- Tests: `cli/src/lib/__tests__/plans.test.ts`, `cli/src/commands/__tests__/{plan,work}.test.ts`, `cli/src/conversation-view/__tests__/plan-artefact.test.ts`.

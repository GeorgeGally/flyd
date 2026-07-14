# Real-State Directed Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flyd turn meaningful provider evidence into a specific decision, investigation, or monitoring surface instead of successfully composing the generic quiet screen.

**Architecture:** Add a focused `Flyd::EvidenceCandidates` service that translates eligible provider collections into justified interface candidates with exact evidence references. `Flyd::InterfaceDirector` will merge those candidates beneath durable scenes and explicit intent, while the existing LLM composition boundary retains final judgment among the allowed modes. The existing validators and deterministic renderers remain unchanged.

**Tech Stack:** Rails 8, Active Support, Minitest, PostgreSQL, Hotwire, existing `Flyd::Intelligence` LLM composition pipeline.

---

## File Map

- Create `app/services/flyd/evidence_candidates.rb`: derive justified interface candidates from provider evidence without choosing UI content.
- Create `test/services/flyd/evidence_candidates_test.rb`: define eligibility, provenance, and quiet-state behavior.
- Modify `app/services/flyd/interface_director.rb`: merge evidence-backed candidates with scene, intent, build, and conversation candidates.
- Modify `test/services/flyd/interface_director_test.rb`: prove rich provider-only state no longer constrains Flyd to quiet.
- Modify `test/services/surface/planner_test.rb`: prove provider-only evidence can produce and validate a specific directed surface end to end.
- Modify `app/services/flyd/intelligence.rb`: make quiet an explicit absence-of-meaning choice and tell the composer to use candidate evidence references.

### Task 1: Extract evidence-backed interface candidates

**Files:**
- Create: `app/services/flyd/evidence_candidates.rb`
- Create: `test/services/flyd/evidence_candidates_test.rb`

- [ ] **Step 1: Write failing tests for meaningful and empty provider state**

Add tests that pass provider-only state containing a user-confirmed tension, an explicit curiosity item, and an unresolved signal. Assert that the service returns `decision`, `investigation`, and `monitoring` candidates with exact source references. Add a second test asserting that goals by themselves do not manufacture urgency and return no candidates.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bin/rails test test/services/flyd/evidence_candidates_test.rb`

Expected: FAIL because `Flyd::EvidenceCandidates` does not exist.

- [ ] **Step 3: Implement the minimal evidence candidate service**

Implement `Flyd::EvidenceCandidates.call(state)` with these rules:

- eligible `tensions` create a `decision` candidate;
- eligible `curiosity` creates an `investigation` candidate;
- eligible unresolved `signals`, `nudges`, or `recentEvents` create a `monitoring` candidate;
- goals and reports remain supporting evidence and do not create a mode by existence alone;
- items with missing ids are ignored;
- candidates include at most five exact `{ type:, id: }` evidence references;
- candidates describe why the evidence justifies the mode but do not prescribe titles, layouts, options, or actions.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `bin/rails test test/services/flyd/evidence_candidates_test.rb`

Expected: PASS.

- [ ] **Step 5: Commit the evidence boundary**

Run:

```bash
git add app/services/flyd/evidence_candidates.rb test/services/flyd/evidence_candidates_test.rb
git commit -m "feat(surface): Derive interface candidates from evidence"
git push origin main
```

### Task 2: Let real evidence reach Flyd's interface judgment

**Files:**
- Modify: `app/services/flyd/interface_director.rb`
- Modify: `test/services/flyd/interface_director_test.rb`

- [ ] **Step 1: Write a failing director test using provider-only state**

Add a test with no active scenes, interaction, intent, or builds. Supply provider state containing tension, curiosity, and unresolved signal evidence. Assert that `decision`, `investigation`, `monitoring`, and `quiet` are allowed, that a specific mode is suggested ahead of quiet, and that the candidates retain exact evidence references.

- [ ] **Step 2: Run the director test and verify RED**

Run: `bin/rails test test/services/flyd/interface_director_test.rb`

Expected: FAIL because the director currently returns only `quiet`.

- [ ] **Step 3: Merge evidence candidates without weakening stronger signals**

Update `Flyd::InterfaceDirector` so explicit builds, durable scenes, and requested capabilities keep their current higher confidence. Insert `Flyd::EvidenceCandidates` after those candidates and before conversation/quiet. De-duplicate candidates by mode, retaining the highest-confidence candidate and its provenance.

- [ ] **Step 4: Run director and existing intelligence tests**

Run: `bin/rails test test/services/flyd/interface_director_test.rb test/services/surface/planner_test.rb`

Expected: PASS.

- [ ] **Step 5: Commit the director integration**

Run:

```bash
git add app/services/flyd/interface_director.rb test/services/flyd/interface_director_test.rb
git commit -m "fix(surface): Direct Flyd from provider evidence"
git push origin main
```

### Task 3: Prove provider-only state composes a real surface

**Files:**
- Modify: `test/services/surface/planner_test.rb`
- Modify: `app/services/flyd/intelligence.rb`

- [ ] **Step 1: Write a failing provider-only composition test**

Create a realistic provider payload with no pre-created `Scene`. Make the fake chat return an investigation surface sourced from the curiosity and signal ids. Assert that the sent `interface_direction` allows investigation, that the response validates, and that the result is not `quiet:available` or titled `What deserves your attention?`.

- [ ] **Step 2: Run the composition test and verify RED**

Run: `bin/rails test test/services/surface/planner_test.rb`

Expected: FAIL before the director integration because investigation is not justified by provider-only state. If Task 2 already makes the assertion pass, first add the prompt assertion in this task so RED proves the missing composer instruction.

- [ ] **Step 3: Tighten the composer contract**

Update the system prompt to state that quiet is valid only when no candidate evidence supports a concrete present situation. Tell Flyd to inspect each candidate's `evidence_refs`, synthesize across those references, and preserve exact references on generated items. Keep the final mode choice with Flyd and keep all current validator constraints.

- [ ] **Step 4: Run composition, validator, and director tests**

Run: `bin/rails test test/services/surface/planner_test.rb test/services/flyd/interface_director_test.rb test/services/flyd/evidence_candidates_test.rb test/services/flyd/surface_plan_validator_test.rb`

Expected: PASS.

- [ ] **Step 5: Commit the end-to-end contract**

Run:

```bash
git add app/services/flyd/intelligence.rb test/services/surface/planner_test.rb
git commit -m "test(surface): Cover real-state composition"
git push origin main
```

### Task 4: Exercise Flyd with the actual local snapshot

**Files:**
- No source files expected.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
bin/rails test
bin/rails test:system
git diff --check
```

Expected: all tests pass and `git diff --check` reports no errors.

- [ ] **Step 2: Compose from the current PostgreSQL snapshot**

Run: `bin/rails runner 'ComposeSurfaceJob.perform_now(reason: "real_state_acceptance")'`

Expected: a new active surface with a successful composition log and a specific non-generic mode justified by source references from the stored provider snapshot.

- [ ] **Step 3: Inspect the rendered root at desktop and mobile sizes**

Open the running Flyd app, verify the focus renderer matches the selected mode, verify all text and controls fit, execute no destructive action, and capture screenshots at approximately 1440x900 and 390x844.

- [ ] **Step 4: Verify main is the delivered state**

Run:

```bash
git status --short --branch
git log -1 --oneline
git rev-parse HEAD
git rev-parse origin/main
```

Expected: clean `main`, with local and remote commit ids identical.

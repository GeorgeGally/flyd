# Founder Trial Runbook

## Purpose

Seven-day founder gate for the Work Intelligence PRD. Before any further architecture expansion, the founder must use Flyd for real work over seven consecutive days and demonstrate that the product reset produces valuable outcomes that justify continued investment.

This is not a QA pass. Builds, tests, and route counts mean nothing here. Only explicit founder-recorded evidence counts.

## Entry criteria

- All U1-U7 implementation units are complete and verified.
- The installed app (`cd mac-adapter && make run`) runs correctly with a private loopback Core.
- `cfyd check-foundry-gate` reports `ready`.
- The founder has at least 30 minutes of real work to do each day.

## Installed repository-action acceptance

Before starting the trial, prove one approval-to-receipt loop against a disposable Git repository:

1. Build and install the current checkout with `make -C mac-adapter install`.
2. Open a tracked file from the disposable repository in a supported Mac editor so that repository is the foreground project.
3. Run `make -C mac-adapter invoke-installed`, then bring the tracked file back to the foreground during the 10-second focus window. This opens the same installed invocation panel as **Ask Flyd...** without bypassing the Mac approval flow.
4. Ask Flyd for one bounded repository change with an observable finish condition.
5. Confirm the approval card shows the expected repository, operation, finish condition, and expiry, then approve it.
6. Observe the executing state and terminal verdict. Inspect the preserved handoff and its linked outcome receipt under `~/.flyd/overlay/`.
7. Confirm the foreground checkout's HEAD and status digest are unchanged.

The `--invoke-on-launch` argument exists only to make installed acceptance automation reproducible when a runner cannot emit the hardware Fn shortcut. It opens the native panel; it does not call a Core endpoint or approve an action.

## Daily practice

Use Flyd for at least **30 minutes of real work** each day across at least **3 of the 5 domains**:

| Domain | Example activity |
|---|---|
| Design | Critique a UI layout, suggest spacing/hierarchy improvements, evaluate a visual decision |
| Writing | Review a draft, improve clarity/structure, edit for audience |
| Strategy | Evaluate a product decision, weigh tradeoffs, challenge an assumption |
| Code | Review a diff, diagnose an issue, propose a bounded repository action |
| Research | Investigate a new technology, compare approaches, surface contradictions |

### Recording

After each meaningful invocation, record in the founder journal. Every entry requires a **explicit founder confirmation** — the journal must not be populated by route counters, worker heuristics, or LLM self-assessment.

Record which of these outcomes the intervention produced:

| Outcome | What to record |
|---|---|
| **Accepted** | The intervention was directly useful for the task at hand. Record as `intervention_accepted`. |
| **Retained an improvement** | An artifact was visibly improved and the change was kept. Record as `artifact_improved`. |
| **Advanced a project** | The intervention moved a real project forward with verified work. Record as `project_advanced`. |
| **Discovered an issue** | Flyd surfaced a problem, gap, or risk the founder would have missed. Record as `issue_discovered`. |
| **Corrected an error** | Flyd caught and corrected a mistake in the work. Record as `correction_applied`. |
| **Rejected** | The intervention was not useful. Record as `intervention_rejected`. No penalty — honest rejection is a data point. |
| **Partial or failed action** | An action was attempted but did not complete or produced incorrect results. Record as `action_partial` or `action_failed`. These count as negative signal and do not advance the gate. |

Also record a **context accuracy sample** each day: explicitly confirm whether the current project Flyd is tracking matches reality. Record as `context_accuracy_sample` with `correctProject: true` or `correctProject: false`. A single incorrect current-project presentation counts as a stale-current incident.

At day end, record a **closeout** for each Work Session: state what was verified, what issues remain, and what the next action is. Record as `closeout_recorded`.

## Success criteria

The gate requires **all** of the following, measured from explicit journal records only:

| Criterion | Threshold | Journal event |
|---|---|---|
| Voluntary use | At least 5 of 7 days | `intervention_accepted` events across distinct calendar days |
| High-value interventions | At least 10 accepted | `intervention_accepted` |
| Retained improvements | At least 3 real artifact improvements | `artifact_improved` |
| Projects advanced | At least 2 projects advanced through verified work | `project_advanced` |
| Issues discovered | At least 3 missed issues or opportunities discovered | `issue_discovered` |
| Current-project accuracy | At least 90% accuracy with zero stale-current incidents | `context_accuracy_sample` |
| Preference over Clicky | Founder preference for project-aware critique over Clicky | Explicit comparison noted in trial journal |
| Preference over generic chat | Founder finds work continuity more useful than generic chat | Explicit comparison noted in trial journal |
| Learning improves later work | At least 1 concrete example of retained learning | `learning_promoted` |

## Invalidation rules

The following must **not** be used to infer trial outcomes:

- Route counts (manifest, resolve, health endpoint hits)
- Worker activity counters
- Assistant self-assessment statements ("the trial is going well")
- Confidence scores from model responses
- Duration or volume metrics not tied to explicit founder confirmation
- Any metric derived from technical counters rather than explicit journal records

If a metric cannot be traced to a specific `FounderJournalEntry` with an explicit founder-confirmed `eventType`, it does not exist for the purpose of the gate.

## Daily checklist

Each day, before recording the day's entries for the gate:

- [ ] **Core health**: Confirm `curl -s http://localhost:4815/health` returns healthy. Core owns ports 4815-4817.
- [ ] **Permissions**: Verify Accessibility, Input Monitoring, and Screen Recording permissions are granted in System Settings > Privacy & Security.
- [ ] **Journal consistency**: The journal directory (`~/.flyd/overlay/founder-journal/`) is accumulating entries. Each entry has a valid `entryId`, `timestamp`, `eventType`, and `details`.
- [ ] **Project accuracy sample**: Explicitly record at least one `context_accuracy_sample` entry. Confirm `correctProject: true` or `correctProject: false`.
- [ ] **Domain coverage**: At least 3 domains were exercised today.
- [ ] **No fabricated evidence**: All entries recorded today come from explicit founder actions, not automated counters.

## End-of-trial assessment

After seven days, run the trial report:

```bash
cd cli && npx tsx src/entry.ts evidence trial-report
```

Or programmatically call `generateFounderTrialReport()` with all journal entries.

The report produces one of three statuses:

### `passed`

All gate thresholds are met. The report confirms:
- At least 10 accepted interventions
- At least 3 retained improvements
- At least 2 projects advanced
- At least 3 issues discovered
- Current-project accuracy at 90%+ with at least one sample
- At least 1 learning promoted for later use
- At least one concrete example of retained learning improving later work

**If passed**: The Work Intelligence PRD is validated. Proceed to architecture expansion from the PRD, not from pre-reset assumptions.

### `failed`

All three core gates failed: fewer than 3 retained improvements, fewer than 2 projects advanced, **and** fewer than 10 accepted interventions.

**If failed**: The product reset direction is wrong. Do not expand architecture. Investigate root causes from journal evidence before deciding next steps.

### `insufficient_evidence`

Some gates are met, some are not, or the gate criteria are partially satisfied. Not a pass, not a hard failure — the trial needs more evidence.

**If insufficient_evidence**: Extend the trial. Do not declare pass or fail. Identify which gates are unmet and focus the next days on those domains.

## Inspection

After the trial, retained artifacts and local records (`~/.flyd/overlay/`) must be inspectable without relying on Flyd's own claim of success. Open the journal directory, examine specific entry files, and verify the claimed improvements independently.

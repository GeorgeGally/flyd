# Flyd Founder Trial Runbook

## Purpose

Run a seven-day trial to determine whether the Flyd work-intelligence reset produces real founder value before any architecture expansion.

## Gate Requirements

| Metric | Required | Measured by |
|---|---|---|
| Voluntary use days | ≥5 of 7 | Journal entries across unique days |
| Accepted high-value interventions | ≥10 | `intervention_accepted` journal events |
| Materially improved real artifacts | ≥3 | `artifact_improved` journal events |
| Projects advanced through verified work | ≥2 | `project_advanced` journal events |
| Missed issues or opportunities discovered | ≥3 | `issue_discovered` journal events |
| Current-project accuracy | ≥90% | `context_accuracy_sample` entries |
| Stale projects presented | 0 | `context_accuracy_sample` entries with correctProject=false |
| Learning improved later work | ≥1 | `learning_promoted` journal events |
| Preference over Clicky for critique | Subjective | Founder self-report |
| Preference over generic chat for continuity | Subjective | Founder self-report |

## Setup

1. `cd mac-adapter && make run` — install and launch the app
2. Grant Accessibility, Input Monitoring, Screen Recording permissions
3. Confirm Core is healthy: `curl http://127.0.0.1:4815/health`
4. Confirm journal directory exists: `ls ~/.flyd/overlay/founder-journal/`

## Daily Routine

1. Invoke Flyd normally while doing real work (design, writing, strategy, code, research)
2. Ask for critique, improvements, and project continuity
3. Accept or reject interventions
4. Execute approved text actions
5. At the end of each session, close the session (through the app or by natural idle timeout)

## Generating the Trial Report

```bash
curl -H "Authorization: Bearer $(cat ~/.flyd/overlay/auth-token)" \
  "http://127.0.0.1:4815/journal/report?since=2026-08-01T00:00:00Z" | jq .
```

The report returns:
- `status`: `passed`, `failed`, or `insufficient_evidence`
- `gateChecks`: per-metric breakdown with required vs actual counts
- `evidenceSummary`: human-readable period and sample counts

## Verifying Without the Report

Inspect the journal directly:
```bash
ls ~/.flyd/overlay/founder-journal/ | wc -l
cat ~/.flyd/overlay/founder-journal/*.json | jq '.eventType' | sort | uniq -c
```

## Trial Completion

The trial passes only if ALL gate checks pass. A `failed` or `insufficient_evidence` status triggers another product review before architecture expansion.

When the trial passes: U6 (repository action) can proceed using the evidence from the verified text loop.

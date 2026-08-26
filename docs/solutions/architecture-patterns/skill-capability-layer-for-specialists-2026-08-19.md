---
title: "Skill-capability layer for flyd specialists, patterned on gbrain skills"
date: 2026-08-19
category: architecture-patterns
module: flyd-work-intelligence
problem_type: architecture_pattern
component: specialist-skills
severity: medium
applies_when:
  - "Building the coach specialist (docs/plans/2026-08-19-001-feat-coach-specialist-plan.md)"
  - "Adding future specialist personas to the work-intelligence pipeline"
  - "Deciding whether to adopt external skill ecosystems (gbrain, Claude skills, OpenClaw plugins)"
  - "Making 'coach compounds' (R3) measurable instead of aspirational"
  - "Making the anti-generic-advice rule (R6) structural instead of a prompt line"
tags:
  - skills
  - coach-specialist
  - eval-contract
  - no-regression
  - correction-pipeline
  - trigger-routing
  - gbrain
  - skillify
  - specialist-registry
---

# Skill-capability layer for flyd specialists, patterned on gbrain skills

## Context

Flyd has one skill concept today: **learned memory**. `cli/src/work-intelligence/skillify/` turns corrections and accepted standards into `proposed → confirmed → written` wiki files (constraints/standards/decisions) that feed future Ground packs. This is the learning substrate and it works.

The coach-specialist plan (`docs/plans/2026-08-19-001-feat-coach-specialist-plan.md`) needs a *second*, distinct concept: **routable capability**. The coach is a persona that owns sub-behaviors (check-in, retrospective, goal-adjustment), each of which must be invoked, evaluated, and improved independently. Future specialists will need the same shape.

gbrain (`github.com/garrytan/gbrain/skills`) is the reference library for this concept: ~75 skills, each a `SKILL.md` with frontmatter `triggers:`, an `eval_contract` (goal + dimensions + hard-fails), cross-modal eval, a no-regression law, and `skill-autobench` (evals authored from real usage history — user corrections as the gold signal). The mechanisms transfer; the full gbrain skillpack machinery does not.

The binding constraint: PRD §14.3 excludes a "marketplace or skill ecosystem" from flyd V1. The pattern below is a small roster of named skills owned by named personas — not a catalog.

## Guidance

### 1. Specialist owns skills (registry shape)

A specialist is a persona that owns multiple trigger-routed skills. The registry entry is `persona → [skills]`, not `persona → one dispatcher`.

```yaml
persona: coach
skills:
  check_in:        # triggers: "check in", "how am i doing"
  retrospective:   # triggers: "retro", "how did that go"
  goal_adjust:     # triggers: "update my goal", "adjust goal"
```

Why: keeps the future roster from becoming a pile of bespoke dispatchers. A specialist's skills are separately routable, separately evaluated, separately improved — and the general pattern is identical for any future persona.

### 2. Skill = { triggers, contract, eval, learning }

The general skill pattern is a bridge between gbrain's capability packages and flyd's learning substrate:

```
Skill = {
  triggers  → substring match on user intent (no capability router)
  contract  → eval_contract frontmatter (goal + dimensions + hard_fails)
  eval      → no-regression receipts; self-review cheap, cross-modal periodic
  learning  → corrections root-caused → hard rule + regression case (skillify path)
}
```

**Routing contract (from gbrain `_AGENT_README`):** skills declare `triggers:` in frontmatter; substring match dispatches; frontmatter is authoritative. No capability router, no resolver tables as source of truth.

**Architectural rule:** the skill pattern lives at the **capability layer**, not the memory layer. Memory (skillify → wiki) stays as-is — it is the learning substrate. Skills consume memory for grounding (exactly as the coach grounds in the outcome journal) but are not written into the wiki.

### 3. Anti-generic advice = eval hard-fail, not a prompt line

Each coach skill carries an `eval_contract`:

```yaml
eval_contract:
  goal: "One high-leverage, non-generic intervention grounded in the user's actual state"
  dimensions:
    - "GROUNDING — names a specific goal/pattern/obligation from real user data"
    - "SINGLE_FOCUS — one intervention, not a list"
    - "LEVERAGE — highest-leverage causal issue, not a topic"
  hard_fails:
    - "Any intervention not grounded in actual user data = auto-zero (R6)"
```

A `hard_fail` is scored and checkable; an `avoidance` is advisory. The plan's U2 avoidances remain, but the hard-fail is what makes R6 structural.

### 4. No-regression gate, judged cheaply

"Coach compounds" (R3) needs a verifiable forward-only trend. gbrain's law, scaled to the personal loop:

- **Self-review (per check-in, zero cost):** the coach's next-session ground includes its prior interventions + the user's responses; it scores itself forward-only. The compounding loop is the judge.
- **3-model audit (periodic):** weekly/monthly, a cross-modal eval on accumulated coach output against the eval contract. Cost-bounded by cadence (~$1–3/run), not per-check-in.
- **Receipts:** one receipt per iteration (sha-bound), so "compounds" is a measured delta, not a vibe.

Never per-check-in 3-model eval — the daily loop must stay near-zero cost.

### 5. Correction pipeline — extend existing skillify, don't fork it

Flyd's `skillify` (`cli/src/work-intelligence/skillify/propose.ts`) already provides proposed→confirmed→written with dedupe and TTL. gbrain's correction-pipeline adds the missing half: **root-cause at source, add a hard rule + regression case**. When a user corrects the coach:

1. Existing skillify propose path fires (unchanged).
2. The correction is mined for (a) a new hard rule in the coach's skill, and (b) a replayable eval case.

Reuse the existing propose/confirm machinery. Do not build a parallel learning store.

### 6. autobench from the outcome journal, not a conversation archive

gbrain mines `conversations/` pages; flyd has no such archive. Mine the **outcome journal** (`cli/src/work-intelligence/outcome-journal.ts`) + check-in entries instead. Corrections after coach interactions are the gold signal. Label cases `HISTORY-IMPLIED` vs `SPEC-DERIVED`, human-gate before merging into the eval contract. Defer if the coach pilot doesn't need it day one.

### 7. resolve-before-asking (cheap privacy lever, R5)

Before the coach asks "who is X?" / "what are you working on?", it exhausts: Present Model current work → memory retrieval → outcome journal → wiki. Only then asks. Keeps the coach from prying (R5) and makes check-ins smarter.

## What NOT to port

Skip the full gbrain skillpack machinery — skill-optimizer (SkillOpt), skillpack-check/harvest, the 15-item skillify checklist, and anything marketplace-shaped. PRD §14.3 excludes a skill ecosystem; the coach owns a handful of skills, not a catalog.

## Verification

- A "coach" message routes to the coach persona; "check in" routes to the check-in skill (trigger substring match, no capability router).
- Coach eval contract has the no-generic hard-fail; a generic intervention scores zero.
- Self-review receipts show forward-only trend; a regression blocks.
- A user correction produces a skillify proposal AND a hard rule / eval case.
- R5 holds: identity questions resolve-before-asking; no new capture, no network.
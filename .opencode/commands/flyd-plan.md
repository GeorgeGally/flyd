---
description: Create a structured implementation plan — searches memory for context, produces a plan with steps and acceptance criteria
argument-hint: "<topic> [--model <model>]"
---
Run `npx tsx src/index.ts plan $ARGUMENTS` to create a structured plan. The plan is saved to `~/.flyd/plans/` and also as a searchable capture in `~/.flyd/raw/`.

The plan includes: Goal, Approach, Files to touch, Implementation steps, and Acceptance criteria.

After running, present the plan to the user and ask if they want to refine it or start working.

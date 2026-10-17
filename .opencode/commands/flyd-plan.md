---
description: Create a structured implementation plan — searches memory for context, produces a phased plan with checkable done_when points
argument-hint: "<topic> [--model <model>]"
---
Run `npx tsx cli/src/index.ts plan $ARGUMENTS` to create a structured plan. The plan is saved to `~/.flyd/plans/` and also as a searchable capture in `~/.flyd/raw/`.

The plan includes: Outcome, Files to touch, Approval gates, and phases each ending in checkable **Done when:** points (shape: `docs/product/flyd-build-a-plan.md`).

After running, present the plan to the user and ask if they want to refine it or start working.

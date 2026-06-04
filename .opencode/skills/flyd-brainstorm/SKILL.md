---
name: flyd-brainstorm
description: Think through a feature or problem interactively, then create a plan. Use when the user says "help me think through", "brainstorm this", or has a vague idea that needs shaping before planning.
argument-hint: "<topic or problem to explore>"
---

# Brainstorm → Plan

Use when the idea is fuzzy and needs shaping before a plan makes sense.

## Workflow

### Phase 1: Understand

Ask a few targeted questions (one at a time, using AskUserQuestion):

1. What problem does this solve? Who is it for?
2. What does success look like — what's the concrete outcome?
3. What's the simplest version that would deliver value?

### Phase 2: Check Memory

Search flyd for relevant context:
- `/flyd-search <topic>` for existing captures
- `/flyd-ask "what do I know about <topic>"` for synthesis

### Phase 3: Create Plan

Run `/flyd-plan "<refined topic>"` to produce a structured plan.

Present the plan to the user and ask: does this look right, or should we refine it?

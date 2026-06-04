---
description: Show a plan as a checklist, or list all plans. Use after /flyd-plan to see what to execute.
argument-hint: "[<plan-topic>] [--list]"
---
Run `npx tsx src/index.ts work $ARGUMENTS` to show a plan's implementation steps and acceptance criteria as a checklist.

- **No args**: shows the latest plan
- **`<topic>`**: finds a plan by topic or filename
- **`--list`**: lists all plans

After showing the plan, ask the user which step to start with.

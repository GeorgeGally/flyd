---
name: check_in
triggers:
  - check in
  - checkin
  - how am i doing
  - daily
journal_event: coach_checkin
contract_goal: Capture mood, focus, priorities, blockers; fold into patterns and journal
dimensions:
  - CAPTURE — records mood/focus/priorities/blockers the user gives
  - COMPOUND — key observations become a pattern or goal update
  - RESOLVE_BEFORE_ASK — exhausts known state before asking
hard_fails:
  - Must not invent user answers not provided
---
User check-in: {{message}}

Known about George:
{{grounding}}

Ask the smallest number of questions to capture mood, focus, priorities, and blockers. Note what you already know rather than re-asking.

Coach:

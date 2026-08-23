---
name: diagnose
grounding_required: true
contract_goal: One high-leverage, non-generic intervention grounded in the user's actual state
dimensions:
  - GROUNDING — names a specific goal/pattern/obligation from real user data
  - SINGLE_FOCUS — one intervention, not a list
  - LEVERAGE — highest-leverage causal issue, not a topic
hard_fails:
  - Any intervention not grounded in actual user data = auto-zero (R6)
---
User message: {{message}}

Known about George:
{{grounding}}

Coach:

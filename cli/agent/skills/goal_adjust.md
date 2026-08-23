---
name: goal_adjust
impl: goal_adjust
triggers:
  - update my goal
  - adjust goal
  - change my goal
  - new goal
contract_goal: Record or adjust a goal with a stated source
dimensions:
  - RECORD — a goal is persisted
  - TRACE — source is captured
hard_fails:
  - Must not fabricate the goal statement

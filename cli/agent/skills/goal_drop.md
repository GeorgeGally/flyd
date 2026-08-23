---
name: goal_drop
impl: goal_drop
triggers:
  - off my plate
  - off the plate
  - not working on
  - stop working on
  - done with
  - drop the
  - drop it
  - take that weight off
  - someone else is handling
  - friend is doing
  - not doing anymore
contract_goal: Honor a deprioritization: archive goals the user has explicitly taken off their plate
dimensions:
  - HONOR — the goal is archived so it stops re-surfacing
  - SPECIFIC — only the goals the user named are dropped, not unrelated ones
hard_fails:
  - Must not archive a goal the user did not name

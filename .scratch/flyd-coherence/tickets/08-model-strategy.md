# Which models make which decisions
label: wayfinder:research
status: closed (2026-11-24)
blocked-by: -

## Question

George feels Flyd under-uses JEV (System-1 routing via TypeSafe) and the stronger reasoning models from OpenAI and Google. Today: what does each Flyd decision run on (routing, chat, creative judgment, taste, proactive planning, review), what does JEV decide and how well (replay calibration status), and which decisions would gain most from a stronger reasoning model (OpenAI, Gemini) or a JEV head, at what cost? Recommend a model map per decision type.

## Resolution

Research: [08-model-strategy](../research/08-model-strategy.md). Jev is strong on closed-set routing but nothing is routed by difficulty: needs_reasoning_model (100% in a 10-case replay) has no consumer, and the replay bench is red (stale answer_form recordings). Recommended map: Jev for routing and tier choice; small model for easy chat and status lines; a reasoning tier (OpenAI or Sonnet/Opus) for hard chat, proactive planning, CoS objectives, taste and news ranking (batched); Opus for creative review with Gemini trialled as a second judge; strongest cross-family model as checker. About $3-4/day extra. Which model fills the reasoning tier is George's call.

George asked 2026-11-24 to choose between Opus and Sonnet for the reasoning tier; recommendation given: Sonnet for hard chat and daily batch jobs (taste, news), Opus for proactive planning, CoS objectives and creative review. Answer pending.

## Decision 2026-11-24 (George: "u decide")

Sonnet for hard chat and the daily batch jobs (taste, news ranking); Opus for proactive planning, CoS objectives and creative review; Jev for routing and tier choice; trial Gemini as a second vision judge. Not yet built: switching models waits for the build phase.

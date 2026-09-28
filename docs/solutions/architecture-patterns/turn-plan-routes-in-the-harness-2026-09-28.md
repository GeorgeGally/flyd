---
title: Decide what kind of turn it is once, and let the harness enforce it
date: 2026-09-28
category: architecture-patterns
module: cli/src/runtime/turn-plan.ts
problem_type: architecture_pattern
component: assistant
severity: high
applies_when:
  - "a chat failure is about doing the wrong kind of thing (exploring instead of handing off, starting work instead of answering, researching instead of asking)"
  - "the fix you are about to write is another sentence in the chat system prompt"
  - "two prompt rules pull in opposite directions and the model resolves them differently run to run"
  - "a tool gets picked instead of a sibling whose description overlaps"
tags:
  - harness-engineering
  - routing
  - turn-contract
  - tool-gating
  - progressive-disclosure
  - honesty-check
related_components:
  - tooling
---

# Decide what kind of turn it is once, and let the harness enforce it

## Context

Live testing on 2026-09-28 surfaced four chat failures that looked unrelated:

- "add a clock to the TUI header" explored 16-30 tool calls and ran out of steps; it never reached `start_coding_task`.
- "can I make my 7:15 flight?" answered, then spawned a background job to "keep an eye on the flight" (a job runs once).
- "anything I should know before tomorrow?" came back as "Go to bed."
- "book it" spent 15 tool calls and timed out instead of asking what to book.
- "talk to me in plain English" saved a memory instead of calling `speaking_style`.

## Root cause

All of them were routing: the model decided *what kind of turn this is* implicitly, mid-loop, with every tool on the table, steered by ~25 prose rules that contradict each other ("make the edit yourself" / "hand substantial work to the crew"; "act now" / "ask when ambiguous"; "never just comment" / "stop when you've answered"). Each earlier failure had been fixed by adding a rule, which added a conflict, which produced the next failure. The room reading (`read-the-room.ts`) already classified the turn, but its verdict only became more prompt text.

Two secondary causes made it worse:

- **Stale state as a task.** MEMORY.md still said "Flyd still needs to switch the purple text to green" after the work was done elsewhere; code turns read it as an open task and chased it.
- **No trace of the decision.** Nothing recorded which route a turn took, so a silent fallback (room reading timed out → old behaviour) was indistinguishable from a wrong route.

## Solution

The room reading commits to a **turn plan** (`turn-plan.ts`): a `route` and the `cover` points the reply must address. The harness, not the prompt, enforces the route:

| route | tools in sight | gate lets through | budget |
|---|---|---|---|
| answer | everything except change-only tools | read | default |
| clarify | everything except change-only tools | read | 3 steps, 2 calls |
| delegate | only `start_coding_task`, `background_task` | the hand-offs | 3 steps, 2 calls |
| act | everything | everything (policy still asks for outward/destructive) | 10 steps, 12 calls |

- Hiding tools is the nudge; `offRoute()` in the handler is the rule (a `bash` that writes is still stopped on an answer turn).
- On `delegate`, reading the code is the crewmate's job: given repo tools, the dispatcher explored until its budget ran out.
- Unattended runs (jobs, agenda) and turns with no reading keep today's behaviour.
- The plan goes into every turn receipt (`plan.route`, `"unplanned"` on fallback).
- Tool contracts (`tool-contracts.ts`) run in the same gate: a style request sent to `remember` comes back pointing at `speaking_style`.
- The honesty check reads grammar, not verb lists: after a hand-off, any "I've …-ed" other than "started" is a claim about work nobody has done yet. The one-voice rule ("never name the crew") became a mechanical style check.

Prompt rules the harness now enforces were removed or reworded so they stop competing.

## Result

Same live scenarios, after: clock and dark-mode requests hand off in 14-18s (was 114-200s or never), "book it" asks one question in 16s with no tools, the evening check-in covers tomorrow and the open loose end, the airport sum starts no job.

## How to apply

Before adding a sentence to the chat prompt, ask which layer the failure belongs to:

1. **Wrong kind of turn** → the room reading's route definitions or the plan's tools/budget.
2. **Wrong tool among siblings** → a contract in `tool-contracts.ts`, or sharper descriptions.
3. **Claimed what didn't happen** → the honesty check, by grammar or receipts.
4. **Chased something nobody asked for** → the state feeding the prompt (stale memory, open commitments).
5. **Genuine judgment** → only then, the prompt.

Check the receipt's `plan.route` first: a failure on an `"unplanned"` turn is a room-reading problem, not a routing one.

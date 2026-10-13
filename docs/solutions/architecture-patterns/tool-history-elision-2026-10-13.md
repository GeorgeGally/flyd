---
title: Reduce stale tool-output pressure without rewriting evidence
date: 2026-10-13
module: cli/src/runtime/tool-history.ts
problem_type: architecture_pattern
tags: [harness-engineering, context-management, evidence]
---

# Applying the harness study to Flyd

Source: [An Empirical Study of Harness Design for Coding Agents](https://arxiv.org/pdf/2609.20804), v1, 17 September 2026. The study supports conditional harness choices: context management helps most under pressure; staged elision before summarization is efficient; planning and shell-only interfaces have model/task-dependent tradeoffs. Its coding benchmarks do not establish personal-assistant memory policy or gains on Flyd's models.

## Decision

| Approach | Impact | Effort / risk | Decision |
|---|---|---|---|
| Request-only stale observation elision | Smaller repeated inputs in long tool turns | Low implementation effort; may omit useful middle details | Implemented |
| LLM running summaries | Can also compress reasoning and dialogue | Extra latency/cost and semantic drift | Wait for residual-pressure evidence |
| Model/task-specific planning and tool portfolios | Potentially fewer redundant calls | Requires paired outcome evaluations; inappropriate defaults can impair completion | Keep existing turn routing; evaluate before changes |

The live TypeScript loops previously resent every result. `tool-history.ts` now projects outgoing requests for Anthropic, Chat Completions, Responses, and the native worker. Original arrays and persisted worker sessions remain intact. User/system content, reasoning, tool arguments, IDs, order, and two complete recent model turns are preserved; a recent region also covers at least 30% of the configured estimated input budget. Older string result bodies over 4096 characters keep their first/last 512 characters and an explicit omission marker.

The default estimated input budget is 32768, with elision triggered at 60%. These are initial engineering settings, not discovered provider limits. UTF-8 JSON bytes / 3 is a heuristic; oversized protected content and structured results can still exceed a provider window. There is no summarization stage or overflow guarantee. `pressureRemaining` reports estimated pressure at 85% after projection.

`AgentLoopOptions.contextPolicy` and the worker's matching option accept `inputBudget`; `false` restores unmodified requests for paired evaluation. `onContextManaged` exposes estimates/counts without raw text; workers emit `context.elided`. No extra model call, persistence store, recall tool, approval gate, or new planning ritual is introduced. Canonical personal memory is unaffected.

## Verification and next evaluation

Tests cover low-pressure/disabled equivalence, protocol metadata, original transcript retention, recent-turn retention, mixed Responses reasoning/message/sibling-call groups, actual provider request paths, and native-worker persisted originals. Run the focused tests plus TypeScript lint/build.

Before claiming better answers or monetary savings, replay matched tasks on each deployed model with policy on/off and the same tools, budgets, assignments, and verifier. Include tasks that need a fact from the middle of an old result, non-Latin observations, resumptions, and large structured results. Compare verified completion, re-reads, provider input usage, latency, and residual pressure. Add summarization only if measured residual pressure warrants it; choose shell/tool portfolios by demonstrated task completion rather than model size.

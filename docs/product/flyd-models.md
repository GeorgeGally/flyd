# Flyd's models and their settings

Which model does which job, how Claude's monthly spend is capped, and every
environment variable that changes it. `flyd doctor` prints the live
assignment and this month's Claude spend; `cli/src/lib/model-setup.ts` is the
same answer in code.

## What must be set

Nothing beyond the key. With `CLAUDE_API_KEY` (or `ANTHROPIC_API_KEY`) in
`flyd/.env`, chat, quick jobs, typing prediction and the coding crew all move
to Claude with the defaults below. The one exception: a **user-level key**
(`sk-ant-usr…`, not scoped to a workspace) is rejected by the API unless each
request names a workspace, so such a key also needs `CLAUDE_WORKSPACE_ID`
(console.anthropic.com → Settings → Workspaces). A workspace-scoped key needs
nothing else.

## Who answers what

| Job | First choice | Falls back to |
| --- | --- | --- |
| Chat (Flyd window, TUI, overlay invocations) | Claude Sonnet 5.5, adaptive thinking at `medium` effort | `FLYD_CHAT_MODEL`, then `FLYD_CHAT_FALLBACK_MODELS`, then CommandCode |
| Quick jobs: room reading/routing, query rewrites, the view's routing, retold answers and status lines | Claude Haiku 5.5, thinking off | `FLYD_MODEL`, then the same fallbacks |
| Reply summaries in the Flyd window | Claude Haiku 5.5 | xAI Grok (`XAI_API_KEY` or the grok CLI's key) |
| Typing prediction | Claude Haiku 5.5, conversation cached | `openrouter:inception/mercury-2.5` |
| Coding crew (`flyd crew`, `start_coding_task`) | `anthropic/claude-sonnet-5-5` in OpenCode | OpenCode's own default model |
| Background learning, synthesis, curation | `FLYD_MODEL` chain, unchanged | — |

A fallback takes over when Claude errors, declines, or the month's cap is
reached. A failed provider cools down for ten minutes before it is tried again.

## Prompt caching

Flyd's long standing instructions (SOUL, how it talks, its tool list) are
marked as a cacheable prefix, as are the tool definitions and the growing
history inside each tool loop. Every tool round and the next turn re-read them
from cache at a tenth of the input price. The per-turn parts (the plan, memory,
the conversation) follow the cached prefix.

## Monthly spend cap

Every Claude call Flyd makes (and every step a Claude crewmate logs) is priced
from its reported token usage and added to this calendar month's total in
`~/.flyd/claude-spend.json`. At 80% of the cap George gets one notification and
an inbox note for his next briefing; at 100% Claude drops out of every chain
until the 1st and he hears that once too.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `CLAUDE_API_KEY` | — | Anthropic key for Flyd's Claude calls; `ANTHROPIC_API_KEY` is read when it is unset |
| `CLAUDE_WORKSPACE_ID` | — | Workspace for a user-level key (`ANTHROPIC_WORKSPACE_ID` also read) |
| `FLYD_CLAUDE` | on | `0` keeps Claude out of every job |
| `FLYD_CLAUDE_CHAT_MODEL` | `claude-sonnet-5-5` | Chat's Claude model |
| `FLYD_CLAUDE_CHAT_EFFORT` | `medium` | Sonnet's effort for chat turns (`low` answers faster, checks in more) |
| `FLYD_CLAUDE_QUICK_MODEL` | `claude-haiku-5-5` | Quick jobs' and typing's Claude model |
| `FLYD_CLAUDE_MONTHLY_CAP_USD` | `100` | Monthly Claude spend cap in US dollars |
| `FLYD_CLAUDE_USAGE_LOG` | — | Path of an opt-in per-call usage trail, for measuring cache hits |
| `FLYD_CHAT_MODEL` | `FLYD_MODEL` | Chat's model after Claude |
| `FLYD_CHAT_FALLBACK_MODELS` | — | Comma-separated, provider-qualified models after that |
| `FLYD_MODEL` | — | Background jobs' model, and quick jobs' fallback |
| `FLYD_ROUTING_FALLBACK_MODEL` | — | Pins the room reader and view router to one exact model |
| `FLYD_PREDICTION_MODEL` | Claude Haiku, then Mercury | Pins typing prediction to one exact model |
| `FLYD_PREDICTIONS` | on | `0` turns typing prediction off |
| `FLYD_CREW_MODEL` | Claude Sonnet while Claude is on | Pins the crew's OpenCode model (`provider/model`) |
| `FLYD_VIEW_ANTHROPIC_MODEL` | quick model | Summaries' Claude model |
| `FLYD_VIEW_XAI_MODEL` | `grok-4-fast-non-reasoning` | Summaries' xAI model |
| `FLYD_VIEW_SUMMARIES` | on | `0` turns model summaries off |
| `COMMANDCODE_API_KEY`, `COMMANDCODE_MODEL` | — | Adds CommandCode as the last chat/quick fallback |
| `FLYD_DICTATE_MODEL` | — | Dictation cleanup model (unchanged by Claude) |

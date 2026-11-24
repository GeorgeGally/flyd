# Flyd's models and their settings

Which model does which job, how Claude's monthly spend is capped, and every
setting that changes it. `flyd doctor` prints the live assignment and this
month's Claude spend; `cli/src/lib/model-setup.ts` is the same answer in code.

## One config: `~/.flyd/models.json`

Every job's models live in one file, like firstmate's crew-dispatch: each job
lists `{provider, model}` entries in order (the first answers, the rest are its
fallbacks), plus a `banned` list no job ever uses. The defaults are in
`cli/src/runtime/model-routing.ts`; the file overrides any part of them (a job
it doesn't list keeps its default). `.env` holds keys only. Swapping a model or
dropping a provider is a one-line edit, picked up on the next call:

```json
{
  "banned": ["deepseek"],
  "imagesOnly": ["codex"],
  "jobs": {
    "chat":       [{ "provider": "opencode-go", "model": "gpt-6-luna" }, { "provider": "anthropic", "model": "claude-sonnet-5-5" }],
    "quick":      [{ "provider": "opencode-go", "model": "gpt-6-luna" }, { "provider": "anthropic", "model": "claude-haiku-5-5" }],
    "background": [{ "provider": "opencode-go", "model": "gpt-6-luna" }, { "provider": "anthropic", "model": "claude-haiku-5-5" }],
    "worker":     [{ "provider": "opencode-go", "model": "gpt-6-luna" }, { "provider": "anthropic", "model": "claude-haiku-5-5" }],
    "crew":       [{ "provider": "claude", "model": "default" }],
    "design":     [{ "provider": "claude", "model": "opus" }],
    "images":     [{ "provider": "codex", "model": "default" }],
    "checker":    []
  }
}
```

That is the default, written out. Providers: `anthropic`, `openai`,
`openrouter`, `commandcode`, `opencode`, `opencode-go` (APIs, by their keys); `claude`
(Claude Code on George's subscription), `cursor` (`cursor-agent`), `codex`
(the ChatGPT/Codex allowance). `banned` entries match anywhere in `provider:model`, so `deepseek`
bans DeepSeek through any provider. A broken file is reported and the defaults
are used. `FLYD_MODELS_PATH` points at another file.

## Which providers Flyd may use

OpenCode Go handles Flyd's API text and coding-worker calls by default. Chat
and every other text job fall back to Anthropic (Sonnet for chat, Haiku for the rest) only if OpenCode Go fails. Anthropic remains available
for other jobs when chosen explicitly in `models.json`. The `claude` and
`cursor` crew/design runners remain their existing CLI subprocesses; the
OpenCode Go API is not a coding-session adapter. DeepSeek stays banned. George's
ChatGPT/Codex allowance is for images only. The checks live in
`cli/src/runtime/provider-policy.ts` and read the config. Flyd's own `openai:…`
models bill the separate `OPENAI_API_KEY` and are not that allowance.

## Who answers what

| Job (`jobs.<name>`) | Default | Notes |
| --- | --- | --- |
| `chat`: Flyd window, TUI, overlay invocations, background agenda runs | OpenCode Go GPT-6 Luna, then Claude Sonnet 5.5 if OpenCode fails | |
| `quick`: room reading/routing, query rewrites, the view's routing, retold answers, status lines, typing prediction, reply summaries | OpenCode Go GPT-6 Luna, then Claude Haiku 5.5 if OpenCode fails | Reply summaries can fall back to xAI Grok (`XAI_API_KEY` or the grok CLI's key) |
| `background`: learning, synthesis, curation, the news edition, the council, taste | OpenCode Go GPT-6 Luna, then Claude Haiku 5.5 if OpenCode fails | |
| `worker`: overlay questions (fn key, text and voice), LIVE's look-ups and actions, `flyd code` | OpenCode Go GPT-6 Luna, then Claude Haiku 5.5 if OpenCode fails | Each entry needs its provider's key; `/free` models are dropped when a paid one is listed |
| `crew`: `flyd crew`, `start_coding_task` | Claude Code (`claude -p`) on George's subscription, its own default model | `claude/<model>` or `cursor/<model>`; later entries are backups a refused crewmate moves to in the same worktree. None by default: a limited Claude waits |
| `design`: the Creative Director, Flyd's review of a lab, the Designers | Claude Opus through the `claude` CLI on George's subscription, never the metered `CLAUDE_API_KEY` | The first `claude` entry is used; `FLYD_CLAUDE_BIN` names the CLI. A plan limit or missing login stops the lab and George is told why |
| `images` | Codex (the ChatGPT/Codex allowance) | The only job allowed on `imagesOnly` providers |
| `checker`: the Chief of Staff's acceptance check, the crew's independent diff review, a background job's checker turn | Empty: another model family than the one that built the work, picked from the text jobs' models (`chat`, `quick`, `background`) | A checker of the builder's own family shares its blind spots (`checkerModelChain` in `cli/src/lib/config.ts`, families from `modelFamily` in `model-routing.ts`). Listing entries here limits the choice to them. Only when no other family is configured does each check run on the models it used before (quick, background, chat). |

OpenCode Go entries need `OPENCODE_API_KEY`; Anthropic entries run while
`CLAUDE_API_KEY` is set, `FLYD_CLAUDE` isn't `0` and the month is under its
cap; CommandCode entries need `COMMANDCODE_API_KEY`. A fallback takes over when
a model errors, declines, or the month's cap is reached. A failed provider
(quota, out of credit, auth or server fault) cools down for ten minutes before
it is tried again.

## What must be set

With `OPENCODE_API_KEY` in `flyd/.env`, the default text jobs use OpenCode Go.
Anthropic remains available by adding an `anthropic` route to the relevant job
in `~/.flyd/models.json`. OpenCode Go uses its OpenAI-compatible API at
`https://opencode.ai/inference/go/v1` (on 2026-11-23 one POST to its `/chat/completions` with model `gpt-6-luna` returned HTTP 200; requests need a flyd user agent plus `x-opencode-session` or the API returns 400 MissingSessionID, so Flyd sends both). A **user-level key**
(`sk-ant-usr…`, not scoped to a workspace) is rejected by the API unless each
request names a workspace, so such a key also needs `CLAUDE_WORKSPACE_ID`
(console.anthropic.com → Settings → Workspaces). A workspace-scoped key needs
nothing else.

## Prompt caching

Flyd's long standing instructions (SOUL, how it talks, its tool list) are
marked as a cacheable prefix, as are the tool definitions and the growing
history inside each tool loop. Every tool round and the next turn re-read them
from cache at a tenth of the input price. The per-turn parts (the plan, memory,
the conversation) follow the cached prefix.

## Monthly spend cap

Every Claude call Flyd makes is priced
from its reported token usage and added to this calendar month's total in
`~/.flyd/claude-spend.json`. At 80% of the cap George gets one notification and
an inbox note for his next briefing; at 100% Claude drops out of every chain
until the 1st and he hears that once too.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `CLAUDE_API_KEY` | — | Anthropic key for Flyd's Claude calls; `ANTHROPIC_API_KEY` is read when it is unset |
| `CLAUDE_WORKSPACE_ID` | — | Workspace for a user-level key (`ANTHROPIC_WORKSPACE_ID` also read) |
| `FLYD_MODELS_PATH` | `~/.flyd/models.json` | Where the model config is read from |
| `FLYD_CLAUDE` | on | `0` keeps Claude out of every job |
| `FLYD_CLAUDE_CHAT_EFFORT` | `medium` | Sonnet's effort for chat turns (`low` answers faster, checks in more) |
| `FLYD_CLAUDE_MONTHLY_CAP_USD` | `100` | Monthly Claude spend cap in US dollars |
| `FLYD_CLAUDE_USAGE_LOG` | — | Path of an opt-in per-call usage trail, for measuring cache hits |
| `OPENCODE_API_KEY` | — | Key for `opencode-go` entries and reply summaries |
| `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `COMMANDCODE_API_KEY` | — | Keys for `openai`, `openrouter` and `commandcode` entries |
| `FLYD_ROUTING_FALLBACK_MODEL` | — | Pins the room reader and view router to one exact model |
| `FLYD_PREDICTION_MODEL` | the quick job's first model | Pins typing prediction to one exact model |
| `FLYD_PREDICTIONS` | on | `0` turns typing prediction off |
| `FLYD_VIEW_ANTHROPIC_MODEL` | — | Explicit Anthropic model for reply summaries |
| `FLYD_VIEW_XAI_MODEL` | `grok-4-fast-non-reasoning` | Summaries' xAI model |
| `FLYD_VIEW_SUMMARIES` | on | `0` turns model summaries off |
| `FLYD_DICTATE_MODEL` | — | Dictation cleanup model (unchanged by Claude) |

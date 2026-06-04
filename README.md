# flyd

Personal memory CLI. Capture anything. Ask anything. No governance gate — everything is immediately searchable.

## How it works

```
/flyd <text>          capture → raw/ → immediately indexed and searchable
/flyd ask <question>  QMD searches raw/ → LLM synthesis → answer + evidence
```

No session injection. No preloaded context. You ask explicitly, it answers from raw captures.

## Commands

```bash
flyd "<text>"                    # capture to raw/ and index immediately
flyd ask "<question>"            # search raw captures, return answer with evidence
flyd search "<query>"              # raw retrieval without synthesis
flyd check                       # memory health: staleness, gaps, coverage
flyd consolidate                 # deep check: dedup + staleness + reindex
flyd compile-context             # rebuild context bundles from wiki
flyd setup                       # check API key configuration
```

## Memory pipeline

1. **Capture** — raw text saved to `~/.flyd/raw/`, auto-tagged with project context, indexed via QMD (`flyd-raw` collection)
2. **Ask / Search** — hybrid semantic search (BM25 + embeddings) over raw captures
3. **Check / Consolidate** — health scans for staleness, topic gaps, duplicate detection
4. **Compile-context** — builds structured bundles from wiki for injection

## Retrieval

`flyd ask` uses [QMD](https://github.com/tobi/qmd) SDK for hybrid retrieval:
- Phase 1: BM25 keyword search (no models)
- Phase 2: semantic + reranking via local GGUF models (`qmd embed` to download, ~2GB)

Falls back to BM25 automatically if models aren't ready.

Response always includes:
- Answer (if API key configured)
- Evidence paths + scores from raw captures
- Staleness warnings when captures are old

## Setup

```bash
npm install -g @radarboy/flyd

# Add API key (OpenAI or Anthropic)
echo '{"openai_api_key": "sk-..."}' > ~/.flyd/config.json
```

## Storage

```
~/.flyd/
├── raw/        immutable archive of captures
├── wiki/       governed memory (legacy — no longer maintained by pipeline)
├── context/    compiled bundles (current_identity, active_projects, etc.)
└── logs/       injection and query logs
```

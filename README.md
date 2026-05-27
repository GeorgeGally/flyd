# flyd

Personal governed memory CLI. Capture anything. Ask anything. Memory is governed before it's searchable.

## How it works

```
/flyd <text>          capture → Host proposes → Mom+George govern → wiki → indexed
/flyd ask <question>  QMD searches wiki → read gate → answer + evidence + status
```

No session injection. No preloaded context. You ask explicitly, it answers from governed memory.

## Commands

```bash
flyd "<text>"                    # capture and govern
flyd ask "<question>"            # search wiki, return answer with evidence
flyd disputes                    # list unresolved Mom/George disagreements
flyd disputes resolve <n> accept|reject  # principal resolves a dispute
flyd promote [--force]           # re-run governance pipeline manually
flyd compile-context             # rebuild context bundles
flyd setup                       # check API key configuration
```

## Memory pipeline

1. **Capture** — raw text saved to `~/.flyd/raw/`
2. **Host distills** — LLM extracts typed memory candidates (education, career, skill, award, testimonial, project, constraint, person)
3. **Mom + George govern** — peer review; both must accept to promote
4. **Wiki** — governed entries land in `~/.flyd/wiki/` with epistemic status (canon / working / speculative)
5. **QMD indexes** — hybrid semantic search over the governed wiki

## Retrieval

`flyd ask` uses [QMD](https://github.com/tobi/qmd) for hybrid retrieval:
- Phase 1: BM25 keyword search (no models)
- Phase 2: semantic + reranking via local GGUF models (`qmd embed` to download, ~2GB)

Falls back to BM25 automatically if models aren't ready.

Response always includes:
- Answer (if API key configured)
- Evidence paths + scores
- Epistemic status: `governed` / `uncertain` / `raw-only`

## Setup

```bash
npm install -g @radarboy/flyd

# Add API key (OpenAI or Anthropic)
echo '{"openai_api_key": "sk-..."}' > ~/.flyd/config.json

# Set up QMD collections (first time)
qmd collection add ~/.flyd/wiki --name flyd-wiki
qmd collection add ~/.flyd/context --name flyd-context
qmd embed  # downloads ~2GB models for semantic search
```

## Dispute resolution

When Mom and George disagree, a dispute artifact is created in `~/.flyd/disputes/`. You resolve it:

```bash
flyd disputes          # see what needs your decision
flyd disputes resolve 1 accept
flyd disputes resolve 2 reject
```

## Storage

```
~/.flyd/
├── raw/        immutable archive of captures
├── proposed/   Host candidates awaiting governance
├── wiki/       governed memory (source of truth)
├── context/    compiled bundles (current_identity, active_projects, etc.)
├── disputes/   unresolved Mom/George disagreements
└── logs/       injection and query logs
```

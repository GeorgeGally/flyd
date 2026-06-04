---
name: flyd-ask
description: Use `/flyd-ask` to search your personal memory and get synthesized answers. Uses qmd SDK (BM25 + vector + LLM rerank) + LLM synthesis. All raw captures are searchable — no governance gate.
---

# Flyd Ask

Search your raw memory and synthesize answers from all captures.

**Command:** `/flyd-ask <question>`

**Example:** `/flyd-ask what event did I found?`

Everything in `.flyd/raw/` is searchable. The system uses qmd's hybrid search (BM25 + semantic + LLM rerank) to find relevant captures, then synthesizes an answer with source citations. If evidence is missing, it says so instead of guessing.

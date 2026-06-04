---
description: Ask flyd memory — synthesis from raw captures
argument-hint: "<question>"
---
Run `npx tsx src/index.ts ask $ARGUMENTS` to search raw memory and synthesize an answer. Uses vector search (BM25 fallback) across all captures — nothing is filtered or gated.

Return the answer to the user with evidence sources.

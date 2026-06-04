---
description: Show recent flyd captures — what's been stored lately
argument-hint: ""
---
Run `ls -lt ~/.flyd/raw/*.md 2>/dev/null | head -10` or `ls -lt .flyd/raw/*.md 2>/dev/null | head -10` to show the 10 most recently captured files. Also try project-local `.flyd/raw/` first, then fall back to `~/.flyd/raw/`.

Run `npx tsx src/index.ts graph stats` to show knowledge graph statistics.

Report filenames (timestamps) to the user as a list of recent captures.

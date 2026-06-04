---
description: Show flyd memory health — captures, staleness, topic gaps
argument-hint: ""
---
Run `npx tsx src/index.ts check` to show memory health statistics:
- Number of raw captures and total size
- Staleness counts (30-day and 90-day thresholds)
- Topic gaps: stale topics and thin coverage

Report the results to the user. If there are stale topics or thin coverage, proactively suggest what they might want to capture.

---
name: last30days
description: Use when the user asks what people are saying now, wants current social/research signal from the last 30 days, or needs competitor/community evidence from Reddit, X, YouTube, TikTok, Hacker News, Polymarket, GitHub, and the web.
---

# Last 30 Days

Use the upstream `mvanhorn/last30days-skill` for current public discussion and engagement-weighted research.

If the skill is not installed in the host, install it from:

```bash
npx skills add mvanhorn/last30days-skill -g
```

For Flyd ingestion, ask for or run the versioned agent JSON export:

```bash
python3 skills/last30days/scripts/last30days.py "<topic>" --emit=json
```

Save JSON reports under `LAST30DAYS_MEMORY_DIR` (default `~/Documents/Last30Days`). Rails scans that directory in the background, persists each report as `last30days` provider evidence, and lets Flyd decide whether the report belongs on the front page.

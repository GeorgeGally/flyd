# Rounds in Flyd

Upstream: https://github.com/krispuckett/rounds at `9b863e289f30c676b35379be5de2859f5858a273` (MIT). Original LICENSE retained.

Source-level static Rounds frontend fork; no Claude transcript indexer, hooks, MCP server, process, Rounds port or API plugin. Changes: Flyd `/api/work/*` authenticated client, a Flyd back link, a read-only empty state, disabled drop and comment operations, and no active HTML preview. No font binaries from upstream are distributed. `/api/work/edits` is explicitly empty until source-grounded changes can be shown.

`cd cli && npm run build` builds these static assets under `cli/dist/work-canvas`. Frontend dependencies have a separate upstream-pinned package lock; the Flyd build script installs them once on first build if unavailable. Keep upstream changes isolated and review any source rebase before relaxing the HTML or feedback safety gates.

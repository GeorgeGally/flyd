# QMD / MCP / Hono dependency advisory

## Status

Patched. `npm audit --omit=dev` reports no production advisories at any severity.

CI enforces the high-severity gate with:

```bash
npm audit --omit=dev --audit-level=high
```

The moderate entries that remained after the high-severity fix all sat under `@tobilu/qmd` -> `@modelcontextprotocol/sdk` (overridden to 1.31.0):

```text
@tobilu/qmd
  -> @modelcontextprotocol/sdk
    -> hono (also via @hono/node-server)
    -> express-rate-limit -> ip-address
    -> express (and body-parser) -> qs
```

They are cleared by pinned `overrides` in `cli/package.json`, each the smallest patched release inside the range its parents already declare:

| Package | Was | Now | Advisories cleared |
|---|---|---|---|
| `hono` | 4.12.30 | 4.13.7 | CORS and language middleware DoS, `memo()` SSR disclosure, proxy helper header handling, `toSSG()` path escape, `parseBody()` nesting DoS, query parsing after the URL fragment, `hono/jsx` XSS |
| `ip-address` | 10.3.1 | 10.7.1 | IPv6 link-local / NAT64 classifier and cross-family subnet checks (SSRF/trust-boundary bypass), unbounded parse diagnostic; also clears the `express-rate-limit` entry |
| `qs` | 6.15.2 | 6.16.0 | array-limit bypass, `isBuffer` DoS |

## Reachability

Flyd uses QMD only as an in-process local indexing library:

```ts
import { createStore } from "@tobilu/qmd";
```

`cli/src/lib/qmd.ts` creates a local SQLite-backed store and calls collection, indexing and search methods. Active Flyd code does not:

- import `@modelcontextprotocol/sdk`,
- import `@hono/node-server`,
- start QMD's MCP server,
- start a Hono or Express HTTP server,
- serve static files through Hono.

So none of the advisories above were reachable from Flyd before the patch. The Mac overlay, TypeScript Core and local evidence dossier server use their own runtime paths; the dossier server is a small loopback-only Node HTTP server and does not use Hono.

## Guardrail

CI scans active TypeScript source and fails if Flyd begins importing or invoking the MCP/Hono server path. Keep that check: future advisories in this chain are only low-risk while the path stays unreached.

## Exit condition

Remove each `hono`, `ip-address` and `qs` override once `@tobilu/qmd` / `@modelcontextprotocol/sdk` resolve to that patched version (or newer) without it. Revisit immediately if a new advisory in this chain cannot be patched within the declared ranges, or if Flyd starts an MCP or Hono server from this dependency chain.

# QMD / MCP / Hono dependency advisory

## Status

Accepted temporarily at **moderate** severity for the active Flyd product.

The committed dependency graph has no high-severity production advisories. CI enforces this with:

```bash
npm audit --omit=dev --audit-level=high
```

Four moderate audit entries remain, all under `@tobilu/qmd` -> `@modelcontextprotocol/sdk` (overridden to 1.31.0):

```text
@tobilu/qmd
  -> @modelcontextprotocol/sdk
    -> hono 4.12.30 (also via @hono/node-server)
    -> express-rate-limit -> ip-address
    -> express (and body-parser) -> qs
```

- **hono** 4.12.30: CORS and language middleware DoS, `memo()` SSR disclosure, proxy helper header handling, `toSSG()` path escape, `parseBody()` nesting DoS, query parsing after the URL fragment, `hono/jsx` XSS.
- **ip-address** (reported for both `ip-address` and `express-rate-limit`): IPv6 classifier and subnet checks that allow SSRF/trust-boundary bypass, plus an unbounded parse diagnostic.
- **qs**: array-limit bypass and `isBuffer` DoS.

All four sit below the CI `--audit-level=high` gate. Their reachability review is pending a follow-up; the sections below were written for the earlier `@hono/node-server` static-file advisory and have not yet been re-reviewed against this set.

## Why the vulnerable path is not active

Flyd uses QMD only as an in-process local indexing library:

```ts
import { createStore } from "@tobilu/qmd";
```

`cli/src/lib/qmd.ts` creates a local SQLite-backed store and calls collection, indexing and search methods. Active Flyd code does not:

- import `@modelcontextprotocol/sdk`,
- import `@hono/node-server`,
- start QMD's MCP server,
- start a Hono HTTP server,
- serve static files through Hono.

The Mac overlay, TypeScript Core and local evidence dossier server use their own runtime paths. The dossier server is a small loopback-only Node HTTP server and does not use Hono.

## npm audit fix

Whether `npm audit fix` can clear the current set without a breaking change is part of the pending review.

## Guardrail

CI scans active TypeScript source and fails if Flyd begins importing or invoking the currently excluded MCP/Hono server path. At that point this acceptance is invalid and the dependency must be upgraded, isolated or removed before merge.

## Exit condition

Remove this acceptance when any of the following becomes true:

1. QMD or its MCP dependency updates to non-vulnerable compatible versions of the packages above.
2. Flyd starts an MCP or Hono server from this dependency chain.
3. The advisory severity or exploitability changes.

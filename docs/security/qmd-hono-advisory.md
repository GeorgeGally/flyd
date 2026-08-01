# QMD / MCP / Hono dependency advisory

## Status

Accepted temporarily at **moderate** severity for the active Flyd product.

The committed dependency graph has no high-severity production advisories. CI enforces this with:

```bash
npm audit --omit=dev --audit-level=high
```

Three moderate audit entries remain on one transitive chain:

```text
@tobilu/qmd
  -> @modelcontextprotocol/sdk
    -> @hono/node-server
```

The advisory affects Hono's static-file server on Windows when a request path contains an encoded backslash.

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
- serve static files through Hono,
- run the active product on Windows.

The Mac overlay, TypeScript Core and local evidence dossier server use their own runtime paths. The dossier server is a small loopback-only Node HTTP server and does not use Hono.

## Why Flyd does not force the advertised npm fix

`npm audit fix --force` currently resolves the advisory by downgrading `@tobilu/qmd` from the active 2.5.x line to 2.0.1. npm marks that as a breaking change.

Flyd will not trade a reviewed, unreachable moderate server advisory for an unreviewed breaking downgrade of its local memory index.

A direct major-version override of `@hono/node-server` is also avoided because the transitive MCP SDK controls that compatibility boundary.

## Guardrail

CI scans active TypeScript source and fails if Flyd begins importing or invoking the currently excluded MCP/Hono server path. At that point this acceptance is invalid and the dependency must be upgraded, isolated or removed before merge.

## Exit condition

Remove this acceptance when any of the following becomes true:

1. QMD or its MCP dependency updates to a non-vulnerable compatible Hono version.
2. Flyd starts an MCP or Hono server from this dependency chain.
3. Flyd adds Windows as an active product runtime.
4. The advisory severity or exploitability changes.

# Flyd Evidence Engine — E1 implementation

## Status

Implemented on `agent/evidence-engine-foundation` as the first live external-reach layer.

This path has **no Rails dependency**. The active architecture is:

```text
external source
    ↓
Flyd capability adapter
    ↓
CapabilityRegistry health/backend selection
    ↓
EvidenceItem / EvidenceBundle
    ↓
Flyd Core reasoning (E2)
```

Rails code remaining in the repository is legacy and is not an Evidence Engine backend, health authority, retrieval path, or manifestation requirement.

## Shipped capabilities

| Capability | Backend | Operations | Setup |
|---|---|---|---|
| Web | Jina Reader | `read` | works anonymously at basic limits; optional `JINA_API_KEY` |
| Web | Jina Search | `search` | `JINA_API_KEY` required |
| GitHub | GitHub REST | `read`, `search` | public unauthenticated access; `GITHUB_TOKEN`/`GH_TOKEN` raises limits |
| RSS/Atom | Flyd native parser | `read` | zero configuration |
| YouTube | `yt-dlp` | `read`, `search` | local `yt-dlp` binary required |

YouTube `read` attempts English human/automatic VTT subtitles first and falls back to video metadata/description when no transcript is available.

## Diagnostics

`flyd doctor` probes capability **operations**, not merely package presence.

Example states:

```text
READY    web.read           via web:jina-reader
AUTH     web.search
DEGRADED github.search      via github:rest
READY    rss.read           via rss:native
DOWN     youtube.search
```

The distinction matters: a provider existing on disk does not mean it is usable, and a missing credential is different from a broken backend.

`flyd doctor --json` returns the same information as structured data.

## Boundaries

E1 deliberately does not:

- call external evidence from `/manifest` yet,
- change PRESENT (still zero-network),
- expose provider output directly to UI,
- perform background monitoring,
- operate logged-in web pages,
- persist raw retrieved content into long-term memory,
- make Rails part of external research.

Those boundaries keep E1 independently testable. E2 is the step that decides when an INVOKED/LIVE question actually needs this evidence and injects a curated bundle into Flyd's synthesis.

# Scout editorial news — operations and acceptance

Related implementation: PR #340.
Product authority: docs/product/flyd-personal-intelligence-prd.md
Plan: docs/plans/2026-11-17-scout-discovery-first-editorial-v1.md

## Running system

The existing Scout tick retains RSS, a bounded rotating set of Reddit feeds, versioned last30days searches and explicit preference learning. A normal edition contains up to eight substantive stories. The independent scout-discovery tick runs after morning preparation, at most once per 20 hours after 14:00 local time, preparing the following day's cache.

Discovery rotates four creative/technical interest beats and a global exploratory beat. It investigates at most three nominations with Flyd's existing Evidence Engine. The preferred provider is upstream last30days; absent Python 3.12+ or a working upstream configuration, the separately labelled native public Hacker News RSS discovery path still nominates candidates. Its restricted coverage and unknown momentum are not concealed.

The model's nomination, number of posts, or a unique hosting domain is never independently enough to verify a news claim. Two independently matching external reports are required to admit a discovery. Syndicated duplicates and weak/noisy hits cannot clear that bar. Discovery failures remain distinct from a clean nothing-solid response. The edition uses last-completed cache rather than blocking on live discovery. Updates to older events may reappear only after material corroborated facts are found.

Must-know notifications use an independent evidence check before the existing one-per-day limit; unsupported breaking claims should be missed rather than falsely pushed. None of this adds a second agent runtime.

## Configuration

- FLYD_SCOUT=0 disables Scout and discovery.
- FLYD_SCOUT_EDITORIAL=on (default) enables event grouping, verified discovery, and explicit-feedback editorial selection.
- FLYD_SCOUT_EDITORIAL=legacy restores the earlier broad briefing. =shadow delivers the original edition while keeping a separate, non-delivered editorial comparison.
- FLYD_SCOUT_DISCOVERY=on (default) admits verified cached nominations; =shadow researches without inclusion; =off disables discovery.
- FLYD_LAST30DAYS_SCRIPT can point to the installed upstream last30days.py; FLYD_LAST30DAYS_PYTHON selects a compatible >=3.12 interpreter.
- FLYD_LAST30DAYS_VERIFY_FRESHNESS=1 requests optional upstream claim freshness verification and may increase its cost/latency.

## Commands

    cd ~/Documents/flyd/cli
    npm ci && npm run lint && npm test && npm run build
    flyd scout status
    flyd scout discover
    flyd scout run
    flyd scout show
    flyd scout more 2 interesting
    flyd scout less 3 wrong-topic

To compare blindly without replacing the news:

    FLYD_SCOUT_EDITORIAL=shadow flyd scout run
    flyd scout compare 2026-11-23
    flyd scout judge A 2026-11-23

Comparisons persist in scout/editorial-shadows/YYYY-MM-DD.json, with the latest file retained for compatibility. The seven-day editorial preference threshold is a measurement on real editions, not evidence supplied by a passing unit test. Check source coverage, false positives, story duplication, confidence, latency, cost and notifications separately.

## Failure, security and privacy

- Missing or unhealthy social sources are reported as coverage gaps, not zero discussion.
- Native fallback reads public RSS only, without logged-in social account sessions.
- The Evidence Engine's credential-free public web.read fallback checks DNS, redirects and private-network addresses, executes no JS, times out after eight seconds, and limits bodies to 450KB.
- Article text remains untrusted evidence, never tool instructions or permission to send, publish or write memory.
- Scout stores private operational state and explicit feedback locally. Do not upload email, WhatsApp or private project notes into research providers.
- Existing News UI, article chat and mobile views are retained, now showing corroborating links, optional evidence details and update markers.

## Acceptance versus installed runtime

GitHub CI can verify code, tests, build, privacy guards and interface compatibility. It cannot verify which Python engine and source credentials are installed on the actual Mac, nor can it produce seven real days of blind user judgments or guaranteed provider costs. These remain explicit host-level acceptance checks, not silently claimed as complete.

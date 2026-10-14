# Flyd everywhere: mobile + Hetzner + Mac companion

Date: 2026-10-14
Status: implementation plan only; no deployment or migration authorised by this document.
Owner: George Galanakis
Code baseline inspected: `ced9af48d8f8dde88dbfef82de61867937c13ca2` on main.

## 1. Outcome and decision

George can speak or type to the same Flyd from his iPhone while his Mac is asleep. Flyd retains its intelligence, memory, artefacts, pending work and existing action authority. His existing, lightly used Hetzner Rails host is the first deployment candidate, not evidence that capacity is sufficient.

Choose one server-authoritative TypeScript Core, a responsive Home Screen web interface, and a Mac companion for device-bound capabilities. Do not revive Flyd's retired Rails application. Do not create a second mobile assistant or migrate existing hosted Rails sites.

| Approach | Impact | Effort | Risk | Reversibility |
|---|---|---|---|---|
| Tunnel to Mac | Fast mobile demonstration; unavailable when Mac sleeps | Low | Laptop availability | Easy |
| Hetzner Core + web interface + Mac companion | Meets always-available goal; reuses existing host | Medium | State cutover, remote security, shared-host contention | Good with single-writer rollback |
| Dedicated always-on home computer | Keeps personal state at home without laptop dependency | Medium plus hardware | Power/network maintenance; remote access still needed | Good |

Commit to the second approach, subject to host preflight. Native iOS packaging, local model hosting, database synchronisation, Kubernetes, and a new frontend framework are not prerequisites.

## 2. What is known versus proposed

Inspected source establishes:

- `AGENTS.md`: TypeScript Core is active; Swift is the thin OS adapter; Rails is retired; main is the working branch. Personal intelligence PRD remains product authority.
- `cli/package.json`: Node >=22, TypeScript build, native `better-sqlite3`, existing test/lint/build scripts. Pin a supported Node release and prove native dependency compatibility on the host architecture during implementation.
- `cli/src/server.ts`: HTTP defaults to loopback 4815; token is read from `~/.flyd/overlay/auth-token`; missing token currently rejects protected requests. Voice transports use 4816/4817. Historical security notes include obsolete auth examples: current source wins.
- `cli/src/conversation-view/server.ts`: loopback 4818, Host restriction, page-generated send token and `/api/token`, SSE updates, uploads, People/WhatsApp and artefact rendering. These are local-browser protections, not Internet user authentication.
- `cli/src/lib/config.ts`: `FLYD_DIR` exists, but other inspected paths still directly use `homedir()`. Changing one environment variable does not prove all state moves.
- `cli/src/conversation-view/flyd-desk.ts`: routing depends on FirstMate for engineering and currently attachments; asks use a local home path. Missing FirstMate must not silently break mobile requests or route them to a different assistant.
- Email/Drive and WhatsApp connectors already exist. WhatsApp ownership includes local process/loopback assumptions that need refactoring before split deployment.

Unknown: server specifications, OS/architecture, free resources, actual ingress/proxy, deployment mechanism, DNS, installed runtime, private state size, connector accounts, credential availability and Linux portability of every import/startup path. No server has been inspected. No time/cost claim is asserted.

All new module names, APIs, flags and targets below are proposals, not shipped capabilities.

## 3. Ownership and capability boundary

| Component | Owns | Does not own |
|---|---|---|
| Hetzner Core | Canonical personal events, derived memory, conversations, task/receipt state, agenda, account connectors, policy | Ambient desktop capture, Mac credentials, arbitrary other-site files |
| Web interface | Explicit input, voice capture, result/artefact rendering, scoped user controls | Model keys, canonical memory, independent permission decisions |
| Mac companion | Local observations under consent, local execution, dictation transport, FirstMate bridge and local artefact transfer | Competing canonical memory, duplicate agenda/connector owners |

Preserve PRESENT as zero-network/zero-persistence. This plan explicitly changes the personal-intelligence PRD's local-first deployment boundary: server storage and invocation-context egress require George's deployment consent and a documented source/retention contract before activation. Do not quietly upload desktop environments or the entire home folder. Update the PRD's deployment scope during implementation while retaining its authority, provenance and privacy invariants.

When Mac is offline, conversation, research, server-connected accounts and server jobs remain available. Mac app actions, local-only repository work and FirstMate jobs visibly wait for the selected device. Never claim stale desktop state is live. Initially preserve local dictation cleanup on Mac as a bounded fallback; it may use a cached, versioned rules projection but cannot create a second learner. Offline learning candidates synchronise as identified events after reconnect.

## 4. Phase A — read-only preflight

Deliver a private host report before any installation:

1. Confirm configured SSH identity and exact host; never paste secrets into chat or git. Inspect OS, CPU architecture, RAM, swap, disk, existing services/containers, network listeners and reverse proxy.
2. Measure current usage and observe representative peaks, including Rails workers, backups and deploy builds. Quiet domains do not establish idle resource use.
3. Inventory Flyd state and hard-coded paths, SQLite stores, timers, provider clients, native executables, macOS imports, credential reads and FirstMate dependencies. Classify each server-safe/device-only/optional.
4. Record existing-site HTTP checks and host health as a before/after baseline. Inspect current proxy/deploy configuration, not sample Rails deployment files as proof of production setup.
5. Choose a controlled CPU/memory/disk allowance based on measurements; account for builds and indexing. Use hosted models initially; disable heavyweight optional local indexing until tested. No GPU assumption.
6. Reuse existing ingress and orchestration where practical. Prefer an isolated unprivileged systemd service if the host is service-managed; use a dedicated container if already container-managed. Do not install a competing proxy on 80/443.

Exit: host fits safely or an explicit upgrade/separate-host decision is required. SSH access, final hostname and credential migration are deployment dependencies, not blockers to preparing code.

## 5. Phase B — server-safe Core

Implementation touchpoints: `cli/src/server.ts`, `cli/src/lib/config.ts`, account connectors, runtime startup/schedulers, conversation-view bootstrap and proposed device/capability registry.

- Introduce explicit local/server/companion roles. Preserve local mode as default until cutover. Document every role's enabled services and owners.
- Centralise state paths; eliminate server-incompatible `homedir()` assumptions incrementally. Service account owns a private state directory outside release code. Code releases are immutable; state survives release replacement.
- Create a headless Linux startup path that does not launch Swift, AppleScript, desktop notification tools, FirstMate or absent local model binaries. Optional capabilities report unavailable instead of crashing or inventing success.
- Add startup checks for state access, schema version, required keys and configured auth. Missing credentials never disable authentication. Keep detailed health private; public health exposes minimal liveness only.
- Reuse current runtime/context compiler/command hierarchy. One scheduler owner and one connector owner. Keep deterministic action policy unchanged; remote infrastructure is not a reason to add extra approval bureaucracy.
- Build a capability matrix consumed by routing. FirstMate and desktop operations route to a device, not server-local shell by accident. Distinguish server workspace paths from Mac repository identities.

Exit: Linux fixture boots and completes a personal turn without any Mac or private account; unavailable tools have truthful outcomes.

## 6. Phase C — authenticated remote gateway

Keep existing local Core/view ports private. Add a narrow gateway for authenticated mobile requests and companion transport; do not reverse-proxy all current routes unfiltered.

- Dedicated approved hostname with HTTPS. Server-side revocable sessions in Secure, HttpOnly, same-site cookies. Begin with a single-user bootstrap enrollment delivered through the configured private admin channel; token is one-use, expires and never appears in logs or tracked code. Prefer passkey enrollment once the minimal flow works.
- Authenticate all personal HTML, data, SSE, downloads, thumbnails, uploads and WebSocket upgrades. A page send token is CSRF protection, not login. Remove remote token-in-query patterns. Core/adapter bearer and browser session are separate credentials.
- Exact origin checks on mutations and WS, CSRF tokens, narrowly trusted proxy headers, no wildcard CORS. Keep local Host checks intact; implement remote mode explicitly rather than globally removing rebinding protection.
- Explicit endpoint allowlist excludes shutdown, raw shell, unrestricted file access, credential inspection and administrative endpoints. Role/capability grants govern execution through existing policy.
- Bound request sizes, streams, audio duration, per-user concurrency and model spend. Disable proxy buffering for streams and configure suitable connection timeouts.
- Generated artefacts are untrusted active content. Render escaped data or sandbox on a separate credential-free origin; never give generated HTML the authenticated app's origin authority. Resolve artefact ids to authorised content, never arbitrary URL/path fetches. Reject SSRF, traversal and sibling Rails-site access.
- Session expiry/revocation closes streams; re-login reconnects by durable cursor. Redact keys, cookie values, URL tokens and sensitive bodies from errors/logs.

Exit: unauthenticated direct HTTP/WS/SSE requests cannot read or mutate personal data, and existing loopback security tests still pass.

## 7. Phase D — durable mobile presence

Extend `cli/src/conversation-view/` and its existing artefact/People renderers. Do not replace the product with a project dashboard or transcript archive. Lead with the few things Flyd judges useful and an unobtrusive talk/type control; conversation is available, not mandatory primary navigation.

1. Responsive phone layout: keyboard-safe composer, safe-area spacing, readable type, thumb-sized actions, polished transitions, reduced-motion mode and accessible status. No desktop-column shrink-to-fit.
2. Home Screen manifest/icons and an install hint shown only when useful. Cache static shell assets only. Private API, messages, artefacts and credentials stay out of service-worker caches. Offline status is honest; queued sends are explicit and identifiable.
3. Separate durable user intent acceptance from the browser connection. A proposal contract is `requestId → accepted receipt → running/waiting/succeeded/failed/unknown`; reuse existing task/receipt stores where possible. Persist acceptance before dispatch; repeated request ids return the same receipt.
4. Streaming attaches to durable work, not vice versa. Reconnect resumes by cursor or refreshes a canonical snapshot. Closing a tab does not cancel accepted work. Cancelling records intent and distinguishes already-completed effects.
5. Tap-to-talk through HTTPS microphone capture; relay to the existing transcription capability behind authenticated transport. Runtime-detect supported codecs, test iPhone Safari/Home Screen separately, allow transcript correction and use the current governed learning loop. No raw audio persistence. Stop mic tracks on cancel, background, lock, navigation or errors. Do not promise background listening.
6. Attachments need an explicit server-safe intake path, because current routing sends them to FirstMate. Initial supported types/limits are documented; unsupported analysis says so and cannot silently upload to a disconnected Mac. Use private ids with expiry, not filesystem paths.
7. Start with text/artefacts and invoked voice. LIVE conversational audio and push are later increments. Push is opt-in, minimal-content, quiet-hour aware and never required for task correctness.

Exit: with Mac off, phone can speak/type, correct input, receive an artefact, close/reopen and recover the actual result without repeating the action.

## 8. Phase E — Mac companion and offline handling

Touchpoints: Swift bridge/auth/Core supervision code, conversation adapter bootstrap, FirstMate inbox/source integration, proposed TypeScript device transport.

- Mac establishes an outbound TLS connection to Hetzner; no inbound Mac ports or router forwarding. Pair once; device-specific credential is revocable and stored in Keychain. Heartbeats communicate freshness and version/capabilities.
- Use typed operations, stable operation ids, grants, deadlines, target identity, cancellation and receipts. Never arbitrary network-delivered shell instructions. Local executor still verifies observed refs/fingerprints and exact targets.
- Reuse canonical task states for queued device work. On wake/reconnect, refresh target context and revalidate grant/expiry before executing. Expired or context-sensitive UI operations do not replay against whatever happens to be focused.
- Write local execution receipt before acknowledgement; reconnect queries status before dispatch. For external sends with uncertain outcomes, never automatically retry. Do not claim general exactly-once external effects.
- Bridge FirstMate's inbox/replies through the Mac companion; preserve full layered results and provenance. Upload only authorised result artefacts, not entire transcripts/home folders. Mac-local preview URLs become authenticated artefact ids; loopback addresses cannot be used by the phone.
- Remote mode prevents Swift supervisor from launching a competing canonical Core on connection loss. Preserve local-only fallback for explicitly device-bound operations, not two writable brains.

Exit: Mac sleep/wake, network loss and companion restarts neither duplicate operations nor fork state. Offline device work is visible and recoverable.

## 9. Phase F — state and connector cutover

1. Make an inventory manifest: canonical events/DBs, derived projections, profile/SOUL/taste/preferences, conversations, task/agenda state, consent records, private artefacts and connectors. Include retention rules and tombstones; omit caches/raw sensing unless explicitly authorised.
2. Back up using SQLite-consistent snapshots, not copying a live database file alone. Freeze relevant writers during cross-store export to preserve a coherent checkpoint. Verify checksums, schema versions, counts and integrity on isolated restore.
3. Secrets migrate separately through encrypted admin transfer or account re-enrollment. Do not copy Mac Keychain wholesale. The credential-security implementation plan is a dependency to reconcile before moving real accounts; do not assume it has shipped.
4. Dry-run on synthetic state first, then approved private snapshot with outbound side effects and schedulers disabled. Test memory recall, timezone, consent expiry, drafts and pending receipts.
5. Stop Mac canonical writers, timers and account sockets; export final checkpoint. Activate server writer epoch and reject stale producers. Mac keeps a read-only recovery snapshot and only a companion outbox after cutover.
6. Move Gmail/Drive/DreamHost one account at a time after refresh/health tests. Preserve supported action limits; this plan does not add sending/deletion/sharing scopes.
7. Move WhatsApp as a separate checkpoint: exactly one linked-device socket owner; stop old owner before starting new; transfer approved credential state securely or re-pair if required. Preserve immutable reviewed drafts, atomic claim and no retry on uncertain sends. Do not add a second pairing silently or promise full historical sync.
8. Enable one scheduler owner only after state verification. Audit due jobs so stale actions are not replayed wholesale.

Rollback: stop server effects/writers first. Export server-side changes and reconcile by event/id/receipt before restoring Mac authority. Never simply restore an old Mac backup after new mobile activity; that loses data and can repeat effects. Maintain schema-compatible previous release and consistent backup; test rollback before cutover.

## 10. Phase G — operations on the shared host

Separate service user/container, private volumes, scoped secrets, no root runtime, no Docker socket, no read access to sibling Rails application credentials. Add service restart/backoff, graceful shutdown, resource limits, disk/log rotation and private health checks. Build off-host when it avoids destabilising Rails; native binaries must match deployment architecture.

Use versioned build artefacts and retain the last known-good release. Prove test/lint/build results, explicitly recording unrelated baseline failures rather than masking them. A new release starts with effects disabled until health/schema checks pass; do not overlap connector/scheduler owners during rolling deployment.

Encrypted off-host backups include consistent SQLite snapshots and approved artefacts; credentials have separate recovery/rotation policy. Proposed initial recovery targets: at most 24 hours of data loss from daily backup and restoration within 2 hours, to be validated by drill before promising them. Shorter checkpoint intervals may be chosen after measuring cost/size. Monitor memory, disk, restarts, queue age, companion age, provider spend, connector health and backup freshness without storing conversation bodies.

## 11. Verification and completion gates

| Test | Required evidence |
|---|---|
| Mac physically off | Mobile text, voice, memory recall and server connector fixture succeed |
| Lost mobile connection mid-turn | Reconnect shows same accepted id/result; no duplicate effect |
| Duplicate submit/retry | One accepted operation and consistent receipts |
| Mac offline then wakes | Target/grant revalidated; expired work does not execute |
| Server/companion crash around effect | Status reconciled; uncertain external effect never retried |
| Missing keys/auth and forged origins | Startup/request rejected safely; no fail-open path |
| Direct port/WS/SSE access | Unauthenticated requests denied; private ports not public |
| Malicious artefact/upload/provider data | No script authority, SSRF, traversal or credential leakage |
| Service-worker/offline/logout | No cached private data exposure or silent re-send |
| Consent/privacy | PRESENT remains unchanged; mic stops; no raw audio retained |
| Connector move | Single owner, preserved grants/drafts, truthful degraded history |
| Cutover + rollback | One writer epoch; new mobile events retained; no repeated effects |
| Shared server under load | Existing Rails baseline remains within agreed limits |
| Linux and Mac compatibility | Core boots headless; current local-mode tests remain valid |

Hermetic tests use synthetic accounts/operations; no real WhatsApp send, crew launch or deployment from tests. Real iPhone/Swift/device checks are manual release gates. No change is called deployed because code was committed.

## 12. Ordered work packages

- A: private host audit + capability/path inventory, no production writes.
- B: role-aware Linux bootstrap and single-owner state boundary.
- C: authentication/gateway, endpoint allowlist and adversarial tests.
- D1: server-native text turn, durable receipts, mobile layout and Home Screen shell.
- D2: invoked voice and safe attachment intake.
- E: paired Mac companion, FirstMate/device routing, artefact transfer.
- F: rehearsed backup/import/rollback, canonical cutover and account-by-account moves.
- G: capacity/load, observability and real iPhone/Mac-off acceptance.
- Later: opt-in push and LIVE audio; no native-app work until a measured web limitation justifies it.

First usable milestone is D1 with Mac off and synthetic/server-safe memory. First daily-use release requires real memory migration, secure authentication, recovery rehearsal and clear offline-device behaviour. Dates and spend are estimated only after A/B establish actual requirements. Keep each package independently testable and reversible; use main per repository workflow.

## 13. Main risks and deliberate limits

The strongest objection is that moving a local-first assistant remotely enlarges its trust boundary and puts personal state beside other sites. Address it with explicit deployment consent, isolation, narrow ingress and tested recovery, not an assumed safe subdomain. A single shared host is not high availability. If measured load or isolation cannot be met, use a separate host rather than compromising existing sites.

Other likely failures are FirstMate/path dependencies hidden behind a working local UI, duplicated schedulers or WhatsApp sockets, stale Mac operations after reconnect, mobile streams mistaken for durable tasks and indiscriminate memory migration. The gates above directly test each. Avoid a general sync engine or distributed autonomous agents for this first release.

## 14. Source references

Repository evidence is pinned to the baseline above; re-inspect before implementation. Primary external documentation checked 2026-10-14:

- [Apple: turn a website into an iPhone web app](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/27/ios/27).
- [WebKit: Home Screen web apps and push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) — installed web apps can support opt-in notifications; not a background-audio guarantee.
- [MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) — secure context and permission are required.
- [SQLite Online Backup API](https://www.sqlite.org/backup.html) and [WAL](https://www.sqlite.org/wal.html) — use a coherent database backup strategy rather than blindly copying live state.

These sources support browser/storage constraints, not unverified host sizing or estimates.

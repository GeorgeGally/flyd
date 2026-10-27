# Flyd mobile: setup and current boundaries

Implemented 2026-10-18. This is a server-native web adapter to the existing TypeScript conversation runtime, not a native iPhone app or a replacement intelligence stack. No Rails application is used.

## What works in this release

- Phone-sized Flyd surface, Home Screen manifest, typed requests, safe Markdown result artefacts and the existing People/WhatsApp renderer.
- One-use, ten-minute phone pairing; revocable thirty-day cookie sessions, hashed credentials in a private SQLite auth store, exact HTTPS Host/Origin, CSRF, endpoint allowlist and loopback-only port 4819.
- Accepted requests and terminal receipts on the canonical intelligence event spine. A reconnect reads server state; closing the browser does not cancel work. Same id/text returns the same receipt; reused id with different text is rejected. Turns run sequentially with server-derived history, up to eight pending requests.
- Restarted in-flight/queued requests become unknown and are never automatically replayed. A succeeded receipt means the runtime returned an answer, not that an external message was delivered. Uncertain account effects are not silently retried.
- Optional explicit voice capture, resampled to the existing 24 kHz mono PCM16 transcription path. Maximum sixty seconds; raw audio is transient only. Transcript stays editable until Send. Backgrounding, locking, logout and navigation stop capture; background listening is not supported.
- Existing Gmail/DreamHost/Drive integrations operate through Flyd's account tools after setup. Email is drafts only. WhatsApp keeps exact reviewed-draft send authority and atomic uncertain-send protection. Existing account limits and partial-history caveats still apply.
- Today's news edition from the host's Scout, with the desktop's "More like this" / "Less like this" on each story. A rating is a local preference write (`recordScoutFeedback`, CSRF-protected `POST /api/news/feedback`) for a story still in today's edition; it is not a tool call and sends nothing outward.
- Shared runtime/context/curator/tool policy. Mobile is a capability ceiling: no filesystem, shell, AppleScript, coding boss, crew or local-app tools. This remains true even if a model forges a hidden tool call or autonomy is set to full.

## What remains unavailable

There is no paired Mac execution bridge in this release. The UI reports this truthfully; mobile cannot control Mac/iPhone apps, run FirstMate jobs or queue desktop operations. No LIVE/background voice, push notifications, offline submission, uploaded-file analysis, account OAuth setup in the phone, or generated executable HTML artefacts are exposed. Static assets may load online; no service worker caches private data.

The broader [implementation plan](flyd-mobile-hetzner-implementation-plan.md) still has outstanding companion, automatic migration tooling, scheduler ownership/cutover and full operational acceptance work. This release does not start the desktop Core's schedulers. Do not claim it implements all plan phases or is live just because it builds.

## Validate before deployment

Run `script/flyd-mobile-preflight` privately on the actual Hetzner host. Audit RAM/CPU/disk peaks, sibling application file permissions, OS/architecture, Node/native dependency compatibility, existing proxy, TLS, backups and real model-provider configuration. Quiet domains are not capacity evidence. No host was available to inspect from the implementation environment.

Use a dedicated unprivileged service account with home `/var/lib/flyd`; state is `/var/lib/flyd/.flyd`. Until all legacy `homedir()` paths are consolidated, mobile deliberately rejects a `FLYD_DIR` elsewhere. Do not run as the Rails user or root, mount sibling credentials, or copy your whole Mac home.

The checked-in `deploy/mobile` files are examples for a systemd/Nginx host, not instructions to replace existing ingress. If the host already uses containers/Kamal/a different proxy, translate the isolation and routing settings to that system. Adjust resource limits from measurements. Build on a matching OS/architecture without competing with Rails peak loads; use `npm ci`, `npm run lint`, `npm run build` in `cli/` and inspect any failures before activating.

## Start and pair

1. Configure `/etc/flyd/mobile.env` privately from the example. Choose an exact HTTPS origin without trailing slash, a supported hosted model and its provider credentials. `OPENAI_API_KEY` is separately required for voice. Defaults leave accounts and voice disabled.
2. Install the release at the reviewed code path, owned read-only to the service account. Ensure private state access and deny access to actual sibling application paths. Integrate only port 4819 through existing HTTPS ingress, preserving Host/Origin. Keep 4815–4818 and 4820 private. Validate proxy syntax and existing sites before reloading.
3. Start `node /opt/flyd/current/cli/dist/mobile/entry.js serve` as the service user with its configured environment. `npm run mobile -- serve` is the source-development equivalent, not the production service.
4. Over the existing private SSH admin connection, run the same entry with `pair` as the same service user/home. Enter its printed one-use code in the phone's login page. Do not paste the code into chat, URLs, source or service logs. Run `revoke` to invalidate all phones and outstanding pairing codes; Sign out revokes that phone.
5. Add Flyd to Home Screen using Safari's Share menu and test its standalone session independently. Pairing supports additional devices without sharing the Core's bearer token.

The service takes an exclusive SQLite owner lock for its state directory and refuses a live local desktop Core; desktop Core/view now refuse a live mobile owner. This protects local ownership only. It is not a distributed cross-host lock. Never run writable Mac and Hetzner copies of the same personal state; migration/cutover must explicitly stop the former.

## Accounts and memory cutover

Use a synthetic/empty state directory for the first smoke test. For real state, stop canonical Mac writers/timers/WhatsApp sockets, take a coherent SQLite backup and an inventory of approved profile/SOUL/taste/memory/conversation data, verify an isolated restore, then transfer through the private admin channel. Keep recovery copies private. Preserve consent, retention and source identities. Do not copy live `.sqlite` files without accounting for WAL and cross-store consistency.

Read [email/Drive setup](flyd-email-drive-setup.md) and [WhatsApp setup](flyd-whatsapp-setup.md). Provision/re-enroll accounts as the service user, outside git. Enable `FLYD_MOBILE_ACCOUNTS=1` only after the account/credential migration has been reviewed. It authorizes existing account tooling, not new account permissions. A server-side WhatsApp linked-device connection must have exactly one owner; do not leave a Mac socket active. The current PID lock cannot prove another host has stopped. Re-pair only when required, explicitly. Never retry a send whose result is uncertain.

Enable `FLYD_MOBILE_VOICE=1` after testing its configured OpenAI transcription key. The phone sends only an explicitly recorded utterance to the server and configured transcription provider. PRESENT and desktop sensing are unchanged. Speech corrections here are editable input, not automatic promotion of dictation correction rules; existing voice vocabulary is reused.

Canonical mobile request receipts are retained with personal state; no automatic retention/erasure UI is added. They follow the existing canonical source erasure API for `mobile.requests`. Existing curator conversation records remain governed by their own source. No raw audio or session secret is included in requests or canonical events.

## Verify and recover

Before daily use: real iPhone Safari/Home Screen, microphone permission/lock/background/audio codec handling, Mac physically off, reconnect during a turn, revoked sessions, duplicate submits, service restart, real account identity/draft review, HTTPS externally, and existing Rails health under load. Synthetic CI tests do not substitute for these checks.

Operationally: rotate systemd journal logs, monitor disk/memory/provider spend, take encrypted off-host coherent backups and rehearse restoration. SQLite auth contains hashes but still belongs in protected credential backups. A previous code release may require compatible schema; never restore an old state backup over newer mobile activity without reconciling requests and effects. Stop server effects/writers before returning authority to Mac. Do not enable a second scheduler during rollback.

No Hetzner deployment, real account transfer, live provider test or iPhone hardware verification was performed in the coding environment.

### Phone interface

The home screen puts the newest results first. Older answers can be expanded,
copied, or used to start a follow-up. The composer grows with your text and
adjusts when the phone keyboard opens. Voice has a separate Cancel control;
transcription stays editable before sending.

Mail opens a dedicated account inbox, search and plain-text reader. New drafts
and replies have an explicit review step showing the account, recipient, subject
and exact body. Save writes to the connected account’s Drafts folder; it never
sends email. Recent draft receipts survive restarts. An uncertain save must be
checked in the mail account before creating another copy. Retrying the same
reviewed save reuses its durable identifier. DreamHost replies save as new drafts
without reply threading. Attachments and full HTML are opened in your mail app.

Mail uses the existing `FLYD_MOBILE_ACCOUNTS=1` opt-in and existing account
credentials. It does not introduce a second OAuth or account store. Use search
for messages outside the latest 12 inbox items.

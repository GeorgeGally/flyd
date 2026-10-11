# WhatsApp as a Flyd artefact

Flyd owns the experience; WhatsApp supplies the transport. The People artefact in
Flyd's conversation window is the first app-consumption surface: a quiet inbox,
focused thread, dictation-ready composer, and an immutable recipient/body review
before sending. It uses Flyd's existing typography, charcoal/amber palette,
transitions and responsive layout, not WhatsApp branding or navigation.

## Connect

1. Update/build Flyd (`cd cli && npm ci && npm run build`).
2. Run `flyd whatsapp connect`. In WhatsApp Settings → Linked Devices, scan the
   QR. Leave pairing running briefly for initial sync, then Ctrl+C.
3. Restart Flyd Core (or reopen Flyd.app). Core maintains the linked-device socket
   and reconnects with bounded retries. Open Flyd's conversation window and select
   **people** in its header; `/whatsapp` is the same server's artefact route.
4. Choose a contact, focus the composer and use Flyd dictation, or type. Review
   the recipient and exact words, then click Send. Spoken assistant commands also
   support “Read my WhatsApp messages” and “Draft a WhatsApp reply to Erica…”.
   That path returns a draft id: “Send WhatsApp draft <id>” approves that exact
   immutable draft. Merely asking to draft or reading a message never sends it.

The daemon owns the socket. The window/CLI use its authenticated loopback API
when it is running; another process cannot open a competing linked-device socket.
A stale process lock is recovered after its owner exits. Stop the pairing CLI
before opening the Core connection. `flyd whatsapp status` checks local pairing;
`flyd whatsapp disconnect` removes local credentials/cache/drafts (close Core
first), then unlink Flyd in WhatsApp Settings. Keep WhatsApp installed for account
administration, recovery, calls and unsupported media.

## Data and limitations

- Baileys is pinned to 7.0.0-rc14, the package available when implemented. It is
  unofficial, unsupported by WhatsApp, and subject to breakage or account blocks.
- No migration of the phone number or WhatsApp account. No complete-history claim:
  partial linked-device sync plus messages arriving while connected.
- Direct chats and groups, text and captions. Audio/video/document messages show
  placeholders; no attachment download, voice-note transcription, calls, reactions,
  read-receipt controls or contact creation in this version. Flyd dictation works
  through the existing native adapter; the artefact does not start a second mic.
- Credentials/Signal keys, a 30-day text cache and 24-hour drafts live in
  `~/.flyd/connectors/whatsapp/state.sqlite` (private directory/file permissions).
  No QR, credentials or message content is written to provider logs or committed.
  This SQLite file is **not encrypted at rest**; OS disk encryption protects it.
- Ephemeral/view-once envelopes are not cached. Incoming edits/deletions update
  the cache when received. It is not a backup or a complete deletion mirror.
- WhatsApp messages are untrusted evidence, never executable instructions, and
  ingestion does not automatically learn them into personal memory.
- A send atomically claims its draft before contacting WhatsApp. Concurrent sends,
  retries, expired drafts and uncertain attempts are blocked. “Sent” means the
  transport returned a message id, not delivery/read confirmation.
- The People artefact and its API use the existing loopback host/origin/token
  guards and a self-only CSP. Provider text renders through textContent.

## Validation

Offline tests cover private storage, history replay deduplication, exact known
recipients, draft expiry, uncertain-send retry prevention, policy classification,
voice/text account routing and exact current-command send authorization. UI tests
cover the review/send sequence and hostile provider text. Real pairing, account
sync and sending require George's linked-device QR and have not been live-tested.

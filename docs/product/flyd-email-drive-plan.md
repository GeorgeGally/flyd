# Direct email, composition and Drive access

Goal: Flyd can find and read George's Gmail, DreamHost mail and Drive documents from chat, invoked text and live voice, retaining account identity and source references.

## Decision
Use direct Google REST APIs with desktop OAuth (PKCE, loopback callback, offline refresh; read-only lookup plus gmail.compose/drive.file for draft and document creation) and DreamHost IMAP through ImapFlow. Expose a small native tool set; a third-party MCP broker is unnecessary inside Core. Lovelybots' current Google integration is identity-only (`email,profile`); reuse the Google Cloud approach, not its Rails authentication or identity tokens. A Desktop OAuth client is required for Flyd.

## Implementation
1. Local account configuration and separate secret files, private directory/file permissions, no secrets in model tools. Multiple accounts; Google identity checked before saving.
2. Read-only Gmail search, full threads, MIME body and attachment metadata. DreamHost mailbox enumeration, search, UIDVALIDITY-qualified reads, read-only mailbox locks and MIME parsing without changing seen flags.
3. Composition: save Gmail drafts with reply headers/thread ids, DreamHost drafts via APPEND with the Draft flag, and create new native Google Docs. No sending tools. Writes are reversible local actions under existing tool policy, hidden on answer-only routes; invocations expose writes only for explicit compose requests. Failover is stopped after an attempted write; duplicate invocation writes are held.
4. Drive full-text search, shared-drive support, metadata and bounded text exports for Docs/Sheets/Slides and plain text. Binary documents return metadata and an explicit unsupported-content result.
5. Native personal tools wired into chat plus a bounded read-only retrieval loop for explicit email/Drive invocations (including LIVE through resolve). External content follows existing untrusted-content handling. No network in PRESENT or dictation.
6. CLI: connect Google, add DreamHost via password environment variable, list/disconnect accounts, live health check. Local disconnect removes saved credentials; Google revocation remains available in account settings.
7. Hermetic connector/auth/routing tests, existing personal-tools/policy regressions, typecheck and compiled build. Commit to main.

## Boundaries
No send/delete/share tools, no automatic inbox sync, no raw evidence persisted to memory. Lookup results retain sources and retrieval timestamps. Learning/sync is a later governed extension, not implied by connecting an account. Attachment metadata is available; binary attachment download/extraction is deferred.

## Acceptance
Search a topic across both mail providers, read matching threads/messages, find and read the related Drive document, and give a source-backed comparison. Partial provider failures must be visible, not misreported as no matches. Account setup and real-mail smoke tests require George's local Google consent and DreamHost credential; tests must not use production credentials.

## Verification and setup
See `docs/product/flyd-email-drive-setup.md` for local account connection and smoke-test commands. Implementation is in `cli/src/connectors/`, routed by `runtime/personal-tools.ts` and `resolve.ts`. Existing LIVE uses the same resolve path. No third-party broker or MCP server is required.

## Validation on 2026-10-09

- `npm run lint` and `npm run build`: passed.
- Connector, personal-tools, policy, turn-plan, Mac account-resolution, existing resolution, realtime and router suites: 169 tests passed; chat tool-registry regression separately passed.
- Full suite run: 2,273 passed, 57 failed, 11 skipped. PostgreSQL integration fixtures are unavailable here. A detached unchanged-main comparison reproduced the five non-Postgres failures in conversation-responder, artifact-check and transitions-harness. The stale chat tool-registry assertion was updated for the extended tool set and passes; unrelated baseline failures were not changed.
- Real account smoke tests and Mac installation remain pending local credentials/Google consent. This checkout contains no connected production accounts.

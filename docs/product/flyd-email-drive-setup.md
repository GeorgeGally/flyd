# Connect email and Drive to Flyd

## Google

Use an existing Google Cloud project if suitable. Enable Gmail API and Google Drive API. Create an OAuth **Desktop app** client for Flyd; Lovelybots' web-client callback is not appropriate for this loopback desktop flow. Configure consent and add your account as a test user if the project is in testing. Google's testing-mode refresh tokens can expire after seven days for these scopes; use a suitable production/internal configuration for persistent access.

Set `FLYD_GOOGLE_CLIENT_ID` and, when supplied by Google, `FLYD_GOOGLE_CLIENT_SECRET` in your local Flyd environment. Do not commit them.

```bash
flyd accounts google personal
```

Open the printed Google URL on the same Mac running Flyd and approve access. Account identity is checked before it is saved. Repeat with another id for another Google account.

Permissions: Gmail read and compose, Drive read and access to files created/opened by the app, plus Google account email identity. Gmail's compose scope also permits sending at the OAuth level; Flyd exposes no send tool. Drafts and new Google Docs can be saved; sending, deletion and sharing are not implemented.

## DreamHost

In your local terminal, read the mailbox password without putting it in shell history:

```bash
read -s -p 'DreamHost mailbox password: ' FLYD_DREAMHOST_PASSWORD
export FLYD_DREAMHOST_PASSWORD
flyd accounts dreamhost work your-address@your-domain.com
unset FLYD_DREAMHOST_PASSWORD
```

This is Bash syntax. On zsh use `read -s 'FLYD_DREAMHOST_PASSWORD?DreamHost mailbox password: '` for the first line.

The connector uses DreamHost's `imap.dreamhost.com:993` over TLS. Reads use read-only mailbox locks; composing appends a draft to an existing Drafts folder. No SMTP or sending capability is enabled. DreamHost reply threading is not yet implemented.

## Check

```bash
flyd accounts list
flyd accounts check
```

Connection configuration and separate credentials are stored in `~/.flyd/connectors` with directory mode 0700 and file mode 0600. `FLYD_CONNECTOR_DIR` can override this location. These are private files, not Keychain-encrypted credentials. Avoid placing the directory inside a repository or synced folder.

## Try it

- “Find Nuanu emails across my inboxes, then read the latest relevant conversation.”
- “Find the Nuanu proposal in Google Drive and compare it with that email.”
- “Draft an email from my work account to [actual email address], subject Christmas market, saying …”
- “Create a Google Doc in my personal account called Market plan with …”

You can use chat, invoked text or LIVE voice. Dictation remains ordinary dictation. Gmail supports Gmail search operators. DreamHost searches literal text in INBOX by default; list mailboxes to search Sent or another folder. Google Sheets exports currently cover the first sheet only. Binary PDFs/Office files and mail attachment bodies are not extracted; metadata and source references are returned. Results explicitly disclose unsupported or truncated content and provider failures.

Draft/document creation may succeed even if the response is lost. Check your account before retrying a timed-out write.

## Disconnect

```bash
flyd accounts disconnect personal
```

This removes local credentials and configuration. Revoke Flyd's Google access separately in Google Account → Security → third-party connections if desired.

## Sources checked 2026-10-09

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2#expiration
- https://developers.google.com/workspace/gmail/api/guides/drafts
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://help.dreamhost.com/hc/en-us/articles/214918038-Email-client-configuration-overview
- https://imapflow.com/docs/api/imapflow-client/

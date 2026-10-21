# Claude Code notices in Flyd

Claude Code's notices ("needs your permission", "waiting for your input", a
usage-limit warning) go to Flyd instead of macOS notifications. A notice that
needs George rings the island; an idle one waits in the conversation view's
column. Notices stay in Core's memory and are never written to disk.

## Setup

Claude Code reads hooks from George's own `~/.claude/settings.json`. The repo
does not edit that file, so add these two entries yourself, using the absolute
path to this checkout:

```json
{
  "preferredNotifChannel": "notifications_disabled",
  "hooks": {
    "Notification": [
      {
        "hooks": [
          { "type": "command", "command": "/Users/radarboy3000/Documents/flyd/bin/claude-notify-to-flyd" }
        ]
      }
    ]
  }
}
```

- `preferredNotifChannel: notifications_disabled` stops Claude Code's own
  terminal and system notifications.
- The `Notification` hook passes each notice's JSON to
  `bin/claude-notify-to-flyd`, which posts it to the conversation view's
  `POST /api/notice` on `127.0.0.1:4818`. Set `FLYD_VIEW_URL` to change that
  address.

The hook always exits 0. If Flyd is not running, the notice is dropped and
Claude Code carries on.

## Check it

With Flyd running:

```bash
echo '{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash","cwd":"'"$PWD"'"}' \
  | bin/claude-notify-to-flyd
```

The island should ring with `flyd: Claude needs your permission to use Bash`.

## Limits

- The endpoint only takes loopback requests with a JSON body and no `Origin`
  header, so web pages cannot post to it.
- At most 12 notices are kept. A notice disappears 12 hours after it last
  repeated, and the island only rings for one that is under 30 minutes old.
  An idle notice repeated within 30 minutes updates the existing one; every
  notice that needs George rings again, even in the same words. A newer notice from
  the same session replaces the older one.

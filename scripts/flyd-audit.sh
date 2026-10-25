#!/bin/bash
# Weekly state-of-the-nation audit of Flyd (launchd: com.flyd.audit).
# A read-only Claude Code run writes ~/.flyd/audits/<date>.md; Flyd's notch
# then shows its one-line headline. Run by hand: scripts/flyd-audit.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$HOME/.flyd/audits"
OUT="$OUT_DIR/$(date +%F).md"
mkdir -p "$OUT_DIR"

CLAUDE="${FLYD_AUDIT_CLAUDE:-$HOME/.local/bin/claude}"
cd "$REPO"
"$CLAUDE" -p "$(cat "$REPO/docs/audit/state-of-the-nation-prompt.md")" \
  --permission-mode dontAsk \
  --allowedTools "Read" "Grep" "Glob" "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" "Bash(ls:*)" "Bash(wc:*)" "Bash(grep:*)" "Bash(tail:*)" "Bash(head:*)" "Bash(curl -s http://127.0.0.1:4815/health)" "Bash(flyd crew list)" \
  > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"

HEADLINE="$(grep -m1 '^» ' "$OUT" | sed 's/^» //' || true)"
[ -n "$HEADLINE" ] || HEADLINE="This week's Flyd audit is ready."
TOKEN="$(cat "$HOME/.flyd/overlay/auth-token" 2>/dev/null || true)"
if [ -n "$TOKEN" ]; then
  python3 - "$TOKEN" "$HEADLINE" "$OUT" <<'PY' || true
import json, sys, urllib.request
token, headline, path = sys.argv[1:4]
body = json.dumps({"title": "Flyd audit", "message": f"{headline} Full audit: {path}", "kind": "deliverable"}).encode()
req = urllib.request.Request("http://127.0.0.1:4815/notify", data=body, method="POST",
                             headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=10)
PY
fi
echo "$OUT"

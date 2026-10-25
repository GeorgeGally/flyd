# Flyd conversation view (`flyd view`)

Reference for the calm conversation view. Product authority: [personal-intelligence PRD](flyd-personal-intelligence-prd.md). Moved out of `AGENTS.md` on 2026-10-25; the code under `cli/src/conversation-view/` is the source of truth where this drifts.

## Hosting

- `flyd view [--session id] [--project dir]` serves the view on `127.0.0.1:4818` (`cli/src/conversation-view/`).
- Flyd.app hosts it natively: menu bar "Conversation…" or ⌃⌥⌘F opens a WKWebView window (`mac-adapter/Sources/Conversation/`).
- The app supervises `node --import tsx src/entry.ts view` from Core's `cli/` (`FLYD_VIEW_CLI_DIR` overrides; log `~/.flyd/overlay/conversation-view.log`; `--conversation-selftest` checks the page in-app).
- The view never writes transcripts.

## What it shows

- Only George's words and final replies, followed live.
- v1 source is firstmate's Claude Code transcripts (`ClaudeCodeTranscriptSource`); Flyd chat plugs in as another `ConversationSource`.
- Under the message box: context % from the transcript's own usage (not in Flyd's window, where it is firstmate's machinery) and plan limits from `quota-axi --provider claude` (read-only, no Keychain prompt).
- firstmate's transcript lines show only as muted "update" relays (routine ones hidden), and all firstmate text is put in Flyd's voice ("sir", never "Captain"; `flyd-voice.ts`).
- "taste" in the header opens `/taste` (see [flyd-taste.md](flyd-taste.md)).
- `/api/status` feeds the notch island (working / a failed line / reply / needs you).

## The message box is Flyd's

- One model call routes each message (`flyd-desk.ts`).
- General questions get Flyd's own assistant turn (kept in `~/.flyd/view/asks`).
- Software/fleet work, slash commands and attached files go to firstmate's own `bin/fm-inbox.sh note`, each as a `desk-…` domain run through the command layer's FirstMate transport (his words, done_when, return contract; settled from receipts, transcript matching only a fallback). Only on firstmate's conversation.
- A screenshot goes with his words to whichever of them answers; Flyd reads it through a vision description kept with the ask.
- firstmate home is `~/Documents/firstmate` (`FLYD_FIRSTMATE_HOME` overrides; never the real one under vitest — `cli/src/lib/firstmate-home.ts`).
- "/" at the start of the box lists Claude Code's skills and commands (`commands.ts`, `/api/commands`); a sent command carries a hidden marker telling firstmate to run it.
- Pasted images: transcript ones are read back by line byte offset (`/api/image`); box ones are saved to firstmate's `data/inbox-images` and named in the note as `[image: /path]`.
- Composer typing suggestions (Tab accepts, Escape dismisses, ↹ toggles): [flyd-composer-predictions.md](flyd-composer-predictions.md).

## Answers under a question

- A question's answer under it is only its own: Flyd's (shown whole when it fits a glance, else led by its first few lines), or firstmate's `fm-inbox.sh reply` from `state/inbox/.replies`.
- firstmate's reply is retold to George by Flyd's own model (`interpret.ts`): his question, the answer, the recent conversation and USER.md in; his question answered first in at most three short lines — the outcome, a decision only he can make, and links — in Flyd's voice. Cached in `~/.flyd/view/interpretations.json` (newest 20 kept), two model calls at a time. firstmate's narration under the busy dots is voiced too.
- firstmate's words sit behind "more"; the local digest leads until the interpretation lands; Flyd's whole briefing when none is coming. Otherwise it says it is waiting.

## Long-reply summaries (`summaries.ts`)

- Long replies lead with a summary of at most three lines, outcome first, how the work was done left out.
- Source order: the reply's own leading `» ` lines, else Claude Haiku → xAI Grok (from `CLAUDE_API_KEY`/`ANTHROPIC_API_KEY` or `XAI_API_KEY`/`~/.grok`). Cached in `~/.flyd/view/summaries.json`, newest 20 only.
- Until then: a local digest of the lead sentence and every point or paragraph. With no key: Flyd's whole briefing of the reply (stubs out, status card, every sentence).
- Sends reply text to that provider. `FLYD_VIEW_SUMMARIES=0` turns it off; `FLYD_SUMMARY_ALWAYS=1` compares.
- Routine replies (acks, status pings, a model's ROUTINE) are muted and never announced on the island.
- Replies with something to act on (code block, table, an instruction to him like "add these") open with the body shown under a model or digest summary (never under Flyd's whole briefing).

## The living line (`living.ts`)

- The busy dots stand alone, with no narrated step under them.
- While his newest message waits, one living line under it says what is happening to it, changed in place: "Queued" the moment he sends (or what his question asks about, e.g. "Looking up usb overdrive", when Flyd answers it), then what the message asks for with the project he named ("Fixing the island filter"), then firstmate's current step once its turn takes that note up by name.
- Never who took it or where it went; the island announces none of it. The answer replaces it.

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
- `live-activity.ts` builds the `live` model sent with each stream update. No page draws it yet. Its counts can differ from the right column's job cards, which group a project's calls.
- Fleet reads request all in-flight rows (`--all-in-flight`). Working, paused, queued and finished rows remain visible even when the executive does not notify about them. Each running worker has its own Jobs card. Queued work is not Working; accepted or working non-FirstMate runs that have not moved for a day are Waiting. Finished work can be ready without a merged PR. Paused, parked and blocked workers read as Paused; grouped cards show a paused count when needed.
- Open domain decisions can be answered on their Jobs cards. Runs in the done phase cannot accept an answer there.
- A Jobs card is read at a glance: a short title and one line (what he must do, else what changed, else what comes next). The full digest stays in the open job.
- An answer is never refused because its question went stale. The server reads the fleet afresh (or the run's current state) and compares the full, case-sensitive question text, not the shortened display copy. The same question under a new id still takes the answer. If the question has closed or changed, or the fleet can't be read, his words and attachments reach the same job as a normal message, so they never decide a different question. If an answer is recorded but its picture fails, the answer stands and only the picture can be retried.

## Project threads

- The header's **Today** tab is home. A conversation with nothing said yet shows today's feed in the middle (`today.ts`): work under way first, then what landed, the jobs, what Flyd did and where he left off, newest first, with the time above each note; a quiet day reaches back up to a week. The first thing said replaces it.
- The header's **News** tab reads `GET /api/desk`: the latest Scout edition without its Giphy, Pexels and Google Trends filler (saying "Last updated" when it is not today's), weather icons from Open-Meteo, and the horoscope. Place comes from `FLYD_WEATHER_LOCATION`, `~/.flyd/location.json`, else the place in `USER.md`; sign from `FLYD_STAR_SIGN`, else `USER.md`. The horoscope is Horoscope.com's, credited and linked. The message box follows the story being read, and his words open that story's article conversation.
- Job cards carry the project and time on top, an unframed picture lined up with the text, one short line, and a count of what he must do only when there is one ("Four to approve", "Pick one of five").
- The right column's **Projects** tab lists each project's latest exchange (his question, the first line of what came back) with a dot on what he has not read; **All** heads it. Picking one opens its thread in the middle, "Back to the conversation" leaves it. What he has read is his browser's own (`localStorage`), counted from his first look, so history never arrives as unread.
- `project-threads.ts` reads Flyd's conversations and firstmate's session transcripts in the background, then refreshes changed or active sessions. `readHistory` reads a long transcript in pieces. A thread is a session to the rest of the view (`project:dir`), capped at its newest 200 messages. firstmate's reports that answer nothing he said pass the same check a relay passes in the stream, or stay out of the threads; a reply to him is never kept back.
- Tags (`project-tags.ts`): names first, from firstmate's `data/projects.md`, Flyd's project list and the older names in `KNOWN`, in his words and firstmate's, task ids and repo URLs included. A turn (what he said, what came back) that names nothing carries on the project of the talk within 20 minutes of it, when that is one project. A message naming several projects is in each; a thread leaves out the paragraphs and points that name only others. A message naming more than four is treated as a fleet round-up and has no project tag.
- Unplaced exchanges go to firstmate (`project-asker.ts`): one note at a time through its inbox as Flyd's own note, at most 25 exchanges, cut short, and only while firstmate is up, spaced 15 minutes apart. Answers are kept by hash in `~/.flyd/view/project-tags.json`. Missing or unrecognized answers remain eligible for another request; an explicit Other answer is retained. Exchanges without a project tag appear under **Other**, the last row.
- His words in a thread go to that project's own conversation (`window:project-dir`), or to the live session when the source keeps none, led by `About the project "DIR"` and the last few lines of the thread (never shown to him), so a follow-up means something there. A slash command goes as typed.

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

/** Messages: his words, Flyd's replies, receipts, staff cards, reply boxes and choices. */
export const MESSAGE_STYLE = `
/* The captain's words look exactly like selected text: the selection's
   colours, hugging each line the way a selection does. The page wraps each
   block's text in .hl. */
.msg.user .hl {
  background: var(--sel-bg); color: var(--sel-fg);
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
}
/* Pasted code: one solid highlighted block, indentation kept, no per-line bars. */
.msg.user pre { background: var(--sel-bg); color: var(--sel-fg); line-height: 1.6; }
.msg.user pre code { background: none; color: inherit; }
/* The highlight fills the whole line box, so wrapped lines touch with no gap:
   ~1.185em glyph box + 2 × 0.36em padding ≈ the 1.9em line. */
.msg.user .body { line-height: 1.9; }
/* Horizontal "padding" comes from side shadows in the same colour: WebKit
   draws them on every wrapped line, so each line's highlight starts at the
   same left edge (inline padding and margins only reach the first line
   there), and the text itself stays aligned with the replies. */
.msg.user .hl {
  padding: 0.36em 0;
  box-shadow: 0.6em 0 0 var(--sel-bg), -0.6em 0 0 var(--sel-bg);
}
.msg.user strong, .msg.user a { color: inherit; }
.msg.user + .msg.user { margin-top: 0.9em; }
/* Flyd's side reads at a calmer size than his own words: a few short lines, never a wall. */
.msg.assistant { margin-top: 1.1em; font-size: 0.78em; line-height: 1.6; }
/* A question with no answer yet: one living line says what is happening to
   it, changing in place, until its answer appears right under it. */
/* Read at a glance: the message face, near body size, in full text colour. */
.queued { display: flex; align-items: flex-start; gap: 0.55em; margin-top: 0.5em; font: 400 0.82em/1.45 var(--sans); color: var(--fg); }
.queued::before { content: ""; flex: none; width: 0.36em; height: 0.36em; margin-top: 0.545em; border-radius: 50%; background: currentColor; animation: breathe 1.4s ease-in-out infinite; }
.queued .line-words { min-width: 0; overflow-wrap: anywhere; }
.queued a, .rail-wait a { color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; overflow-wrap: anywhere; }
.queued.swap { animation: swap 280ms cubic-bezier(.2,.7,.2,1); }
@keyframes swap { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .queued::before, .queued.swap { animation: none; } }
/* Whether firstmate has read a note: "sent", then "read by firstmate"; late when left unread too long.
   Once firstmate has said the outcome, the outcome takes this line, in the same quiet face. */
.receipt { display: block; margin-top: 0.45em; font: 500 13px/1.3 var(--mono); letter-spacing: 0.02em; color: var(--muted); }
.receipt.late { color: var(--k-waiting); }
.receipt.outcome { overflow-wrap: anywhere; }
.receipt a { color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
/* Updates relayed from firstmate's own session: set apart, never read as an answer. */
.msg.aside { color: var(--muted); }
.aside-label { display: block; margin-bottom: 0.2em; font: 500 12px/1.6 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.msg.aside:not(.aside-first) .aside-label { display: none; }
.time {
  position: absolute; right: calc(100% + 2em); top: 0.55em; white-space: nowrap;
  font: 13px/1 var(--mono); color: var(--muted); opacity: 0; transition: opacity 140ms ease;
  font-variant-numeric: tabular-nums;
}
.msg:hover .time { opacity: 1; }
.msg.fresh { animation: rise 320ms cubic-bezier(.2,.7,.2,1); }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* A shaped answer: the lead, then each labelled part, what backs it, and what comes next. */
.answer-form { display: block; }
.answer-form .answer-lead { margin: 0 0 0.9em; font: 500 1.08em/1.55 var(--sans); color: var(--strong); }
.answer-form .answer-parts { display: grid; gap: 0.85em; margin: 0; }
.answer-form dt { margin: 0 0 0.2em; font: 600 11px/1.4 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.answer-form dd { margin: 0; }
.answer-form .answer-evidence { margin: 0.9em 0 0; padding-left: 1.1em; color: var(--muted); }
.answer-form .answer-evidence a { color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
.answer-form .answer-next { margin: 0.9em 0 0; font-weight: 600; color: var(--strong); }
.answer-form .answer-compare { width: 100%; border-collapse: collapse; font: 0.95em/1.5 var(--sans); }
.answer-form .answer-compare th, .answer-form .answer-compare td { padding: 0.5em 0.7em 0.5em 0; text-align: left; vertical-align: top; border-top: 1px solid var(--faint); }
.answer-form .answer-compare th { font-weight: 600; color: var(--strong); }
.answer-form .answer-compare thead th, .answer-form .answer-compare thead td { border-top: 0; font: 600 11px/1.4 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.body > :first-child { margin-top: 0; }
.body > :last-child { margin-bottom: 0; }
.body p { margin: 0 0 0.85em; }
.body h1, .body h2, .body h3, .body h4 { color: var(--strong); line-height: 1.3; margin: 1.5em 0 0.5em; letter-spacing: -0.01em; }
.body h1 { font-size: 1.32em; } .body h2 { font-size: 1.16em; } .body h3, .body h4 { font-size: 1em; }
.body strong { color: var(--strong); font-weight: 620; }
.body ul, .body ol { margin: 0 0 0.9em; padding-left: 1.3em; }
.body li { margin: 0.28em 0; padding-left: 0.15em; }
.body li::marker { color: var(--muted); }
.body a { color: var(--link); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--link) 40%, transparent); }
.body a:hover { text-decoration-color: currentColor; }
.body code { font: 0.84em var(--mono); background: var(--tint); padding: 0.12em 0.36em; border-radius: 5px; }
.body pre { background: var(--tint); padding: 0.7em 0.85em; border-radius: 0.3em; overflow-x: auto; margin: 0 0 1em; font: 0.72em/1.6 var(--mono); }
.body pre code { background: none; padding: 0; font: inherit; color: var(--fg); font-weight: 400; }
.body blockquote { margin: 0 0 1em; padding: 0; color: var(--muted); }
.body hr { border: 0; border-top: 1px solid var(--faint); margin: 1.6em 0; }
.body table { border-collapse: collapse; width: 100%; margin: 0.4em 0 1.1em; font-size: 0.8em; display: block; overflow-x: auto; }
.body th { text-align: left; font: 500 0.82em var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.body th, .body td { padding: 0.45em 0.8em 0.45em 0; border-bottom: 1px solid var(--faint); vertical-align: top; }
/* A reply on several pieces of work, as Flyd shows it: grouped by what each
   asks of him, a coloured light per piece, the line itself opens the work.
   Flat, the artefact's colours; nothing framed. */
.status-card { margin: 1.5em 0 1.6em; display: flex; flex-direction: column; gap: 1.7em; }
.status-card:last-child { margin-bottom: 0; }
/* A rail: the state on the left, its work on the right, like a title card. */
.sc-group { --k: var(--k-news); display: grid; grid-template-columns: 7.2em minmax(0, 1fr); column-gap: 1.2em; align-items: baseline; }
.sc-group.k-call { --k: var(--k-call); }
.sc-group.k-live { --k: var(--k-live); }
.sc-group.k-landed { --k: var(--k-landed); }
.sc-kicker { margin: 0; padding-top: 0.15em; display: flex; gap: 0.7em; font: 600 11.5px/1.5 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--k); }
.sc-count { color: var(--muted); letter-spacing: 0; font-variant-numeric: tabular-nums; }
.sc-group ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.55em; }
.sc-row {
  display: flex; align-items: baseline; gap: 0.75em; margin: 0; padding: 0; line-height: 1.4;
  animation: sc-in 420ms cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i, 0) * 70ms + 60ms);
}
.sc-what { min-width: 0; flex: 1; display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 0.6em; }
.sc-led { display: none; }
.sc-what .sc-led { align-self: center; transform: none; opacity: 0.5; transition: opacity 140ms ease; }
.sc-what .sc-led:hover, .sc-what .sc-led:focus-visible { opacity: 1; outline: 0; }
.sc-group.k-call .sc-row > .sc-led { box-shadow: 0 0 0 4px color-mix(in srgb, var(--k) 20%, transparent); animation: sc-pulse 2.4s ease-in-out infinite; }
.sc-text { color: var(--strong); text-decoration: none; transition: color 140ms ease; }
a.sc-text:hover, a.sc-text:focus-visible { color: var(--k); outline: 0; }
.sc-group.k-landed .sc-text { color: var(--fg); }
.sc-detail { flex-basis: 100%; margin-top: 0.1em; font-size: 0.86em; line-height: 1.4; color: var(--muted); }
.sc-project { margin-left: auto; font: 500 11px/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
/* Answering a "needs you" line right where it stands. */
/* His reply to one answer: quiet until he looks for it, then a box under the answer. */
.reply { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 0.4em; }
.reply-open { font: 500 13px/1.2 var(--sans); color: var(--muted); background: transparent; border: 0; border-radius: 4px; padding: 2px 0; cursor: pointer; opacity: 0.7; transition: opacity 160ms ease, color 160ms ease; }
.msg:hover .reply-open, .reply-open:focus-visible { opacity: 1; }
.reply-open:hover { color: var(--fg); }
/* Open, it is a card like a learned memory: its label and Close, then his words and Send as one row. */
.reply form {
  flex-basis: 100%; padding: 10px 12px 12px; border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 7%, var(--tint)); transition: border-color 140ms ease;
}
.reply form:focus-within { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
.reply form[hidden], .reply-open[hidden], .reply-note[hidden] { display: none; }
.reply-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 6px; }
.reply-kicker { display: flex; align-items: center; gap: 7px; font: 500 13px/1.2 var(--sans); color: var(--accent); }
.reply-kicker::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.reply-close { font: 500 13px/1.2 var(--sans); color: var(--muted); background: transparent; border: 0; border-radius: 4px; padding: 2px 0; cursor: pointer; transition: color 140ms ease; }
.reply-close:hover { color: var(--fg); }
.reply-row { display: flex; align-items: flex-end; gap: 8px; }
.reply form .reply-input { min-height: 32px; font-size: 16px; line-height: 22px; padding: 5px 0; color: var(--strong); background: transparent; border: 0; border-radius: 0; }
.reply form .reply-input:focus { outline: none; }
.reply form .reply-send { flex: none; height: 32px; padding: 0 14px; font: 600 14px/1 var(--sans); letter-spacing: 0; text-transform: none; border-radius: 6px; }
.reply-close:focus-visible, .reply form .reply-send:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.reply-input { flex: 1; min-width: 8em; max-height: 12em; field-sizing: content; font: 400 16px/1.45 var(--sans); color: var(--fg); background: var(--tint); border: 1px solid var(--faint); border-radius: 8px; padding: 8px 10px; resize: none; }
.reply-input:focus { outline: none; border-color: var(--accent); }
.reply-input::placeholder { color: var(--muted); }
.reply-send { font: 700 11px/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--bg); background: var(--accent); border: 0; border-radius: 8px; padding: 10px 12px; cursor: pointer; }
.reply-note { flex-basis: 100%; font: 400 13px/1.4 var(--mono); color: var(--muted); }
/* Words he selects in a message take a comment: a small frosted Comment by the
   selection, then the same card as a reply, quoting them. It fades in where it stands. */
.passage {
  position: fixed; z-index: 40; max-width: min(460px, calc(100vw - 32px)); opacity: 0; transition: opacity 140ms ease;
  border: 1px solid color-mix(in srgb, var(--fg) 12%, transparent); border-radius: 10px;
  background: color-mix(in srgb, var(--tint) 70%, transparent); -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
}
.passage.shown { opacity: 1; }
.passage[hidden], .passage-card[hidden], .passage-open[hidden] { display: none; }
.passage-open { display: block; font: 500 16px/1 var(--sans); color: var(--fg); background: transparent; border: 0; border-radius: 10px; padding: 10px 14px; cursor: pointer; transition: color 140ms ease; }
.passage-open:hover { color: var(--accent); }
.passage-open:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.passage.open { width: min(520px, calc(100vw - 32px)); max-width: min(520px, calc(100vw - 32px)); }
.passage-card { padding: 14px 18px 16px; }
.passage .reply-head { margin-bottom: 10px; }
.passage-quote { margin: 0 0 12px; padding: 0; font: 400 17px/1.45 var(--sans); color: var(--muted); white-space: pre-line; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
.passage .reply-row { align-items: center; gap: 12px; }
.passage .reply-input { min-height: 34px; font-size: 19px; line-height: 26px; padding: 4px 0; color: var(--strong); background: transparent; border: 0; border-radius: 0; }
.passage .reply-input:focus { outline: none; }
.passage .reply-send { flex: none; height: 36px; padding: 0 16px; font: 600 15px/1 var(--sans); letter-spacing: 0; text-transform: none; border-radius: 8px; transition: background-color 140ms ease, opacity 140ms ease; }
.passage .reply-send:disabled { opacity: 0.5; cursor: default; }
.passage .reply-send:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.passage .reply-note { display: block; margin-top: 10px; font: 400 15px/1.4 var(--sans); }
.passage .reply-note[hidden] { display: none; }
/* The words he is commenting on stay marked while the card is open. */
::highlight(passage) { background-color: var(--sel-bg); color: var(--sel-fg); }
.reply-ref { display: block; margin: 0 0 0.3em; font: 400 0.72em/1.4 var(--sans); color: var(--muted); overflow-wrap: anywhere; }
/* A question a reply put to him: the question, one tap per option, or his own
   words. Said to him, so never muted as an update; it fades in, nothing moves. */
.msg.aside.asks { color: var(--fg); }
/* A relayed staff update: a compact card, never a paragraph. A dot and a word for the kind of news, one line, its link. */
.msg.carded { color: var(--fg); }
.msg.carded > .summary, .msg.carded > .aside-label, .msg.carded-decision .choice-q { display: none; }
.msg .card { display: flex; gap: 18px; align-items: flex-start; padding: 16px 20px 17px; border-radius: 14px; background: var(--tint); animation: choice-in 380ms ease both; }
.msg .card-text { flex: 1; min-width: 0; }
.msg .card-meta { display: flex; align-items: center; gap: 8px; font: 500 12px/1.4 var(--sans); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.msg .card-meta::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.msg .card-landed .card-meta::before { background: #7ec699; }
.msg .card-decision .card-meta::before { background: var(--accent); }
.msg .card-blocker .card-meta::before { background: #d0574c; }
.msg .card-line { margin: 8px 0 0; font: 500 19px/1.45 var(--sans); color: var(--strong); text-wrap: pretty; overflow-wrap: anywhere; }
.msg .card-link { display: inline-block; margin-top: 10px; font: 500 15px/1.4 var(--sans); color: var(--link); text-decoration: none; transition: color 140ms ease; }
.msg .card-link:hover { color: var(--strong); }
.msg .card-thumb { flex: none; margin: 0; }
.msg .card-text > .card-line:first-child { margin-top: 0; }
.outcomes { display: grid; gap: 10px; }
.outcomes-lead { margin: 0 0 4px; font: 400 17px/1.5 var(--sans); color: var(--fg); text-wrap: pretty; }
.msg .card-compact { padding: 14px 18px 15px; }
.msg .card-compact .card-line { margin-top: 6px; font-size: 17px; }
.msg .card-compact .card-meta + .card-line { margin-top: 6px; }
.msg .card-compact .card-text > .card-line:first-child { margin-top: 0; }
.msg .card-sub { margin: 4px 0 0; font: 400 15px/1.45 var(--sans); color: var(--muted); text-wrap: pretty; overflow-wrap: anywhere; }
.msg .card-underway .card-meta::before { background: var(--k-live); }
.msg .card-needs .card-meta::before { background: var(--accent); }
.msg .card-stuck .card-meta::before { background: #d0574c; }
.msg .card-thumb .shot img { width: 104px; height: 68px; object-fit: cover; border-radius: 8px; }
.msg.carded > .more { margin-top: 8px; }
.msg.carded .choice { margin-top: 10px; }
.choice { margin-top: 0.9em; padding: 0.85em 1em 0.95em; border-radius: 12px; background: var(--tint); animation: choice-in 380ms ease both; }
.choice-q { margin: 0 0 0.65em; font: 600 1.05em/1.35 var(--sans); color: var(--strong); text-wrap: pretty; overflow-wrap: anywhere; }
.choice-options { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 0.75em; }
.choice-option { font: 500 16px/1.3 var(--sans); color: var(--fg); background: var(--bg); border: 1px solid var(--faint); border-radius: 18px; padding: 9px 16px; cursor: pointer; text-align: left; transition: color 140ms ease, border-color 140ms ease; }
.choice-option:hover { color: var(--strong); border-color: var(--accent); }
.choice-option:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.choice-option:disabled { opacity: 0.5; cursor: default; }
.choice-option:disabled:hover { color: var(--fg); border-color: var(--faint); }
.choice-option[aria-pressed="true"], .choice-option[aria-pressed="true"]:hover { color: var(--bg); background: var(--accent); border-color: var(--accent); }
.choice-send { margin-bottom: 0.75em; }
.choice-free { display: flex; align-items: flex-end; gap: 8px; }
.choice-free[hidden] { display: none; }
.choice .reply-note { display: block; margin-top: 0.55em; }
/* Several questions, one at a time: where he is, the question, its answers; his answers listed before they go. */
.choice-q.choice-lead { margin-bottom: 0.4em; font-weight: 500; font-size: 0.95em; color: var(--muted); }
.stepper { display: grid; gap: 10px; line-height: 1.4; }
.step-count { margin: 0; font: 500 12px/1.3 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.step-q { margin: 0; font: 600 1.05em/1.35 var(--sans); color: var(--strong); text-wrap: pretty; overflow-wrap: anywhere; }
.step-options { display: flex; flex-wrap: wrap; gap: 8px; }
.scene-ask .step-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(11em, 1fr)); }
.choice-option[aria-pressed="true"] { color: var(--bg); background: var(--accent); border-color: var(--accent); }
.step-free { display: flex; align-items: flex-end; gap: 8px; }
.step-nav { display: flex; align-items: center; gap: 12px; }
.step-back { font: 500 15px/1 var(--sans); color: var(--muted); background: none; border: 0; padding: 8px 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.step-back:hover { color: var(--strong); }
.step-send { font: 700 12px/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--bg); background: var(--accent); border: 0; border-radius: 8px; padding: 12px 16px; cursor: pointer; }
.step-send:disabled, .step-back:disabled { opacity: .45; cursor: default; }
.step-review { margin: 0 0 4px; padding-left: 1.3em; display: grid; gap: 12px; }
.step-review-q { display: block; color: var(--fg); overflow-wrap: anywhere; }
.step-review-a { display: block; margin-top: 2px; font-weight: 600; color: var(--strong); overflow-wrap: anywhere; }
.stepper :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@keyframes choice-in { from { opacity: 0; } to { opacity: 1; } }
/* An answer Flyd gave for him by one of his standing rules: one quiet line,
   what it said and the rule it stands on, with Undo. Not his words, so no highlight. */
.msg.user.auto > .body { display: none; }
.auto-line { margin: 0; font: 400 0.92em/1.5 var(--sans); color: var(--muted); text-wrap: pretty; }
.auto-what { color: var(--fg); font-weight: 500; }
.auto-undo { margin-left: 0.5em; font: 500 1em/1 var(--sans); color: var(--accent); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.auto-undo:disabled { color: var(--muted); text-decoration: none; cursor: default; }
.auto-undo:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
@media (prefers-reduced-motion: reduce) { .choice { animation: none; } }
.sc-ask { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 0.5em; }
.sc-ask-input { flex: 1; min-width: 8em; font: 400 0.82em/1.4 var(--sans); color: var(--fg); background: var(--tint); border: 0; border-radius: 8px; padding: 8px 10px; resize: none; }
.sc-ask-input::placeholder { color: var(--muted); }
.sc-ask-send { font: 700 11px/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--bg); background: var(--accent); border: 0; border-radius: 8px; padding: 9px 12px; cursor: pointer; }
.sc-ask-send:disabled { opacity: 0.4; cursor: default; }
.sc-ask-receipt { flex-basis: 100%; font: 400 0.72em/1.4 var(--mono); color: var(--muted); }
@keyframes sc-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
@keyframes sc-pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--k) 8%, transparent); } }
@media (max-width: 560px) {
  .sc-group { grid-template-columns: minmax(0, 1fr); row-gap: 0.45em; }
}
@media (prefers-reduced-motion: reduce) { .sc-row, .sc-group.k-call .sc-row > .sc-led { animation: none; } }
.pill { font: 500 0.7em var(--mono); color: var(--muted); border: 1px solid var(--faint); border-radius: 999px; padding: 0.12em 0.6em; vertical-align: 0.12em; white-space: nowrap; }

.working { margin-top: 1em; }
.working[hidden] { display: none; }
.working .dots { height: 20px; display: flex; gap: 7px; align-items: center; }
.working i { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); animation: breathe 1.4s ease-in-out infinite; }
.working i:nth-child(2) { animation-delay: .18s; } .working i:nth-child(3) { animation-delay: .36s; }
@keyframes breathe { 0%, 100% { opacity: .25; } 50% { opacity: .9; } }

.jump {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  font: 500 12.5px/1 var(--mono); color: var(--bg); background: var(--fg); border: 0;
  border-radius: 999px; padding: 9px 14px; cursor: pointer; box-shadow: 0 6px 24px rgba(0,0,0,.25);
}
.jump[hidden] { display: none; }
body.can-send .jump { bottom: calc(110px + max(72px, 9vh)); font-size: 14px; }
.problem { position: fixed; right: 16px; bottom: 16px; font: 12px var(--mono); color: var(--muted); }

/* Summary view: a long reply leads with its plain-English summary; the full
   reply waits behind "more". Full view shows replies whole. */
.summary { color: var(--strong); }
.summary > :first-child { margin-top: 0; }
.summary > :last-child { margin-bottom: 0; }
.summary p { margin: 0 0 0.5em; }
.summary.pending::after, .compare.pending::after { content: "summarising…"; display: block; margin-top: 0.2em; font: 13px/1.3 var(--mono); color: var(--muted); }
.compare { margin-top: 0.5em; padding-left: 0.8em; color: var(--muted); font-size: 0.86em; }
.compare::before { content: "model"; display: block; font: 500 12px/1.6 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; }
.compare p { margin: 0; }
.more {
  display: inline-block; margin: 0.35em 0 0; padding: 2px 0; border: 0; background: none; cursor: pointer;
  font: 500 13px/1.4 var(--mono); color: var(--muted); letter-spacing: 0.02em;
}
.more:hover { color: var(--fg); }
.msg.has-summary > .body { margin-top: 0.7em; }
/* Routine chatter ("shipshape", "still waiting"): one quiet line. */
.msg.routine .body, .msg.routine .summary { color: var(--muted); font-size: 0.86em; }
:root:not([data-view="full"]) .msg.has-summary:not(.open) > .body { display: none; }
:root[data-view="full"] .msg.has-summary .more,
:root[data-view="full"] .msg.has-summary .compare,
:root[data-view="full"] .msg.has-summary:not([data-summary="author"]) .summary { display: none; }
:root[data-view="full"] .msg.has-summary:not([data-summary="author"]) > .body { margin-top: 0; }

/* Pasted images: thumbnails under the message, full size on click. */
.shots { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.45em; }
.shot { font: inherit; padding: 0; border: 1px solid var(--faint); border-radius: 0.25em; background: var(--tint); cursor: zoom-in; overflow: hidden; line-height: 0; }
.shot img { display: block; width: auto; height: auto; max-height: 9em; max-width: min(22em, calc(100vw - 3em)); }
.shot:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.reply-shots { margin: 0.55em 0 0.35em; }
.reply-shots .shot img { max-height: 16em; max-width: min(30em, calc(100vw - 3em)); }
.lightbox {
  position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, #000 82%, transparent); cursor: zoom-out; padding: 3vh 3vw;
}
.lightbox[hidden] { display: none; }
.lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }
.lightbox-nav { position: fixed; top: 50%; width: 36px; height: 36px; border: 0; border-radius: 50%; color: white; background: #222; cursor: pointer; }
.lightbox-prev { left: 18px; }
.lightbox-next { right: 18px; }

/* Pending: the captain's message is on its way to firstmate. */
/* Only his words dim while on their way; the living line stays fully legible. */
.msg.pending > :not(.queued) { opacity: 0.72; }
.msg.pending .body { white-space: pre-wrap; }
.msg.failed { opacity: 1; outline: 1px solid color-mix(in srgb, #d0574c 60%, transparent); cursor: pointer; }
.state { display: block; margin-top: 0.3em; font: 500 13px/1.3 var(--mono); color: var(--muted); }
.msg.failed .state { color: #d0574c; }
/* The optimistic copy's line is the same living line the delivered message keeps. */
.state.queued { display: flex; margin-top: 0.5em; font: 400 0.82em/1.45 var(--sans); color: var(--fg); }
.msg.failed .queued::before { animation: none; background: #d0574c; }
.msg.failed .state.queued { color: #d0574c; }
.msg.failed.pending > * { opacity: 1; }
.queued.still::before { animation: none; opacity: 0.5; }
.msg .resend { all: unset; cursor: pointer; font: 400 0.82em/1.45 var(--sans); color: var(--muted); text-decoration: underline; text-underline-offset: 2px; }
/* Firstmate's outcome, said in its own chat: the work is settled, so the dot rests. */
.queued.settled::before { animation: none; opacity: 0.5; }

.composer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 4;
  /* Lifted clear of the window's bottom edge. */
  padding: 1.6em 0 max(72px, 9vh);
  background: linear-gradient(to bottom, transparent, var(--bg) 1.4em);
  font-size: 0.8em;
}
.composer[hidden] { display: none; }
/* Stuck work Flyd could not settle: said plainly over the message box. */
.composer .unread {
  display: flex; align-items: flex-start; gap: 0.55em; margin: 0 0 0.6em -0.75em; padding: 0.5em 0.75em;
  border-radius: 0.4em; font: 500 0.82em/1.45 var(--sans); color: var(--k-waiting);
  background: color-mix(in srgb, var(--k-waiting) 14%, var(--bg));
}
.composer .unread::before { content: ""; flex: none; width: 0.42em; height: 0.42em; margin-top: 0.52em; border-radius: 50%; background: currentColor; }
.composer .unread[hidden] { display: none; }
`;

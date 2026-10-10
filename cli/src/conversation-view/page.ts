import { DOCUMENT_EXTENSIONS, MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "./firstmate-inbox.js";
import { escapeHtml } from "./markdown.js";
import { installComposerPredictions } from "./composer-predictions-client.js";
import { RECEIVED } from "./living.js";

// The whole page: one flat column, the captain's words and the replies, a
// slim header. Everything is inline (see the CSP in server.ts); the page
// fetches nothing but this server's own /api endpoints.

/** Colours, type and the slim header, shared with the taste page. */
export const BASE_STYLE = `
:root {
  --bg: #101113;
  --fg: #e4e2dc;
  --strong: #f6f4ef;
  --muted: #7c7f86;
  --faint: #25272b;
  --tint: #18191c;
  --accent: #e2b877;
  --link: #9cc3e6;
  --sel-bg: #5a4b36;
  --sel-fg: #fff6e6;
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Helvetica Neue", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  color-scheme: dark;
}
:root[data-theme="light"] {
  --bg: #f6f5f1;
  --fg: #2b2b2e;
  --strong: #111113;
  --muted: #8b8880;
  --faint: #e2e0d9;
  --tint: #ecebe5;
  --accent: #a4641c;
  --link: #1f5f99;
  --sel-bg: #d9c2a6;
  --sel-fg: #1a1206;
  color-scheme: light;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body {
  font: 400 27px/1.6 var(--sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-feature-settings: "kern", "liga";
}
/* One selection style; the captain's own words wear exactly the same colours. */
::selection { background: var(--sel-bg); color: var(--sel-fg); }

header {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 16px;
  height: 52px; padding: 0 24px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  font: 500 14px/1 var(--mono); letter-spacing: 0.02em; color: var(--muted);
}
.who { color: var(--accent); white-space: nowrap; }
.when { white-space: nowrap; font-variant-numeric: tabular-nums; }
/* One kind of control: a small text toggle. No borders; colour alone says
   which are on. */
header .controls { display: flex; align-items: center; gap: 4px; margin-left: 8px; }
header button {
  font: inherit; color: var(--muted); background: transparent; border: 0; border-radius: 6px;
  height: 28px; padding: 0 8px; cursor: pointer; white-space: nowrap; transition: color 140ms ease;
}
header button[aria-pressed="true"] { color: var(--accent); }
/* A switch: its word, then a small track whose knob and fill say on or off at a glance. */
header button[role="switch"] { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; }
header button[role="switch"] .track {
  position: relative; flex: none; width: 26px; height: 14px; border-radius: 7px;
  background: color-mix(in srgb, var(--muted) 34%, transparent); transition: background-color 180ms ease;
}
header button[role="switch"] .track::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--muted); transition: transform 220ms cubic-bezier(.3,1.4,.5,1), background-color 180ms ease;
}
header button[role="switch"][aria-checked="true"] { color: var(--strong); }
header button[role="switch"][aria-checked="true"] .track { background: var(--accent); }
header button[role="switch"][aria-checked="true"] .track::after { transform: translateX(12px); background: var(--bg); }
header .air { display: none; flex: 1; align-items: center; gap: 9px; min-width: 0; white-space: nowrap; }
header .air::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); opacity: 0.5; }
header .air.on { color: var(--k-live, var(--accent)); }
header .air.on::before { background: currentColor; opacity: 1; }
/* The session picker doubles as the title. */
header .picker { flex: 1; min-width: 0; display: flex; }
header select {
  font: inherit; color: var(--fg); background: transparent; border: 0; border-radius: 6px;
  height: 30px; padding: 0 20px 0 6px; margin-left: -6px; cursor: pointer; max-width: 100%;
  field-sizing: content;
  appearance: none; -webkit-appearance: none; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
  background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 11px) 13px, calc(100% - 7px) 13px; background-size: 4px 4px; background-repeat: no-repeat;
}
header select:hover { background-color: var(--tint); }
header select option { color: var(--fg); background: var(--bg); }
header button:hover { color: var(--fg); }
header button[aria-pressed="true"]:hover { color: color-mix(in srgb, var(--accent) 80%, var(--strong)); }
header button[role="switch"][aria-checked="true"]:hover { color: var(--strong); }
header :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
`;

/*
 * Artefact view: Flyd on TV. One scene holds the screen at a time: a big
 * headline in Flyd's words, the sentence that says what it means for him, and
 * the work's screenshot large beside it. The scenes take turns like title
 * cards, the calls only he can make first. Under them a row of small readouts
 * (weather, plan, the week, where the work stands) flickers in. Nothing framed:
 * colour, type and motion carry it. The conversation stays live underneath,
 * one switch away.
 */
const SHOW_STYLE = `
:root {
  --screen: #0a0b10;
  --display: "Helvetica Neue", Helvetica, -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
  --k-call: #ff5470;
  --k-live: #4cc3ff;
  --k-ready: #b693ff;
  --k-landed: #3fe394;
  --k-waiting: #ffc247;
  --k-next: #7c7f86;
  --k-news: #e4e2dc;
}
:root[data-theme="light"] {
  --screen: #f3f0e6;
  --k-call: #dc2449;
  --k-live: #0d72c4;
  --k-ready: #6c3fd6;
  --k-landed: #0f8c52;
  --k-waiting: #b56b00;
  --k-next: #8b8880;
  --k-news: #2b2b2e;
}
:root[data-screen="show"] main, :root[data-screen="show"] .jump, :root[data-screen="show"] .composer { display: none; }
:root[data-screen="show"] .problem { z-index: 7; }
/* The header stays: the same switches in both modes, over the screen. */
:root[data-screen="show"] header { z-index: 7; background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
:root[data-screen="show"] header .picker, :root[data-screen="show"] header #mode { display: none; }
:root[data-screen="show"] header .air { display: inline-flex; }

.show {
  position: fixed; inset: 0; z-index: 6; overflow: hidden;
  display: flex; flex-direction: column;
  padding: 52px clamp(28px, 6vw, 104px) 0;
  color: var(--fg); background: var(--screen);
}
.show[hidden] { display: none; }
.show.power { animation: show-in 320ms ease both; }
.show.off { animation: show-out 160ms ease both; }
@keyframes show-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes show-out { from { opacity: 1; } to { opacity: 0; } }
.show > * { width: 100%; max-width: 1480px; margin-left: auto; margin-right: auto; }

/* The stage: one scene, centred, the same room above and below it. */
.tv { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; justify-content: safe center; padding: clamp(20px, 5vh, 64px) 0; }
.scene { --k: var(--k-news); display: grid; grid-template-columns: minmax(0, 1fr); align-items: center; gap: clamp(36px, 4.5vw, 88px); }
.scene.has-shot { grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr); }
.scene-text { min-width: 0; }
.scene-head {
  margin: 0; max-width: 14em; font: 800 clamp(40px, 5.6vw, 96px)/1.02 var(--display); letter-spacing: -0.032em;
  color: var(--strong); text-wrap: balance; overflow-wrap: anywhere;
}
.scene-head.long { max-width: 18em; font-size: clamp(32px, 4vw, 64px); line-height: 1.06; letter-spacing: -0.026em; }
.scene.has-shot .scene-head { font-size: clamp(34px, 3.9vw, 66px); }
.scene.has-shot .scene-head.long { font-size: clamp(28px, 2.9vw, 46px); }
.scene-head[role="button"] { cursor: pointer; }
.scene-head[role="button"]:hover { color: color-mix(in srgb, var(--strong) 80%, var(--k)); }
.scene-head:focus-visible { outline: 2px solid var(--accent); outline-offset: 8px; border-radius: 6px; }
.scene-line { margin: 30px 0 0; max-width: 31em; font: 400 clamp(18px, 1.45vw, 23px)/1.5 var(--sans); color: var(--fg); text-wrap: pretty; overflow-wrap: anywhere; }
.scene-line:empty { display: none; }
.scene-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 22px; margin-top: 30px; font: 500 14px/1.3 var(--mono); color: var(--muted); }
.scene-meta .kind { font-size: 12px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--k); }
.scene-meta .project { color: var(--fg); }
.scene-meta a { color: var(--link); text-decoration: none; transition: color 140ms ease; }
.scene-meta a:hover { color: var(--strong); }
/* The screenshot at its own shape, as large as the stage allows: never cropped. */
.scene-shot { margin: 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.scene-shot .main {
  display: block; width: auto; height: auto; max-width: 100%; max-height: min(58vh, calc(100vh - 420px));
  min-height: 120px; object-fit: contain; border-radius: 10px; cursor: zoom-in;
}
.scene-shot .main.phone {
  box-sizing: border-box; border-radius: 38px; corner-shape: squircle; border: 5px solid #26292c;
  outline: 1px solid rgba(255,255,255,.16);
  box-shadow: 0 3px 7px rgba(0,0,0,.18), 0 18px 36px rgba(0,0,0,.24), 0 40px 72px rgba(0,0,0,.16);
}
.scene-answer { display: grid; gap: 12px; margin-top: 24px; max-width: 38em; }
.scene-answer .choices { display: flex; flex-wrap: wrap; gap: 8px; }
.scene-answer button, .scene-answer textarea { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--muted); border-radius: 18px; padding: 10px 16px; }
.scene-answer button { cursor: pointer; width: fit-content; }
.scene-answer button:disabled { opacity: .55; cursor: default; }
.scene-answer textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 76px; }
.scene-answer :focus-visible, .scene-shot img:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.scene-answer .receipt { font: 400 14px/1.5 var(--sans); color: var(--muted); }
.scene-shot .thumbs { display: flex; gap: 10px; }
.scene-shot .thumbs img {
  width: 72px; height: 46px; object-fit: contain; border-radius: 5px; cursor: pointer;
  opacity: 0.45; transition: opacity 140ms ease;
}
.scene-shot .thumbs img:hover, .scene-shot .thumbs img.on { opacity: 1; }

/* Title-card motion: the old scene lifts away, the new one rises in, headline first. */
.scene.out > * { animation: scene-out 220ms ease both; }
.scene.in .scene-head { animation: scene-in 620ms cubic-bezier(.16,1,.3,1) both; }
.scene.in .scene-line { animation: scene-in 620ms cubic-bezier(.16,1,.3,1) 90ms both; }
.scene.in .scene-meta { animation: scene-fade 520ms ease 180ms both; }
.scene.in .scene-shot { animation: shot-in 700ms cubic-bezier(.16,1,.3,1) 60ms both; }
@keyframes scene-out { to { opacity: 0; transform: translateY(-12px); } }
@keyframes scene-in { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: none; } }
@keyframes scene-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes shot-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: none; } }

/* Which scene is up, and how long until the next: one short line each. */
.ticks { display: flex; flex-wrap: wrap; gap: 10px; min-height: 14px; margin-bottom: clamp(28px, 5vh, 48px); }
.ticks[hidden] { display: none; }
.ticks button { position: relative; width: 30px; height: 14px; padding: 0; border: 0; background: none; cursor: pointer; }
.ticks button::before, .ticks button::after { content: ""; position: absolute; left: 0; top: 6px; height: 2px; border-radius: 1px; }
.ticks button::before { right: 0; background: var(--k); opacity: 0.3; }
.ticks button::after { width: 0; background: var(--k); }
.ticks button.on::after { width: 100%; transition: width var(--dwell, 9s) linear; }
.ticks button.on.held::after { transition: none; }
.ticks button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* The readouts: small, white, drawn rather than framed; each flickers in. */
.readouts { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 300px)); gap: 28px clamp(40px, 5vw, 80px); padding-bottom: 26px; }
.readouts:empty { display: none; }
.ro { min-width: 0; display: flex; flex-direction: column; gap: 9px; }
.ro-label { font: 500 11px/1.4 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.ro-value { font: 600 17px/1.25 var(--display); color: var(--strong); overflow-wrap: anywhere; }
.ro-cols { display: flex; align-items: flex-end; gap: 4px; height: 30px; }
.ro-cols { justify-content: space-between; }
.ro-cols i { flex: 0 1 6px; min-width: 2px; background: var(--strong); opacity: 0.85; border-radius: 1px; }
.ro-cols i.none { opacity: 0.18; }
.ro-cols i.wet { background: var(--k-live); opacity: 1; }
.ro-axis { display: flex; justify-content: space-between; gap: 4px; margin-top: -3px; font: 500 10px/1 var(--mono); color: var(--muted); }
.ro-axis span { flex: 0 1 6px; min-width: 0; display: flex; justify-content: center; white-space: nowrap; }
.ro-rows { display: flex; flex-direction: column; gap: 9px; }
.ro-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 12px; font: 500 12px/1.2 var(--mono); color: var(--muted); }
.ro-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ro-row b { font-weight: 600; color: var(--strong); font-variant-numeric: tabular-nums; }
.ro-row .track { grid-column: 1 / -1; height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--fg) 14%, transparent); overflow: hidden; }
.ro-row .track i { display: block; height: 100%; background: var(--strong); }
.ro-row.low .track i { background: var(--k-waiting); }
.ro-split { display: flex; gap: 3px; height: 4px; }
.ro-split i { min-width: 3px; border-radius: 2px; background: var(--k); }
.ro-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font: 500 12px/1.4 var(--mono); color: var(--muted); }
.ro-legend b { font-weight: 600; color: var(--k); }
.ro.flick { animation: flick 900ms steps(6, jump-none) both; animation-delay: var(--d, 0ms); }
@keyframes flick { 0% { opacity: 0; } 30% { opacity: 1; } 45% { opacity: 0.15; } 60%, 100% { opacity: 1; } }

/* The foot: what Flyd is doing, and how to talk to it. */
.foot { display: flex; align-items: center; justify-content: space-between; gap: 8px 24px; flex-wrap: wrap; padding-bottom: 24px; }
.foot .hint { font: 500 12px/1.4 var(--mono); color: var(--muted); }
.k-call { --k: var(--k-call); } .k-live { --k: var(--k-live); } .k-ready { --k: var(--k-ready); }
.k-landed { --k: var(--k-landed); } .k-waiting, .k-warn { --k: var(--k-waiting); } .k-next { --k: var(--k-next); }
.k-news, .k-clear { --k: var(--k-news); }
.doing { margin: 0; display: flex; align-items: center; gap: 10px; font: 500 13px/1.4 var(--mono); color: var(--muted); }
.doing::before { content: ""; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); opacity: 0.5; }
.doing.on { color: var(--k-live); }
.doing.on::before { background: var(--k-live); opacity: 1; animation: blink 1.6s steps(2, jump-none) infinite; }
@keyframes blink { 50% { opacity: 0.2; } }

/* A message opened from the artefact says where it is. */
.msg.spot { animation: spot 1.8s ease-out; }
@keyframes spot { 0%, 35% { background: color-mix(in srgb, var(--accent) 16%, transparent); box-shadow: 0 0 0 0.4em color-mix(in srgb, var(--accent) 16%, transparent); } 100% { background: transparent; box-shadow: 0 0 0 0.4em transparent; } }

@media (max-width: 900px) {
  .scene.has-shot { grid-template-columns: minmax(0, 1fr); gap: 28px; }
  .scene-shot { order: -1; }
  .scene-shot .main { max-height: 38vh; }
}
@media (max-height: 680px) {
  .scene-head, .scene.has-shot .scene-head { font-size: clamp(30px, 3.4vw, 48px); }
  .scene-head.long, .scene.has-shot .scene-head.long { font-size: clamp(24px, 2.6vw, 36px); }
  .scene-line { margin-top: 18px; }
  .scene-meta { margin-top: 18px; }
  .scene-shot .main, .scene.has-shot .scene-shot .main { max-height: 30vh; }
}
@media (max-width: 720px) {
  .show { overflow-y: auto; padding: 52px 20px 0; }
  .tv { flex: none; min-height: calc(100vh - 220px); padding: 28px 0 36px; }
  .scene-head, .scene.has-shot .scene-head { font-size: 34px; }
  .scene-head.long, .scene.has-shot .scene-head.long { font-size: 27px; }
  .scene-line { margin-top: 20px; font-size: 18px; }
  .scene-meta { margin-top: 20px; font-size: 13px; }
  .ticks { margin-bottom: 32px; }
  .readouts { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
  .foot .hint { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .show.power, .show.off, .scene.in > *, .scene.in .scene-head, .scene.in .scene-line, .scene.in .scene-meta, .scene.in .scene-shot,
  .scene.out > *, .ro.flick, .doing.on::before, .msg.spot { animation: none; }
  .ticks button.on::after { transition: none; }
}
`;

const STYLE = BASE_STYLE + `

/* ~66 characters a line at the reading size. */
/* The latest message sits just clear of the message box, never stranded above a sea of space. */
main { max-width: 36em; margin: 0 auto; padding: 1em 1.5em 12vh; }
body.can-send main { padding-bottom: calc(7.5em + max(72px, 9vh)); }
.empty { color: var(--muted); font: 15px var(--mono); text-align: center; margin-top: 30vh; }

.msg { position: relative; overflow-wrap: anywhere; }
.msg[data-day]::before {
  content: attr(data-day); display: block; margin: 2.4em 0 0.4em;
  font: 500 13px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
}
.msg.user { margin-top: 2em; }
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
.msg.assistant { margin-top: 0.85em; }
/* A question with no answer yet: one living line says what is happening to
   it, changing in place, until its answer appears right under it. */
/* Read at a glance: the message face, near body size, in full text colour. */
.queued { display: flex; align-items: center; gap: 0.55em; margin-top: 0.5em; font: 400 0.82em/1.45 var(--sans); color: var(--fg); }
.queued::before { content: ""; flex: none; width: 0.36em; height: 0.36em; border-radius: 50%; background: currentColor; animation: breathe 1.4s ease-in-out infinite; }
.queued.swap { animation: swap 280ms cubic-bezier(.2,.7,.2,1); }
@keyframes swap { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .queued::before, .queued.swap { animation: none; } }
/* Updates relayed from firstmate's own session: set apart, never read as an answer. */
.msg.aside { padding-left: 0.9em; border-left: 2px solid var(--faint); color: var(--muted); font-size: 0.92em; }
.aside-label { display: block; margin-bottom: 0.2em; font: 500 12px/1.6 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.msg.aside:not(.aside-first) .aside-label { display: none; }
.time {
  position: absolute; right: calc(100% + 2em); top: 0.55em; white-space: nowrap;
  font: 13px/1 var(--mono); color: var(--muted); opacity: 0; transition: opacity 140ms ease;
  font-variant-numeric: tabular-nums;
}
.msg:hover .time { opacity: 1; }
.msg.fresh { animation: rise 320ms cubic-bezier(.2,.7,.2,1); }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

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
.body blockquote { margin: 0 0 1em; padding: 0 0 0 1em; border-left: 2px solid var(--faint); color: var(--muted); }
.body hr { border: 0; border-top: 1px solid var(--faint); margin: 1.6em 0; }
.body table { border-collapse: collapse; width: 100%; margin: 0.4em 0 1.1em; font-size: 0.8em; display: block; overflow-x: auto; }
.body th { text-align: left; font: 500 0.82em var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.body th, .body td { padding: 0.45em 0.8em 0.45em 0; border-bottom: 1px solid var(--faint); vertical-align: top; }
/* A reply on several pieces of work, as Flyd shows it: grouped by what each
   asks of him, a coloured light per piece, the line itself opens the work.
   Flat, the artefact's colours; nothing framed. */
.status-card { margin: 1.3em 0 1.4em; display: flex; flex-direction: column; gap: 1.3em; }
.status-card:last-child { margin-bottom: 0; }
/* A rail: the state on the left, its work on the right, like a title card. */
.sc-group { --k: var(--k-news); display: grid; grid-template-columns: 7.2em minmax(0, 1fr); column-gap: 1.2em; align-items: baseline; }
.sc-group.k-call { --k: var(--k-call); }
.sc-group.k-live { --k: var(--k-live); }
.sc-group.k-landed { --k: var(--k-landed); }
.sc-kicker { margin: 0; padding-top: 0.15em; display: flex; gap: 0.7em; font: 600 11.5px/1.5 var(--mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--k); }
.sc-count { color: var(--muted); letter-spacing: 0; font-variant-numeric: tabular-nums; }
.sc-group ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.55em; }
.sc-row {
  display: flex; align-items: baseline; gap: 0.75em; margin: 0; padding: 0; line-height: 1.4;
  animation: sc-in 420ms cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i, 0) * 70ms + 60ms);
}
.sc-what { min-width: 0; flex: 1; display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 0.6em; }
.sc-led { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--k); transform: translateY(-0.12em); }
.sc-what .sc-led { align-self: center; transform: none; opacity: 0.5; transition: opacity 140ms ease; }
.sc-what .sc-led:hover, .sc-what .sc-led:focus-visible { opacity: 1; outline: 0; }
.sc-group.k-call .sc-row > .sc-led { box-shadow: 0 0 0 4px color-mix(in srgb, var(--k) 20%, transparent); animation: sc-pulse 2.4s ease-in-out infinite; }
.sc-text { color: var(--strong); text-decoration: none; transition: color 140ms ease; }
a.sc-text:hover, a.sc-text:focus-visible { color: var(--k); outline: 0; }
.sc-group.k-landed .sc-text { color: var(--fg); }
.sc-detail { flex-basis: 100%; margin-top: 0.1em; font-size: 0.86em; line-height: 1.4; color: var(--muted); }
.sc-project { margin-left: auto; font: 500 11px/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
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
/* What the assistant is doing now, small and quiet under the dots. */
.working .doing { display: block; margin-top: 0.3em; font: 13px/1.4 var(--mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.working .doing:empty { display: none; }
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
.compare { margin-top: 0.5em; padding-left: 0.8em; border-left: 2px solid var(--faint); color: var(--muted); font-size: 0.86em; }
.compare::before { content: "model"; display: block; font: 500 12px/1.6 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; }
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
.lightbox {
  position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, #000 82%, transparent); cursor: zoom-out; padding: 3vh 3vw;
}
.lightbox[hidden] { display: none; }
.lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }

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

.composer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 4;
  /* Lifted clear of the window's bottom edge. */
  padding: 1.6em 0 max(72px, 9vh);
  background: linear-gradient(to bottom, transparent, var(--bg) 1.4em);
  font-size: 0.8em;
}
.composer[hidden] { display: none; }
.composer .row {
  position: relative; max-width: calc(36em * 1.25); margin: 0 auto; padding: 0 1.875em;
}
.composer .field {
  display: flex; align-items: flex-end; gap: 0.6em;
  background: var(--tint); border-radius: 0.4em; padding: 0.5em 0.6em 0.5em 0.75em; margin-left: -0.75em;
  border: 0; transition: background-color 140ms ease;
}
/* No border (the captain asked); focus and state show as a change of fill. */
.composer .field:focus-within { background: color-mix(in srgb, var(--fg) 6%, var(--tint)); }
.composer textarea {
  flex: 1; min-width: 0; resize: none; border: 0; outline: 0; background: transparent;
  color: var(--fg); font: 400 1em/1.5 var(--sans); max-height: 38vh; padding: 0;
}
.composer textarea::placeholder { color: var(--muted); font-weight: 400; }
.composer .typing { flex: 1; min-width: 0; position: relative; }
.composer .typing textarea { display: block; width: 100%; box-sizing: border-box; }
.composer .prediction-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; white-space: pre-wrap; overflow-wrap: break-word; font: 400 1em/1.5 var(--sans); }
.composer .prediction-prefix { visibility: hidden; }
.composer .prediction-suffix { color: var(--muted); opacity: .65; }
.composer .prediction-toggle { background: transparent; color: var(--muted); padding: 8px 3px; font-size: 15px; font-weight: 400; }
.composer .prediction-toggle[aria-pressed="false"] { opacity: .4; }
.composer button {
  font: 800 14px/1 var(--mono); letter-spacing: -0.03em; text-transform: uppercase;
  color: var(--bg); background: var(--accent); border: 0;
  border-radius: 6px; padding: 9px 12px; cursor: pointer;
}
.composer button:disabled { opacity: 0.4; cursor: default; }
.attachments { display: flex; flex-wrap: wrap; gap: 0.5em; margin: 0 0 0.5em; }
.attachments[hidden] { display: none; }
.attachment { position: relative; line-height: 0; border: 1px solid var(--faint); border-radius: 6px; overflow: hidden; background: var(--tint); }
/* The whole picture, scaled to fit: cropping a wide screenshot left only a strip of it. */
.attachment img { display: block; width: auto; height: auto; max-width: 240px; max-height: 96px; }
.attachment button {
  position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; padding: 0; border-radius: 50%;
  font: 600 13px/22px var(--mono); color: var(--fg); background: color-mix(in srgb, var(--bg) 80%, transparent);
}
/* A dropped document: its kind and name, removable like a picture. */
.attachment.file { display: flex; align-items: center; gap: 0.5em; line-height: 1.2; padding: 8px 34px 8px 10px; max-width: 280px; }
.attachment.file .kind { font: 800 11px/1 var(--mono); color: var(--bg); background: var(--accent); border-radius: 3px; padding: 3px 4px; }
.attachment.file .name { font: 500 13px/1.3 var(--mono); color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.attachment.file button { top: 50%; transform: translateY(-50%); }
.docs { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.45em; }
.doc { display: inline-flex; align-items: center; gap: 0.45em; max-width: 100%; padding: 4px 8px; border: 1px solid var(--faint); border-radius: 0.25em; background: var(--tint); font: 500 13px/1.3 var(--mono); color: var(--fg); }
.doc .kind { font-weight: 800; color: var(--accent); }
.doc .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
/* After a restart: the box came back as he left it. */
.composer .hint[data-note]::before { content: attr(data-note) "   "; color: var(--accent); }
.composer.dropping .field { background: color-mix(in srgb, var(--accent) 16%, var(--tint)); }
.composer.dropping .hint::before { content: "drop to attach   "; color: var(--accent); }
/* Push-to-talk (Fn+Control in Flyd.app): the box shows it is listening. */
.composer.listening .field, .composer.transcribing .field { background: color-mix(in srgb, var(--accent) 12%, var(--tint)); }
.composer.listening .hint::before { content: "● listening   "; color: var(--accent); animation: breathe 1.4s ease-in-out infinite; }
.composer.transcribing .hint::before { content: "… writing it down   "; color: var(--accent); }
/* "/" lists the assistant's skills and commands, like Claude Code's prompt. */
.commands {
  position: absolute; left: 1.875em; right: 1.875em; bottom: calc(100% + 0.4em); z-index: 6;
  max-height: 46vh; overflow-y: auto; margin: 0 0 0 -0.75em; padding: 0.3em; list-style: none;
  background: var(--tint); border-radius: 0.4em; box-shadow: 0 10px 30px rgba(0,0,0,.35);
}
.commands[hidden] { display: none; }
.commands li { display: flex; gap: 0.9em; align-items: baseline; padding: 0.38em 0.6em; border-radius: 0.3em; cursor: pointer; }
.commands li.selected { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.commands .name { font: 500 0.82em var(--mono); color: var(--fg); white-space: nowrap; }
.commands .about { font-size: 0.66em; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.commands .none { font: 0.72em var(--mono); color: var(--muted); cursor: default; }
.composer .hint { margin-top: 0.45em; min-height: 1em; font: 12.5px/1 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

@media (max-width: 720px) {
  body { font-size: 20px; }
  main { padding: 1em 1em 12vh; }
  .composer .row { padding: 0 1.25em; }
  .composer .hint { display: none; }
  .time { display: none; }
  header .when { display: none; }
  header { gap: 10px; padding: 0 16px; }
  header .controls { margin-left: 0; gap: 0; }
  header button { padding: 0 6px; }
  header button[role="switch"] { gap: 5px; font-size: 11px; letter-spacing: 0.04em; }
  /* A phone keeps the light of "on air", not its words. */
  header .air { font-size: 0; gap: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .msg.fresh, .working i { animation: none; }
  html { scroll-behavior: auto; }
}
` + SHOW_STYLE;

// Core runs under tsx/esbuild with keepNames, so a function inlined with
// toString() can carry __name(...) calls; without this shim they throw and
// take the whole page script down.
const SCRIPT = `
var __name = function (f) { return f; };
(function () {
  var main = document.getElementById("stream");
  var working = document.getElementById("working");
  var doing = document.getElementById("doing");
  var jump = document.getElementById("jump");
  var whenEl = document.getElementById("when");
  var picker = document.getElementById("picker");
  var themeBtn = document.getElementById("theme");
  var problem = document.getElementById("problem");
  var nodes = new Map();
  var source = null;
  var current = null;
  var explicit = new URLSearchParams(location.search).get("session");
  var lastActivity = null;
  var isWorking = false;
  var first = true;
  var awaiting = new Set();
  var latestSession = null;
  var warnings = new Map();
  var SEND_TOKEN = document.body.dataset.sendToken || "";
  var VIEW_TOKEN = SEND_TOKEN;
  var assistant = document.title || "the assistant";

  function store(key, value) {
    try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeBtn.setAttribute("aria-checked", String(theme === "light"));
    // Inside Flyd.app the window's title bar follows the page.
    try { window.webkit.messageHandlers.flyd.postMessage({ theme: theme }); } catch (e) { /* in a browser */ }
  }
  applyTheme(store("flyd-view-theme") === "light" ? "light" : "dark");
  var modeBtn = document.getElementById("mode");
  // One switch, FULL: off is Flyd's reading of every reply, on is everything as it was written.
  function applyMode(mode) {
    document.documentElement.setAttribute("data-view", mode);
    modeBtn.setAttribute("aria-checked", String(mode === "full"));
  }
  applyMode(store("flyd-view-mode") === "full" ? "full" : "summary");
  modeBtn.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-view") === "full" ? "summary" : "full";
    store("flyd-view-mode", next);
    // The heights change everywhere: stay on the latest message, or on the one he was reading.
    keepPlace(function () { applyMode(next); });
  });
  document.getElementById("taste-link").addEventListener("click", function () { location.href = "/taste?token=" + encodeURIComponent(VIEW_TOKEN); });
  themeBtn.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    store("flyd-view-theme", next);
    applyTheme(next);
  });

  function clock(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function dayOf(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  }
  function nearBottom() {
    return document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 160;
  }
  // Pinned: he is reading the latest message, so whatever changes keeps him
  // there. Only his own scrolling up unpins it.
  var pinned = true;
  function onConversation() { return document.documentElement.getAttribute("data-screen") !== "show"; }
  function toBottom() { pinned = true; window.scrollTo(0, document.documentElement.scrollHeight); }
  // The message at the top of the window and where it sits, so a change above
  // it cannot move what he is reading (WebKit has no scroll anchoring).
  function anchor() {
    var list = main.querySelectorAll(".msg");
    for (var i = 0; i < list.length; i += 1) {
      var box = list[i].getBoundingClientRect();
      if (box.height > 0 && box.bottom > 64) return { node: list[i], top: box.top };
    }
    return null;
  }
  function restore(at) {
    if (!at || !at.node.isConnected) return;
    var box = at.node.getBoundingClientRect();
    if (box.height > 0) window.scrollBy(0, box.top - at.top);
  }
  function keepPlace(change) {
    if (!onConversation()) { change(); return; }
    var wasPinned = pinned;
    var at = wasPinned ? null : anchor();
    change();
    if (wasPinned) toBottom(); else restore(at);
  }

  function build(message) {
    var el = document.createElement("article");
    el.className = "msg " + message.role;
    var time = document.createElement("span");
    time.className = "time";
    el.appendChild(time);
    var body = document.createElement("div");
    body.className = "body";
    el.appendChild(body);
    return el;
  }
  var BLOCK = /^(UL|OL|P|PRE|BLOCKQUOTE|TABLE|DIV|H[1-6]|HR)$/;
  // Wraps each run of inline content in a block in span.hl, so the captain's
  // words are highlighted line by line, the way a text selection is.
  function highlight(body) {
    body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, td, th").forEach(function (block) {
      var run = [];
      function flush() {
        if (!run.length) return;
        var text = run.map(function (n) { return n.textContent; }).join("");
        if (text.trim()) {
          var span = document.createElement("span");
          span.className = "hl";
          block.insertBefore(span, run[0]);
          run.forEach(function (n) { span.appendChild(n); });
        }
        run = [];
      }
      Array.prototype.slice.call(block.childNodes).forEach(function (node) {
        if (node.nodeType === 1 && BLOCK.test(node.tagName)) flush(); else run.push(node);
      });
      flush();
    });
  }
  function fill(el, message) {
    el.dataset.ts = message.timestamp || "";
    el.firstChild.textContent = message.timestamp ? clock(message.timestamp) : "";
    var body = el.querySelector(".body");
    body.innerHTML = message.html;
    if (message.role === "user") highlight(body);
    var old = el.querySelector(".shots");
    if (old) old.remove();
    var oldDocs = el.querySelector(".docs");
    if (oldDocs) oldDocs.remove();
    if (message.files && message.files.length) body.after(docs(message.files));
    if (message.images && message.images.length) {
      body.after(shots(message.images.map(function (id) {
        return "/api/image?session=" + encodeURIComponent(current || "") + "&id=" + encodeURIComponent(id);
      })));
    }
    pairing(el, message);
    if (message.role === "assistant") {
      el.classList.toggle("routine", !!message.routine);
      // Something to act on (rules to paste, steps) shows whole until he folds it.
      if (message.expanded && !el.dataset.folded) el.classList.add("open");
      summarize(el, message);
    }
    if (warnings.has(message.id)) showWarning(el, warnings.get(message.id));
  }
  // A question waits for its own answer; firstmate's session lines are relayed updates.
  function pairing(el, message) {
    var queued = el.querySelector(":scope > .queued");
    if (!message.waiting) { if (queued) queued.remove(); }
    else if (!queued) {
      queued = document.createElement("span");
      queued.className = "queued";
      queued.setAttribute("role", "status");
      // Picks up where the optimistic copy's line left off: no jump.
      queued.textContent = carried.get(message.id) || message.waiting;
      carried.delete(message.id);
      el.appendChild(queued);
      living(queued, message.waiting);
    } else living(queued, message.waiting);
    if (queued && message.waiting) queued.classList.toggle("still", !!message.waitingFailed);
    el.classList.toggle("answer", !!message.answers);
    el.classList.toggle("aside", !!message.aside);
    var label = el.querySelector(":scope > .aside-label");
    if (label) label.remove();
    if (message.aside) {
      label = document.createElement("span");
      label.className = "aside-label";
      label.textContent = "update";
      el.insertBefore(label, el.querySelector(".body"));
    }
  }
  function summarize(el, message) {
    ["summary", "compare", "more"].forEach(function (name) {
      var old = el.querySelector(":scope > ." + name);
      if (old) old.remove();
    });
    el.classList.toggle("has-summary", !!message.summary);
    if (!message.summary) { delete el.dataset.summary; return; }
    el.dataset.summary = message.summary.source;
    var body = el.querySelector(".body");
    var summary = document.createElement("div");
    summary.className = "summary" + (message.summary.pending ? " pending" : "");
    summary.innerHTML = message.summary.html;
    el.insertBefore(summary, body);
    if (message.compare) {
      var compare = document.createElement("div");
      compare.className = "compare" + (message.compare.pending ? " pending" : "");
      compare.innerHTML = message.compare.html;
      el.insertBefore(compare, body);
    }
    var more = document.createElement("button");
    // Flyd's whole reading already leads; what waits behind it is the reply as firstmate wrote it.
    var word = message.summary.source === "brief" ? "as written" : "more";
    more.type = "button";
    more.className = "more";
    more.textContent = el.classList.contains("open") ? "less" : word;
    more.setAttribute("aria-expanded", el.classList.contains("open") ? "true" : "false");
    more.addEventListener("click", function () {
      pinned = false;
      var open = el.classList.toggle("open");
      if (!open) el.dataset.folded = "1";
      more.textContent = open ? "less" : word;
      more.setAttribute("aria-expanded", open ? "true" : "false");
    });
    el.insertBefore(more, body);
  }
  function shots(urls) {
    var row = document.createElement("div");
    row.className = "shots";
    urls.forEach(function (url) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "shot";
      button.setAttribute("aria-label", "Open image");
      var img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = url;
      button.appendChild(img);
      button.addEventListener("click", function () { openImage(url); });
      row.appendChild(button);
    });
    return row;
  }
  function fileKind(name) {
    var dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toUpperCase() : "FILE";
  }
  function docs(names) {
    var row = document.createElement("div");
    row.className = "docs";
    names.forEach(function (name) {
      var chip = document.createElement("span");
      chip.className = "doc";
      chip.title = name;
      var kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = fileKind(name);
      var label = document.createElement("span");
      label.className = "name";
      label.textContent = name;
      chip.appendChild(kind);
      chip.appendChild(label);
      row.appendChild(chip);
    });
    return row;
  }
  var lightbox = document.getElementById("lightbox");
  function openImage(url) {
    document.getElementById("lightbox-img").src = url;
    lightbox.hidden = false;
  }
  lightbox.addEventListener("click", function () { lightbox.hidden = true; });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") lightbox.hidden = true; });

  // A sent note that was saved but did not wake firstmate says so.
  function showWarning(el, text) {
    if (el.querySelector(".state")) return;
    var state = document.createElement("span");
    state.className = "state";
    state.textContent = text;
    el.appendChild(state);
  }

  // The one line under his newest message changes in place, with a calm
  // swap, never growing into a log.
  var carried = new Map();
  function living(line, text) {
    if (line.textContent === text) return;
    line.textContent = text;
    line.classList.remove("swap");
    void line.offsetWidth;
    line.classList.add("swap");
  }
  function refreshWorking() {
    var recent = lastActivity && Date.now() - new Date(lastActivity).getTime() < 10 * 60 * 1000;
    // While his newest message's own line says what is happening, the dots would only repeat it.
    var shown = main.querySelectorAll(".msg");
    var last = shown[shown.length - 1];
    var speaking = !!(last && last.querySelector(":scope > .queued:not(.still)"));
    working.hidden = !(isWorking && recent) || speaking;
  }
  setInterval(refreshWorking, 15000);

  function apply(update) {
    var stick = first || pinned;
    var at = stick || !onConversation() ? null : anchor();
    var added = false;
    update.messages.forEach(function (message) {
      var el = nodes.get(message.id);
      if (!el) {
        el = build(message);
        nodes.set(message.id, el);
        // A message the page already showed optimistically arrives quietly.
        if (!first && !awaiting.has(message.id)) { el.classList.add("fresh"); added = true; }
      }
      fill(el, message);
    });
    main.querySelectorAll(".msg.pending").forEach(function (el) {
      if (el.dataset.wait && update.order.indexOf(el.dataset.wait) !== -1) { awaiting.delete(el.dataset.wait); el.remove(); }
    });
    var keep = new Set(update.order);
    nodes.forEach(function (el, id) { if (!keep.has(id)) { el.remove(); nodes.delete(id); } });
    var cursor = main.firstElementChild;
    var day = "";
    var previous = null;
    update.order.forEach(function (id) {
      var el = nodes.get(id);
      if (el !== cursor) main.insertBefore(el, cursor); else cursor = cursor.nextElementSibling;
      el.classList.toggle("aside-first", el.classList.contains("aside") && !(previous && previous.classList.contains("aside")));
      previous = el;
      // A reply sits under its question, whenever it was written: no day marker of its own.
      var d = el.dataset.ts && !el.classList.contains("answer") ? dayOf(el.dataset.ts) : "";
      if (d && d !== day) { el.dataset.day = d; day = d; } else { delete el.dataset.day; }
    });
    main.querySelectorAll(".msg.pending").forEach(function (el) { main.appendChild(el); });
    main.appendChild(working);
    document.getElementById("empty").hidden = update.order.length > 0 || !!main.querySelector(".msg.pending");
    isWorking = update.working;
    doing.textContent = update.working && update.activity ? update.activity : "";
    if (update.context) { usage.context = update.context; renderUsage(); }
    lastActivity = update.lastActivity || lastActivity;
    refreshWorking();
    if (lastActivity) whenEl.textContent = dayOf(lastActivity) + "  " + clock(lastActivity);
    if (!onConversation()) { /* the terminal is hidden; it finds its place when it comes back */ }
    else if (stick) { toBottom(); jump.hidden = true; } else { restore(at); if (added) jump.hidden = false; }
    first = false;
    if (update.show) renderShow(update.show, update.boxes);
  }

  // Under the message box: how full the context is, and the plan's limits.
  var usageEl = document.getElementById("usage");
  var usage = { context: null, plan: null };
  function compact(n) {
    return n >= 1000000 ? (Math.round(n / 100000) / 10) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
  }
  function renderUsage() {
    var parts = [];
    if (usage.context) {
      var c = usage.context;
      parts.push("context " + Math.round((c.tokens / c.window) * 100) + "% · " + compact(c.tokens) + " of " + compact(c.window));
    }
    if (usage.plan) {
      usage.plan.windows.forEach(function (w) {
        parts.push(w.label + " " + Math.round(w.percentRemaining) + "% left" + (w.resetsAt ? ", resets " + dayOf(w.resetsAt) + " " + clock(w.resetsAt) : ""));
      });
    }
    usageEl.textContent = parts.join("   ·   ");
  }
  function loadPlan() {
    fetch("/api/plan").then(function (r) { return r.json(); }).then(function (data) { usage.plan = data.plan; renderUsage(); }).catch(function () {});
  }
  loadPlan();
  setInterval(loadPlan, 60000);

  function reset() {
    nodes.forEach(function (el) { el.remove(); });
    nodes.clear();
    usage.context = null;
    renderUsage();
    // Optimistic copies belong to the session they were sent from.
    main.querySelectorAll(".msg.pending").forEach(function (el) { el.remove(); });
    awaiting.clear();
    carried.clear();
    first = true;
    jump.hidden = true;
  }

  function connect(sessionId) {
    if (!VIEW_TOKEN) return;
    if (typingPredictions) typingPredictions.reset();
    if (source) source.close();
    reset();
    var streamQuery = "?token=" + encodeURIComponent(VIEW_TOKEN) + (sessionId ? "&session=" + encodeURIComponent(sessionId) : "");
    source = new EventSource("/api/stream" + streamQuery);
    source.addEventListener("session", function (event) {
      var session = JSON.parse(event.data);
      if (current !== session.id && typingPredictions) typingPredictions.reset();
      current = session.id;
      assistant = session.assistantLabel;
      document.title = session.title + " · " + session.assistantLabel;
      if (picker.value !== session.id) loadSessions();
    });
    source.addEventListener("update", function (event) { problem.textContent = ""; apply(JSON.parse(event.data)); });
    source.addEventListener("problem", function (event) { problem.textContent = JSON.parse(event.data).error; });
    source.onerror = function () { problem.textContent = "reconnecting…"; };
    source.onopen = function () { problem.textContent = ""; };
  }

  function loadSessions() {
    return fetch("/api/sessions").then(function (r) { return r.json(); }).then(function (data) {
      var sessions = data.sessions || [];
      latestSession = sessions.length ? sessions[0].id : null;
      picker.textContent = "";
      sessions.forEach(function (session, index) {
        var option = document.createElement("option");
        option.value = session.id;
        option.textContent = session.title + (index === 0 ? "" : "  ·  " + dayOf(session.updatedAt));
        picker.appendChild(option);
      });
      if (current) picker.value = current;
      return sessions;
    });
  }

  picker.addEventListener("change", function () {
    explicit = picker.value;
    history.replaceState(null, "", "?session=" + encodeURIComponent(explicit));
    connect(explicit);
  });

  // Without an explicit pick, follow whichever session is newest (a /clear
  // in Claude Code starts a new transcript file).
  setInterval(function () {
    if (explicit) return;
    loadSessions().then(function (sessions) {
      if (sessions.length && current && sessions[0].id !== current) connect(null);
    }).catch(function () {});
  }, 5000);

  window.addEventListener("scroll", function () {
    if (!onConversation()) return;
    pinned = nearBottom();
    if (pinned) jump.hidden = true;
  }, { passive: true });
  // A picture loading or a summary landing grows the page: a pinned reader stays on the latest.
  if (window.ResizeObserver) new ResizeObserver(function () { if (pinned && onConversation()) toBottom(); }).observe(main);
  jump.addEventListener("click", function () { toBottom(); jump.hidden = true; });

  // Composer: shown only when the server can deliver the captain's words.
  var composer = document.getElementById("composer");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  if (SEND_TOKEN) {
    composer.hidden = false;
    document.body.classList.add("can-send");
  }
  var attachmentsEl = document.getElementById("attachments");
  var attachments = [];
  var MAX_ATTACHMENTS = 4;
  function grow() {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
    sendBtn.disabled = !input.value.trim() && attachments.length === 0;
    saveDraft();
  }
  // The box is never lost: its words, caret and attachments are kept on every
  // change, in this page's storage and in Core, and come back when the window
  // does (an update, a reinstall, a restarted view). Only sending it or
  // emptying the box clears it.
  var DRAFT_KEY = explicit || "latest";
  var DRAFT_STORE = "flyd-view-draft:" + DRAFT_KEY;
  var draftTimer = null;
  var restoring = false;
  var sendsInFlight = 0;
  function draftState() {
    // Paging through earlier messages shows them in the box; the draft is what he had typed.
    var recalling = recall.index !== -1;
    var text = recalling ? recall.draft : input.value;
    return {
      text: text,
      selectionStart: recalling ? text.length : input.selectionStart,
      selectionEnd: recalling ? text.length : input.selectionEnd,
      attachments: attachments.filter(function (a) { return a.draftId; }).map(function (a) {
        return a.name ? { id: a.draftId, name: a.name } : { id: a.draftId, mediaType: a.mediaType };
      }),
      savedAt: Date.now(),
    };
  }
  function saveDraftNow(keepalive) {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!SEND_TOKEN || restoring) return;
    // A message on its way keeps its draft until it has landed.
    if (sendsInFlight > 0 && !input.value && !attachments.length) return;
    var state = draftState();
    store(DRAFT_STORE, JSON.stringify(state));
    authed("/api/draft", { method: "POST", keepalive: !!keepalive, headers: { "content-type": "application/json" }, body: JSON.stringify({ key: DRAFT_KEY, draft: state }) }, true)
      .catch(function () { /* the page's own copy holds it until the next change */ });
  }
  function saveDraft() {
    if (!SEND_TOKEN || draftTimer) return;
    draftTimer = setTimeout(saveDraftNow, 300);
  }
  document.addEventListener("selectionchange", function () { if (document.activeElement === input) saveDraft(); });
  window.addEventListener("pagehide", function () { if (draftTimer) saveDraftNow(true); });
  // A token from before the view restarted is swapped for the current one, once.
  function authed(path, init, retry) {
    var headers = Object.assign({}, init.headers || {}, { "x-flyd-view-token": SEND_TOKEN });
    return fetch(path, Object.assign({}, init, { headers: headers })).then(function (response) {
      if (response.status !== 403 || !retry) return response;
      return fetch("/api/token").then(function (r) { return r.json(); }).then(function (data) {
        if (!data.token) return response;
        SEND_TOKEN = data.token;
        return authed(path, init, false);
      });
    });
  }
  // Each attachment's bytes go to Core once, as it is added; the draft names it.
  function keepAttachment(attachment) {
    var body = attachment.name ? { name: attachment.name, data: attachment.data } : { mediaType: attachment.mediaType, data: attachment.data };
    authed("/api/draft/attachment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, true)
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (stored) {
        if (!stored || !stored.id || attachments.indexOf(attachment) === -1) return;
        attachment.draftId = stored.id;
        saveDraft();
      })
      .catch(function () { /* kept in the box; only a restart would lose it */ });
  }
  function draftNote(text) {
    var hint = document.getElementById("usage");
    function clear() { hint.removeAttribute("data-note"); input.removeEventListener("input", clear); }
    hint.setAttribute("data-note", text);
    input.addEventListener("input", clear);
    setTimeout(clear, 15000);
  }
  function restoreDraft() {
    if (!SEND_TOKEN) return;
    var local = null;
    try { local = JSON.parse(store(DRAFT_STORE) || "null"); } catch (e) { local = null; }
    restoring = true;
    authed("/api/draft?key=" + encodeURIComponent(DRAFT_KEY), { method: "GET" }, true)
      .then(function (response) { return response.ok ? response.json() : {}; })
      .catch(function () { return {}; })
      .then(function (data) {
        restoring = false;
        // Whatever he has started since the window opened wins.
        if (input.value || attachments.length || voiceBase !== null) {
          if (input.value || attachments.length) saveDraftNow();
          return;
        }
        var kept = data && data.draft && typeof data.draft.text === "string" ? data.draft : null;
        var newer = local && typeof local.text === "string" && (!kept || local.savedAt > kept.savedAt) ? local : kept;
        if (!newer) return;
        var ids = (newer.attachments || []).map(function (a) { return a.id; });
        var restored = (kept ? kept.attachments : []).filter(function (a) { return ids.indexOf(a.id) !== -1; }).map(function (a) {
          return a.name
            ? { name: a.name, data: a.data, draftId: a.id }
            : { url: "data:" + a.mediaType + ";base64," + a.data, mediaType: a.mediaType, data: a.data, draftId: a.id };
        }).slice(0, MAX_ATTACHMENTS);
        if (!newer.text && !restored.length) return;
        input.value = newer.text;
        attachments = restored;
        renderAttachments();
        try { input.setSelectionRange(newer.selectionStart, newer.selectionEnd); } catch (e) { /* caret at the end */ }
        draftNote("your draft is safe");
      });
  }
  var typingPredictions = (${installComposerPredictions.toString()})({
    input: input, composer: composer, layer: document.getElementById("prediction-layer"),
    prefix: document.getElementById("prediction-prefix"), suffix: document.getElementById("prediction-suffix"), toggle: document.getElementById("prediction-toggle"),
    session: function () { return current; }, token: function () { return SEND_TOKEN; }, grow: grow,
    attached: function () { return attachments.length > 0 || composer.classList.contains("listening") || composer.classList.contains("transcribing"); }
  });
  function renderAttachments() {
    if (typingPredictions) typingPredictions.reset();
    attachmentsEl.textContent = "";
    attachments.forEach(function (attachment, index) {
      var item = document.createElement("div");
      item.className = attachment.name ? "attachment file" : "attachment";
      if (attachment.name) {
        item.title = attachment.name;
        var kind = document.createElement("span");
        kind.className = "kind";
        kind.textContent = fileKind(attachment.name);
        var label = document.createElement("span");
        label.className = "name";
        label.textContent = attachment.name;
        item.appendChild(kind);
        item.appendChild(label);
      } else {
        var img = document.createElement("img");
        img.src = attachment.url;
        img.alt = "";
        item.appendChild(img);
      }
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", attachment.name ? "Remove " + attachment.name : "Remove image");
      remove.addEventListener("click", function () { attachments.splice(index, 1); renderAttachments(); });
      item.appendChild(remove);
      attachmentsEl.appendChild(item);
    });
    attachmentsEl.hidden = attachments.length === 0;
    grow();
  }
  // Screenshots go as images; documents (a PDF, a Word file, notes) as files under their own names.
  var DOCUMENTS = ${JSON.stringify(DOCUMENT_EXTENSIONS)};
  var MAX_IMAGE_BYTES = ${MAX_IMAGE_BYTES};
  var MAX_FILE_BYTES = ${MAX_FILE_BYTES};
  var IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  function addFiles(files) {
    var refused = [];
    Array.prototype.forEach.call(files, function (file) {
      if (!file) return;
      var image = IMAGE_TYPES.indexOf(file.type) !== -1;
      var ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
      if (!image && (file.name.indexOf(".") === -1 || DOCUMENTS.indexOf(ext) === -1)) { refused.push(file.name + ": not a document Flyd can pass on"); return; }
      if (file.size > (image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES)) { refused.push(file.name + ": over " + Math.round((image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES) / 1048576) + "MB"); return; }
      if (attachments.length >= MAX_ATTACHMENTS) { refused.push(file.name + ": " + MAX_ATTACHMENTS + " attachments at most"); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var url = String(reader.result);
        if (attachments.length >= MAX_ATTACHMENTS) return;
        var data = url.slice(url.indexOf(",") + 1);
        var attachment = image ? { url: url, mediaType: file.type, data: data } : { name: file.name, data: data };
        attachments.push(attachment);
        renderAttachments();
        keepAttachment(attachment);
      };
      reader.readAsDataURL(file);
    });
    if (refused.length) problem.textContent = refused.join(" · ");
  }
  input.addEventListener("paste", function (event) {
    var files = Array.prototype.map.call((event.clipboardData && event.clipboardData.items) || [], function (item) {
      return item.kind === "file" ? item.getAsFile() : null;
    }).filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  });
  // Images and documents can be dropped anywhere on the page; a stray drop never navigates away.
  document.addEventListener("dragover", function (event) {
    if (composer.hidden) return;
    event.preventDefault();
    composer.classList.add("dropping");
  });
  document.addEventListener("dragleave", function (event) {
    if (!event.relatedTarget) composer.classList.remove("dropping");
  });
  document.addEventListener("drop", function (event) {
    if (composer.hidden) return;
    event.preventDefault();
    composer.classList.remove("dropping");
    if (event.dataTransfer) addFiles(event.dataTransfer.files);
  });
  input.addEventListener("input", grow);
  // Terminal-style history: Up on the first line recalls earlier messages,
  // newest first; Down walks back and finally restores the draft.
  var recall = { list: [], index: -1, draft: "" };
  function captainHistory() {
    var list = [];
    main.querySelectorAll(".msg.user .body").forEach(function (body) {
      var text = (body.innerText || body.textContent || "").trim();
      if (text && text !== list[list.length - 1]) list.push(text);
    });
    return list;
  }
  function setRecalled(text) {
    typingPredictions.reset();
    input.value = text;
    grow();
    input.setSelectionRange(text.length, text.length);
  }
  // "/" at the start of the box: the assistant's skills and commands.
  var commandsEl = document.getElementById("commands");
  var commandList = null;
  var commandMatches = [];
  var commandIndex = 0;
  function loadCommands() {
    if (commandList) return Promise.resolve(commandList);
    return fetch("/api/commands").then(function (r) { return r.json(); }).then(function (data) {
      commandList = data.commands || [];
      return commandList;
    }).catch(function () { return []; });
  }
  function closeCommands() {
    commandsEl.hidden = true;
    commandMatches = [];
  }
  function renderCommands() {
    commandsEl.textContent = "";
    if (!commandMatches.length) {
      var none = document.createElement("li");
      none.className = "none";
      none.textContent = "No skill or command matches " + input.value;
      commandsEl.appendChild(none);
      return;
    }
    commandMatches.forEach(function (command, index) {
      var item = document.createElement("li");
      item.setAttribute("role", "option");
      item.className = index === commandIndex ? "selected" : "";
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = "/" + command.name;
      var about = document.createElement("span");
      about.className = "about";
      about.textContent = command.description;
      item.appendChild(name);
      item.appendChild(about);
      item.addEventListener("mousedown", function (event) { event.preventDefault(); chooseCommand(index); });
      commandsEl.appendChild(item);
    });
    var selected = commandsEl.children[commandIndex];
    if (selected && selected.scrollIntoView) selected.scrollIntoView({ block: "nearest" });
  }
  function updateCommands() {
    var typed = /^\\/([\\w:.-]*)$/.exec(input.value);
    if (!typed) { closeCommands(); return; }
    var query = typed[1].toLowerCase();
    loadCommands().then(function (list) {
      if (!/^\\/([\\w:.-]*)$/.test(input.value)) return;
      var starts = list.filter(function (c) { return c.name.toLowerCase().indexOf(query) === 0; });
      var contains = list.filter(function (c) { return c.name.toLowerCase().indexOf(query) > 0; });
      commandMatches = starts.concat(contains).slice(0, 50);
      commandIndex = 0;
      commandsEl.hidden = false;
      renderCommands();
    });
  }
  function chooseCommand(index) {
    var command = commandMatches[index];
    if (!command) return;
    typingPredictions.reset();
    input.value = "/" + command.name + " ";
    closeCommands();
    grow();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  input.addEventListener("input", updateCommands);
  input.addEventListener("blur", function () { setTimeout(closeCommands, 150); });

  input.addEventListener("keydown", function (event) {
    if (event.isComposing) return;
    if (!commandsEl.hidden) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (commandMatches.length) {
          commandIndex = (commandIndex + (event.key === "ArrowDown" ? 1 : commandMatches.length - 1)) % commandMatches.length;
          renderCommands();
        }
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && commandMatches.length) {
        event.preventDefault();
        chooseCommand(commandIndex);
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); closeCommands(); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); return; }
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    var value = input.value;
    if (event.key === "ArrowUp") {
      var onFirstLine = value.lastIndexOf("\\n", input.selectionStart - 1) === -1;
      if (!onFirstLine) return;
      if (recall.index === -1) {
        recall.list = captainHistory();
        if (!recall.list.length) return;
        recall.draft = value;
        recall.index = recall.list.length;
      }
      if (recall.index === 0) { event.preventDefault(); return; }
      event.preventDefault();
      recall.index -= 1;
      setRecalled(recall.list[recall.index]);
    } else if (event.key === "ArrowDown") {
      if (recall.index === -1) return;
      var onLastLine = value.indexOf("\\n", input.selectionEnd) === -1;
      if (!onLastLine) return;
      event.preventDefault();
      recall.index += 1;
      if (recall.index >= recall.list.length) {
        recall.index = -1;
        setRecalled(recall.draft);
      } else {
        setRecalled(recall.list[recall.index]);
      }
    }
  });
  // Editing a recalled message makes it the draft.
  input.addEventListener("input", function () { recall.index = -1; });

  function pendingMessage(text, sending) {
    var el = document.createElement("article");
    el.className = "msg user pending fresh";
    var time = document.createElement("span");
    time.className = "time";
    el.appendChild(time);
    var body = document.createElement("div");
    body.className = "body";
    var hl = document.createElement("span");
    hl.className = "hl";
    hl.textContent = text;
    if (text) body.appendChild(hl);
    el.appendChild(body);
    var images = sending.filter(function (attachment) { return !attachment.name; });
    var names = sending.filter(function (attachment) { return attachment.name; }).map(function (attachment) { return attachment.name; });
    if (images.length) el.appendChild(shots(images.map(function (image) { return image.url; })));
    if (names.length) el.appendChild(docs(names));
    // Said the moment he sends: Flyd has it, before anything else is known.
    var state = document.createElement("span");
    state.className = "queued state";
    state.setAttribute("role", "status");
    state.textContent = ${JSON.stringify(RECEIVED)};
    el.appendChild(state);
    main.insertBefore(el, working);
    document.getElementById("empty").hidden = true;
    return el;
  }

  // A tiny electronic blip when a message goes out: synthesized, no file.
  var audio = null;
  function wakeAudio() {
    try {
      var Context = window.AudioContext || window.webkitAudioContext;
      if (!audio && Context) audio = new Context();
      if (audio && audio.state === "suspended") audio.resume();
    } catch (e) { audio = null; }
  }
  function blip() {
    if (!audio) return;
    try {
      var t = audio.currentTime;
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1500, t);
      osc.frequency.exponentialRampToValueAtTime(950, t + 0.07);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    } catch (e) { /* sound is a nicety */ }
  }

  function deliver(payload) {
    return authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: payload }, true).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || "not sent");
        return data;
      });
    });
  }

  // Push-to-talk from Flyd.app: the words appear in the box as they are
  // heard and go out on release like a typed message. Whatever was typed
  // before stays in front of them.
  var voiceBase = null;
  function joinVoice(text) {
    return voiceBase && voiceBase.trim() ? voiceBase.trimEnd() + " " + text : text;
  }
  function endVoice() {
    composer.classList.remove("listening", "transcribing");
    voiceBase = null;
  }
  window.flydVoice = {
    start: function () {
      typingPredictions.reset();
      // Speaking is conversation: the terminal comes back for it, this once.
      if (onShow()) applyScreen("terminal", false);
      if (composer.hidden) return;
      voiceBase = input.value;
      composer.classList.add("listening");
      composer.classList.remove("transcribing");
    },
    draft: function (text) {
      typingPredictions.reset();
      if (voiceBase === null) return;
      input.value = joinVoice(text);
      grow();
    },
    transcribing: function () {
      typingPredictions.reset();
      composer.classList.remove("listening");
      composer.classList.add("transcribing");
    },
    send: function (text) {
      if (voiceBase === null) voiceBase = input.value;
      input.value = joinVoice(text).trim();
      endVoice();
      grow();
      if (!input.value) return;
      // A window that was never shown may still be connecting: wait for the
      // session before sending, rather than dropping the message.
      var tries = 0;
      (function submitWhenReady() {
        if (current) { composer.requestSubmit(); return; }
        if (tries++ < 100) setTimeout(submitWhenReady, 200);
        else problem.textContent = "Not sent: the conversation did not load";
      })();
    },
    cancel: function (message) {
      if (voiceBase !== null) { input.value = voiceBase; grow(); }
      endVoice();
      if (message) problem.textContent = message;
    },
  };

  composer.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    var sending = attachments.slice();
    if ((!text && !sending.length) || !current) return;
    recall.index = -1;
    // Created inside the key press, as browsers require for audio.
    wakeAudio();
    var el = pendingMessage(text, sending);
    refreshWorking();
    sendsInFlight += 1;
    input.value = "";
    attachments = [];
    renderAttachments();
    toBottom();
    var payload = JSON.stringify({
      session: current,
      text: text,
      images: sending.filter(function (a) { return !a.name; }).map(function (image) { return { mediaType: image.mediaType, data: image.data }; }),
      files: sending.filter(function (a) { return a.name; }).map(function (file) { return { name: file.name, data: file.data }; }),
    });
    deliver(payload).then(function (sent) {
      sendsInFlight -= 1;
      // Landed: the draft it came from goes, unless he has started another.
      if (!input.value && !attachments.length) saveDraftNow();
      blip();
      // Inside Flyd.app the notch island says "sent".
      try { window.webkit.messageHandlers.flyd.postMessage({ sent: true }); } catch (e) { /* in a browser */ }
      // Kept until the message shows up in the conversation itself.
      if (nodes.has(sent.id)) {
        el.remove();
        if (sent.warning) {
          warnings.set(sent.id, "saved, but not passed on yet");
          showWarning(nodes.get(sent.id), warnings.get(sent.id));
        }
        return;
      }
      var state = el.querySelector(".state");
      if (latestSession && current !== latestSession) {
        // Firstmate answers in its live session; the note is shown there.
        state.classList.add("still");
        living(state, "Sent. It shows in the latest session");
        return;
      }
      el.dataset.wait = sent.id;
      awaiting.add(sent.id);
      if (sent.warning) warnings.set(sent.id, "saved, but not passed on yet");
      living(state, warnings.get(sent.id) || sent.waiting || "Sent");
      carried.set(sent.id, state.textContent);
    }).catch(function (error) {
      sendsInFlight -= 1;
      el.classList.add("failed");
      el.querySelector(".state").textContent = "not sent: " + error.message + " (click to dismiss)";
      el.addEventListener("click", function () { el.remove(); });
      if (!input.value && !attachments.length) { input.value = text; attachments = sending; renderAttachments(); }
    });
  });
  restoreDraft();


  // Artefact view: Flyd on TV. Core's boxes become scenes that take turns,
  // one at a time like title cards: the calls only he can make, then what
  // Flyd sees coming, then the stories, each with its screenshot large. The
  // instruments become a row of small readouts under the stage. The
  // "artefact" switch (or Tab) flips between it and the conversation, and the
  // choice is remembered; the conversation keeps streaming underneath.
  var showEl = document.getElementById("show");
  var sceneEl = document.getElementById("scene");
  var sceneHead = document.getElementById("scene-head");
  var sceneLine = document.getElementById("scene-line");
  var sceneMeta = document.getElementById("scene-meta");
  var ticksEl = document.getElementById("ticks");
  var readoutsEl = document.getElementById("readouts");
  var showDoing = document.getElementById("show-doing");
  var air = document.getElementById("air");
  var flip = document.getElementById("flip");
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // What each kind is called on screen.
  var WORDS = { call: "needs you", live: "under way", ready: "waiting to land", landed: "landed", waiting: "held up", next: "up next", news: "also", clear: "all clear", warn: "coming up" };
  var RANK = { call: 0, note: 1, alert: 2, story: 3 };
  var DWELL = 9000;
  var scenes = [];
  var at = 0;
  var cycle = null;
  var holding = false;
  var filled = "";
  var drawnReadouts = "";
  var lastScreen = null;
  // Where the conversation was: the latest message unless he had scrolled up.
  var terminalAt = { pinned: true, anchor: null };

  function onShow() { return document.documentElement.getAttribute("data-screen") === "show"; }
  function ago(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return "";
    var minutes = Math.round(ms / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.round(minutes / 60);
    return hours < 24 ? hours + "h ago" : Math.round(hours / 24) + "d ago";
  }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function withToken(src) { return src + (src.indexOf("?") < 0 ? "?" : "&") + "token=" + encodeURIComponent(VIEW_TOKEN); }
  function sentence(text) { text = String(text || "").trim(); return text && !/[.!?…:]$/.test(text) ? text + "." : text; }
  function capital(text) { text = String(text || ""); return text.charAt(0).toUpperCase() + text.slice(1); }

  // Core's boxes, split: what holds the stage in turn, and the readouts under it.
  function split(boxes) {
    var stage = [];
    var readouts = [];
    function place(box) {
      if (box.kind === "group") { (box.children || []).forEach(place); return; }
      if (box.kind in RANK) stage.push(box); else if (box.kind !== "shot") readouts.push(box);
    }
    boxes.forEach(place);
    // A stable sort: calls first, then the situation, what is coming, the stories.
    stage = stage.map(function (box, index) { return { box: box, index: index }; })
      .sort(function (a, b) { return (RANK[a.box.kind] - RANK[b.box.kind]) || (a.index - b.index); })
      .map(function (entry) { return entry.box; });
    return { stage: stage, readouts: readouts };
  }
  function kindWord(box) {
    if (box.status === "report available") return "earlier report";
    if (box.kind === "note") return box.why || "where things stand";
    if (box.tone === "news") return box.why || WORDS.news;
    return WORDS[box.kind === "alert" ? "warn" : box.tone] || box.why || "";
  }
  function shotsOf(box) {
    return (box.children || []).filter(function (child) { return child.kind === "shot" && child.shot; }).map(function (child) { return child.shot; });
  }

  function fillScene(box) {
    filled = JSON.stringify(box);
    var shots = shotsOf(box);
    sceneEl.className = "scene k-" + (box.kind === "alert" ? "warn" : box.tone || "news") + (shots.length ? " has-shot" : "");
    if (sceneEl.dataset.id !== box.id) sceneEl.parentElement.scrollTop = 0;
    sceneEl.dataset.id = box.id;
    sceneHead.textContent = box.title;
    sceneHead.classList.toggle("long", box.title.length > 80);
    if (box.ref) {
      sceneHead.setAttribute("role", "button");
      sceneHead.tabIndex = 0;
      sceneHead.dataset.ref = box.ref;
      sceneHead.title = "Open in the conversation";
    } else {
      sceneHead.removeAttribute("role");
      sceneHead.removeAttribute("tabindex");
      sceneHead.removeAttribute("title");
      sceneHead.dataset.ref = "";
    }
    sceneLine.textContent = box.line ? sentence(capital(box.line)) : "";
    var oldAnswer = sceneEl.querySelector(".scene-answer");
    var decisionKey = box.decision && VIEW_TOKEN ? "flyd-decision:" + box.decision.task + ":" + box.decision.question : "";
    if (oldAnswer && oldAnswer.dataset.key !== decisionKey) oldAnswer.remove();
    if (decisionKey && !(oldAnswer && oldAnswer.isConnected)) {
      var decision = box.decision;
      var key = decisionKey;
      var state = {};
      try { state = JSON.parse(sessionStorage.getItem(key) || "{}"); } catch (_) {}
      var form = el("form", "scene-answer");
      form.setAttribute("aria-label", "Answer this question");
      form.dataset.key = key;
      var label = el("label", "", "Your answer");
      label.htmlFor = "decision-answer";
      var answer = el("textarea");
      answer.id = "decision-answer";
      answer.maxLength = 4000;
      answer.required = true;
      answer.value = state.text || "";
      var choices = el("div", "choices");
      (decision.choices || []).forEach(function (choice) {
        var button = el("button", "", choice);
        button.type = "button";
        button.addEventListener("click", function () { answer.value = choice; answer.dispatchEvent(new Event("input")); answer.focus(); });
        choices.appendChild(button);
      });
      form.appendChild(choices);
      form.appendChild(label);
      form.appendChild(answer);
      var send = el("button", "", "Send answer");
      send.type = "submit";
      var receipt = el("div", "receipt", state.receipt || "The question stays open until your answer is acknowledged.");
      receipt.setAttribute("role", "status");
      receipt.setAttribute("aria-live", "polite");
      function save() { try { sessionStorage.setItem(key, JSON.stringify(state)); } catch (_) {} }
      answer.addEventListener("input", function () { state.text = answer.value; state.receipt = ""; save(); send.disabled = !answer.value.trim(); });
      send.disabled = !answer.value.trim() || !!state.receipt;
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (send.disabled || !answer.value.trim()) return;
        send.disabled = true;
        receipt.textContent = "Sending your answer…";
        try {
          var response = await fetch("/api/send", { method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": VIEW_TOKEN }, body: JSON.stringify({ decision: decision.task, text: answer.value }) });
          var sent = await response.json();
          if (!response.ok) throw new Error(sent.error || "Answer not delivered");
          state.receipt = "Answer received (" + sent.id + "). Waiting for acknowledgement; this decision remains open.";
          save();
          receipt.textContent = state.receipt;
        } catch (error) {
          receipt.textContent = error.message || "Answer not delivered. Try again.";
          send.disabled = false;
        }
      });
      form.appendChild(send);
      form.appendChild(receipt);
      sceneEl.querySelector(".scene-text").appendChild(form);
    }
    sceneMeta.textContent = "";
    var word = kindWord(box);
    if (word) sceneMeta.appendChild(el("span", "kind", word));
    if (box.project) sceneMeta.appendChild(el("span", "project", box.project));
    if (box.status && box.status !== word) sceneMeta.appendChild(el("span", "status", box.status));
    (box.links || []).forEach(function (link) {
      var a = el("a", "", link.label);
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      sceneMeta.appendChild(a);
    });
    if (box.at) {
      var when = el("span", "ago", ago(box.at));
      when.dataset.at = box.at;
      sceneMeta.appendChild(when);
    }
    var old = sceneEl.querySelector(".scene-shot");
    if (old) old.remove();
    if (!shots.length) return;
    var figure = el("figure", "scene-shot");
    var main = el("img", "main");
    main.tabIndex = 0;
    main.setAttribute("role", "button");
    // ponytail: a phone silhouette is a portrait 9:16-to-9:22 frame; a taller
    // desktop capture (~0.59) and a tablet (~0.7) fall outside it.
    main.addEventListener("load", function () { var ratio = main.naturalWidth / main.naturalHeight; main.classList.toggle("phone", ratio >= .4 && ratio <= .58); });
    main.alt = "Screenshot: " + box.title;
    main.src = withToken(shots[0].src);
    main.addEventListener("click", function () { openImage(main.src); });
    main.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openImage(main.src); } });
    figure.appendChild(main);
    if (shots.length > 1) {
      var thumbs = el("div", "thumbs");
      shots.forEach(function (shot, index) {
        var thumb = el("img", index === 0 ? "on" : "");
        thumb.alt = shot.label;
        thumb.tabIndex = 0;
        thumb.setAttribute("role", "button");
        thumb.src = withToken(shot.src);
        // Rolling over a thumbnail brings it up; a tap does the same on a phone.
        function choose() {
          main.src = thumb.src;
          thumbs.querySelectorAll("img").forEach(function (other) { other.classList.toggle("on", other === thumb); });
        }
        thumb.addEventListener("mouseenter", choose);
        thumb.addEventListener("click", choose);
        thumb.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } });
        thumbs.appendChild(thumb);
      });
      figure.appendChild(thumbs);
    }
    sceneEl.appendChild(figure);
  }
  function markTicks() {
    Array.prototype.forEach.call(ticksEl.children, function (tick, index) {
      tick.classList.remove("on");
      tick.classList.toggle("held", holding);
      if (index === at) {
        void tick.offsetWidth;
        tick.classList.add("on");
      }
      tick.setAttribute("aria-current", index === at ? "true" : "false");
    });
  }
  function show(index, animate) {
    if (!scenes.length) return;
    at = (index + scenes.length) % scenes.length;
    var box = scenes[at];
    if (!animate || reduced || !onShow()) {
      sceneEl.classList.remove("out");
      fillScene(box);
      markTicks();
      return;
    }
    sceneEl.classList.remove("in");
    sceneEl.classList.add("out");
    setTimeout(function () {
      fillScene(box);
      sceneEl.classList.add("in");
      markTicks();
    }, 220);
  }
  function schedule() {
    clearInterval(cycle);
    cycle = null;
    if (scenes.length > 1 && !holding && !(document.activeElement && document.activeElement.closest(".scene-answer"))) cycle = setInterval(function () { if (onShow()) show(at + 1, true); }, DWELL);
  }
  function hold(on) {
    holding = on;
    markTicks();
    schedule();
  }
  sceneEl.addEventListener("mouseenter", function () { hold(true); });
  sceneEl.addEventListener("mouseleave", function () { hold(false); });
  sceneEl.addEventListener("focusin", function () { hold(true); });
  sceneEl.addEventListener("focusout", function (event) { if (!sceneEl.contains(event.relatedTarget)) hold(false); });
  ticksEl.addEventListener("mouseleave", function () { hold(false); });
  function openScene() { if (sceneHead.dataset.ref) openInTerminal(sceneHead.dataset.ref); }
  sceneHead.addEventListener("click", openScene);
  sceneHead.addEventListener("keydown", function (event) {
    if (sceneHead.dataset.ref && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openScene(); }
  });
  function renderTicks() {
    ticksEl.textContent = "";
    ticksEl.hidden = scenes.length < 2;
    scenes.forEach(function (box, index) {
      var tick = el("button", "k-" + (box.kind === "alert" ? "warn" : box.tone || "news"));
      tick.type = "button";
      tick.setAttribute("aria-label", (kindWord(box) ? kindWord(box) + ": " : "") + box.title);
      tick.style.setProperty("--dwell", DWELL + "ms");
      // Hover, not click: resting on a line brings its scene up.
      function choose() { holding = true; if (index !== at) show(index, true); else markTicks(); schedule(); }
      tick.addEventListener("mouseenter", choose);
      tick.addEventListener("focus", choose);
      tick.addEventListener("click", choose);
      ticksEl.appendChild(tick);
    });
    markTicks();
  }

  // The readouts: each drawn small, white, with room for every label.
  function drawCols(values, max, extra) {
    var cols = el("div", "ro-cols");
    values.forEach(function (value, index) {
      var bar = el("i", (value ? "" : "none") + (extra ? " " + extra(index) : ""));
      bar.style.height = (value ? Math.max(10, Math.round((value / Math.max(max, 1)) * 100)) : 6) + "%";
      cols.appendChild(bar);
    });
    return cols;
  }
  function drawAxis(labels) {
    var axis = el("div", "ro-axis");
    labels.forEach(function (label) { axis.appendChild(el("span", "", label)); });
    return axis;
  }
  function drawReadout(box) {
    var node = el("div", "ro");
    node.dataset.id = box.id;
    node.appendChild(el("span", "ro-label", box.why));
    node.appendChild(el("span", "ro-value", box.title));
    if (box.hours && box.hours.length) {
      var temps = box.hours.map(function (hour) { return hour.tempC; });
      var low = Math.min.apply(null, temps), high = Math.max.apply(null, temps);
      node.appendChild(drawCols(box.hours.map(function (hour) { return 30 + (high > low ? ((hour.tempC - low) / (high - low)) * 70 : 50); }), 100, function (index) { return box.hours[index].rainChance >= 50 ? "wet" : ""; }));
      node.appendChild(drawAxis(box.hours.map(function (hour, index) { return index % 3 === 0 ? hour.label : ""; })));
    }
    if (box.gauges && box.gauges.length) {
      var rows = el("div", "ro-rows");
      box.gauges.forEach(function (gauge) {
        var row = el("div", "ro-row" + (gauge.used >= 75 ? " low" : ""));
        if (gauge.resetsAt) row.title = "resets " + new Date(gauge.resetsAt).toLocaleString();
        row.appendChild(el("span", "", gauge.label));
        row.appendChild(el("b", "", gauge.used + "%"));
        var track = el("span", "track");
        var fill = el("i");
        fill.style.width = gauge.used + "%";
        track.appendChild(fill);
        row.appendChild(track);
        rows.appendChild(row);
      });
      node.appendChild(rows);
    }
    if (box.bars && box.bars.length) {
      if (box.id === "work-state") {
        // Where the work stands: one line split by state, the counts written out under it.
        var whole = box.bars.reduce(function (sum, bar) { return sum + bar.value; }, 0) || 1;
        var line = el("div", "ro-split");
        var legend = el("div", "ro-legend");
        box.bars.forEach(function (bar) {
          var part = el("i", "k-" + (bar.tone || "news"));
          part.style.flex = String(bar.value / whole);
          line.appendChild(part);
          var item = el("span", "k-" + (bar.tone || "news"));
          item.appendChild(el("b", "", String(bar.value)));
          item.appendChild(document.createTextNode(" " + bar.label));
          legend.appendChild(item);
        });
        node.appendChild(line);
        node.appendChild(legend);
      } else {
        var most = Math.max.apply(null, box.bars.map(function (bar) { return bar.value; }));
        node.appendChild(drawCols(box.bars.map(function (bar) { return bar.value; }), most));
        node.appendChild(drawAxis(box.bars.map(function (bar) { return bar.label.charAt(0); })));
      }
    }
    if (box.line && !box.hours) node.appendChild(el("span", "ro-label", box.line));
    return node;
  }
  function flicker() {
    if (reduced) return;
    readoutsEl.querySelectorAll(".ro").forEach(function (node) {
      node.classList.remove("flick");
      node.style.setProperty("--d", Math.round(160 + Math.random() * 520) + "ms");
      void node.offsetWidth;
      node.classList.add("flick");
    });
  }
  function renderReadouts(readouts) {
    var key = JSON.stringify(readouts);
    if (key === drawnReadouts) return;
    var first = drawnReadouts === "";
    drawnReadouts = key;
    readoutsEl.textContent = "";
    readouts.forEach(function (box) { readoutsEl.appendChild(drawReadout(box)); });
    if (!first && onShow()) flicker();
  }
  function renderDoing() {
    if (!lastScreen) return;
    showDoing.classList.toggle("on", !!lastScreen.live);
    showDoing.textContent = lastScreen.live ? (lastScreen.doing || "Working on it") : "Standby" + (lastScreen.read ? ". Fleet read " + ago(lastScreen.read) : "");
  }
  function renderShow(next, boxes) {
    lastScreen = next;
    air.classList.toggle("on", !!next.live);
    air.textContent = next.live ? "on air" : "standby";
    var parts = split(boxes && boxes.length ? boxes : [{ id: "situation", kind: "note", size: "wide", title: next.title, line: next.summary, why: "where things stand" }]);
    var current = scenes[at] ? scenes[at].id : null;
    var sameSet = parts.stage.length === scenes.length && parts.stage.every(function (box, index) { return box.id === scenes[index].id; });
    scenes = parts.stage;
    if (!sameSet) {
      var keep = scenes.findIndex(function (box) { return box.id === current; });
      at = keep >= 0 ? keep : 0;
      renderTicks();
      schedule();
    }
    if (scenes.length && JSON.stringify(scenes[at]) !== filled) fillScene(scenes[at]);
    renderReadouts(parts.readouts);
    renderDoing();
  }
  setInterval(function () {
    sceneMeta.querySelectorAll(".ago").forEach(function (node) { node.textContent = ago(node.dataset.at); });
    renderDoing();
  }, 30000);

  function applyScreen(next, animate) {
    var root = document.documentElement;
    if (next === "show") {
      if (!onShow() && root.hasAttribute("data-screen")) terminalAt = { pinned: pinned, anchor: pinned ? null : anchor() };
      root.setAttribute("data-screen", "show");
      showEl.hidden = false;
      showEl.classList.remove("off");
      if (animate && !reduced) {
        showEl.classList.remove("power");
        void showEl.offsetWidth;
        showEl.classList.add("power");
        if (scenes.length) { sceneEl.classList.remove("out"); sceneEl.classList.remove("in"); void sceneEl.offsetWidth; sceneEl.classList.add("in"); }
        flicker();
      }
      flip.setAttribute("aria-checked", "true");
    } else {
      root.setAttribute("data-screen", "terminal");
      showEl.hidden = true;
      showEl.classList.remove("power", "off");
      if (terminalAt.pinned) { toBottom(); jump.hidden = true; } else { pinned = false; restore(terminalAt.anchor); }
      flip.setAttribute("aria-checked", "false");
    }
  }
  function setScreen(next) {
    store("flyd-view-screen", next);
    if (next === "show") { applyScreen("show", true); return; }
    if (reduced) { applyScreen("terminal", false); return; }
    // The set switches off, then the conversation.
    showEl.classList.add("off");
    setTimeout(function () { if (showEl.classList.contains("off")) applyScreen("terminal", false); }, 170);
  }
  flip.addEventListener("click", function () {
    if (showEl.classList.contains("off")) return;
    setScreen(onShow() ? "terminal" : "show");
  });
  document.addEventListener("keydown", function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest(".scene-answer")) return;
    // Tab swaps between the conversation and the artefact, from anywhere. Left
    // alone while the "/" list or a typing suggestion has claimed the key.
    if (event.key === "Tab") {
      event.preventDefault();
      if (showEl.classList.contains("off")) return;
      setScreen(onShow() ? "terminal" : "show");
      return;
    }
    if (showEl.hidden || !lightbox.hidden) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      holding = true;
      show(at + (event.key === "ArrowRight" ? 1 : -1), true);
      schedule();
      return;
    }
    // Typing talks to Flyd: the conversation comes back with the message box, and the key lands in it.
    if (event.key.length === 1 && event.key !== " " && !composer.hidden) {
      // At once, not after the switch-off: a hidden box cannot take the key.
      store("flyd-view-screen", "terminal");
      applyScreen("terminal", false);
      input.focus();
    }
  });
  // A scene opens its message in the conversation.
  function openInTerminal(ref) {
    store("flyd-view-screen", "terminal");
    var target = ref ? nodes.get(ref) : null;
    terminalAt = { pinned: !target, anchor: null };
    applyScreen("terminal", false);
    if (!target) return;
    if (target.classList.contains("has-summary") && !target.classList.contains("open")) {
      var more = target.querySelector(":scope > .more");
      if (more) more.click();
    }
    pinned = false;
    target.scrollIntoView({ block: "center" });
    target.classList.remove("spot");
    void target.offsetWidth;
    target.classList.add("spot");
  }
  applyScreen(store("flyd-view-screen") === "show" ? "show" : "terminal", false);

  (VIEW_TOKEN ? Promise.resolve({ token: VIEW_TOKEN }) : fetch("/api/token").then(function (r) { return r.json(); }))
    .then(function (data) {
      VIEW_TOKEN = data.token;
      return loadSessions();
    })
    .then(function () { connect(explicit); })
    .catch(function () { problem.textContent = "reconnecting…"; });
})();
`;

export function renderPage(options: { assistantLabel: string; sendToken?: string }): string {
  const label = escapeHtml(options.assistantLabel);
  const token = options.sendToken ? ` data-send-token="${escapeHtml(options.sendToken)}"` : "";
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label}</title>
<style>${STYLE}</style>
</head>
<body${token}>
<header>
  <span class="who">${label}</span>
  <span class="picker"><select id="picker" aria-label="Session"></select></span>
  <span class="air" id="air">standby</span>
  <span class="when" id="when"></span>
  <span class="controls">
    <button id="taste-link" type="button" aria-label="What Flyd knows about your taste">taste</button>
    <button id="mode" type="button" role="switch" aria-checked="false" aria-label="Full replies, as written">full<span class="track" aria-hidden="true"></span></button>
    <button id="theme" type="button" role="switch" aria-checked="false" aria-label="Light theme">light<span class="track" aria-hidden="true"></span></button>
    <button id="flip" type="button" role="switch" aria-checked="false" aria-label="Artefact view">artefact<span class="track" aria-hidden="true"></span></button>
  </span>
</header>
<main id="stream" aria-live="polite">
  <p class="empty" id="empty" hidden>Nothing said yet.</p>
  <div class="working" id="working" hidden aria-label="${label} is working"><span class="dots"><i></i><i></i><i></i></span><span class="doing" id="doing"></span></div>
</main>
<button class="jump" id="jump" type="button" hidden>↓ new</button>
<div class="lightbox" id="lightbox" hidden role="dialog" aria-label="Image"><img id="lightbox-img" alt=""></div>
<div class="problem" id="problem"></div>
<section class="show" id="show" hidden aria-label="Flyd's artefact: what it thinks you need to see">
  <div class="tv">
    <div class="scene" id="scene" aria-live="polite">
      <div class="scene-text">
        <h1 class="scene-head" id="scene-head"></h1>
        <p class="scene-line" id="scene-line"></p>
        <div class="scene-meta" id="scene-meta"></div>
      </div>
    </div>
  </div>
  <div class="ticks" id="ticks" aria-label="Flyd's scenes" hidden></div>
  <div class="readouts" id="readouts" aria-label="Readouts"></div>
  <div class="foot"><p class="doing" id="show-doing">Standby</p><span class="hint">type to talk · tab for the conversation</span></div>
</section>
<form class="composer" id="composer" hidden autocomplete="off">
  <div class="row">
    <ul class="commands" id="commands" role="listbox" aria-label="Skills and commands" hidden></ul>
    <div class="attachments" id="attachments" hidden></div>
    <div class="field">
      <div class="typing">
        <div class="prediction-layer" id="prediction-layer" aria-hidden="true" hidden><span class="prediction-prefix" id="prediction-prefix"></span><span class="prediction-suffix" id="prediction-suffix"></span></div>
        <textarea id="input" rows="1" placeholder="Message ${label}" aria-label="Message ${label}"></textarea>
      </div>
      <button class="prediction-toggle" id="prediction-toggle" type="button" aria-label="Toggle typing suggestions" aria-pressed="true">↹</button>
      <button id="send" type="submit" disabled aria-label="Send to ${label}">AHOY</button>
    </div>
    <div class="hint" id="usage"></div>
  </div>
</form>
<script>${SCRIPT}</script>
</body>
</html>`;
}

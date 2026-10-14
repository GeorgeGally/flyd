import { DOCUMENT_EXTENSIONS, MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "./firstmate-inbox.js";
import { escapeHtml } from "./markdown.js";
import { installComposerPredictions } from "./composer-predictions-client.js";
import { RECEIVED } from "./living.js";
import { UNREAD_AFTER_MS } from "./note-receipts.js";
import { PASSAGE_CHARS } from "./replies.js";

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
header button[role="switch"] { display: inline-flex; align-items: center; gap: 8px; }
button[role="switch"] .track {
  position: relative; flex: none; width: 26px; height: 14px; border-radius: 7px;
  background: color-mix(in srgb, var(--muted) 34%, transparent); transition: background-color 180ms ease;
}
button[role="switch"] .track::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--muted); transition: transform 220ms cubic-bezier(.3,1.4,.5,1), background-color 180ms ease;
}
header button[role="switch"][aria-checked="true"] { color: var(--strong); }
button[role="switch"][aria-checked="true"] .track { background: var(--accent); }
button[role="switch"][aria-checked="true"] .track::after { transform: translateX(12px); background: var(--bg); }
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
 * the work itself large beside it: the desktop capture in a browser, the phone
 * capture in a phone in front of it. The scenes take turns like title cards,
 * the work with pictures first. The numbers are one quiet line at the foot,
 * never a dashboard. Text fades in place: no movement, no pop. The
 * conversation stays live underneath, one switch away.
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
:root[data-screen="show"] header .picker { display: none; }
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
.scene.has-shot { grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); }
/* A question with its answer field needs the room for words: the picture steps back. */
.scene.has-shot.has-ask { grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); }
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
/* The page a change is on: a button that opens it, big enough to read across the room. */
a.open-page, .msg.user a.open-page { display: flex; width: fit-content; align-items: center; gap: 0.5em; max-width: 100%; padding: 0.6em 1.15em; border-radius: 999px; background: var(--accent); color: var(--bg); font: 600 15px/1.2 var(--sans); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity 160ms ease; }
.open-page:hover { opacity: 0.85; }
.open-page:focus-visible { outline: 2px solid var(--strong); outline-offset: 3px; }
.scene-open { margin-top: 26px; font-size: clamp(16px, 1.2vw, 19px); }
.rail-open { margin: 10px 0 0; }
.reply-open-page { margin: 0.6em 0 0.4em; }
.scene-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 22px; margin-top: 30px; font: 500 14px/1.3 var(--mono); color: var(--muted); }
.scene-meta .kind { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--k); }
.scene-meta .project { color: var(--fg); }
.scene-meta a { color: var(--link); text-decoration: none; transition: color 140ms ease; }
.scene-meta a:hover { color: var(--strong); }
/*
 * The work, as large as the stage allows. A desktop capture sits in a browser,
 * a phone capture in a phone (both shown from the top of the page, as a device
 * would, unless the top is nearly empty; see aimAtContent); with both, the phone stands in front of the browser. Anything else
 * (artwork, a tablet without its name) keeps its own shape, never cropped.
 */
.scene-shot { margin: 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.devices { position: relative; width: 100%; height: min(66vh, calc(100vh - 300px)); min-height: 220px; container-type: size; }
.device { position: absolute; overflow: hidden; background: #050608; cursor: zoom-in; box-sizing: border-box; }
.device img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top center; }
.device:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.device.desk {
  border-radius: 12px; border: 1px solid rgba(255,255,255,.12);
  box-shadow: 0 4px 10px rgba(0,0,0,.22), 0 24px 48px rgba(0,0,0,.28), 0 60px 110px rgba(0,0,0,.2);
  display: flex; flex-direction: column;
}
.device.desk .bar { flex: none; height: 24px; display: flex; align-items: center; gap: 6px; padding: 0 12px; background: #17191d; border-bottom: 1px solid rgba(255,255,255,.06); }
.device.desk .bar i { width: 8px; height: 8px; border-radius: 50%; background: #34373d; }
.device.desk img { flex: 1; min-height: 0; height: auto; }
.device.phone {
  border-radius: 40px; corner-shape: squircle; border: 6px solid #1c1e21; outline: 1px solid rgba(255,255,255,.16);
  box-shadow: 0 3px 8px rgba(0,0,0,.24), 0 20px 40px rgba(0,0,0,.3), 0 44px 80px rgba(0,0,0,.22);
}
.device.tablet {
  border-radius: 26px; corner-shape: squircle; border: 8px solid #1c1e21; outline: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 4px 10px rgba(0,0,0,.22), 0 24px 48px rgba(0,0,0,.28);
}
.device.art { background: none; border-radius: 10px; box-shadow: 0 18px 44px rgba(0,0,0,.28); }
.device.art img { object-fit: contain; }
/* One device, centred at its own proportions. */
.devices.one .device { left: 50%; top: 50%; transform: translate(-50%, -50%); }
.devices.one .desk { width: min(100cqw, 160cqh); height: min(62.5cqw, 100cqh); }
.devices.one .phone { width: min(46.2cqh, 100cqw); height: min(100cqh, 216.7cqw); }
.devices.one .tablet { width: min(75cqh, 100cqw); height: min(100cqh, 133.3cqw); }
.devices.one .art { width: auto; height: auto; max-width: 100cqw; max-height: 100cqh; }
.devices.one .art img { width: auto; height: auto; max-width: 100cqw; max-height: 100cqh; }
/* The pair: the browser behind, the phone in front of its right edge. */
.devices.pair .desk { left: 0; top: 4cqh; width: min(86cqw, 137.6cqh); height: min(53.75cqw, 86cqh); }
.devices.pair .phone { right: 0; bottom: 0; width: min(36cqh, 34cqw); height: min(78cqh, 73.7cqw); }
/* A scene's foot: a question's options, one tap each, then the chat box every artefact has. */
.scene-ask { display: grid; gap: 14px; margin-top: 28px; max-width: 640px; }
.scene-ask .choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(11em, 1fr)); gap: 8px; }
.choice-pick {
  display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; min-height: 52px;
  font: 500 17px/1.25 var(--sans); color: var(--fg); text-align: left; background: var(--tint); border: 1px solid var(--faint);
  border-radius: 10px; padding: 10px 14px; cursor: pointer; transition: color 140ms ease, border-color 140ms ease, background-color 140ms ease;
}
.choice-pick small { font: 400 13px/1.2 var(--sans); color: var(--muted); }
.choice-pick:hover { color: var(--strong); border-color: var(--accent); }
.choice-pick[aria-pressed="true"], .choice-pick[aria-pressed="true"]:hover { color: var(--bg); background: var(--accent); border-color: var(--accent); }
.choice-pick[aria-pressed="true"] small { color: color-mix(in srgb, var(--bg) 70%, transparent); }
.choice-pick:disabled:not([aria-pressed="true"]) { opacity: .45; cursor: default; }
.choice-pick:disabled:not([aria-pressed="true"]):hover { color: var(--fg); border-color: var(--faint); }
.scene-ask :focus-visible, .scene-shot img:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
/* The chat box at the foot of every artefact: one field like the reply card,
   his words and Send inside it on one row, any pasted images above them. */
.art-chat { display: flex; flex-direction: column; gap: 8px; }
/* A question's own answer box, one step at a time, is the same field. */
.art-chat-field, .scene-ask .step-free {
  padding: 6px 6px 6px 14px; border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 7%, var(--tint)); transition: border-color 140ms ease;
}
.art-chat-field:focus-within, .scene-ask .step-free:focus-within { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
.art-chat-row { display: flex; align-items: flex-end; gap: 8px; }
/* It grows with what he types, never with focus: a box that shrank as Send
   took the click moved Send out from under the pointer, and nothing went. */
.art-chat-input {
  flex: 1; min-width: 8em; min-height: 32px; max-height: 10em; box-sizing: border-box; field-sizing: content; overflow: auto;
  font: 400 16px/22px var(--sans); color: var(--strong); background: transparent; border: 0; border-radius: 0;
  padding: 5px 0; resize: none;
}
.art-chat-input:focus { outline: none; }
.art-chat-input::placeholder { color: var(--muted); }
.art-chat-send { flex: none; height: 32px; font: 600 14px/1 var(--sans); letter-spacing: 0; text-transform: none; color: var(--bg); background: var(--accent); border: 0; border-radius: 6px; padding: 0 14px; cursor: pointer; transition: opacity 140ms ease; }
.art-chat-send:disabled { opacity: .4; cursor: default; }
.art-chat-send:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.art-chat-images { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 8px 6px 0; }
.art-chat-images[hidden] { display: none; }
.art-chat-images .attachment img { max-width: 160px; max-height: 64px; cursor: zoom-in; }
.art-chat-images .attachment button { border: 0; cursor: pointer; }
.art-chat-receipt { flex-basis: 100%; margin: 0; font: 400 14px/1.4 var(--sans); color: var(--muted); }
.art-chat-receipt.sent { color: var(--fg); }
.art-chat-receipt.sent::before { content: "✓ "; color: var(--accent); }
.art-chat-receipt:empty { display: none; }
.art-chat-receipt.problem { color: var(--k-waiting); }
.art-chat--receipt .art-chat-field { display: none; }
.scene-ask .step-q { font-size: clamp(20px, 1.6vw, 26px); line-height: 1.25; }
.scene-ask .step-review { font-size: clamp(16px, 1.2vw, 19px); }
.scene-meta .closed { color: var(--muted); font-style: italic; }
/* A question leads in words his own size: the answer under it is what matters. */
.scene.has-ask .scene-head, .scene.has-ask .scene-head.long { max-width: 24em; font-size: clamp(26px, 2.4vw, 40px); line-height: 1.15; letter-spacing: -0.015em; }
.scene.has-ask .scene-line { margin-top: 14px; font-size: clamp(16px, 1.2vw, 19px); color: var(--muted); }
.scene.has-ask .scene-text { display: flex; flex-direction: column; }
.scene.has-ask .scene-meta { order: -1; margin: 0 0 14px; }
.scene-shot .thumbs { display: flex; align-items: center; gap: 8px; }
.scene-shot .thumbs img {
  width: auto; height: 46px; max-width: 82px; object-fit: cover; object-position: top; border-radius: 5px; cursor: pointer;
  opacity: 0.45; transition: opacity 140ms ease;
}
.scene-shot .thumbs img:hover, .scene-shot .thumbs img.on { opacity: 1; }

/* Title-card motion, TV style: the old scene fades out, the new one fades in where it stands, headline first. Nothing moves or scales. */
.scene.out > * { animation: scene-out 200ms ease both; }
.scene.in .scene-head { animation: scene-fade 380ms ease both; }
.scene.in .scene-line { animation: scene-fade 380ms ease 70ms both; }
.scene.in .scene-meta, .scene.in .scene-ask, .scene.in .scene-open { animation: scene-fade 380ms ease 140ms both; }
.scene.in .scene-shot { animation: scene-fade 520ms ease 40ms both; }
@keyframes scene-out { to { opacity: 0; } }
@keyframes scene-fade { from { opacity: 0; } to { opacity: 1; } }

/* The work's own colours, far behind everything and out of focus: the room the screen is in. */
.ambient { position: absolute; inset: -10%; z-index: -1; max-width: none; margin: 0; width: auto; background: center / cover no-repeat; filter: blur(90px) saturate(1.3); opacity: 0; transition: opacity 900ms ease; pointer-events: none; }
.ambient.on { opacity: .2; }
:root[data-theme="light"] .ambient.on { opacity: .14; }

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

/* The numbers: one quiet line, read like a TV's crawl, never a dashboard of charts. */
.readouts { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 26px; padding-bottom: 14px; font: 500 14px/1.4 var(--mono); color: var(--muted); }
.readouts:empty { display: none; }
.ro { min-width: 0; display: flex; flex-wrap: wrap; column-gap: 0.6em; }
.ro b, .ro-part { white-space: nowrap; }
.ro b { font-weight: 600; color: var(--strong); font-variant-numeric: tabular-nums; }
.ro .k-call b, .ro b.k-call { color: var(--k-call); }
.ro-part + .ro-part::before { content: "· "; color: var(--muted); }
.ro-part b { color: var(--k); }
.ro.fade { animation: scene-fade 600ms ease both; }
/* A figure that opens what it counts: underlined like a link, nothing louder. */
.ro-open { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--k) 45%, transparent); text-underline-offset: 4px; transition: color 140ms ease; }
.ro-open:hover { color: var(--fg); text-decoration-color: var(--k); }
.ro-open:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }

/* What needs him: a sheet over the artefact, one call after another, each answerable where it stands. */
.calls { position: fixed; inset: 0; z-index: 9; display: grid; place-items: center; padding: 64px 16px 24px; background: color-mix(in srgb, var(--bg) 62%, transparent); }
.calls[hidden] { display: none; }
.calls-sheet {
  display: flex; flex-direction: column; width: min(680px, 100%); max-height: calc(100vh - 88px); border: 1px solid var(--faint); border-radius: 14px;
  background: var(--bg); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32); animation: choice-in 160ms ease both;
}
.calls-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 24px; border-bottom: 1px solid var(--faint); }
.calls-top h2 { margin: 0; font: 600 20px/1.2 var(--sans); color: var(--k-call); }
.calls-top button { font: 500 15px/1 var(--mono); color: var(--muted); background: none; border: 0; border-radius: 6px; padding: 6px 8px; cursor: pointer; }
.calls-top button:hover { color: var(--fg); }
.calls-top button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.calls-list { flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 0 24px; list-style: none; }
.call { padding: 22px 0 24px; }
.call + .call { border-top: 1px solid var(--faint); }
.call-meta { display: flex; gap: 12px; margin: 0 0 6px; font: 500 12px/1.4 var(--mono); color: var(--muted); }
.call-head { margin: 0; font: 600 19px/1.35 var(--sans); color: var(--strong); text-wrap: pretty; }
.call-question { margin: 8px 0 0; font: 400 16px/1.5 var(--sans); color: var(--fg); text-wrap: pretty; }
.call-link { display: inline-block; margin: 8px 14px 0 0; font: 500 13px/1.4 var(--mono); color: var(--link); text-decoration: none; }
.calls-sheet:focus { outline: none; }
/* Each answer compact: the choices, then the chat box. */
.call .scene-ask { margin-top: 14px; max-width: none; }
.call .choice-pick { min-height: 44px; font-size: 15px; }
.call-link.closed { color: var(--muted); font-style: italic; }

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
  .devices { height: 44vh; }
}
@media (max-height: 680px) {
  .scene-head, .scene.has-shot .scene-head { font-size: clamp(30px, 3.4vw, 48px); }
  .scene-head.long, .scene.has-shot .scene-head.long { font-size: clamp(24px, 2.6vw, 36px); }
  .scene-line { margin-top: 18px; }
  .scene-meta { margin-top: 18px; }
  .devices { height: 38vh; }
}
@media (max-width: 720px) {
  .show { overflow-x: hidden; overflow-y: auto; padding: 52px 16px 0; }
  .tv { flex: none; min-height: calc(100vh - 220px); padding: 28px 0 36px; }
  .scene-head, .scene.has-shot .scene-head { font-size: 34px; }
  .scene-head.long, .scene.has-shot .scene-head.long { font-size: 27px; }
  .scene-line { margin-top: 20px; font-size: 18px; }
  .scene-meta { margin-top: 20px; font-size: 13px; }
  .scene.has-ask .scene-head, .scene.has-ask .scene-head.long { font-size: 24px; }
  .ticks { margin-bottom: 32px; }
  .devices { height: 46vh; }
  .foot .hint { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .show.power, .show.off, .scene.in > *, .scene.in .scene-head, .scene.in .scene-line, .scene.in .scene-meta, .scene.in .scene-ask, .scene.in .scene-shot, .scene.in .scene-open,
  .scene.out > *, .ro.fade, .doing.on::before, .msg.spot { animation: none; }
  .ambient { transition: none; }
  .ticks button.on::after { transition: none; }
}
`;

const STYLE = BASE_STYLE + `

/* ~66 characters a line at the reading size. */
/* The latest message sits just clear of the message box, never stranded above a sea of space. */
main { max-width: 36em; margin: 0 auto; padding: 1em 1.5em 12vh; }
body.can-send main { padding-bottom: calc(7.5em + max(72px, 9vh)); }
.empty { color: var(--muted); font: 15px var(--mono); text-align: center; margin-top: 30vh; }

/* The page the work is on, always in the header while there is one: local
   preview or live site, where, and which part of it. */
header .site {
  display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 46vw; height: 30px; padding: 0 12px;
  border: 1px solid var(--faint); border-radius: 999px; color: var(--muted); text-decoration: none;
  font: 500 13px/1 var(--mono); letter-spacing: 0; white-space: nowrap; transition: border-color 140ms ease, color 140ms ease;
}
header .site[hidden] { display: none; }
header .site:hover { border-color: var(--accent); color: var(--fg); }
header .site-kind { display: inline-flex; align-items: center; gap: 6px; font-family: var(--sans); font-weight: 600; color: var(--k-live); }
header .site-kind::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
header .site--live .site-kind { color: var(--k-landed); }
header .site-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--strong); }
header .site-path::after { content: " ↗"; color: var(--muted); }

/* Preferences: the reading, theme and taste settings, out of the header until asked for. */
header #prefs-open { font-size: 12px; }
header #prefs-open[aria-expanded="true"] { color: var(--strong); }
.prefs {
  position: fixed; top: 48px; right: 16px; z-index: 8; width: min(320px, calc(100vw - 32px)); padding: 6px;
  border: 1px solid var(--faint); border-radius: 12px; background: var(--bg); box-shadow: 0 18px 44px rgba(0, 0, 0, 0.28);
  font: 400 15px/1.35 var(--sans); animation: choice-in 160ms ease both;
}
.prefs[hidden] { display: none; }
.prefs-title { margin: 0; padding: 10px 12px 6px; font: 600 13px/1.2 var(--sans); color: var(--muted); }
.prefs button {
  display: flex; align-items: center; gap: 14px; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px;
  background: transparent; color: var(--fg); font: inherit; text-align: left; cursor: pointer; transition: background-color 140ms ease;
}
.prefs button:hover { background: var(--tint); }
.prefs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.prefs-words { flex: 1; min-width: 0; display: grid; gap: 2px; }
.prefs-name { font-weight: 500; color: var(--strong); }
.prefs-about { font-size: 13px; color: var(--muted); }
.prefs-go { color: var(--muted); }

/* The right column: his conversations with their answers, and artefacts beside them. */
.rail {
  position: fixed; top: 52px; right: 0; bottom: 0; width: min(430px, 34vw); z-index: 6;
  display: flex; flex-direction: column; background: var(--bg);
  box-shadow: -18px 0 44px rgba(0, 0, 0, 0.22); font-size: 0.62em;
}
.rail[hidden] { display: none; }
:root[data-rail="on"] main { margin-right: calc(min(430px, 34vw) + 1.5em); }
:root[data-rail="on"] .composer .row { margin-right: calc(min(430px, 34vw) + 1.875em); }
.rail-hide {
  position: absolute; top: 10px; right: 10px; z-index: 1; font: 500 14px/1 var(--sans); color: var(--muted);
  background: transparent; border: 0; cursor: pointer; padding: 6px 8px; border-radius: 6px; transition: color 140ms ease;
}
.rail-hide:hover { color: var(--fg); }
.rail-hide:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.rail-tabs { display: flex; gap: 20px; padding: 14px 18px 10px; }
.rail-tabs button { padding: 0 0 5px; border: 0; border-bottom: 1px solid transparent; background: none; color: var(--muted); font: 500 13px/1.2 var(--mono); cursor: pointer; }
.rail-tabs button[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.rail-tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.rail-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.rail-pane[hidden] { display: none; }
/* The top of the column: one decision that needs him, the jobs under way, and what got done. */
.brief { flex: none; max-height: 62%; overflow-y: auto; padding: 18px 18px 6px; border-bottom: 1px solid var(--faint); }
.brief[hidden], .brief > [hidden] { display: none; }
.brief > section + section { margin-top: 22px; }
.brief-top { display: flex; align-items: baseline; gap: 10px; margin: 0 0 10px; padding-right: 32px; }
.brief-label { margin: 0; font: 600 13px/1.2 var(--mono); letter-spacing: 0.02em; text-transform: uppercase; color: var(--muted); }
.needs .brief-label { color: var(--k-call); }
.needs-nav { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; font: 500 13px/1 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.needs-nav button { font: inherit; color: var(--muted); background: none; border: 0; border-radius: 6px; padding: 4px 8px; cursor: pointer; transition: color 140ms ease; }
.needs-nav button:hover { color: var(--fg); }
.needs-nav button:disabled { opacity: 0.35; cursor: default; }
.needs-nav button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.needs-meta { margin: 0 0 4px; font: 400 12px/1.4 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.needs-head { margin: 0; font: 500 18px/1.35 var(--sans); color: var(--strong); text-wrap: pretty; overflow-wrap: anywhere; }
.needs-detail { margin: 8px 0 0; font: 400 15px/1.5 var(--sans); color: var(--fg); text-wrap: pretty; overflow-wrap: anywhere; }
.needs-rec { margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 10%, transparent); font: 400 15px/1.5 var(--sans); color: var(--strong); text-wrap: pretty; }
.needs-rec b { display: block; margin-bottom: 2px; font: 600 12px/1.3 var(--mono); letter-spacing: 0.02em; color: var(--accent); }
.needs .call-link { display: inline-block; margin: 10px 14px 0 0; font: 500 14px/1.4 var(--sans); color: var(--link); text-decoration: none; }
.needs .scene-ask { margin-top: 14px; max-width: none; gap: 10px; }
.needs .scene-ask .choices { grid-template-columns: 1fr; gap: 6px; }
.brief-list ul { margin: 0; padding: 0; list-style: none; }
.brief-list ul { display: grid; gap: 10px; }
.brief-list li { display: block; min-width: 0; padding: 12px 14px 13px; border-radius: 10px; background: var(--tint); }
/* Each item gets the quiet raised treatment used by conversation cards. */
.brief-list li::before { content: ""; float: left; width: 6px; height: 6px; margin: 7px 8px 0 0; border-radius: 50%; background: var(--k-live); }
.brief-line { display: block; min-width: 0; font: 400 15px/1.45 var(--sans); color: var(--fg); white-space: normal; overflow-wrap: anywhere; text-wrap: pretty; }
.brief-line a { color: inherit; text-decoration: none; }
.brief-line a:hover { color: var(--link); }
.brief-meta { display: block; margin-top: 6px; font: 400 11px/1.4 var(--mono); color: var(--muted); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
#done .brief-line { font-weight: 500; color: var(--strong); }
#done li::before { background: var(--k-landed); }
.brief-more { margin: 6px 0 0; padding: 2px 0; border: 0; background: none; cursor: pointer; font: 500 13px/1.3 var(--sans); color: var(--muted); transition: color 140ms ease; }
.brief-more:hover { color: var(--fg); }
.brief-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.rail-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 18px 40px; }
.rail-section { margin: 18px 0 8px; font: 600 13px/1 var(--mono); letter-spacing: 0.02em; color: var(--muted); }
/* One row per message he sent: his words plainly, where it stands, and its own answer under it. */
.rail-talk { margin: 0; }
.rail-body > .rail-talk { padding: 14px 0 15px; border-top: 1px solid var(--faint); }
.rail-body > .rail-section + .rail-talk { border-top: 0; padding-top: 4px; }
.rail-q { margin: 0; font: 500 16px/1.45 var(--sans); color: var(--strong); white-space: pre-wrap; overflow-wrap: anywhere; text-wrap: pretty; }
.rail-about { margin: 0 0 3px; font: 400 13px/1.4 var(--sans); color: var(--muted); overflow-wrap: anywhere; }
.rail-about a { color: var(--link); text-decoration: none; }
.rail-about a:hover { text-decoration: underline; text-underline-offset: 2px; }
.rail-a { margin: 8px 0 0; font: 400 15px/1.5 var(--sans); color: var(--fg); white-space: pre-wrap; overflow-wrap: anywhere; }
.rail-when { display: flex; align-items: center; gap: 6px; margin: 4px 0 0; font: 400 11px/1.4 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.rail-state { font: 500 12px/1.4 var(--sans); }
.rail-state--needs { color: var(--k-call); }
.rail-state--underway { color: var(--k-live); }
/* Scannable at a glance: each message is one line, its answer at most two faded
   lines; a click on the row opens the whole of both. Answered ones step back further. */
.rail-talk:not(.open) > .rail-q { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.rail-talk:not(.open) > .rail-a { color: var(--muted); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; cursor: pointer; }
.rail-talk:not(.open) > .rail-a * { display: inline; margin: 0; }
.rail-talk:not(.open) > .reply { display: none; }
.rail-talk.is-done:not(.open) > .rail-q { color: var(--muted); font-weight: 400; }
.rail-card { margin: 0 0 22px; border: 1px solid var(--faint); border-radius: 10px; overflow: hidden; }
.rail-card-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; font: 500 14px/1.3 var(--mono); color: var(--fg); }
.rail-card-head a { color: var(--link); text-decoration: none; margin-left: auto; white-space: nowrap; }
.rail-card p { margin: 0; padding: 0 12px 10px; font: 400 14px/1.45 var(--sans); color: var(--muted); }
.rail-a-md { white-space: normal; }
.rail-a-md p { margin: 0 0 8px; padding: 0; font: inherit; color: inherit; }
.rail-a-md p:last-child { margin-bottom: 0; }
.rail-a-md a { color: var(--link); }
.rail-card-note { font-style: italic; }
.rail-card .art-chat { padding: 10px 12px 12px; border-top: 1px solid var(--faint); }
.rail-card .art-chat-receipt { padding: 0; font-size: 13px; }
.rail-card--down .rail-card-head span { color: var(--muted); }
.rail-card p.rail-card-server { margin-top: -6px; font: 400 12px/1.45 var(--mono); overflow-wrap: anywhere; }
.rail-card-whose { display: block; color: var(--muted); }
.rail-card-whose::before { content: "✓ "; }
.rail-card-server--copy .rail-card-whose { color: var(--accent); }
.rail-card-server--copy .rail-card-whose::before { content: "! "; }
.rail-card p.rail-card-change { margin: 0 12px 10px; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--fg); font: 500 13px/1.4 var(--sans); }
/* A framed page is laid out at a desktop width and scaled down whole, like a
   screenshot of it: the narrow card never reflows it. The script sets --fit. */
.rail-frame-box { position: relative; aspect-ratio: 1280 / 800; overflow: hidden; border-top: 1px solid var(--faint); background: #fff; }
.rail-frame {
  position: absolute; top: 0; left: 0; width: 1280px; height: 800px; border: 0; background: #fff; display: block;
  transform: scale(var(--fit, 0.3)); transform-origin: 0 0; pointer-events: none;
}
/* Work at phone width is shown on a phone: the page at 390×844, scaled into a
   quiet bezel. With comments on, a click drops a pin and opens a line to say what about it. */
.rail-phone { padding: 14px 0 16px; border-top: 1px solid var(--faint); background: var(--tint); }
.rail-phone-screen {
  position: relative; width: min(236px, 70%); aspect-ratio: 390 / 844; margin: 0 auto; overflow: hidden;
  border-radius: 26px; background: #fff; box-shadow: 0 0 0 6px var(--bg), 0 0 0 7px var(--faint), 0 14px 32px rgba(0, 0, 0, 0.28);
}
.rail-phone-frame {
  position: absolute; top: 0; left: 0; width: 390px; height: 844px; border: 0; background: #fff; display: block;
  transform: scale(var(--fit, 0.6)); transform-origin: 0 0;
}
.rail-phone-pins { position: absolute; inset: 0; pointer-events: none; }
.rail-card--commenting .rail-phone-pins { pointer-events: auto; cursor: crosshair; }
.rail-card--commenting .rail-phone-screen { box-shadow: 0 0 0 6px var(--bg), 0 0 0 7px var(--accent), 0 14px 32px rgba(0, 0, 0, 0.28); }
.rail-pin {
  position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; box-sizing: border-box; border-radius: 50%;
  border: 2px solid #fff; background: var(--k-call); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.45); animation: choice-in 140ms ease both;
}
.rail-pin.sent { background: #8a8f98; }
.rail-card-head .rail-phone-toggle {
  margin-left: auto; font: inherit; color: var(--muted); background: none; border: 0; border-radius: 6px; padding: 2px 6px; cursor: pointer; transition: color 140ms ease;
}
.rail-card-head .rail-phone-toggle + a { margin-left: 6px; }
.rail-phone-toggle:hover, .rail-phone-toggle[aria-pressed="true"] { color: var(--accent); }
.rail-phone-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.rail-card p.rail-phone-hint { padding: 10px 12px 12px; font: 400 14px/1.45 var(--sans); color: var(--muted); }
.rail-card p.rail-phone-hint[hidden], .rail-phone-say[hidden] { display: none; }
.rail-phone-say { display: grid; gap: 8px; padding: 12px; border-top: 1px solid var(--faint); }
.rail-phone-where { font: 500 12px/1.4 var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.rail-phone-say textarea {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 56px; padding: 8px 10px; border: 1px solid var(--faint); border-radius: 8px;
  background: var(--bg); color: var(--fg); font: 400 15px/1.4 var(--sans);
}
.rail-phone-say textarea:focus { outline: none; border-color: var(--accent); }
.rail-phone-row { display: flex; align-items: center; gap: 8px; }
.rail-phone-receipt { flex: 1; min-width: 0; font: 400 13px/1.4 var(--sans); color: var(--muted); }
.rail-phone-cancel { font: 500 13px/1 var(--sans); color: var(--muted); background: none; border: 0; padding: 8px 6px; cursor: pointer; }
.rail-phone-cancel:hover { color: var(--fg); }
.rail-phone-send { font: 600 13px/1 var(--sans); color: var(--bg); background: var(--accent); border: 0; border-radius: 8px; padding: 9px 14px; cursor: pointer; }
.rail-phone-send:disabled { opacity: .55; cursor: default; }
.rail-phone-say button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.rail-frame-open { position: absolute; inset: 0; }
.rail-frame-open:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.rail-shot { width: 100%; display: block; border-top: 1px solid var(--faint); background: var(--screen); }
/* The screenshot behind an answer leads it, a size to read at a glance. */
.rail-shots { margin: 8px 0 0; }
.rail-shots .shot img { max-height: 15em; max-width: 100%; }
/* What Flyd remembers: a card each, one plain sentence. What it learned while
   we talked sits in the conversation where it learned it. */
/* A raised surface with no outline: the fill alone sets each card apart. */
.rail-mem { margin: 0 0 24px; padding: 12px 14px 13px; border-radius: 10px; background: var(--tint); }
.rail-body > .rail-mem + .rail-talk { border-top: 0; }
.rail-mem-kicker { margin: 0 0 6px; font: 500 12px/1.2 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--accent); }
.rail-mem-text { margin: 0; font: 400 16px/1.45 var(--sans); color: var(--strong); text-wrap: pretty; overflow-wrap: anywhere; }
.rail-mem--new { background: color-mix(in srgb, var(--accent) 7%, var(--tint)); }
/* What it already holds here: folded under one line at the top until he opens it. */
.rail-held > summary { display: flex; align-items: center; gap: 8px; list-style: none; cursor: pointer; transition: color 140ms ease; }
.rail-held > summary::-webkit-details-marker { display: none; }
.rail-held > summary::after { content: "›"; font-size: 15px; transition: transform 180ms ease; }
.rail-held[open] > summary::after { transform: rotate(90deg); }
.rail-held > summary:hover { color: var(--fg); }
.rail-held > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.rail-held-count { font-weight: 500; font-variant-numeric: tabular-nums; }
.rail-held .rail-mem { margin-bottom: 12px; padding: 10px 12px; }
.rail-held .rail-mem-text { font-size: 15px; color: var(--fg); }
:root[data-screen="show"] .rail { display: none; }

.msg { position: relative; overflow-wrap: anywhere; }
.msg[data-day]::before {
  content: attr(data-day); display: block; margin: 2.4em 0 0.4em;
  font: 500 13px/1 var(--mono); letter-spacing: 0.02em; color: var(--muted);
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
.queued { display: flex; align-items: flex-start; gap: 0.55em; margin-top: 0.5em; font: 400 0.82em/1.45 var(--sans); color: var(--fg); }
.queued::before { content: ""; flex: none; width: 0.36em; height: 0.36em; margin-top: 0.545em; border-radius: 50%; background: currentColor; animation: breathe 1.4s ease-in-out infinite; }
.queued .line-words { min-width: 0; overflow-wrap: anywhere; }
.queued a, .rail-wait a { color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; overflow-wrap: anywhere; }
.queued.swap { animation: swap 280ms cubic-bezier(.2,.7,.2,1); }
@keyframes swap { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .queued::before, .queued.swap, #underway li::before { animation: none; } }
/* Whether firstmate has read a note: "sent", then "read by firstmate"; late when left unread too long.
   Once firstmate has said the outcome, the outcome takes this line, in the same quiet face. */
.receipt { display: block; margin-top: 0.45em; font: 500 13px/1.3 var(--mono); letter-spacing: 0.02em; color: var(--muted); }
.receipt.late { color: var(--k-waiting); }
.receipt.outcome { overflow-wrap: anywhere; }
.receipt a { color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
/* Updates relayed from firstmate's own session: set apart, never read as an answer. */
.msg.aside { color: var(--muted); font-size: 0.92em; }
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
.msg:hover .reply-open, .rail-talk:hover .reply-open, .reply-open:focus-visible { opacity: 1; }
.reply-open:hover { color: var(--fg); }
/* Open, it is a card like a learned memory: its label and Close, then his words and Send as one row. */
.reply form {
  flex-basis: 100%; padding: 10px 12px 12px; border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 7%, var(--tint)); transition: border-color 140ms ease;
}
.reply form:focus-within { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
/* In the column the conversation is already the card, so the box sits flat inside it. */
.rail-body .reply form { padding: 0; border: 0; border-radius: 0; background: transparent; }
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
.msg.aside.asks { color: var(--fg); font-size: 1em; }
.choice { margin-top: 0.9em; padding: 0.85em 1em 0.95em; border-radius: 12px; background: var(--tint); animation: choice-in 380ms ease both; }
.choice-q { margin: 0 0 0.65em; font: 600 1.05em/1.35 var(--sans); color: var(--strong); text-wrap: pretty; overflow-wrap: anywhere; }
.choice-options { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 0.75em; }
.choice-option { font: 500 16px/1.3 var(--sans); color: var(--fg); background: var(--bg); border: 1px solid var(--faint); border-radius: 18px; padding: 9px 16px; cursor: pointer; text-align: left; transition: color 140ms ease, border-color 140ms ease; }
.choice-option:hover { color: var(--strong); border-color: var(--accent); }
.choice-option:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.choice-option:disabled { opacity: 0.5; cursor: default; }
.choice-option:disabled:hover { color: var(--fg); border-color: var(--faint); }
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
.rail-replies { margin: 10px 0 0 14px; padding-left: 12px; }
.rail-replies .rail-talk { margin: 0 0 12px; }
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
/* Notes firstmate has left unread too long: said plainly over the message box. */
.composer .unread {
  display: flex; align-items: flex-start; gap: 0.55em; margin: 0 0 0.6em -0.75em; padding: 0.5em 0.75em;
  border-radius: 0.4em; font: 500 0.82em/1.45 var(--sans); color: var(--k-waiting);
  background: color-mix(in srgb, var(--k-waiting) 14%, var(--bg));
}
.composer .unread::before { content: ""; flex: none; width: 0.42em; height: 0.42em; margin-top: 0.52em; border-radius: 50%; background: currentColor; }
.composer .unread[hidden] { display: none; }
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
  header button[role="switch"] { gap: 5px; }
  /* A phone keeps the light of "on air", not its words. */
  header .air { font-size: 0; gap: 0; }
  header .site { max-width: 34vw; padding: 0 10px; }
  header .site-kind, header .site-host { display: none; }
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
  // Preferences: a small panel under the header, closed by Escape or a click elsewhere.
  var prefs = document.getElementById("prefs");
  var prefsOpen = document.getElementById("prefs-open");
  function showPrefs(open) {
    prefs.hidden = !open;
    prefsOpen.setAttribute("aria-expanded", String(open));
  }
  prefsOpen.addEventListener("click", function () { showPrefs(prefs.hidden); });
  document.addEventListener("click", function (event) {
    if (!prefs.hidden && event.target instanceof Node && !prefs.contains(event.target) && !prefsOpen.contains(event.target)) showPrefs(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !prefs.hidden) { showPrefs(false); prefsOpen.focus(); }
  });

  // The page the work is on, in the header for as long as there is one.
  var siteEl = document.getElementById("site");
  function renderSite(page) {
    siteEl.hidden = !page;
    if (!page) return;
    siteEl.href = page.url;
    siteEl.title = page.url;
    siteEl.className = "site " + (page.local ? "site--local" : "site--live");
    siteEl.setAttribute("aria-label", "Working on " + page.url + (page.local ? ", a local preview" : ", the live site"));
    document.getElementById("site-kind").textContent = page.local ? "local" : "live";
    document.getElementById("site-host").textContent = page.host;
    document.getElementById("site-path").textContent = page.label;
  }

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
    el.querySelectorAll(":scope > .shots, :scope > .reply-open-page").forEach(function (old) { old.remove(); });
    var oldDocs = el.querySelector(".docs");
    if (oldDocs) oldDocs.remove();
    if (message.files && message.files.length) body.after(docs(message.files));
    if (message.images && message.images.length) {
      body.after(shots(message.images.map(function (id) {
        return "/api/image?session=" + encodeURIComponent(current || "") + "&id=" + encodeURIComponent(id);
      })));
    }
    // The screenshot firstmate looked at leads its answer: under his words, before the outcome line.
    if (message.shots && message.shots.length) {
      var answerShots = shots(message.shots.map(withToken), "reply-shots");
      if (message.role === "user") body.after(answerShots); else body.before(answerShots);
    }
    // The page the answer changed opens from a button beside its picture.
    if (message.page) {
      var opener = pageButton(message.page, "reply-open-page");
      var after = el.querySelector(":scope > .reply-shots");
      if (message.role === "user") (after || body).after(opener); else body.before(opener);
    }
    pairing(el, message);
    var ref = el.querySelector(":scope > .reply-ref");
    if (ref) ref.remove();
    if (message.replyQuote) {
      ref = document.createElement("span");
      ref.className = "reply-ref";
      ref.textContent = "Replying to “" + message.replyQuote + "”";
      el.insertBefore(ref, body);
    }
    wireAuto(el, message, body.textContent.trim());
    wireReply(el, message);
    if (message.role === "assistant") {
      el.classList.toggle("routine", !!message.routine);
      // Something to act on (rules to paste, steps) shows whole until he folds it.
      if (message.expanded && !el.dataset.folded) el.classList.add("open");
      summarize(el, message);
      wireAsks(body);
    }
    wireChoice(el, message);
    receipt(el, message);
    if (warnings.has(message.id)) showWarning(el, warnings.get(message.id));
  }
  // A note to firstmate says whether firstmate has read it: "sent", then "read by firstmate"; then the outcome
  // firstmate said in its own chat, on the same line in the same face.
  var UNREAD_AFTER_MS = ${UNREAD_AFTER_MS};
  function outcomeOf(message) { return message.role === "user" && message.settled && message.waiting ? message.waiting : ""; }
  function receipt(el, message) {
    var line = el.querySelector(":scope > .receipt");
    var outcome = outcomeOf(message);
    if (outcome) el.dataset.outcome = outcome; else delete el.dataset.outcome;
    if (!message.receipt && !outcome) { if (line) line.remove(); delete el.dataset.receipt; return; }
    if (!line) {
      line = document.createElement("span");
      line.className = "receipt";
    }
    // Right under his own words and attachments, above the screenshot and line of the answer.
    var own = el.querySelectorAll(":scope > .body, :scope > .docs, :scope > .shots:not(.reply-shots)");
    var mine = own[own.length - 1];
    if (mine.nextSibling !== line) mine.after(line);
    if (message.receipt) el.dataset.receipt = message.receipt; else delete el.dataset.receipt;
    el.dataset.note = message.id;
    receiptLine(el, line);
  }
  function receiptLine(el, line) {
    var outcome = el.dataset.outcome;
    line.classList.toggle("outcome", !!outcome);
    if (outcome) {
      line.classList.remove("late");
      if (line.dataset.line !== outcome) { line.dataset.line = outcome; linkLine(line, outcome); }
      return;
    }
    delete line.dataset.line;
    var read = el.dataset.receipt === "read";
    var age = el.dataset.ts ? Date.now() - new Date(el.dataset.ts).getTime() : 0;
    // A note firstmate answered was read, even if the acknowledgement never came.
    var answered = nodes.has("note-reply:" + (el.dataset.note || "").replace(/^note:/, ""));
    var late = !read && !answered && age > UNREAD_AFTER_MS;
    var text = read ? "read by firstmate" : late ? "sent · not read by firstmate yet" : "sent";
    if (line.textContent !== text) line.textContent = text;
    line.classList.toggle("late", late);
  }
  // A note crosses into unread as time passes, with nothing new on the stream.
  setInterval(function () {
    main.querySelectorAll(".msg > .receipt").forEach(function (line) { receiptLine(line.parentNode, line); });
  }, 15000);
  var unreadEl = document.getElementById("unread");
  function showUnread(unread) {
    unreadEl.hidden = !unread.count;
    unreadEl.textContent = unread.count ? unread.text : "";
  }
  // A question waits for its own answer; firstmate's session lines are relayed updates. Once firstmate said the
  // outcome (it sits on the receipt line), the living line carries on only while work on this message does.
  function pairing(el, message) {
    var queued = el.querySelector(":scope > .queued");
    var line = outcomeOf(message) ? message.doing || "" : message.waiting;
    if (!line) { if (queued) queued.remove(); queued = null; }
    else if (!queued) {
      queued = document.createElement("span");
      queued.className = "queued";
      queued.setAttribute("role", "status");
      // Picks up where the optimistic copy's line left off: no jump.
      setLine(queued, carried.get(message.id) || line);
      carried.delete(message.id);
      el.appendChild(queued);
      living(queued, line);
    } else living(queued, line);
    if (queued) {
      queued.classList.toggle("still", !!message.waitingFailed);
      queued.classList.toggle("settled", false);
    }
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
  // The page a change is on, as a button that opens it in his browser.
  function pageButton(page, kind) {
    var a = document.createElement("a");
    a.className = "open-page " + kind;
    a.href = page.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = page.url;
    a.setAttribute("aria-label", "Open " + page.url);
    a.textContent = page.label + " ↗";
    return a;
  }
  function shots(urls, kind) {
    var row = document.createElement("div");
    row.className = "shots" + (kind ? " " + kind : "");
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
  // A line can carry links: a bare web address, or "[label](address)"; each opens like any other link.
  var LINE_LINK = /\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)|https?:\\/\\/[^\\s<>"'\`)\\]]*[^\\s<>"'\`)\\].,;:!?…]/g;
  function linkLine(node, text) {
    text = String(text || "");
    node.textContent = "";
    var at = 0;
    text.replace(LINE_LINK, function (whole, label, href, offset) {
      if (offset > at) node.appendChild(document.createTextNode(text.slice(at, offset)));
      var link = document.createElement("a");
      link.href = href || whole;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = label || whole;
      node.appendChild(link);
      at = offset + whole.length;
      return whole;
    });
    if (at < text.length) node.appendChild(document.createTextNode(text.slice(at)));
  }
  // The words sit in their own span so a link inside them flows as text beside the line's dot.
  function setLine(line, text) {
    line.dataset.line = text;
    var words = line.querySelector(":scope > .line-words");
    if (!words) {
      line.textContent = "";
      words = document.createElement("span");
      words.className = "line-words";
      line.appendChild(words);
    }
    linkLine(words, text);
  }
  function living(line, text) {
    if (line.dataset.line === text) return;
    setLine(line, text);
    line.classList.remove("swap");
    void line.offsetWidth;
    line.classList.add("swap");
  }
  // A message whose send was in doubt has landed when, with no other note of his on its
  // way, a note the page had not seen arrives, written no earlier than the send, that no
  // other send was told is its own, carrying what he sent: his words with only markdown
  // taken out, or as many pictures and files and no words.
  var delivered = new Set();
  var notesOut = 0;
  function letters(text) { return text.toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function carries(typed, shown) {
    if (shown.length < typed.length * 0.6) return false;
    var at = 0;
    for (var i = 0; i < typed.length && at < shown.length; i += 1) if (typed[i] === shown[at]) at += 1;
    return at === shown.length;
  }
  function arrived(el) {
    if (notesOut) return false;
    var found = false;
    nodes.forEach(function (node, id) {
      if (found || el.knownIds.has(id) || delivered.has(id) || !node.classList.contains("user") || !node.dataset.ts) return;
      if (new Date(node.dataset.ts).getTime() < el.sentAt - 5000) return;
      var shown = letters(node.querySelector(".body").textContent);
      var attached = node.querySelectorAll(":scope > .shots:not(.reply-shots) .shot, :scope > .docs .doc").length;
      found = el.typed ? !!shown && carries(el.typed, shown) : !shown && attached === el.attached;
    });
    return found;
  }
  function clearLanded() {
    main.querySelectorAll(".msg.pending.unsure").forEach(function (el) { if (arrived(el)) el.remove(); });
  }
  function refreshWorking() {
    var recent = lastActivity && Date.now() - new Date(lastActivity).getTime() < 10 * 60 * 1000;
    // While his newest message's own line says what is happening, the dots would only repeat it.
    var shown = main.querySelectorAll(".msg");
    var last = shown[shown.length - 1];
    var speaking = !!(last && last.querySelector(":scope > .queued:not(.still):not(.settled)"));
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
    clearLanded();
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
    if (update.context) { usage.context = update.context; renderUsage(); }
    lastActivity = update.lastActivity || lastActivity;
    refreshWorking();
    if (lastActivity) whenEl.textContent = dayOf(lastActivity) + "  " + clock(lastActivity);
    if (!onConversation()) { /* the terminal is hidden; it finds its place when it comes back */ }
    else if (stick) { toBottom(); jump.hidden = true; } else { restore(at); if (added) jump.hidden = false; }
    first = false;
    if (update.show) renderShow(update.show, update.boxes);
    renderSite(update.page);
    renderBrief(update.show);
    renderRail(update.rail);
  }

  // The top of the column, Flyd as chief of staff: the one decision that needs
  // him, with what Flyd advises; every job a worker is on now; and what got
  // done, one line each. Read from firstmate's own records on every update.
  var briefEl = document.getElementById("brief");
  var needsEl = document.getElementById("needs");
  var underwayEl = document.getElementById("underway");
  var doneEl = document.getElementById("done");
  var briefFilled = false;
  var lastBrief = null;
  var needsAt = Number(store("flyd-needs-at")) || 0;
  var needsShown = "";
  var needsDrawn = "";
  var doneAll = false;
  var DONE_FEW = 3;
  function running(iso) {
    var minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(minutes)) return "";
    if (minutes < 1) return "just started";
    if (minutes < 60) return minutes + " min";
    var hours = Math.round(minutes / 60);
    return hours < 24 ? hours + " h" : Math.round(hours / 24) + (Math.round(hours / 24) === 1 ? " day" : " days");
  }
  // "GNM (Good Neighbours Market)" is GNM on a line this small.
  function shortName(project) { return project ? String(project).replace(/\\s*\\([^)]*\\)\\s*$/, "") : ""; }
  function briefTop(label, extra) {
    var top = el("div", "brief-top");
    top.appendChild(el("h2", "brief-label", label));
    if (extra) top.appendChild(extra);
    return top;
  }
  function briefItem(item, meta) {
    var li = el("li");
    var line = el("span", "brief-line");
    var link = item.open || (item.links || []).find(function (one) { return !one.closed; });
    if (link) {
      var a = el("a", "", item.headline);
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      line.appendChild(a);
    } else line.textContent = item.headline;
    line.title = item.headline;
    li.appendChild(line);
    var said = [shortName(item.project), meta].filter(Boolean).join(" · ");
    if (said) li.appendChild(el("span", "brief-meta", said));
    return li;
  }
  function drawNeeds(calls) {
    if (!calls.length) { needsEl.hidden = true; needsEl.textContent = ""; needsDrawn = ""; needsShown = ""; return; }
    // The same call stays while it is there; once answered, the next one takes its place.
    var index = calls.findIndex(function (call) { return call.id === needsShown; });
    if (index < 0) index = Math.min(needsAt, calls.length - 1);
    needsAt = index;
    needsShown = calls[index].id;
    store("flyd-needs-at", String(index));
    var call = calls[index];
    var key = JSON.stringify([call, index, calls.length]);
    needsEl.hidden = false;
    if (key === needsDrawn) return;
    needsDrawn = key;
    needsEl.textContent = "";
    var nav = null;
    if (calls.length > 1) {
      nav = el("span", "needs-nav");
      var back = el("button", "", "‹");
      back.type = "button";
      back.setAttribute("aria-label", "The one before");
      back.disabled = index === 0;
      var forward = el("button", "", "›");
      forward.type = "button";
      forward.setAttribute("aria-label", "The next one");
      forward.disabled = index === calls.length - 1;
      back.addEventListener("click", function () { needsShown = calls[Math.max(0, index - 1)].id; drawNeeds(calls); });
      forward.addEventListener("click", function () { needsShown = calls[Math.min(calls.length - 1, index + 1)].id; drawNeeds(calls); });
      nav.appendChild(back);
      nav.appendChild(el("span", "", (index + 1) + " of " + calls.length));
      nav.appendChild(forward);
    }
    needsEl.appendChild(briefTop("Needs you", nav));
    var meta = [shortName(call.project), call.at ? ago(call.at) : ""].filter(Boolean).join(" · ");
    if (meta) needsEl.appendChild(el("p", "needs-meta", meta));
    needsEl.appendChild(el("h3", "needs-head", call.headline));
    var question = call.decision && call.decision.question;
    var detail = call.detail && call.detail !== call.headline ? call.detail : question && question !== call.headline ? question : "";
    if (detail) needsEl.appendChild(el("p", "needs-detail", sentence(capital(detail))));
    var advice = call.decision && call.decision.recommended ? "I'd pick " + call.decision.recommended + "." : "";
    if (advice) {
      var rec = el("p", "needs-rec");
      rec.appendChild(el("b", "", "Recommended"));
      rec.appendChild(document.createTextNode(advice));
      needsEl.appendChild(rec);
    }
    (call.links || []).forEach(function (link) {
      if (link.closed) return;
      var a = el("a", "call-link", link.label + " ↗");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      needsEl.appendChild(a);
    });
    if (call.decision && VIEW_TOKEN) needsEl.appendChild(sceneAsk({ title: call.headline, decision: call.decision }, "flyd-decision:" + call.decision.task + ":" + call.decision.question));
  }
  function drawList(section, label, items, meta, few) {
    section.textContent = "";
    section.hidden = !items.length;
    if (!items.length) return;
    section.appendChild(briefTop(label));
    var list = el("ul");
    var shown = few && !doneAll ? items.slice(0, few) : items;
    shown.forEach(function (item) { list.appendChild(briefItem(item, meta(item))); });
    section.appendChild(list);
    if (few && items.length > few) {
      var more = el("button", "brief-more", doneAll ? "Show fewer" : "Show all " + items.length);
      more.type = "button";
      more.addEventListener("click", function () { doneAll = !doneAll; renderBrief(lastBrief); });
      section.appendChild(more);
    }
  }
  function renderBrief(show) {
    lastBrief = show || null;
    var calls = (show && show.calls) || [];
    var underway = (show && show.underway) || [];
    var done = (show && show.done) || [];
    drawNeeds(calls);
    drawList(underwayEl, "Under way", underway, function (item) { return item.started ? running(item.started) : ""; });
    drawList(doneEl, "Done", done, function (item) { return item.at ? ago(item.at) : ""; }, DONE_FEW);
    briefFilled = calls.length + underway.length + done.length > 0;
    briefEl.hidden = !briefFilled;
    showRail();
  }
  // How long each job has run moves on with the clock, not only with updates.
  setInterval(function () { if (lastBrief) renderBrief(lastBrief); }, 60000);

  // The right column: his conversations with their answers, and artefacts beside them.
  var railEl = document.getElementById("rail");
  var railBody = document.getElementById("rail-body");
  var artefactBody = document.getElementById("artefact-body");
  var railTab = store("flyd-rail-tab") || "artefacts";
  function selectRailTab(tab) {
    railTab = tab;
    store("flyd-rail-tab", tab);
    document.querySelectorAll("[data-rail-tab]").forEach(function (button) { button.setAttribute("aria-selected", String(button.getAttribute("data-rail-tab") === tab)); });
    document.querySelectorAll("[data-rail-pane]").forEach(function (pane) { pane.hidden = pane.getAttribute("data-rail-pane") !== tab; });
  }
  document.querySelectorAll("[data-rail-tab]").forEach(function (button) { button.addEventListener("click", function () { selectRailTab(button.getAttribute("data-rail-tab")); }); });
  selectRailTab(railTab === "detail" ? "detail" : "artefacts");
  var railSignature = null;
  var railHidden = store("flyd-rail") === "off";
  function railRoot() { return document.documentElement; }
  function railOn() { return !railHidden && railEl && !railEl.hidden; }
  function setRail(on) { railRoot().setAttribute("data-rail", on ? "on" : "off"); }
  // Each framed page is scaled from its own width (1280px desktop, 390px phone) to the card's.
  var fitFrames = window.ResizeObserver ? new ResizeObserver(function (entries) {
    entries.forEach(function (entry) { entry.target.style.setProperty("--fit", String(entry.contentRect.width / Number(entry.target.dataset.base || 1280))); });
  }) : null;
  // What he pointed at, when the page lets Flyd look inside it: "button.cta “Book now”".
  function describeSpot(frame, x, y) {
    try {
      var node = frame.contentDocument && frame.contentDocument.elementFromPoint(x, y);
      if (!node) return "";
      var name = node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") + Array.prototype.slice.call(node.classList, 0, 2).map(function (c) { return "." + c; }).join("");
      var words = String(node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60);
      return words ? name + " “" + words + "”" : name;
    } catch (_) { return ""; }
  }
  // A page at phone width, on a phone: he uses it as it is, or turns on comments and clicks a spot to say something about it.
  function railPhone(card, box, head) {
    var W = 390, H = 844;
    var phone = el("div", "rail-phone");
    var screen = el("div", "rail-phone-screen");
    screen.dataset.base = String(W);
    var frame = el("iframe", "rail-phone-frame");
    frame.src = card.preview;
    frame.loading = "lazy";
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", "Phone preview of " + card.preview);
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
    var pins = el("div", "rail-phone-pins");
    pins.setAttribute("aria-hidden", "true");
    screen.appendChild(frame);
    screen.appendChild(pins);
    phone.appendChild(screen);
    if (fitFrames) fitFrames.observe(screen);
    var toggle = el("button", "rail-phone-toggle", "comment");
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "false");
    toggle.title = "Click a spot on the phone to comment on it";
    head.insertBefore(toggle, head.querySelector("a"));
    var hint = el("p", "rail-phone-hint", "Click a spot on the phone to comment on it.");
    hint.hidden = true;
    var say = el("form", "rail-phone-say");
    say.hidden = true;
    var where = el("label", "rail-phone-where");
    var text = el("textarea");
    text.rows = 2;
    text.maxLength = 4000;
    text.placeholder = "What about it?";
    var row = el("div", "rail-phone-row");
    var receipt = el("span", "rail-phone-receipt");
    receipt.setAttribute("role", "status");
    var cancel = el("button", "rail-phone-cancel", "Cancel");
    cancel.type = "button";
    var send = el("button", "rail-phone-send", "Send");
    send.type = "submit";
    row.appendChild(receipt);
    row.appendChild(cancel);
    row.appendChild(send);
    say.appendChild(where);
    say.appendChild(text);
    say.appendChild(row);
    var spot = null;
    var pin = null;
    function commenting(on) {
      box.classList.toggle("rail-card--commenting", on);
      toggle.setAttribute("aria-pressed", on ? "true" : "false");
      hint.hidden = !on || !!spot;
      if (!on) drop();
    }
    function drop() {
      if (pin && !pin.classList.contains("sent")) pin.remove();
      pin = null; spot = null; say.hidden = true; text.value = ""; receipt.textContent = "";
      hint.hidden = !box.classList.contains("rail-card--commenting");
    }
    toggle.addEventListener("click", function () { commenting(!box.classList.contains("rail-card--commenting")); });
    pins.addEventListener("click", function (event) {
      var rect = screen.getBoundingClientRect();
      var fit = rect.width / W;
      var x = Math.max(0, Math.min(W, (event.clientX - rect.left) / fit));
      var y = Math.max(0, Math.min(H, (event.clientY - rect.top) / fit));
      if (pin && !pin.classList.contains("sent")) pin.remove();
      pin = el("span", "rail-pin");
      pin.style.left = (x / W * 100) + "%";
      pin.style.top = (y / H * 100) + "%";
      pins.appendChild(pin);
      spot = { x: Math.round(x), y: Math.round(y), element: describeSpot(frame, x, y) };
      where.textContent = "At " + spot.x + ", " + spot.y + (spot.element ? " · " + spot.element : "") + " on the " + W + "×" + H + " screen";
      hint.hidden = true;
      say.hidden = false;
      receipt.textContent = "";
      send.disabled = false;
      text.focus();
    });
    cancel.addEventListener("click", drop);
    text.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); drop(); }
      else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); say.requestSubmit(); }
    });
    say.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!spot || !text.value.trim() || send.disabled) return;
      send.disabled = true;
      receipt.textContent = "Sending…";
      try {
        var comment = { url: card.url || card.preview, x: spot.x, y: spot.y, text: text.value };
        if (spot.element) comment.element = spot.element;
        var response = await authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: current, comment: comment }) }, true);
        var sent = await response.json();
        if (!response.ok) throw new Error(sent.error || "Not sent");
        pin.classList.add("sent");
        pin.title = text.value.trim();
        pin = null; spot = null; say.hidden = true; text.value = "";
        hint.hidden = false;
        hint.textContent = "Sent. Click another spot to say more.";
      } catch (error) {
        receipt.textContent = error.message || "Not sent. Try again.";
        send.disabled = false;
      }
    });
    box.appendChild(phone);
    box.appendChild(hint);
    box.appendChild(say);
  }
  function railCard(card) {
    var box = keyed(el("div", "rail-card" + (card.down ? " rail-card--down" : "")), "card:" + card.id);
    var head = el("div", "rail-card-head");
    head.appendChild(el("span", "", card.title));
    if (card.url) {
      var open = el("a", "", "open ↗");
      open.href = card.url;
      open.target = "_blank";
      open.rel = "noopener";
      head.appendChild(open);
    }
    box.appendChild(head);
    var server = card.server;
    // A change of server behind the page leads the card, with when it happened.
    if (server && server.changed) {
      var when = clock(server.changed.at);
      box.appendChild(el("p", "rail-card-change", server.changed.title + (when ? " at " + when : "") + (server.changed.detail ? " — " + server.changed.detail : "")));
    }
    if (card.line) box.appendChild(el("p", "", card.line));
    if (server && server.command) {
      var served = el("p", "rail-card-server" + (server.own === false ? " rail-card-server--copy" : ""));
      served.appendChild(el("span", "", [server.command, server.folder].filter(Boolean).join(" · ")));
      if (server.whose) served.appendChild(el("span", "rail-card-whose", server.whose));
      served.title = "Served by " + server.command + " on " + server.address + (server.folder ? " from " + server.folder : "");
      box.appendChild(served);
    }
    if (card.down) box.appendChild(el("p", "rail-card-note", "Nothing answers at this address yet."));
    else if (card.checking) box.appendChild(el("p", "rail-card-note", "Checking the page answers…"));
    else if (card.blocked) box.appendChild(el("p", "rail-card-note", "This page won't show inside Flyd; open it to see it."));
    if (card.image) {
      var shot = el("img", "rail-shot");
      shot.src = withToken(card.image);
      shot.alt = card.title;
      shot.loading = "lazy";
      box.appendChild(shot);
    }
    if (card.preview && card.phone) railPhone(card, box, head);
    else if (card.preview) {
      var framed = el("div", "rail-frame-box");
      var frame = el("iframe", "rail-frame");
      frame.src = card.preview;
      frame.loading = "lazy";
      frame.tabIndex = -1;
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("title", "Live preview of " + card.preview);
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
      framed.appendChild(frame);
      // The preview is a picture of the page; clicking it opens the page full size.
      if (card.url) {
        var full = el("a", "rail-frame-open");
        full.href = card.url;
        full.target = "_blank";
        full.rel = "noopener";
        full.setAttribute("aria-label", "Open " + card.title + " full size");
        framed.appendChild(full);
      }
      if (fitFrames) fitFrames.observe(framed);
      box.appendChild(framed);
    }
    if (SEND_TOKEN) {
      var about = { title: card.title };
      if (card.url) about.url = card.url;
      box.appendChild(artefactChat("flyd-about:" + card.id, { about: about }, "Say something about this…").form);
    }
    return box;
  }
  // One memory as a card: the sentence, and over what it took in while we talked, what kind of thing it is:
  // "Learned" only for a rule or preference he taught it; work that got done is "Shipped", never a lesson.
  var KICKERS = { taste: "Learned", shipped: "Shipped", capture: "Noted", memory: "Remembered" };
  function railMemory(memory, fresh) {
    var card = keyed(el("div", "rail-mem" + (fresh ? " rail-mem--new" : "")), "mem:" + memory.id);
    if (fresh) card.appendChild(el("p", "rail-mem-kicker", KICKERS[memory.kind] || "Remembered"));
    card.appendChild(el("p", "rail-mem-text", memory.title));
    return card;
  }
  // What Flyd already holds here, folded under one line at the top; he opens it when he wants it.
  var heldOpen = store("flyd-rail-held") === "open";
  function renderHeld(memory, into) {
    var held = (memory && memory.remembers) || [];
    if (!held.length) return false;
    var box = keyed(el("details", "rail-held"), "held");
    box.open = heldOpen;
    var summary = el("summary", "rail-section", "Remembers" + (memory.project ? " · " + memory.project : ""));
    summary.appendChild(el("span", "rail-held-count", " " + held.length));
    box.appendChild(summary);
    held.forEach(function (item) { box.appendChild(railMemory(item, false)); });
    box.addEventListener("toggle", function () { heldOpen = box.open; store("flyd-rail-held", heldOpen ? "open" : "closed"); });
    into.appendChild(box);
    return true;
  }
  function timeOf(iso) { var at = iso ? Date.parse(iso) : NaN; return isNaN(at) ? Infinity : at; }
  // Rebuilding the column on every update reloads each framed page, so a live
  // preview never gets to paint: only what changed is replaced, and nothing kept is moved.
  function keyed(node, key, deep) {
    node.dataset.key = key;
    if (deep) node.dataset.deep = "1";
    return node;
  }
  function keyOf(node) { return node.dataset.key || node.outerHTML; }
  function patch(parent, fresh) {
    var keys = fresh.map(keyOf);
    var children = Array.prototype.slice.call(parent.children);
    var old = new Map(children.map(function (child) { return [keyOf(child), child]; }));
    var kept = children.map(keyOf).filter(function (key) { return keys.indexOf(key) >= 0; });
    var order = keys.filter(function (key) { return old.has(key); });
    if (new Set(keys).size !== keys.length || old.size !== children.length || kept.join("\\n") !== order.join("\\n")) {
      parent.replaceChildren.apply(parent, fresh);
      return;
    }
    children.forEach(function (child) { if (keys.indexOf(keyOf(child)) < 0) child.remove(); });
    var cursor = parent.firstElementChild;
    fresh.forEach(function (node, i) {
      var was = old.get(keys[i]);
      if (!was) { parent.insertBefore(node, cursor); return; }
      if (was.outerHTML !== node.outerHTML) {
        if (node.dataset.deep && was.tagName === node.tagName) {
          was.className = node.className;
          patch(was, Array.prototype.slice.call(node.children));
        } else {
          parent.replaceChild(node, was);
          was = node;
        }
      }
      cursor = was.nextElementSibling;
    });
  }
  function talkAnswer(wrap, talk) {
    // The picture of the result leads; the words follow.
    if (talk.shots && talk.shots.length) wrap.appendChild(shots(talk.shots.map(withToken), "rail-shots"));
    if (talk.page) wrap.appendChild(pageButton(talk.page, "rail-open"));
    // Its own answer only; where it stands is the word over it, never a narrated step.
    if (talk.answerHtml) {
      var answer = el("div", "rail-a rail-a-md");
      answer.innerHTML = talk.answerHtml;
      wrap.appendChild(answer);
    } else if (talk.answer) wrap.appendChild(el("p", "rail-a", talk.answer));
  }
  function talkRest(wrap, talk) {
    (talk.previews || []).forEach(function (card) { wrap.appendChild(railCard(card)); });
    if (SEND_TOKEN && (talk.answer || talk.answerHtml || talk.answered)) wrap.appendChild(replyBox(talk.id, "rail"));
  }
  var STATES = { done: "Done", underway: "Under way", needs: "Needs you" };
  // Where a message stands, in a word, and when he sent it: both small.
  function talkWhen(talk) {
    var line = el("div", "rail-when");
    var state = talk.state || (talk.answer || talk.answerHtml || talk.answered ? "done" : "underway");
    line.appendChild(el("span", "rail-state rail-state--" + state, STATES[state] || ""));
    if (talk.at) {
      line.appendChild(el("span", "", "·"));
      line.appendChild(el("span", "", ago(talk.at)));
    }
    return line;
  }
  // His words as he wrote them; what they were about (an artefact, a decision) named and linked over them.
  function talkHead(wrap, talk) {
    if (talk.about) {
      var about = el("p", "rail-about");
      if (talk.about.url) {
        var link = el("a", "", talk.about.title + " ↗");
        link.href = talk.about.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        about.appendChild(link);
      } else about.textContent = talk.about.title;
      wrap.appendChild(about);
    }
    if (talk.question) wrap.appendChild(el("p", "rail-q", sentence(capital(talk.question))));
    wrap.appendChild(talkWhen(talk));
  }
  // Every row is folded to a line and two until he opens it (see the column's click handler); answered ones step back.
  var talksOpen = new Set();
  function talkFold(wrap, talk) {
    if ((talk.state || "") === "done") wrap.classList.add("is-done");
    if (talksOpen.has(talk.id)) wrap.classList.add("open");
  }

  // His reply to one answer, in a box under it. The box is drawn from its
  // state alone, so a redraw of the column leaves an open box, and what he
  // is typing in it, where they are.
  var replies = new Map();
  function replyState(key) {
    if (!replies.has(key)) replies.set(key, { open: false, note: "", draft: "", sending: false });
    return replies.get(key);
  }
  // The column and the window each keep their own box for the same answer.
  function replyBox(id, place) {
    var state = replyState(place + ":" + id);
    var box = keyed(el("div", "reply"), "reply:" + id);
    // Reply opens the box and steps aside; open, the box is a card like a
    // learned memory, its label and Close over his words and Send.
    var opener = el("button", "reply-open", "Reply");
    opener.type = "button";
    opener.setAttribute("aria-expanded", state.open ? "true" : "false");
    opener.hidden = state.open;
    box.appendChild(opener);
    var form = el("form");
    form.hidden = !state.open;
    var input = el("textarea", "reply-input");
    input.rows = 1;
    input.placeholder = "Reply to this…";
    input.value = state.draft;
    input.setAttribute("aria-label", "Reply to this answer");
    var head = el("div", "reply-head");
    head.appendChild(el("span", "reply-kicker", "Reply"));
    var close = el("button", "reply-close", "Close");
    close.type = "button";
    head.appendChild(close);
    var send = el("button", "reply-send", "Send");
    send.type = "submit";
    var row = el("div", "reply-row");
    row.appendChild(input);
    row.appendChild(send);
    form.appendChild(head);
    form.appendChild(row);
    box.appendChild(form);
    var note = el("span", "reply-note", state.note);
    note.setAttribute("role", "status");
    note.hidden = !state.note;
    box.appendChild(note);
    function show(open) {
      state.open = open;
      form.hidden = !open;
      opener.hidden = open;
      opener.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) input.focus(); else opener.focus();
    }
    function say(text) { state.note = text; note.textContent = text; note.hidden = !text; }
    opener.addEventListener("click", function () { say(""); show(true); });
    close.addEventListener("click", function () { say(""); show(false); });
    input.addEventListener("input", function () { state.draft = input.value; });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); show(false); return; }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text || !current || state.sending) return;
      state.sending = true;
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: current, text: text, replyTo: id }) }, true)
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "not sent"); return data; }); })
        .then(function () { input.value = ""; state.draft = ""; say(""); show(false); })
        .catch(function (error) { say("Not sent: " + (error.message || "try again")); })
        .then(function () { state.sending = false; });
    });
    return box;
  }
  // Words he selects in a message take a comment: a small Comment button by
  // the selection, then a card that quotes them, his words and Send. It goes
  // to whoever is doing the work, naming the conversation the words came from.
  var PASSAGE_CHARS = ${PASSAGE_CHARS};
  function passageComments() {
    var pop = el("div", "passage");
    pop.hidden = true;
    var opener = el("button", "passage-open", "Comment");
    opener.type = "button";
    var form = el("form", "passage-card");
    form.hidden = true;
    var head = el("div", "reply-head");
    head.appendChild(el("span", "reply-kicker", "Comment"));
    var close = el("button", "reply-close", "Close");
    close.type = "button";
    head.appendChild(close);
    var quote = el("blockquote", "passage-quote");
    var input = el("textarea", "reply-input passage-input");
    input.rows = 1;
    input.maxLength = 4000;
    input.placeholder = "What about it?";
    input.setAttribute("aria-label", "Your comment on the selected words");
    var send = el("button", "reply-send", "Send");
    send.type = "submit";
    var row = el("div", "reply-row");
    row.appendChild(input);
    row.appendChild(send);
    var note = el("span", "reply-note");
    note.setAttribute("role", "status");
    note.hidden = true;
    form.appendChild(head);
    form.appendChild(quote);
    form.appendChild(row);
    form.appendChild(note);
    pop.appendChild(opener);
    pop.appendChild(form);
    document.body.appendChild(pop);
    // What he selected: the words, whose they were, and where they sit on screen.
    var picked = null;
    var sending = false;
    var selecting = false;
    var marks = window.CSS && CSS.highlights && typeof Highlight === "function" ? CSS.highlights : null;
    function messageOf(node) {
      var at = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!at || at.closest("textarea, input, form, button")) return null;
      var msg = at.closest(".msg");
      return msg && main.contains(msg) ? msg : null;
    }
    function selected() {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
      var range = selection.getRangeAt(0);
      var msg = messageOf(range.commonAncestorContainer);
      var text = selection.toString().replace(/[ \\t]+\\n/g, "\\n").trim();
      if (!msg || !text || !current) return null;
      return { session: current, range: range.cloneRange(), text: text.slice(0, PASSAGE_CHARS), from: msg.classList.contains("user") ? "user" : "assistant" };
    }
    function place() {
      if (!picked) return;
      // A redraw of the message drops the selection; an open card stays where it was.
      if (!picked.range.startContainer.isConnected) { if (form.hidden) hide(); return; }
      // Comment sits over the first line he selected, the card under the last,
      // each starting where his selection starts and kept in the conversation's column.
      var lines = picked.range.getClientRects();
      var first = lines.length ? lines[0] : picked.range.getBoundingClientRect();
      var whole = picked.range.getBoundingClientRect();
      var width = pop.offsetWidth;
      var height = pop.offsetHeight;
      var edge = Math.min(window.innerWidth - 16, main.getBoundingClientRect().right || window.innerWidth);
      var left = Math.max(16, Math.min(first.left, edge - width));
      var top = form.hidden ? first.top - height - 8 : whole.bottom + 12;
      if (form.hidden && top < 64) top = whole.bottom + 8;
      if (!form.hidden && top + height > window.innerHeight - 16) top = first.top - height - 12;
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(Math.max(16, Math.min(top, window.innerHeight - height - 16))) + "px";
    }
    function mark(on) {
      if (!marks) return;
      if (on && picked) marks.set("passage", new Highlight(picked.range)); else marks.delete("passage");
    }
    function say(text) { note.textContent = text; note.hidden = !text; }
    function hide() {
      pop.hidden = true;
      pop.classList.remove("shown", "open");
      form.hidden = true;
      opener.hidden = false;
      picked = null;
      say("");
      mark(false);
    }
    function offer(pick) {
      picked = pick;
      opener.hidden = false;
      form.hidden = true;
      pop.hidden = false;
      place();
      requestAnimationFrame(function () { pop.classList.add("shown"); });
    }
    function check() {
      if (!form.hidden || sending || selecting) return;
      var pick = selected();
      if (pick) offer(pick); else hide();
    }
    var pending = 0;
    document.addEventListener("selectionchange", function () {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(check);
    });
    document.addEventListener("pointerdown", function (event) { selecting = !!messageOf(event.target); });
    document.addEventListener("pointerup", function () {
      selecting = false;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(check);
    });
    // Pressing Comment keeps the selection it is about.
    opener.addEventListener("mousedown", function (event) { event.preventDefault(); });
    opener.addEventListener("click", function () {
      if (!picked) return;
      quote.textContent = picked.text;
      input.value = "";
      say("");
      send.disabled = false;
      opener.hidden = true;
      form.hidden = false;
      pop.classList.add("open");
      mark(true);
      place();
      input.focus();
    });
    close.addEventListener("click", hide);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); hide(); return; }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !pop.hidden && form.hidden) hide();
    });
    // A click elsewhere puts the card away unless he has started writing.
    document.addEventListener("mousedown", function (event) {
      if (pop.hidden || pop.contains(event.target) || sending) return;
      if (form.hidden || !input.value.trim()) hide();
    });
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text || !picked || sending) return;
      sending = true;
      send.disabled = true;
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: picked.session, passage: { quote: picked.text, from: picked.from }, text: text }) }, true)
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "not sent"); return data; }); })
        .then(function () {
          input.value = "";
          say("Sent to Flyd");
          var selection = window.getSelection();
          if (selection) selection.removeAllRanges();
          setTimeout(function () { if (!input.value.trim()) hide(); }, 1600);
        })
        .catch(function (error) { send.disabled = false; say("Not sent: " + (error.message || "try again")); })
        .then(function () { sending = false; });
    });
  }
  if (SEND_TOKEN) passageComments();
  // An answer Flyd gave for him by one of his standing rules says so in one
  // line, with the rule; Undo tells the session to hold off until he answers.
  function wireAuto(target, message, said) {
    var auto = message.answeredFor !== undefined;
    target.classList.toggle("auto", auto);
    var old = target.querySelector(":scope > .auto-line");
    if (old) old.remove();
    if (!auto) return;
    var line = el("p", "auto-line");
    line.appendChild(el("span", "auto-what", (message.undone ? "You took back “" : "Answered for you: “") + said + "”"));
    if (message.answeredFor) line.appendChild(document.createTextNode(" · your rule: " + sentence(message.answeredFor)));
    if (SEND_TOKEN && !message.undone) {
      var undo = el("button", "auto-undo", "Undo");
      undo.type = "button";
      undo.setAttribute("aria-label", "Undo the answer Flyd gave for you");
      undo.addEventListener("click", function () {
        if (undo.disabled || !current) return;
        undo.disabled = true;
        undo.textContent = "Taking back…";
        authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: current, undo: message.id }) }, true)
          .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "not sent"); }); })
          .then(function () { undo.textContent = "Taken back"; })
          .catch(function (error) { undo.disabled = false; undo.textContent = "Undo (" + (error.message || "try again") + ")"; });
      });
      line.appendChild(undo);
    }
    target.insertBefore(line, target.querySelector(":scope > .body"));
  }
  // In the window: an answer, or the outcome under his note, takes a reply the same way.
  function replyTarget(message) {
    if (message.role === "assistant") return message.answers || null;
    return message.settled && message.waiting ? message.id : null;
  }
  function wireReply(el, message) {
    // A reply that asks him something is answered in its own card instead.
    var target = SEND_TOKEN && !message.choice ? replyTarget(message) : null;
    var old = el.querySelector(":scope > .reply");
    if (old && (!target || old.dataset.key !== "reply:" + target)) { old.remove(); old = null; }
    if (!target) return;
    if (!old) old = replyBox(target, "window");
    if (el.lastElementChild !== old) el.appendChild(old);
  }
  // A reply that asks him something carries its question under it: one tap per
  // option, or his own words. The answer goes back where the question came from,
  // the way a reply to an answer does. Drawn from its state alone, so a redraw
  // keeps what he typed and what was sent.
  var choiceStates = new Map();
  function wireChoice(target, message) {
    var choice = SEND_TOKEN ? message.choice : null;
    var key = choice ? "choice:" + choice.replyTo + ":" + choice.question + ":" + choice.options.join("|") + (choice.steps ? ":" + JSON.stringify(choice.steps) : "") : "";
    var old = target.querySelector(":scope > .choice");
    target.classList.toggle("asks", !!choice);
    if (old && old.dataset.key !== key) { old.remove(); old = null; }
    if (!choice) return;
    if (!old) old = choiceCard(choice, key);
    if (target.lastElementChild !== old) target.appendChild(old);
  }
  function choiceCard(choice, key) {
    if (!choiceStates.has(key)) choiceStates.set(key, { draft: "", note: "", sent: false, sending: false, steps: { at: 0, answers: [] } });
    var state = choiceStates.get(key);
    var card = el("div", "choice");
    card.dataset.key = key;
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", choice.question);
    card.appendChild(el("p", "choice-q", choice.question));
    if (choice.steps && choice.steps.length) { card.firstChild.classList.add("choice-lead"); return stepsCard(card, choice, state); }
    var buttons = [];
    if (choice.options.length) {
      var options = el("div", "choice-options");
      choice.options.forEach(function (option) {
        var button = el("button", "choice-option", option);
        button.type = "button";
        button.addEventListener("click", function () { deliver(option); });
        buttons.push(button);
        options.appendChild(button);
      });
      card.appendChild(options);
    }
    var form = el("form", "choice-free");
    var input = el("textarea", "reply-input choice-input");
    input.rows = 1;
    input.placeholder = choice.options.length ? "Or say something else…" : "Your answer…";
    input.value = state.draft;
    input.setAttribute("aria-label", "Answer: " + choice.question);
    var send = el("button", "reply-send", "Send");
    send.type = "submit";
    form.appendChild(input);
    form.appendChild(send);
    card.appendChild(form);
    var note = el("span", "reply-note", state.note);
    note.setAttribute("role", "status");
    note.hidden = !state.note;
    card.appendChild(note);
    function say(text) { state.note = text; note.textContent = text; note.hidden = !text; }
    function settle() {
      buttons.forEach(function (button) { button.disabled = state.sent || state.sending; });
      input.disabled = send.disabled = state.sent || state.sending;
      form.hidden = state.sent;
    }
    function deliver(text) {
      text = String(text || "").trim();
      if (!text || !current || state.sending || state.sent) return;
      state.sending = true;
      settle();
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: current, text: text, replyTo: choice.replyTo }) }, true)
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "not sent"); return data; }); })
        .then(function () { state.sent = true; state.draft = ""; input.value = ""; say("Sent: “" + text + "”"); })
        .catch(function (error) { say("Not sent: " + (error.message || "try again")); })
        .then(function () { state.sending = false; settle(); });
    }
    input.addEventListener("input", function () { state.draft = input.value; });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", function (event) { event.preventDefault(); deliver(input.value); });
    settle();
    return card;
  }
  // Several questions in one reply: the card asks them one after another, and his
  // answers go back together, only when he sends them.
  function stepsCard(card, choice, state) {
    var note = el("span", "reply-note", state.note);
    note.setAttribute("role", "status");
    note.hidden = !state.note;
    function say(text) { state.note = text; note.textContent = text; note.hidden = !text; }
    var steps = stepper(choice.steps, state.steps, { option: "choice-option", input: "reply-input", next: "reply-send" }, function () {}, function (text) {
      if (!current || state.steps.sending || state.steps.sent) return;
      state.steps.sending = true;
      steps.sync();
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: current, text: text, replyTo: choice.replyTo }) }, true)
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "not sent"); return data; }); })
        .then(function () { state.steps.sent = true; say("Sent your answers"); })
        .catch(function (error) { say("Not sent: " + (error.message || "try again")); })
        .then(function () { state.steps.sending = false; steps.draw(); });
    });
    card.appendChild(steps.el);
    card.appendChild(note);
    return card;
  }
  // One question at a time: a tap or his own words answers it and moves to the
  // next, Back goes to the one before, and nothing is sent until the last step,
  // where he sees every answer and sends them as one reply. \`state\` is
  // { at, answers, sent, sending }; \`look\` names the surface's option, input
  // and button classes; \`save\` keeps the state, \`send\` delivers the reply.
  function stepper(steps, state, look, save, send) {
    var wrap = el("div", "stepper");
    var controls = [];
    function answerFor(index) { return state.answers[index] || ""; }
    function reply() {
      return steps.map(function (step, index) { return (index + 1) + ". " + step.question + " " + answerFor(index); }).join("\\n");
    }
    function go(at) { state.at = Math.max(0, Math.min(steps.length, at)); save(); draw(); }
    function answer(index, text) {
      text = String(text || "").trim();
      if (!text || state.sent || state.sending) return;
      state.answers[index] = text;
      go(index + 1);
    }
    function backButton() {
      var back = el("button", "step-back", "Back");
      back.type = "button";
      back.addEventListener("click", function () { go(state.at - 1); });
      controls.push(back);
      return back;
    }
    function draw() {
      wrap.textContent = "";
      controls = [];
      var at = Math.min(state.at || 0, steps.length);
      if (at === steps.length) {
        wrap.appendChild(el("p", "step-count", state.sent ? "Your answers" : "Your answers, ready to send"));
        var list = el("ol", "step-review");
        steps.forEach(function (step, index) {
          var item = el("li");
          item.appendChild(el("span", "step-review-q", step.question));
          item.appendChild(el("span", "step-review-a", answerFor(index)));
          list.appendChild(item);
        });
        wrap.appendChild(list);
        if (!state.sent) {
          var nav = el("div", "step-nav");
          nav.appendChild(backButton());
          var go2 = el("button", "step-send", "Send answers");
          go2.type = "button";
          go2.addEventListener("click", function () { if (!state.sending && !state.sent) send(reply()); });
          controls.push(go2);
          nav.appendChild(go2);
          wrap.appendChild(nav);
        }
        sync();
        return;
      }
      var step = steps[at];
      wrap.appendChild(el("p", "step-count", "Question " + (at + 1) + " of " + steps.length));
      wrap.appendChild(el("p", "step-q", step.question));
      var given = answerFor(at);
      if (step.options.length) {
        var options = el("div", "step-options");
        options.setAttribute("role", "group");
        options.setAttribute("aria-label", "Options");
        step.options.forEach(function (option) {
          var button = el("button", look.option, option);
          button.type = "button";
          button.setAttribute("aria-pressed", String(given === option));
          button.addEventListener("click", function () { answer(at, option); });
          controls.push(button);
          options.appendChild(button);
        });
        wrap.appendChild(options);
      }
      var form = el("form", "step-free");
      var input = el("textarea", look.input + " step-input");
      input.rows = 1;
      input.placeholder = step.options.length ? "Or say something else…" : "Your answer…";
      input.setAttribute("aria-label", "Answer: " + step.question);
      if (given && step.options.indexOf(given) === -1) input.value = given;
      var next = el("button", look.next, "Next");
      next.type = "submit";
      form.appendChild(input);
      form.appendChild(next);
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
      });
      form.addEventListener("submit", function (event) { event.preventDefault(); answer(at, input.value); });
      controls.push(input, next);
      wrap.appendChild(form);
      if (at > 0) {
        var row = el("div", "step-nav");
        row.appendChild(backButton());
        wrap.appendChild(row);
      }
      sync();
    }
    function sync() { controls.forEach(function (control) { control.disabled = !!state.sending || !!state.sent; }); }
    if (!state.answers) state.answers = [];
    draw();
    return { el: wrap, draw: draw, sync: sync };
  }
  function railTalk(talk) {
    var wrap = keyed(el("div", "rail-talk"), "talk:" + talk.id, true);
    // A reply whose answer has scrolled out of the column says what it answers.
    if (talk.replyQuote) wrap.appendChild(el("span", "reply-ref", "Replying to “" + talk.replyQuote + "”"));
    talkHead(wrap, talk);
    talkAnswer(wrap, talk);
    talkFold(wrap, talk);
    talkRest(wrap, talk);
    if (talk.replies && talk.replies.length) {
      var thread = keyed(el("div", "rail-replies"), "replies:" + talk.id, true);
      talk.replies.forEach(function (reply) {
        var sub = keyed(el("div", "rail-talk"), "talk:" + reply.id, true);
        talkHead(sub, reply);
        talkAnswer(sub, reply);
        talkFold(sub, reply);
        talkRest(sub, reply);
        thread.appendChild(sub);
      });
      wrap.appendChild(thread);
    }
    return wrap;
  }
  var lastRail = null;
  var railFilled = false;
  // The column shows when it has something: a call, a job, done work, or his messages; unless he hid it.
  function showRail() {
    railEl.hidden = railHidden || !(railFilled || briefFilled);
    setRail(railOn());
  }
  function renderRail(rail) {
    lastRail = rail;
    if (!rail) { railFilled = false; showRail(); return; }
    var signature = JSON.stringify([rail.conversations, rail.artefacts, rail.memory, Array.from(talksOpen)]);
    if (signature === railSignature) { showRail(); return; }
    railSignature = signature;
    var next = el("div");
    var nextArtefacts = el("div");
    var talks = rail.conversations || [];
    // Chat order: the newest message last, at the bottom, which stays in view
    // unless he has scrolled up to read.
    var pinned = !railBody.firstElementChild || railBody.scrollHeight - railBody.scrollTop - railBody.clientHeight < 40;
    var held = renderHeld(rail.memory, next);
    var cards = rail.artefacts || [];
    if (cards.length) {
      cards.forEach(function (card) { nextArtefacts.appendChild(railCard(card)); });
    }
    // What Flyd learned while we talked sits in the conversation, after the message it learned it from.
    var learned = ((rail.memory && rail.memory.remembering) || []).slice().sort(function (a, b) { return timeOf(a.at) - timeOf(b.at); });
    var told = 0;
    if (talks.length) next.appendChild(el("div", "rail-section", "Conversations"));
    talks.forEach(function (talk) {
      var start = talk.at ? Date.parse(talk.at) : NaN;
      while (told < learned.length && timeOf(learned[told].at) < start) next.appendChild(railMemory(learned[told++], true));
      next.appendChild(railTalk(talk));
    });
    while (told < learned.length) next.appendChild(railMemory(learned[told++], true));
    patch(railBody, Array.prototype.slice.call(next.children));
    patch(artefactBody, Array.prototype.slice.call(nextArtefacts.children));
    railFilled = talks.length > 0 || cards.length > 0 || held || learned.length > 0;
    showRail();
    if (pinned) railBody.scrollTop = railBody.scrollHeight;
  }
  // A folded row opens with a click on its words or its answer, and stays open across updates.
  railBody.addEventListener("click", function (event) {
    var hit = event.target instanceof Element ? event.target.closest(".rail-talk:not(.open) > .rail-q, .rail-talk:not(.open) > .rail-a") : null;
    if (!hit || (event.target instanceof Element && event.target.closest("a"))) return;
    var talk = hit.parentElement;
    talksOpen.add(String(talk.dataset.key || "").replace(/^talk:/, ""));
    talk.classList.add("open");
  });
  function hideRail(hidden) {
    railHidden = hidden;
    store("flyd-rail", hidden ? "off" : "on");
    railToggle.setAttribute("aria-checked", String(!hidden));
    showRail();
  }
  var railToggle = document.getElementById("rail-toggle");
  railToggle.setAttribute("aria-checked", String(!railHidden));
  railToggle.addEventListener("click", function () { hideRail(!railHidden); });
  document.getElementById("rail-hide").addEventListener("click", function () { hideRail(true); });

  // The chat box at the foot of every artefact: his words about that one thing go
  // to firstmate naming it, and the line under the box says where they are in
  // plain words: sent, then "Flyd has it" once firstmate has read the note.
  // \`target\` is what the words answer: a fleet decision, a reply's question, or
  // the artefact itself ({ about: { title, task, url } }).
  function artefactChat(key, target, label) {
    var state = {};
    try { state = JSON.parse(sessionStorage.getItem(key) || "{}"); } catch (_) {}
    if (state.receipt === "sending") state.receipt = "";
    var form = el("form", "art-chat");
    form.setAttribute("aria-label", label);
    var input = el("textarea", "art-chat-input");
    input.rows = 1;
    input.maxLength = 4000;
    input.placeholder = label;
    input.setAttribute("aria-label", label);
    input.value = state.text || "";
    var send = el("button", "art-chat-send", "Send");
    send.type = "submit";
    // Pressing Send leaves the caret in the box, so nothing in the row moves under the click.
    send.addEventListener("mousedown", function (event) { event.preventDefault(); });
    // Screenshots he pastes into the box go with his words about this artefact;
    // a reply to an answer has no room for them, so it takes words only.
    var takesImages = !!(target.about || target.decision);
    var images = [];
    var thumbs = el("div", "art-chat-images");
    thumbs.hidden = true;
    var receipt = el("p", "art-chat-receipt");
    receipt.setAttribute("role", "status");
    receipt.setAttribute("aria-live", "polite");
    var watching = null;
    function save() { try { sessionStorage.setItem(key, JSON.stringify(state)); } catch (_) {} }
    function paint() {
      receipt.textContent = state.error || (state.receipt === "read" ? "Flyd has it" : state.receipt === "sent" ? "Sent to Flyd" : state.receipt === "sending" ? "Sending…" : "");
      receipt.classList.toggle("problem", !!state.error);
      receipt.classList.toggle("sent", !state.error && (state.receipt === "sent" || state.receipt === "read"));
      // A picture alone says enough about an artefact; an answer still needs words.
      send.disabled = state.receipt === "sending" || !(input.value.trim() || (target.about && images.length));
      if (chat.onPaint) chat.onPaint();
    }
    function paintImages() {
      thumbs.textContent = "";
      images.forEach(function (image, index) {
        var item = el("div", "attachment");
        var img = el("img");
        img.src = image.url;
        img.alt = "Pasted image " + (index + 1);
        img.addEventListener("click", function () { openImage(image.url); });
        item.appendChild(img);
        var remove = el("button", "", "×");
        remove.type = "button";
        remove.setAttribute("aria-label", "Remove image");
        remove.addEventListener("mousedown", function (event) { event.preventDefault(); });
        remove.addEventListener("click", function () { images.splice(index, 1); paintImages(); paint(); });
        item.appendChild(remove);
        thumbs.appendChild(item);
      });
      thumbs.hidden = images.length === 0;
    }
    if (takesImages) input.addEventListener("paste", function (event) {
      var files = Array.prototype.map.call((event.clipboardData && event.clipboardData.items) || [], function (item) {
        return item.kind === "file" && ["image/png", "image/jpeg", "image/gif", "image/webp"].indexOf(item.type) !== -1 ? item.getAsFile() : null;
      }).filter(Boolean);
      if (!files.length) return;
      if (!Array.prototype.some.call(event.clipboardData.items, function (item) { return item.kind === "string" && item.type === "text/plain"; })) event.preventDefault();
      files.forEach(function (file) {
        if (images.length >= 4) { state.error = "4 images at most"; paint(); return; }
        if (file.size > ${MAX_IMAGE_BYTES}) { state.error = "Images must be under " + Math.round(${MAX_IMAGE_BYTES} / 1048576) + "MB"; paint(); return; }
        var reader = new FileReader();
        reader.onload = function () {
          if (images.length >= 4) return;
          var url = String(reader.result);
          images.push({ url: url, mediaType: file.type, data: url.slice(url.indexOf(",") + 1) });
          state.error = "";
          paintImages();
          paint();
        };
        reader.readAsDataURL(file);
      });
    });
    // Firstmate reads a note by acknowledging it; until then the line says only that it was sent.
    function watch() {
      if (watching || !state.note || state.receipt !== "sent") return;
      watching = setInterval(function () {
        if (!form.isConnected || state.receipt !== "sent") { clearInterval(watching); watching = null; return; }
        fetch("/api/note?id=" + encodeURIComponent(state.note) + "&token=" + encodeURIComponent(VIEW_TOKEN))
          .then(function (response) { return response.ok ? response.json() : null; })
          .then(function (data) { if (data && data.receipt === "read") { state.receipt = "read"; save(); paint(); } })
          .catch(function () {});
      }, 5000);
    }
    function deliver(text, done) {
      state.receipt = "sending";
      state.error = "";
      paint();
      var sending = takesImages ? images.slice() : [];
      var body = Object.assign({ text: text }, target);
      if (sending.length) body.images = sending.map(function (image) { return { mediaType: image.mediaType, data: image.data }; });
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, true)
        .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) throw new Error(result.data.error || "Not delivered; try again.");
          state.receipt = "sent";
          state.note = result.data.id;
          // Only what went is cleared: one pasted while it was on its way stays for the next.
          images = images.filter(function (image) { return sending.indexOf(image) === -1; });
          paintImages();
          if (done) done();
          save();
          paint();
          watch();
        })
        .catch(function (error) { state.receipt = ""; state.error = error.message || "Not delivered; try again."; paint(); });
    }
    input.addEventListener("input", function () { state.text = input.value; state.error = ""; save(); paint(); });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (send.disabled) return;
      deliver(text, function () { input.value = ""; state.text = ""; });
    });
    // One field: his pasted images over his words, Send inside it on the same row.
    var field = el("div", "art-chat-field");
    var row = el("div", "art-chat-row");
    row.appendChild(input);
    row.appendChild(send);
    field.appendChild(thumbs);
    field.appendChild(row);
    form.appendChild(field);
    form.appendChild(receipt);
    var chat = { form: form, state: state, deliver: deliver, save: save, onPaint: null };
    paint();
    watch();
    return chat;
  }
  // A scene's foot: a question's options, one tap each, then the chat box.
  function sceneAsk(box, key) {
    var wrap = el("div", "scene-ask");
    wrap.dataset.key = key;
    var decision = box.decision;
    var link = box.open || (box.links || []).find(function (one) { return !one.closed; });
    var about = { title: box.title };
    if (box.task) about.task = box.task;
    if (link) about.url = link.url;
    var target = !decision ? { about: about } : decision.replyTo ? { session: current, replyTo: decision.replyTo } : { decision: decision.task };
    var chat = artefactChat(key, target, decision && (decision.choices.length || decision.steps) ? "Or say something else…" : decision ? "Your answer…" : "Say something about this…");
    if (decision && decision.steps && decision.steps.length) {
      // Several questions: one at a time, a tap moves on, and the answers go together from the last step.
      if (!chat.state.steps) chat.state.steps = { at: 0, answers: [] };
      chat.state.steps.sending = false;
      var steps = stepper(decision.steps, chat.state.steps, { option: "choice-pick", input: "art-chat-input", next: "art-chat-send" }, chat.save, function (text) {
        chat.deliver(text, function () { chat.state.steps.sent = true; });
      });
      // Redrawn only when sending starts or ends, so a half-typed answer stays put.
      chat.onPaint = function () {
        var sending = chat.state.receipt === "sending";
        if (sending === !!chat.state.steps.sending && !(chat.state.steps.sent && steps.el.querySelector(".step-send"))) return;
        chat.state.steps.sending = sending;
        steps.draw();
      };
      wrap.appendChild(steps.el);
      // Each question takes his own words; the box below only says where the answers are.
      chat.form.classList.add("art-chat--receipt");
    } else if (decision && decision.choices.length) {
      var choices = el("div", "choices");
      choices.setAttribute("role", "group");
      choices.setAttribute("aria-label", "Options");
      var buttons = decision.choices.map(function (choice) {
        var button = el("button", "choice-pick");
        button.type = "button";
        button.appendChild(el("span", "", choice));
        if (choice === decision.recommended) button.appendChild(el("small", "", "recommended"));
        button.addEventListener("click", function () {
          if (chat.state.picked || chat.state.receipt === "sending") return;
          chat.deliver(choice, function () { chat.state.picked = choice; });
        });
        choices.appendChild(button);
        return button;
      });
      // The one he picked stays lit; the others step back once it is sent.
      chat.onPaint = function () {
        buttons.forEach(function (button, index) {
          var picked = chat.state.picked === decision.choices[index];
          button.setAttribute("aria-pressed", String(picked));
          button.disabled = !!chat.state.picked && !picked;
        });
      };
      chat.onPaint();
      wrap.appendChild(choices);
    }
    wrap.appendChild(chat.form);
    return wrap;
  }

  // A "needs you" line in a reply is answerable where it stands: the answer goes
  // to firstmate as a note, like the answers to an artefact question.
  function wireAsks(root) {
    root.querySelectorAll(".status-card .sc-row[data-ask]").forEach(function (row) {
      var what = row.querySelector(".sc-what");
      if (!what || what.querySelector(".sc-ask")) return;
      var ask = row.dataset.ask || "";
      var key = "flyd-ask:" + ask;
      var form = el("form", "sc-ask");
      var input = el("textarea", "sc-ask-input");
      input.rows = 1;
      input.placeholder = "Answer…";
      input.setAttribute("aria-label", "Answer: " + ask);
      var send = el("button", "sc-ask-send", "Send");
      send.type = "submit";
      var receipt = el("span", "sc-ask-receipt");
      receipt.setAttribute("role", "status");
      receipt.setAttribute("aria-live", "polite");
      var settled = "";
      try { settled = sessionStorage.getItem(key) || ""; } catch (_) {}
      if (settled && settled.indexOf("Sent to firstmate") === 0) { receipt.textContent = settled; input.disabled = true; }
      function refresh() { send.disabled = input.disabled || !!receipt.textContent || !input.value.trim(); }
      refresh();
      input.addEventListener("input", refresh);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (send.disabled || !input.value.trim()) return;
        send.disabled = true;
        receipt.textContent = "Sending…";
        authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: current, text: 'On "' + ask + '": ' + input.value.trim() }) }, true)
          .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
          .then(function (result) {
            if (!result.ok) throw new Error(result.data.error || "not delivered");
            receipt.textContent = "Sent to firstmate.";
            input.disabled = true;
            try { sessionStorage.setItem(key, receipt.textContent); } catch (_) {}
          })
          .catch(function (error) { receipt.textContent = error.message || "Not delivered; try again."; refresh(); });
      });
      form.appendChild(input);
      form.appendChild(send);
      form.appendChild(receipt);
      what.appendChild(form);
    });
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
    source.addEventListener("unread", function (event) { showUnread(JSON.parse(event.data)); });
    source.onerror = function () {
      problem.textContent = "reconnecting…";
      // The browser retries a dropped stream by itself, but gives up for good
      // once the view refuses it: after a restart the old token is no longer
      // the view's. Then a new view is up; load it, its code and its token.
      if (source.readyState === 2 /* CLOSED */) rejoin(sessionId);
    };
    source.onopen = function () { problem.textContent = ""; rejoinDelay = 1000; };
  }
  var rejoinDelay = 1000;
  var rejoining = null;
  function rejoin(sessionId) {
    if (rejoining) return;
    rejoining = setTimeout(function () {
      fetch("/api/token").then(function (r) { return r.json(); }).then(function (data) {
        rejoining = null;
        // The draft is kept on the way out (pagehide), so reloading loses nothing.
        if (data.token && data.token !== VIEW_TOKEN) { location.reload(); return; }
        rejoinDelay = Math.min(rejoinDelay * 2, 15000);
        connect(sessionId);
      }).catch(function () {
        // The view is not up yet: try again, less often each time.
        rejoining = null;
        rejoinDelay = Math.min(rejoinDelay * 2, 15000);
        rejoin(sessionId);
      });
    }, rejoinDelay);
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
    if (path !== "/api/send") return tokenFetch(path, init, retry);
    notesOut += 1;
    return tokenFetch(path, init, retry).then(function (response) {
      return response.clone().json().catch(function () { return null; }).then(function (data) {
        notesOut -= 1;
        if (response.ok && data && data.id) delivered.add(data.id);
        clearLanded();
        return response;
      });
    }, function (error) {
      notesOut -= 1;
      throw error;
    });
  }
  function tokenFetch(path, init, retry) {
    var headers = Object.assign({}, init.headers || {}, { "x-flyd-view-token": SEND_TOKEN });
    return fetch(path, Object.assign({}, init, { headers: headers })).then(function (response) {
      if (response.status !== 403 || !retry) return response;
      return fetch("/api/token").then(function (r) { return r.json(); }).then(function (data) {
        if (!data.token) return response;
        SEND_TOKEN = data.token;
        return tokenFetch(path, init, false);
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
    setLine(state, ${JSON.stringify(RECEIVED)});
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

  // A send whose answer never came may still have landed: when the view answers
  // straight after, he is told it may not have sent and resends it himself;
  // when it does not, it was not sent.
  function deliver(payload) {
    return authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: payload }, true).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || "not sent");
        return data;
      });
    }, function (error) {
      return fetch("/api/token").then(function () { return { unsure: true }; }, function () { throw error; });
    });
  }

  // Push-to-talk from Flyd.app: the words appear in the box as they are
  // heard and go out on release like a typed message. Whatever was typed
  // before stays in front of them.
  var voiceBase = null;
  // Speaking while a reply box is open fills that box, and sends it, instead of the message box.
  var voiceInput = null;
  function voiceField() { return voiceInput || input; }
  function joinVoice(text) {
    return voiceBase && voiceBase.trim() ? voiceBase.trimEnd() + " " + text : text;
  }
  function voiceShow() {
    var field = voiceField();
    if (field === input) grow(); else field.dispatchEvent(new Event("input"));
  }
  function endVoice() {
    composer.classList.remove("listening", "transcribing");
    voiceBase = null;
    voiceInput = null;
  }
  window.flydVoice = {
    start: function () {
      typingPredictions.reset();
      var active = document.activeElement;
      voiceInput = active && active.classList && active.classList.contains("reply-input") ? active : null;
      // Speaking is conversation: the terminal comes back for it, this once.
      if (!voiceInput && onShow()) applyScreen("terminal", false);
      if (!voiceInput && composer.hidden) return;
      voiceBase = voiceField().value;
      if (voiceInput) return;
      composer.classList.add("listening");
      composer.classList.remove("transcribing");
    },
    draft: function (text) {
      typingPredictions.reset();
      if (voiceBase === null) return;
      voiceField().value = joinVoice(text);
      voiceShow();
    },
    transcribing: function () {
      typingPredictions.reset();
      if (voiceInput) return;
      composer.classList.remove("listening");
      composer.classList.add("transcribing");
    },
    send: function (text) {
      var field = voiceField();
      if (voiceBase === null) voiceBase = field.value;
      field.value = joinVoice(text).trim();
      endVoice();
      if (field !== input) {
        field.dispatchEvent(new Event("input"));
        if (field.value && field.form) field.form.requestSubmit();
        return;
      }
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
      var field = voiceField();
      if (voiceBase !== null) { field.value = voiceBase; voiceShow(); }
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
    el.typed = letters(text);
    el.attached = sending.length;
    function send() {
      el.knownIds = new Set(nodes.keys());
      el.sentAt = Date.now();
      deliver(payload).then(function (sent) {
        sendsInFlight -= 1;
        if (sent.unsure) {
          if (arrived(el)) { el.remove(); return; }
          var line = el.querySelector(".state");
          el.classList.add("unsure");
          line.classList.add("still");
          living(line, "may not have sent -");
          var resend = document.createElement("button");
          resend.type = "button";
          resend.className = "resend";
          resend.textContent = "tap to resend";
          resend.addEventListener("click", function () {
            resend.remove();
            el.classList.remove("unsure");
            line.classList.remove("still");
            living(line, ${JSON.stringify(RECEIVED)});
            sendsInFlight += 1;
            send();
          });
          line.after(resend);
          return;
        }
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
        carried.set(sent.id, state.dataset.line || state.textContent);
      }).catch(function (error) {
        sendsInFlight -= 1;
        el.classList.add("failed");
        el.querySelector(".state").textContent = "not sent: " + error.message + " (click to dismiss)";
        el.addEventListener("click", function () { el.remove(); });
        if (!input.value && !attachments.length) { input.value = text; attachments = sending; renderAttachments(); }
      });
    }
    send();
  });
  restoreDraft();


  // Artefact view: Flyd on TV. Core's boxes become scenes that take turns,
  // one at a time like title cards: the work with pictures of it first (in a
  // browser and a phone), then the calls only he can make, what Flyd sees
  // coming, and the stories told in words. The instruments become one quiet
  // line under the stage. The
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
  var ambient = document.getElementById("ambient");
  var air = document.getElementById("air");
  var flip = document.getElementById("flip");
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // What each kind is called on screen.
  var WORDS = { call: "needs you", live: "under way", ready: "waiting to land", landed: "landed", waiting: "held up", next: "up next", news: "also", clear: "all clear", warn: "coming up" };
  // The screen is for showing the work: pictured stories lead, then his calls.
  var RANK = { pictured: 0, call: 1, note: 2, alert: 3, story: 4 };
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
    // A stable sort: the work with pictures, then calls, the situation, what is coming, the stories in words.
    function rank(box) { return box.kind === "story" && shotsOf(box).length ? RANK.pictured : RANK[box.kind]; }
    stage = stage.map(function (box, index) { return { box: box, index: index }; })
      .sort(function (a, b) { return (rank(a.box) - rank(b.box)) || (a.index - b.index); })
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
    sceneEl.className = "scene k-" + (box.kind === "alert" ? "warn" : box.tone || "news") + (shots.length ? " has-shot" : "") + (box.decision ? " has-ask" : "");
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
    var oldOpen = sceneEl.querySelector(".scene-open");
    if (oldOpen) oldOpen.remove();
    if (box.open) sceneLine.after(pageButton(box.open, "scene-open"));
    // Every scene takes his words about it at its foot; a question's options answer it in one tap.
    var oldAsk = sceneEl.querySelector(".scene-ask");
    // Only a piece of work takes words about it; "Working on it" and the situation line are not one.
    var aboutWork = box.decision || box.task || box.ref || box.open || (box.links && box.links.length) || shots.length;
    var askKey = !VIEW_TOKEN || !aboutWork ? "" : box.decision ? "flyd-decision:" + box.decision.task + ":" + box.decision.question : "flyd-about:" + box.id;
    if (oldAsk && oldAsk.dataset.key !== askKey) oldAsk.remove();
    if (askKey && !(oldAsk && oldAsk.isConnected)) sceneEl.querySelector(".scene-text").appendChild(sceneAsk(box, askKey));
    sceneMeta.textContent = "";
    var word = kindWord(box);
    if (word) sceneMeta.appendChild(el("span", "kind", word));
    if (box.project) sceneMeta.appendChild(el("span", "project", box.project));
    if (box.status && box.status !== word) sceneMeta.appendChild(el("span", "status", box.status));
    (box.links || []).forEach(function (link) {
      // A page on this machine that stopped answering is said in words, never a dead link.
      if (link.closed) { sceneMeta.appendChild(el("span", "closed", "The review page for this has closed")); return; }
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
    setAmbient(shots.length ? withToken(shots[0].src) : "");
    if (!shots.length) return;
    var figure = el("figure", "scene-shot");
    var stage = el("div", "devices");
    figure.appendChild(stage);
    var looks = shots.map(function (shot) { return { src: withToken(shot.src), label: shot.label, device: deviceOf(shot.label) }; });
    // What holds the stage: the desktop and phone captures as a pair, else the one chosen.
    var slots = { desk: null, phone: null, chosen: looks[0] };
    looks.forEach(function (look) { if (look.device === "desk" && !slots.desk) slots.desk = look; if (look.device === "phone" && !slots.phone) slots.phone = look; });
    function device(look) {
      var node = el("div", "device " + (look.device || "art"));
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", "Open " + look.label);
      if (look.device === "desk") { var bar = el("div", "bar"); bar.appendChild(el("i")); bar.appendChild(el("i")); bar.appendChild(el("i")); node.appendChild(bar); }
      var img = el("img");
      img.alt = "Screenshot: " + box.title;
      img.src = look.src;
      img.addEventListener("load", function () {
        // A capture without a device in its name is placed by its shape once it loads.
        if (!look.device) {
          var shape = shapeOf(img.naturalWidth, img.naturalHeight);
          if (shape) { look.device = shape; if (shape === "phone" && !slots.phone) slots.phone = look; if (shape === "desk" && !slots.desk) slots.desk = look; place(); return; }
        }
        if (look.device) { img.dataset.aim = "1"; aimAtContent(img); }
      });
      node.appendChild(img);
      node.addEventListener("click", function () { openImage(look.src); });
      node.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openImage(look.src); } });
      return node;
    }
    function place() {
      var chosen = slots.chosen;
      var pair = slots.desk && slots.phone && (chosen === slots.desk || chosen === slots.phone);
      var shown = pair ? [slots.desk, slots.phone] : [chosen];
      var key = shown.map(function (look) { return look.src + "|" + (look.device || ""); }).join(" ");
      if (stage.dataset.key === key) return;
      stage.dataset.key = key;
      stage.className = "devices " + (pair ? "pair" : "one");
      stage.textContent = "";
      shown.forEach(function (look) { stage.appendChild(device(look)); });
    }
    place();
    if (looks.length > 1) {
      var thumbs = el("div", "thumbs");
      looks.forEach(function (look, index) {
        var thumb = el("img", index === 0 ? "on" : "");
        thumb.alt = look.label;
        thumb.tabIndex = 0;
        thumb.setAttribute("role", "button");
        thumb.src = look.src;
        // Rolling over a thumbnail brings it up (beside its partner device); a tap does the same on a phone.
        function choose() {
          if (look.device === "desk") slots.desk = look;
          if (look.device === "phone") slots.phone = look;
          slots.chosen = look;
          place();
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
  // A full-page capture taller than its frame shows from the top, as a device
  // would, unless the top is nearly empty (a form centred low on a tall page
  // left the browser frame a blank colour): then the frame moves down to the
  // stretch of the page with the most on it.
  function aimAtContent(img) {
    var frame = img.getBoundingClientRect();
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!frame.width || !frame.height || !w || !h) return;
    img.style.objectPosition = "";
    var seen = w * frame.height / frame.width;
    if (h <= seen * 1.05) return;
    var cols = 96, rows = Math.max(2, Math.min(600, Math.round(cols * h / w)));
    var pixels;
    try {
      var canvas = document.createElement("canvas");
      canvas.width = cols;
      canvas.height = rows;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, cols, rows);
      pixels = ctx.getImageData(0, 0, cols, rows).data;
    } catch (_) { return; }
    // How much is drawn on each row: the change in brightness from pixel to pixel.
    function lum(x, y) { var i = (y * cols + x) * 4; return pixels[i] * .3 + pixels[i + 1] * .59 + pixels[i + 2] * .11; }
    var busy = [];
    for (var y = 0; y < rows; y++) {
      var sum = 0;
      for (var x = 1; x < cols; x++) sum += Math.abs(lum(x, y) - lum(x - 1, y)) + (y ? Math.abs(lum(x, y) - lum(x, y - 1)) : 0);
      busy.push(sum);
    }
    var span = Math.max(1, Math.min(rows, Math.round(rows * seen / h)));
    var run = 0;
    for (var i = 0; i < span; i++) run += busy[i];
    var top = run, best = run, at = 0;
    for (var start = 1; start + span <= rows; start++) {
      run += busy[start + span - 1] - busy[start - 1];
      if (run > best) { best = run; at = start; }
    }
    // The top stays when it holds a fair share of what the page shows at its busiest.
    if (top >= best * 0.6 || rows === span) return;
    // A little of what is above it stays in view, so the content does not start at the frame's very edge.
    at = Math.max(0, at - Math.round(span * 0.06));
    img.style.objectPosition = "center " + (at / (rows - span) * 100).toFixed(1) + "%";
  }
  function aimShown() {
    if (onShow()) sceneEl.querySelectorAll(".device img[data-aim]").forEach(aimAtContent);
  }
  window.addEventListener("resize", aimShown);
  // What a capture was taken on, from its name: "desktop-1440.png", "phone.png", "ipad.png".
  function deviceOf(name) {
    name = String(name || "").toLowerCase();
    // A crop of the element a change touched keeps its own shape: it is a piece of the page, not a screen.
    if (/^element-/.test(name)) return "art";
    function width(list) { return new RegExp("(?:^|[^0-9])(?:" + list + ")(?:[^0-9]|$)").test(name); }
    if (/phone|mobile|android/.test(name) || width("360|375|390|393|402|412|414|428|430")) return "phone";
    if (/ipad|tablet/.test(name) || width("768|810|820|834")) return "tablet";
    if (/desk|laptop|wide/.test(name) || width("1024|1080|1200|1280|1366|1440|1512|1536|1600|1680|1728|1920|2560")) return "desk";
    return "";
  }
  // Otherwise its shape says it: a portrait 9:16-to-9:22 capture is a phone, a
  // wide one a desktop; anything else (artwork, a square) keeps its own shape.
  function shapeOf(w, h) {
    var ratio = w / h;
    if (ratio >= .4 && ratio <= .58) return "phone";
    if (ratio >= 1.25) return "desk";
    return "";
  }
  var ambientSrc = "";
  function setAmbient(src) {
    if (src === ambientSrc) return;
    ambientSrc = src;
    ambient.classList.remove("on");
    if (!src) return;
    setTimeout(function () {
      if (ambientSrc !== src) return;
      ambient.style.backgroundImage = "url(" + JSON.stringify(src) + ")";
      ambient.classList.add("on");
    }, reduced ? 0 : 300);
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
    if (scenes.length > 1 && !holding && !(document.activeElement && document.activeElement.closest(".scene-ask"))) cycle = setInterval(function () { if (onShow()) show(at + 1, true); }, DWELL);
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

  // The numbers: one quiet line, each reading a few words with its figure.
  function drawReadout(box) {
    var node = el("span", "ro");
    node.dataset.id = box.id;
    if (box.id === "work-state" && box.bars) {
      box.bars.forEach(function (bar) {
        // "7 need you" opens the list of what needs him, each with its question to answer.
        var opens = bar.tone === "call" && lastScreen && lastScreen.calls && lastScreen.calls.length;
        var part = el(opens ? "button" : "span", "ro-part k-" + (bar.tone || "news") + (opens ? " ro-open" : ""));
        part.appendChild(el("b", "", String(bar.value)));
        part.appendChild(document.createTextNode(" " + bar.label));
        if (opens) {
          part.type = "button";
          part.setAttribute("aria-haspopup", "dialog");
          part.setAttribute("aria-controls", "calls");
          part.addEventListener("click", function () { showCalls(true, part); });
        }
        node.appendChild(part);
      });
      return node;
    }
    if (box.gauges && box.gauges.length) {
      box.gauges.forEach(function (gauge) {
        var part = el("span", "ro-part");
        if (gauge.resetsAt) part.title = "resets " + new Date(gauge.resetsAt).toLocaleString();
        part.appendChild(document.createTextNode("Claude " + gauge.label + " "));
        part.appendChild(el("b", "", gauge.used + "%"));
        part.appendChild(document.createTextNode(" used"));
        node.appendChild(part);
      });
      return node;
    }
    node.appendChild(el("b", "", box.title));
    if (box.line) node.appendChild(document.createTextNode(" " + box.line));
    return node;
  }
  function flicker() {
    if (reduced) return;
    readoutsEl.querySelectorAll(".ro").forEach(function (node) {
      node.classList.remove("fade");
      void node.offsetWidth;
      node.classList.add("fade");
    });
  }
  function renderReadouts(readouts) {
    var key = JSON.stringify([readouts, !!(lastScreen && lastScreen.calls && lastScreen.calls.length)]);
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
    showDoing.textContent = lastScreen.live ? lastScreen.doing || "" : "Standby" + (lastScreen.read ? ". Fleet read " + ago(lastScreen.read) : "");
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
    if (!callsEl.hidden) drawCalls();
  }

  // What needs him, every one: a sheet over the artefact, each call with its question and a way to answer.
  var callsEl = document.getElementById("calls");
  var callsList = document.getElementById("calls-list");
  var callsFrom = null;
  var drawnCalls = "";
  function drawCalls() {
    var calls = (lastScreen && lastScreen.calls) || [];
    var key = JSON.stringify(calls);
    if (key === drawnCalls) return;
    drawnCalls = key;
    var open = {};
    callsList.querySelectorAll(".call").forEach(function (node) { open[node.dataset.id] = node.contains(document.activeElement); });
    document.getElementById("calls-title").textContent = calls.length === 1 ? "One needs you" : calls.length + " need you";
    callsList.textContent = "";
    calls.forEach(function (call, index) {
      var item = el("li", "call");
      item.dataset.id = call.id;
      var meta = el("p", "call-meta");
      if (call.project) meta.appendChild(el("span", "", call.project));
      if (call.at) meta.appendChild(el("span", "", ago(call.at)));
      if (meta.childNodes.length) item.appendChild(meta);
      item.appendChild(el("h3", "call-head", call.headline));
      // Under the question, the work it is about when Flyd has put the question in plain words; else the question whole.
      var question = call.decision && call.decision.question;
      if (call.detail && call.detail !== call.headline) item.appendChild(el("p", "call-question", sentence(capital(call.detail))));
      else if (question && question !== call.headline) item.appendChild(el("p", "call-question", sentence(capital(question))));
      (call.links || []).forEach(function (link) {
        if (link.closed) { item.appendChild(el("p", "call-link closed", "The review page for this has closed")); return; }
        var a = el("a", "call-link", link.label + " ↗");
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        item.appendChild(a);
      });
      if (call.decision && VIEW_TOKEN) item.appendChild(sceneAsk({ title: call.headline, decision: call.decision }, "flyd-decision:" + call.decision.task + ":" + call.decision.question));
      callsList.appendChild(item);
    });
  }
  function showCalls(open, from) {
    if (open) { callsFrom = from || null; drawnCalls = ""; drawCalls(); }
    callsEl.hidden = !open;
    if (open) callsEl.querySelector(".calls-sheet").focus();
    else if (callsFrom && callsFrom.isConnected) callsFrom.focus();
  }
  document.getElementById("calls-close").addEventListener("click", function () { showCalls(false); });
  callsEl.addEventListener("click", function (event) { if (event.target === callsEl) showCalls(false); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !callsEl.hidden) { event.preventDefault(); showCalls(false); }
  });
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
      aimShown();
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
    if (event.target instanceof Element && event.target.closest(".scene-ask, .art-chat, .prefs, .calls, .rail-phone-say")) return;
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
  <a class="site" id="site" hidden target="_blank" rel="noopener noreferrer"><span class="site-kind" id="site-kind"></span><span class="site-host" id="site-host"></span><span class="site-path" id="site-path"></span></a>
  <span class="when" id="when"></span>
  <span class="controls">
    <a href="/whatsapp" style="font-size:12px;color:var(--muted);text-decoration:none;padding:0 8px">people</a><button id="prefs-open" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="prefs">preferences</button>
    <button id="flip" type="button" role="switch" aria-checked="false" aria-label="Artefact view">artefact<span class="track" aria-hidden="true"></span></button>
  </span>
</header>
<div class="prefs" id="prefs" hidden role="dialog" aria-label="Preferences">
  <p class="prefs-title">Preferences</p>
  <button id="mode" type="button" role="switch" aria-checked="false"><span class="prefs-words"><span class="prefs-name">Full replies</span><span class="prefs-about">Every reply as written, not Flyd's reading</span></span><span class="track" aria-hidden="true"></span></button>
  <button id="theme" type="button" role="switch" aria-checked="false"><span class="prefs-words"><span class="prefs-name">Light theme</span><span class="prefs-about">Dark when off</span></span><span class="track" aria-hidden="true"></span></button>
  <button id="rail-toggle" type="button" role="switch" aria-checked="true"><span class="prefs-words"><span class="prefs-name">Side column</span><span class="prefs-about">What needs you, what is under way and done</span></span><span class="track" aria-hidden="true"></span></button>
  <button id="taste-link" type="button"><span class="prefs-words"><span class="prefs-name">Taste</span><span class="prefs-about">What Flyd knows about your taste</span></span><span class="prefs-go" aria-hidden="true">→</span></button>
</div>
<aside class="rail" id="rail" hidden aria-label="What needs you, what is under way and done, and your conversations">
  <button class="rail-hide" id="rail-hide" type="button" aria-label="Hide the column">✕</button>
  <nav class="rail-tabs" aria-label="Sidebar view"><button type="button" data-rail-tab="artefacts" aria-selected="true">Artefacts</button><button type="button" data-rail-tab="detail" aria-selected="false">Detailed view</button></nav>
  <div class="rail-pane" data-rail-pane="artefacts">
  <div class="brief" id="brief" hidden>
    <section class="needs" id="needs" hidden aria-label="Needs you"></section>
    <section class="brief-list" id="underway" hidden aria-label="Under way"></section>
    <section class="brief-list" id="done" hidden aria-label="Done"></section>
  </div>
  <div class="rail-body" id="artefact-body"></div>
  </div>
  <div class="rail-pane" data-rail-pane="detail" hidden>
    <div class="rail-body" id="rail-body"></div>
  </div>
</aside>
<main id="stream" aria-live="polite">
  <p class="empty" id="empty" hidden>Nothing said yet.</p>
  <div class="working" id="working" hidden aria-label="${label} is working"><span class="dots"><i></i><i></i><i></i></span></div>
</main>
<button class="jump" id="jump" type="button" hidden>↓ new</button>
<div class="lightbox" id="lightbox" hidden role="dialog" aria-label="Image"><img id="lightbox-img" alt=""></div>
<div class="problem" id="problem"></div>
<section class="show" id="show" hidden aria-label="Flyd's artefact: what it thinks you need to see">
  <div class="ambient" id="ambient" aria-hidden="true"></div>
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
  <div class="calls" id="calls" hidden role="dialog" aria-modal="true" aria-labelledby="calls-title">
    <div class="calls-sheet" tabindex="-1">
      <div class="calls-top"><h2 id="calls-title">Need you</h2><button id="calls-close" type="button" aria-label="Close">✕</button></div>
      <ol class="calls-list" id="calls-list"></ol>
    </div>
  </div>
  <div class="foot"><p class="doing" id="show-doing">Standby</p><span class="hint">type to talk · tab for the conversation</span></div>
</section>
<form class="composer" id="composer" hidden autocomplete="off">
  <div class="row">
    <p class="unread" id="unread" role="alert" hidden></p>
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

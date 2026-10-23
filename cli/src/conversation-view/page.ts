import { DOCUMENT_EXTENSIONS, MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "./firstmate-inbox.js";
import { escapeHtml } from "./markdown.js";
import { installComposerPredictions } from "./composer-predictions-client.js";
import { LEFT_BUTTON, LEFT_HTML, LEFT_PREFERENCE, LEFT_SCRIPT, LEFT_STYLE } from "./left-column.js";
import { CARD_SCRIPT } from "./cards.js";
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
  font: 500 14px/1 var(--sans); color: var(--muted);
}
.who { color: var(--accent); white-space: nowrap; }
.project-badge { flex: none; max-width: 18em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 12px/1.2 var(--mono); letter-spacing: 0.03em; color: var(--muted); }
.project-badge[hidden] { display: none; }
.project-badge.shown { animation: scene-fade 240ms ease both; }
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
/* The current conversation title stays in the header; past sessions live in the right column. */
header .picker { flex: 1; min-width: 0; display: flex; }
#conversation-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

/* Semantic workspace: the focused work owns the room; the rest of Flyd is
   context at its edge, not a competing dashboard. */
.show.semantic-workspace { padding-top: 64px; }
.semantic-workspace .tv { padding: clamp(26px, 6vh, 78px) 0 clamp(20px, 4vh, 48px); }
.semantic-workspace .scene { min-height: min(68vh, 820px); align-content: center; }
.semantic-workspace .scene[data-semantic="decision"],
.semantic-workspace .scene[data-semantic="action"] { grid-template-columns: minmax(0, 1fr); max-width: 980px; margin-inline: auto; }
.semantic-workspace .scene[data-semantic="artifact"].has-shot,
.semantic-workspace .scene[data-semantic="investigation"].has-shot { grid-template-columns: minmax(280px, .7fr) minmax(0, 1.3fr); }
.semantic-workspace .scene[data-semantic="artifact"] .scene-shot img { max-height: 70vh; object-fit: contain; background: var(--tint); }
.semantic-workspace .scene[data-semantic="activity"] .scene-head { max-width: 18em; }
.semantic-workspace .scene[data-semantic="monitor"] { opacity: .96; }
.semantic-workspace .semantic-context { display: flex; gap: 10px 22px; align-items: baseline; flex-wrap: wrap; padding: 14px 0 18px; border-top: 1px solid var(--faint); font: 500 13px/1.35 var(--mono); color: var(--muted); }
.semantic-workspace .semantic-context:empty { display: none; }
.semantic-context button { appearance: none; border: 0; background: none; padding: 0; color: inherit; font: inherit; cursor: pointer; }
.semantic-context button:hover { color: var(--strong); }
.semantic-context .needs { color: var(--k-call); }
.semantic-context .working { color: var(--k-live); }
.semantic-context .landed { color: var(--k-landed); }
.semantic-context .held { color: var(--k-waiting); }
.semantic-context .watching { color: var(--muted); }
.semantic-workspace .ticks { display: none !important; }

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
.art-chat[hidden] { display: none; }
.art-chat-open { width: 28px; height: 28px; padding: 0; color: var(--muted); background: transparent; border: 0; cursor: pointer; }
.art-chat-open:hover { color: var(--strong); }
.art-chat-open svg { width: 16px; height: 16px; }
/* A question's own answer box, one step at a time, is the same field. */
.art-chat-field, .scene-ask .step-free {
  padding: 6px 6px 6px 14px; border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 7%, var(--tint)); transition: border-color 140ms ease;
}
.art-chat-field:focus-within, .scene-ask .step-free:focus-within { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
.art-chat-row { display: flex; align-items: flex-end; gap: 8px; }
.card .art-chat-input { min-width: 0; }
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
/* His messages to one card and what came back, in order: the card's own thread.
   Quiet type, no bubbles, and the newest thing he sent stays under his words. */
.art-thread { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.art-thread[hidden] { display: none; }
.art-msg { margin: 0; font: 400 15px/1.5 var(--sans); color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.art-msg--you { color: var(--fg); }
/* Flyd's reply: a step smaller and held back, the way its voice sits under his elsewhere. */
.art-msg--them { font-size: 14px; margin-bottom: 4px; }
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

/* A figure's own group, opened: one calm sheet, every piece of work one line,
   newest first, each unfolding its card detail where it stands. */
.drill { position: fixed; inset: 0; z-index: 9; display: grid; place-items: center; padding: 64px 16px 24px; background: color-mix(in srgb, var(--bg) 62%, transparent); }
.drill[hidden] { display: none; }
.drill-sheet {
  display: flex; flex-direction: column; width: min(560px, 100%); max-height: calc(100vh - 88px); border: 1px solid var(--faint); border-radius: 20px;
  background: var(--bg); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32); animation: choice-in 160ms ease both;
}
.drill-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 26px 28px 20px; border-bottom: 1px solid var(--faint); }
.drill-top h2 { margin: 0; font: 600 21px/1.2 var(--sans); color: var(--k, var(--strong)); }
.drill-top button { font: 500 15px/1 var(--mono); color: var(--muted); background: none; border: 0; border-radius: 6px; padding: 6px 8px; cursor: pointer; }
.drill-top button:hover { color: var(--fg); }
.drill-top button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.drill-list { flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 20px 22px 26px; list-style: none; display: grid; gap: 12px; align-content: start; }
.drill-empty { margin: 0; padding: 6px 4px; font: 400 15px/1.5 var(--sans); color: var(--muted); }
.drill-sheet:focus { outline: none; }

/* The foot: what Flyd is doing, and how to talk to it. */
.foot { display: flex; align-items: center; justify-content: space-between; gap: 8px 24px; flex-wrap: wrap; padding-bottom: 24px; }
.foot .hint { font: 500 12px/1.4 var(--mono); color: var(--muted); }
.show-nav { width: 32px; height: 32px; margin-left: 8px; border: 0; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; }
.show-nav:hover { color: var(--strong); }
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
  .project-badge.shown, .show.power, .show.off, .scene.in > *, .scene.in .scene-head, .scene.in .scene-line, .scene.in .scene-meta, .scene.in .scene-ask, .scene.in .scene-shot, .scene.in .scene-open,
  .scene.out > *, .ro.fade, .doing.on::before, .msg.spot { animation: none; }
  .ticks button.on::after { transition: none; }
}
`;

const STYLE = BASE_STYLE + `

/* ~66 characters a line at the reading size. */
/* The latest message sits just clear of the message box, never stranded above a sea of space. */
main { max-width: 36em; margin: 0 auto; padding: 1em 1.5em 12vh; }
body.can-send main { padding-bottom: calc(7.5em + max(72px, 9vh)); }
.empty { color: var(--muted); font: 16px var(--sans); text-align: center; margin-top: 30vh; }

/* The page the work is on, always in the header while there is one: local
   preview or live site, where, and which part of it. */
header .site {
  display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 46vw; height: 30px; padding: 0 12px;
  border: 1px solid var(--faint); border-radius: 999px; color: var(--muted); text-decoration: none;
  font: 500 13px/1 var(--sans); white-space: nowrap; transition: border-color 140ms ease, color 140ms ease;
}
header .site[hidden] { display: none; }
header .site:hover { border-color: var(--accent); color: var(--fg); }
header .site-kind { display: inline-flex; align-items: center; gap: 6px; font-family: var(--sans); font-weight: 600; color: var(--k-live); }
header .site-kind::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
header .site--live .site-kind { color: var(--k-landed); }
header .site-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--strong); }
header .site-path::after { content: " ↗"; color: var(--muted); }

/* Preferences: the reading, theme and taste settings, out of the header until asked for. */
header #prefs-open { font-size: 14px; }
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
  font-size: 0.62em;
}
.rail[hidden] { display: none; }
:root[data-rail="on"] main { margin-right: calc(min(430px, 34vw) + 1.5em); }
:root[data-rail="on"] .composer .row { margin-right: calc(min(430px, 34vw) + 1.875em); }
/* At phone width the column is the screen, not a sliver beside it. */
@media (max-width: 720px) {
  .rail { width: 100vw; font-size: 0.8em; }
  :root[data-rail="on"] main, :root[data-rail="on"] .composer .row { margin-right: 0; }
}
.rail-hide {
  position: absolute; top: 10px; right: 10px; z-index: 1; font: 500 14px/1 var(--sans); color: var(--muted);
  background: transparent; border: 0; cursor: pointer; padding: 6px 8px; border-radius: 6px; transition: color 140ms ease;
}
.rail-hide:hover { color: var(--fg); }
.rail-hide:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.rail-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }
.history { flex: 0 0 min(420px, 48%); min-height: 0; max-height: 52%; overflow-y: auto; padding: 18px 20px 12px; border-bottom: 1px solid var(--faint); }
.history[hidden] { display: none; }
.history-top { display: flex; align-items: baseline; margin: 0 0 10px; }
.history-title { margin: 0; font: 600 14px/1.2 var(--sans); color: var(--muted); }
.history-group { margin: 0; }
.history-group + .history-group { margin-top: 2px; }
.history-group summary { padding: 8px 0; color: var(--fg); font: 500 14px/1.3 var(--sans); cursor: pointer; }
.history-items { margin: 0; padding: 0 0 4px 14px; list-style: none; }
.history-item { display: flex; width: 100%; align-items: baseline; gap: 8px; padding: 7px 0; border: 0; color: var(--fg); background: transparent; text-align: left; font: 400 13px/1.35 var(--sans); cursor: pointer; }
.history-item:hover { color: var(--strong); }
.history-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.history-item-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-item-age { flex: none; color: var(--muted); font: 400 12px/1.3 var(--sans); }
.history-empty { margin: 0; color: var(--muted); font: 400 13px/1.4 var(--sans); }
/* The column: what got done, one card each. */
.brief { flex: none; padding: 20px 20px 10px; border-bottom: 1px solid var(--faint); }
.brief[hidden], .brief > [hidden] { display: none; }
.brief > section + section { margin-top: 28px; }
.brief-top { display: flex; align-items: baseline; gap: 10px; margin: 0 0 12px; padding-right: 32px; }
.brief-label { margin: 0; font: 600 14px/1.2 var(--sans); color: var(--muted); }
.needs .brief-label { color: var(--k-call); }
.needs-nav { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; font: 500 13px/1 var(--sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.needs-nav button { font: inherit; color: var(--muted); background: none; border: 0; border-radius: 6px; padding: 4px 8px; cursor: pointer; transition: color 140ms ease; }
.needs-nav button:hover { color: var(--fg); }
.needs-nav button:disabled { opacity: 0.35; cursor: default; }
.needs-nav button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.needs-meta { margin: 0 0 6px; font: 400 13px/1.4 var(--sans); color: var(--muted); }
.needs-head { margin: 0; font: 500 18px/1.35 var(--sans); color: var(--strong); text-wrap: pretty; overflow-wrap: anywhere; }
.needs-detail { margin: 10px 0 0; font: 400 15px/1.5 var(--sans); color: var(--fg); text-wrap: pretty; overflow-wrap: anywhere; }
.needs-rec { margin: 14px 0 0; font: 400 15px/1.5 var(--sans); color: var(--strong); text-wrap: pretty; }
.needs-rec b { display: block; margin-bottom: 2px; font: 600 13px/1.3 var(--sans); color: var(--accent); }
.needs .call-link { display: inline-block; margin: 18px 16px 0 0; font: 500 14px/1.4 var(--sans); color: var(--link); text-decoration: none; }
.needs .decision-evidence { margin: 16px 0 2px; gap: 8px; }
.needs .decision-evidence .shot { flex: 1 1 140px; border-radius: 10px; }
.needs .decision-evidence .shot img { width: 100%; max-width: none; max-height: 220px; object-fit: cover; }
.needs .scene-ask { margin-top: 20px; max-width: none; gap: 10px; }
.needs .scene-ask .choices { grid-template-columns: 1fr; gap: 6px; }
.brief-list ul { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
/* Each job and each piece of finished work is one of the shared cards: an icon for its kind, a chip, a line. */
.brief-list li { position: relative; display: block; min-width: 0; }
.brief-line { display: block; min-width: 0; font: 500 16px/1.4 var(--sans); color: var(--strong); white-space: normal; overflow-wrap: anywhere; text-wrap: pretty; }
.brief-line a { color: inherit; text-decoration: none; }
.brief-line a:hover { color: var(--link); }
.brief-meta { display: block; margin: 7px 0 0; font: 500 13px/1.4 var(--sans); letter-spacing: normal; color: var(--muted); text-transform: none; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
#done .brief-line { font-weight: 500; color: var(--strong); }
#done .card-text { min-width: 0; }
#done .brief-card { padding: 0; background: transparent; }
.brief-outcome { margin: 4px 0 0; font: 400 14px/1.45 var(--sans); color: var(--fg); overflow-wrap: anywhere; text-wrap: pretty; }
.news .card-stories { margin-top: 14px; }
.news .card-stories + .brief-top { margin-top: 28px; }
.brief-open { margin-right: 10px; color: var(--link); text-decoration: none; }
.brief-open:hover { text-decoration: underline; text-underline-offset: 2px; }
.brief-more { margin: 22px 0 0; padding: 8px 0; border: 0; background: none; cursor: pointer; font: 500 13px/1.3 var(--sans); color: var(--muted); transition: color 140ms ease; }
.brief-more:hover { color: var(--fg); }
.brief-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
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
/* The card his next message is about, picked from the activity column: everything it has to say, over the message box. */
.composer .about { position: relative; max-height: 56vh; overflow-y: auto; margin: 0 0 0.75em -0.75em; padding: 1em 1.1em 1.1em; border-radius: 0.4em; background: var(--tint); animation: card-in 200ms ease both; }
.composer .about[hidden] { display: none; }
.composer .about-head { display: flex; align-items: center; gap: 0.6em; padding-right: 2em; }
.composer .about .card-icon { width: 1.9em; height: 1.9em; }
.composer .about .card-icon svg { width: 1.1em; height: 1.1em; }
.composer .about-chip { font: 500 0.72em/1.4 var(--sans); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.composer .about-when { font: 500 0.72em/1.4 var(--sans); letter-spacing: 0.02em; color: var(--muted); font-variant-numeric: tabular-nums; }
.composer .about.tone-call .card-icon, .composer .about.tone-call .about-chip { color: var(--k-call); }
.composer .about.tone-live .card-icon, .composer .about.tone-live .about-chip { color: var(--k-live); }
.composer .about.tone-done .card-icon, .composer .about.tone-done .about-chip { color: var(--k-landed); }
.composer .about.tone-held .card-icon, .composer .about.tone-held .about-chip { color: var(--k-waiting); }
.composer .about.tone-ready .card-icon, .composer .about.tone-ready .about-chip { color: var(--k-ready); }
.composer .about.tone-memory .card-icon, .composer .about.tone-memory .about-chip { color: var(--accent); }
.composer .about-title { margin: 0.7em 0 0; font: 600 1.1em/1.3 var(--sans); color: var(--strong); text-wrap: pretty; overflow-wrap: anywhere; }
.composer .about-text { margin: 0.5em 0 0; font: 400 0.95em/1.5 var(--sans); color: var(--fg); text-wrap: pretty; overflow-wrap: anywhere; white-space: pre-line; }
.composer .about-at { margin: 0.8em 0 0; font: 500 0.75em/1.4 var(--sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.composer .about .card-stories { margin-top: 0.8em; }
.composer .about .card-link { display: inline-block; margin: 0.8em 1.2em 0 0; font-size: 0.9em; }
.composer .about-shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5em, 1fr)); gap: 0.9em 0.75em; margin-top: 1em; }
.composer .about-shot { display: flex; flex-direction: column; gap: 0.4em; min-width: 0; margin: 0; padding: 0; border: 0; background: none; cursor: zoom-in; text-align: left; }
.composer .about-shot img { display: block; width: 100%; aspect-ratio: 3 / 2; object-fit: cover; object-position: top; border-radius: 0.4em; background: var(--faint); transition: opacity 140ms ease; }
.composer .about-shot:hover img { opacity: 0.85; }
.composer .about-shot:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 0.4em; }
.composer .about-shot-name { font: 500 0.78em/1.3 var(--sans); color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.composer .about-clear { position: absolute; top: 0.8em; right: 0.8em; width: 1.7em; height: 1.7em; padding: 0; border: 0; border-radius: 0.3em; background: none; cursor: pointer; font: 400 0.95em/1 var(--sans); color: var(--muted); transition: color 140ms ease, background 140ms ease; }
.composer .about-clear:hover { color: var(--strong); background: var(--faint); }
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
.commands.in-box { position: static; max-height: 14em; margin: 6px 0 0; padding: 0; font-size: 16px; background: transparent; border-radius: 0; box-shadow: none; }
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
` + LEFT_STYLE + SHOW_STYLE;

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
  var conversationTitle = document.getElementById("conversation-title");
  var historyEl = document.getElementById("history");
  var historyList = document.getElementById("history-list");
  var themeBtn = document.getElementById("theme");
  var problem = document.getElementById("problem");
  var nodes = new Map();
  var source = null;
  var current = null;
  var drawnFrom = null;
  var explicit = new URLSearchParams(location.search).get("session") || (function () {
    var fresh = document.body.dataset.newSession;
    if (!fresh) return null;
    try {
      var kept = sessionStorage.getItem("flyd-window-session");
      if (kept) return kept;
      sessionStorage.setItem("flyd-window-session", fresh);
    } catch (_) {}
    return fresh;
  })();
  var railMobileDismissed = !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);
  var historyDrawn = "";
  var lastActivity = null;
  var isWorking = false;
  var first = true;
  var awaiting = new Set();
  var latestSession = null;
  var answersInSession = false;
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
  document.getElementById("routine-suggestion").addEventListener("click", function (event) { event.preventDefault(); location.href = "/routines?session=" + encodeURIComponent(current || "latest"); });
  document.getElementById("preparation-link").addEventListener("click", function () { location.href = "/preparation?session=" + encodeURIComponent(current || "latest"); });
  document.getElementById("routines-link").addEventListener("click", function () { location.href = "/routines?session=" + encodeURIComponent(current || "latest"); });
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
    if (event.key === "Escape" && !prefs.hidden) { event.preventDefault(); showPrefs(false); prefsOpen.focus(); }
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
      staffCard(el, message);
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
  // Coding work Flyd found stuck and could not settle, said plainly over the message box.
  var staffEl = document.getElementById("staff");
  function showStaff(staff) {
    staffEl.hidden = !staff.text;
    staffEl.textContent = staff.text || "";
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
  // A relayed staff update is a compact card: a dot for what kind of news it is, one line, its link, its picture.
  var CARD_WORDS = { landed: "Done", decision: "Your call", blocker: "Stuck", underway: "Under way", note: "" };
  function linkWord(url) {
    return /\\/pull\\/\\d+/.test(url) ? "Open the change ↗" : url.replace(/^https?:\\/\\/(www\\.)?/, "").replace(/\\/$/, "") + " ↗";
  }
  // Several pieces of work in one reply: its opening line, then a compact card each, never paragraphs.
  var OUTCOME_WORDS = { landed: "Done", underway: "Under way", needs: "Your call", stuck: "Stuck", note: "", handled: "Handled" };
  function outcomeCards(outcomes) {
    var box = document.createElement("div");
    box.className = "outcomes";
    if (outcomes.lead) box.appendChild(Object.assign(document.createElement("p"), { className: "outcomes-lead", textContent: outcomes.lead }));
    outcomes.items.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "card card-compact card-" + item.state;
      var text = document.createElement("div");
      text.className = "card-text";
      if (OUTCOME_WORDS[item.state]) text.appendChild(Object.assign(document.createElement("span"), { className: "card-meta", textContent: OUTCOME_WORDS[item.state] }));
      text.appendChild(Object.assign(document.createElement("p"), { className: "card-line", textContent: item.title }));
      if (item.line) text.appendChild(Object.assign(document.createElement("p"), { className: "card-sub", textContent: item.line }));
      if (item.url) text.appendChild(Object.assign(document.createElement("a"), { className: "card-link", href: item.url, target: "_blank", rel: "noopener noreferrer", textContent: linkWord(item.url) }));
      card.appendChild(text);
      box.appendChild(card);
    });
    return box;
  }
  function staffCard(el, message) {
    var old = el.querySelector(":scope > .card, :scope > .outcomes");
    if (old) old.remove();
    el.classList.toggle("carded", !!(message.card || message.outcomes));
    el.classList.toggle("carded-decision", !message.outcomes && !!message.card && message.card.kind === "decision");
    if (message.outcomes) {
      el.insertBefore(outcomeCards(message.outcomes), el.querySelector(":scope > .summary") || el.querySelector(":scope > .body"));
      return;
    }
    if (!message.card) return;
    var box = document.createElement("div");
    box.className = "card card-" + message.card.kind;
    var text = document.createElement("div");
    text.className = "card-text";
    if (CARD_WORDS[message.card.kind]) text.appendChild(Object.assign(document.createElement("span"), { className: "card-meta", textContent: CARD_WORDS[message.card.kind] }));
    text.appendChild(Object.assign(document.createElement("p"), { className: "card-line", textContent: message.card.line }));
    if (message.card.sub) text.appendChild(Object.assign(document.createElement("p"), { className: "card-sub", textContent: message.card.sub }));
    if (message.card.url) {
      var link = Object.assign(document.createElement("a"), { className: "card-link", href: message.card.url, target: "_blank", rel: "noopener noreferrer", textContent: linkWord(message.card.url) });
      text.appendChild(link);
    }
    box.appendChild(text);
    // Its screenshot, small, beside the line: the picture says what changed.
    var shot = el.querySelector(":scope > .reply-shots");
    if (shot) { shot.classList.add("card-thumb"); box.appendChild(shot); }
    el.insertBefore(box, el.querySelector(":scope > .summary") || el.querySelector(":scope > .body"));
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
  var lightboxImages = [];
  var lightboxIndex = 0;
  function openImage(url) {
    var shown = new URL(url, location.href).href;
    lightboxImages = Array.from(document.querySelectorAll("img")).filter(function (image) {
      return image.id !== "lightbox-img" && !image.closest("[hidden]");
    }).map(function (image) { return image.currentSrc || image.src; }).filter(function (imageUrl, i, all) { return imageUrl && all.indexOf(imageUrl) === i; });
    lightboxIndex = lightboxImages.indexOf(shown);
    if (lightboxIndex < 0) { lightboxImages.unshift(shown); lightboxIndex = 0; }
    document.getElementById("lightbox-img").src = lightboxImages[lightboxIndex];
    lightbox.hidden = false;
  }
  function stepLightbox(direction) {
    if (!lightboxImages.length) return;
    lightboxIndex = (lightboxIndex + direction + lightboxImages.length) % lightboxImages.length;
    document.getElementById("lightbox-img").src = lightboxImages[lightboxIndex];
  }
  document.querySelector(".lightbox-prev").addEventListener("click", function (event) { event.stopPropagation(); stepLightbox(-1); });
  document.querySelector(".lightbox-next").addEventListener("click", function (event) { event.stopPropagation(); stepLightbox(1); });
  lightbox.addEventListener("click", function (event) { if (event.target === lightbox) lightbox.hidden = true; });
  document.addEventListener("keydown", function (event) {
    if (lightbox.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); lightbox.hidden = true; }
    else if (event.key === "ArrowRight") stepLightbox(1);
    else if (event.key === "ArrowLeft") stepLightbox(-1);
  });

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
    main.querySelectorAll(".msg.pending.unsure").forEach(function (el) {
      if (!arrived(el)) return;
      el.remove();
      if (!input.value && !attachments.length) saveDraftNow();
    });
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
    drawnFrom = current;
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
    var projectBadge = document.getElementById("project-badge");
    if (projectBadge.textContent !== (update.project || "")) {
      projectBadge.textContent = update.project || "";
      projectBadge.hidden = !update.project;
      projectBadge.classList.remove("shown");
      if (update.project) { void projectBadge.offsetWidth; projectBadge.classList.add("shown"); }
    }
    if (update.context) { usage.context = update.context; renderUsage(); }
    lastActivity = update.lastActivity || lastActivity;
    refreshWorking();
    if (lastActivity) whenEl.textContent = dayOf(lastActivity) + "  " + clock(lastActivity);
    if (!onConversation()) { /* the terminal is hidden; it finds its place when it comes back */ }
    else if (stick) { toBottom(); jump.hidden = true; } else { restore(at); if (added) jump.hidden = false; }
    first = false;
    if (update.show) renderShow(update.show, update.boxes);
    renderSite(update.page);
    notices = (update.rail && update.rail.notices) || [];
    renderBrief(update.show);
    renderActivity(update.leftColumn);
    if (update.leftColumn) drawNews(update.leftColumn.recent);
  }

  // Done items are read from firstmate's own records on every update.
  var briefEl = document.getElementById("brief");
  var needsEl = document.getElementById("needs");
  var doneEl = document.getElementById("done");
  var noticesEl = document.getElementById("notices");
  // Notices other tools sent instead of macOS notifications, newest first.
  var notices = [];
  var newsEl = document.getElementById("news");
  var briefFilled = false;
  var lastBrief = null;
  var needsAt = Number(store("flyd-needs-at")) || 0;
  var needsShown = "";
  var needsDrawn = "";
  var doneAll = false;
  var DONE_FEW = 3;
  // "GNM (Good Neighbours Market)" is GNM on a line this small.
  function shortName(project) { return project ? String(project).replace(/\\s*\\([^)]*\\)\\s*$/, "") : ""; }
  function briefTop(label, extra) {
    var top = el("div", "brief-top");
    if (label) top.appendChild(el("h2", "brief-label", label));
    if (extra) top.appendChild(extra);
    return top;
  }
  // What he has put away is kept by the shared cards (cardGone); a Done item he has seen fades on its own after a day.
  var SEEN_FOR_MS = 24 * 60 * 60 * 1000;
  // A card with no task of its own is named only by its place in the list, so it is kept by its words instead.
  function itemKey(item) { return item.task ? item.id : item.headline; }
  /** A Done item no longer listed is forgotten once it is this old. */
  var SEEN_KEPT_MS = 3 * SEEN_FOR_MS;
  // Only the newest few hundred are kept; old ones have long left the column anyway.
  function newest(times, first) {
    var kept = {};
    var rank = function (key) { return first && first[key] ? 1 : 0; };
    Object.keys(times).sort(function (a, b) { return rank(b) - rank(a) || times[b] - times[a]; }).slice(0, 300).forEach(function (key) { kept[key] = times[key]; });
    return kept;
  }
  function seenDone(items) {
    var seen = cardRead("flyd-done-seen");
    var now = Date.now();
    var listed = {};
    items.forEach(function (item) {
      var key = itemKey(item);
      listed[key] = true;
      if (!seen[key]) seen[key] = now;
    });
    Object.keys(seen).forEach(function (key) { if (!listed[key] && now - seen[key] > SEEN_KEPT_MS) delete seen[key]; });
    seen = newest(seen, listed);
    store("flyd-done-seen", JSON.stringify(seen));
    return seen;
  }
  function stillShown(item, seen) {
    if (item.task && cardGone(item.id)) return false;
    return !seen || Date.now() - seen[itemKey(item)] < SEEN_FOR_MS;
  }
  // One piece of finished work: its picture, its title, one short line on the outcome, then "open" and how long ago.
  function briefItem(item, meta) {
    var li = el("li", "card brief-card");
    li.dataset.key = item.id || item.headline;
    // Its picture, when the work has one: the small thumbnail says what changed, and opens full size on click.
    if (item.shots && item.shots.length) {
      var shotSrc = withToken(item.shots[0].src);
      var thumb = el("button", "card-thumb");
      thumb.type = "button";
      thumb.setAttribute("aria-label", "Open image");
      var img = el("img", "");
      img.src = shotSrc;
      img.alt = "";
      img.loading = "lazy";
      thumb.appendChild(img);
      thumb.addEventListener("click", function () { openImage(shotSrc); });
      li.appendChild(thumb);
    }
    var text = el("div", "card-text");
    text.appendChild(el("p", "card-line brief-line", item.headline));
    var outcome = String(item.detail || "").replace(/\\s+/g, " ").trim();
    if (outcome.length > 110) outcome = outcome.slice(0, 109).replace(/\\s+\\S*$/, "") + "…";
    if (outcome) text.appendChild(el("p", "brief-outcome", outcome));
    var foot = el("p", "brief-meta");
    var link = item.open || (item.links || []).find(function (one) { return !one.closed; });
    if (link) {
      var a = el("a", "brief-open", "open");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      foot.appendChild(a);
    }
    if (meta) foot.appendChild(document.createTextNode(meta));
    if (foot.firstChild) text.appendChild(foot);
    li.appendChild(text);
    if (item.task) {
      var close = el("button", "card-dismiss", "✕");
      close.type = "button";
      close.setAttribute("aria-label", "Hide this");
      close.addEventListener("click", function () {
        cardDismiss(item.id);
        li.classList.add("leaving");
        setTimeout(function () { renderBrief(lastBrief); }, 220);
      });
      li.appendChild(close);
    }
    return li;
  }
  function drawSemanticDecisions(decisions) {
    if (!decisions.length) { needsEl.hidden = true; needsEl.textContent = ""; needsDrawn = ""; needsShown = ""; return; }
    // A Decision is the object. Navigation changes which Decision is in focus;
    // legacy call position is no longer its identity.
    var index = decisions.findIndex(function (decision) { return decision.id === needsShown; });
    if (index < 0) index = Math.min(needsAt, decisions.length - 1);
    needsAt = index;
    needsShown = decisions[index].id;
    store("flyd-needs-at", String(index));
    var decision = decisions[index];
    var key = JSON.stringify([decision, index, decisions.length]);
    needsEl.hidden = false;
    if (key === needsDrawn) return;
    needsDrawn = key;
    needsEl.textContent = "";
    var nav = null;
    if (decisions.length > 1) {
      nav = el("span", "needs-nav");
      var back = el("button", "", "‹");
      back.type = "button";
      back.setAttribute("aria-label", "The one before");
      back.disabled = index === 0;
      var forward = el("button", "", "›");
      forward.type = "button";
      forward.setAttribute("aria-label", "The next one");
      forward.disabled = index === decisions.length - 1;
      back.addEventListener("click", function () { needsShown = decisions[Math.max(0, index - 1)].id; drawSemanticDecisions(decisions); });
      forward.addEventListener("click", function () { needsShown = decisions[Math.min(decisions.length - 1, index + 1)].id; drawSemanticDecisions(decisions); });
      nav.appendChild(back);
      nav.appendChild(el("span", "", (index + 1) + " of " + decisions.length));
      nav.appendChild(forward);
    }
    if (nav) needsEl.appendChild(briefTop("", nav));
    needsEl.dataset.semanticId = decision.id;
    var meta = [shortName(decision.project), decision.createdAt ? ago(decision.createdAt) : ""].filter(Boolean).join(" · ");
    if (meta) needsEl.appendChild(el("p", "needs-meta", meta));
    needsEl.appendChild(el("h3", "needs-head", decision.subject));
    var question = decision.decision && decision.decision.question;
    var detail = decision.detail && decision.detail !== decision.subject ? decision.detail
      : question && question !== decision.subject ? question
      : decision.summary && decision.summary !== "waiting on you" ? decision.summary : "";
    if (detail) needsEl.appendChild(el("p", "needs-detail", sentence(capital(detail))));

    var images = (decision.evidence || []).filter(function (object) { return object.kind === "image"; });
    if (images.length) needsEl.appendChild(shots(images.map(function (object) { return withToken(object.ref); }), "decision-evidence"));

    var advice = decision.decision && decision.decision.recommended ? "I'd pick " + decision.decision.recommended + "." : "";
    if (advice) {
      var rec = el("p", "needs-rec");
      rec.appendChild(el("b", "", "Recommended"));
      rec.appendChild(document.createTextNode(advice));
      needsEl.appendChild(rec);
    }
    (decision.evidence || []).filter(function (object) { return object.kind === "web" && !object.closed; }).forEach(function (object) {
      var a = el("a", "call-link", (object.label || "Open") + " ↗");
      a.href = object.ref;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      needsEl.appendChild(a);
    });
    if (decision.decision && VIEW_TOKEN) {
      needsEl.appendChild(sceneAsk({
        title: decision.subject,
        decision: {
          task: decision.decision.target,
          decisionId: decision.decision.decisionId,
          question: decision.decision.question,
          choices: decision.decision.alternatives || [],
          recommended: decision.decision.recommended,
          replyTo: decision.decision.replyTo,
        },
      }, "flyd-decision:" + decision.id + ":" + decision.decision.question));
    }
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
    if (nav) needsEl.appendChild(briefTop("", nav));
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
    if (call.decision && VIEW_TOKEN) needsEl.appendChild(sceneAsk({ title: call.headline, decision: call.decision }, "flyd-decision:" + (call.decision.decisionId || call.decision.task) + ":" + call.decision.question));
  }
  function drawSemanticArtifacts(artifacts) {
    var seen = artifacts.length ? seenDone(artifacts.map(function (artifact) {
      return { id: artifact.id, at: artifact.updatedAt || artifact.createdAt || "" };
    })) : null;
    var items = artifacts.filter(function (artifact) { return stillShown({ id: artifact.id }, seen); });
    doneEl.textContent = "";
    doneEl.hidden = !items.length;
    if (!items.length) return;
    doneEl.appendChild(briefTop("Done"));
    var list = el("ul");
    var shown = !doneAll ? items.slice(0, DONE_FEW) : items;
    shown.forEach(function (artifact) {
      var evidence = artifact.evidence || [];
      var open = evidence.find(function (object) { return object.kind === "web" && !object.closed; });
      var image = evidence.find(function (object) { return object.kind === "image"; });
      var visual = {
        id: artifact.id,
        kind: "landed",
        headline: artifact.subject,
        detail: artifact.summary || artifact.detail || "",
        at: artifact.updatedAt || artifact.createdAt || "",
        status: artifact.status || "ready",
        shots: image ? [{ src: image.ref, label: image.label || artifact.subject }] : [],
        open: open ? { url: open.ref, label: open.label || "Open" } : undefined,
      };
      list.appendChild(briefItem(visual, visual.at ? ago(visual.at) : ""));
    });
    doneEl.appendChild(list);
    if (items.length > DONE_FEW) {
      var more = el("button", "brief-more", doneAll ? "Show fewer" : "Show all " + items.length);
      more.type = "button";
      more.addEventListener("click", function () { doneAll = !doneAll; renderBrief(lastBrief); });
      doneEl.appendChild(more);
    }
  }
  function drawList(section, label, items, meta, few) {
    var seen = label === "Done" && items.length ? seenDone(items) : null;
    items = items.filter(function (item) { return stillShown(item, seen); });
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
    var decisions = show && show.decisions;
    var done = (show && show.done) || [];
    var artifacts = show && show.artifacts && show.artifacts.filter(function (artifact) { return !(artifact.artifact && artifact.artifact.type === "plan"); });
    if (decisions) drawSemanticDecisions(decisions);
    else drawNeeds(calls);
    setNeeds((decisions || calls).map(function (item) { return item.id; }));
    if (artifacts) drawSemanticArtifacts(artifacts);
    else drawList(doneEl, "Done", done, function (item) { return item.at ? ago(item.at) : ""; }, DONE_FEW);
    drawList(noticesEl, "Notices", notices.slice().reverse().map(function (notice) {
      return { id: "notice:" + notice.id, headline: notice.text, at: notice.at, kind: notice.kind, count: notice.count };
    }), function (item) {
      return [item.kind === "attention" ? "Needs you" : "Done", item.count ? (item.count === 2 ? "twice" : item.count + " times") : "", item.at ? ago(item.at) : ""].filter(Boolean).join(" · ");
    });
    fillBrief();
  }
  function fillBrief() {
    briefFilled = !doneEl.hidden || !noticesEl.hidden || !newsEl.hidden;
    briefEl.hidden = !briefFilled;
    showRail();
  }
  // The stories behind a news card: how each was marked, the headline as a link, a line of gist, and where it came from.
  function storiesNode(stories) {
    var list = el("ul", "card-stories");
    stories.forEach(function (story) {
      var li = el("li", "");
      if (story.mark) li.appendChild(el("p", "card-story-mark", story.mark));
      var a = el("a", "card-story-head", story.title);
      a.href = story.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.appendChild(a);
      if (story.gist) li.appendChild(el("p", "card-story-line", story.gist));
      if (story.source) li.appendChild(el("p", "card-story-src", story.source));
      list.appendChild(li);
    });
    return list;
  }
  // The news: the newest card of each kind that carries its stories, every story a working link.
  function drawNews(recent) {
    var titles = {};
    var cards = (recent || []).filter(function (item) {
      if (item.kind !== "news" || !item.stories || !item.stories.length || titles[item.title]) return false;
      titles[item.title] = true;
      return true;
    });
    newsEl.textContent = "";
    newsEl.hidden = !cards.length;
    cards.forEach(function (item) {
      newsEl.appendChild(briefTop(item.title));
      if (item.line) newsEl.appendChild(el("p", "brief-outcome", item.line));
      newsEl.appendChild(storiesNode(item.stories));
    });
    fillBrief();
  }
  // How long ago each piece of work was done moves on with the clock, not only with updates.
  setInterval(function () { if (lastBrief) renderBrief(lastBrief); }, 60000);

  // The right column: what got done.
  var railEl = document.getElementById("rail");
  var railHidden = store("flyd-rail") === "off";
  function railRoot() { return document.documentElement; }
  function railOn() { return !railHidden && railEl && !railEl.hidden; }
  function setRail(on) { railRoot().setAttribute("data-rail", on ? "on" : "off"); }
  // Only what changed is replaced, and nothing kept is moved.
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

  // His reply to one answer, in a box under it. The box is drawn from its
  // state alone, so a redraw of the column leaves an open box, and what he
  // is typing in it, where they are.
  var replies = new Map();
  function replyState(key) {
    if (!replies.has(key)) replies.set(key, { open: false, note: "", draft: "", sending: false });
    return replies.get(key);
  }
  var commandList = null;
  function loadCommands() {
    if (commandList) return Promise.resolve(commandList);
    return fetch("/api/commands").then(function (r) { return r.json(); }).then(function (data) {
      commandList = data.commands || [];
      return commandList;
    }).catch(function () { return []; });
  }
  function commandMenu(input, menu, chosen) {
    var matches = [];
    var index = 0;
    var revision = 0;
    function close() {
      revision += 1;
      menu.hidden = true;
      matches = [];
    }
    function render() {
      menu.textContent = "";
      if (!matches.length) {
        var none = document.createElement("li");
        none.className = "none";
        none.textContent = "No skill or command matches " + input.value;
        menu.appendChild(none);
        return;
      }
      matches.forEach(function (command, at) {
        var item = document.createElement("li");
        item.setAttribute("role", "option");
        item.className = at === index ? "selected" : "";
        var name = document.createElement("span");
        name.className = "name";
        name.textContent = "/" + command.name;
        var about = document.createElement("span");
        about.className = "about";
        about.textContent = command.description;
        item.appendChild(name);
        item.appendChild(about);
        item.addEventListener("mousedown", function (event) { event.preventDefault(); choose(at); });
        menu.appendChild(item);
      });
      var selected = menu.children[index];
      if (selected && selected.scrollIntoView) selected.scrollIntoView({ block: "nearest" });
    }
    function update() {
      var typed = /^\\/([\\w:.-]*)$/.exec(input.value);
      if (!typed) { close(); return; }
      var request = ++revision;
      var query = typed[1].toLowerCase();
      loadCommands().then(function (list) {
        if (request !== revision || !input.isConnected) return;
        if (!/^\\/([\\w:.-]*)$/.test(input.value)) return;
        var starts = list.filter(function (c) { return c.name.toLowerCase().indexOf(query) === 0; });
        var contains = list.filter(function (c) { return c.name.toLowerCase().indexOf(query) > 0; });
        matches = starts.concat(contains).slice(0, 50);
        index = 0;
        menu.hidden = false;
        render();
      });
    }
    function choose(at) {
      var command = matches[at];
      if (!command) return;
      input.value = "/" + command.name + " ";
      close();
      if (chosen) chosen();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    input.addEventListener("input", update);
    input.addEventListener("blur", close);
    input.addEventListener("keydown", function (event) {
      if (event.isComposing || menu.hidden) return;
      var taken = true;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (matches.length) {
          index = (index + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
          render();
        }
      } else if ((event.key === "Enter" || event.key === "Tab") && matches.length) {
        choose(index);
      } else if (event.key === "Escape") {
        close();
      } else {
        taken = false;
      }
      if (!taken) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    });
  }
  function boxCommands(input, chosen) {
    var menu = el("ul", "commands in-box");
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "Skills and commands");
    menu.hidden = true;
    commandMenu(input, menu, chosen);
    return menu;
  }
  // The column and the window each keep their own box for the same answer.
  function replyBox(id, place) {
    var state = replyState(place + ":" + id);
    var from = drawnFrom;
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
    var commands = boxCommands(input, function () { state.draft = input.value; });
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
    form.appendChild(commands);
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
      if (!text || !from || state.sending) return;
      state.sending = true;
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: from, text: text, replyTo: id }) }, true)
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
    var commands = boxCommands(input, function () { place(); });
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
    form.appendChild(commands);
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
      if (event.key === "Escape" && !pop.hidden && form.hidden) { event.preventDefault(); hide(); }
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
  function choiceKey(choice) {
    return "choice:" + choice.replyTo + ":" + choice.question + ":" + choice.options.join("|") + (choice.multiple ? ":multi" : "") + (choice.steps ? ":" + JSON.stringify(choice.steps) : "");
  }
  function wireChoice(target, message) {
    var choice = SEND_TOKEN ? message.choice : null;
    var key = choice ? choiceKey(choice) : "";
    var old = target.querySelector(":scope > .choice");
    target.classList.toggle("asks", !!choice);
    if (old && old.dataset.key !== key) { old.remove(); old = null; }
    if (!choice) return;
    if (!old) old = choiceCard(choice, key);
    if (target.lastElementChild !== old) target.appendChild(old);
  }
  function choiceCard(choice, key) {
    if (!choiceStates.has(key)) choiceStates.set(key, { draft: "", note: "", sent: false, sending: false, picked: [], steps: { at: 0, answers: [] } });
    var state = choiceStates.get(key);
    var card = el("div", "choice");
    card.dataset.key = key;
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", choice.question);
    card.appendChild(el("p", "choice-q", choice.question));
    if (choice.steps && choice.steps.length) { card.firstChild.classList.add("choice-lead"); return stepsCard(card, choice, state); }
    var buttons = [];
    var multiple = choice.multiple === true;
    var picked = state.picked;
    var pickSend = null;
    if (choice.options.length) {
      var options = el("div", "choice-options");
      choice.options.forEach(function (option, index) {
        var button = el("button", "choice-option", option);
        button.type = "button";
        if (multiple) {
          var on = picked.indexOf(index) >= 0;
          button.setAttribute("aria-pressed", on ? "true" : "false");
          button.addEventListener("click", function () {
            if (state.sent || state.sending) return;
            var at = picked.indexOf(index);
            if (at >= 0) picked.splice(at, 1); else picked.push(index);
            button.setAttribute("aria-pressed", at >= 0 ? "false" : "true");
            if (pickSend) pickSend.disabled = picked.length === 0;
          });
        } else {
          button.addEventListener("click", function () { deliver(option); });
        }
        buttons.push(button);
        options.appendChild(button);
      });
      card.appendChild(options);
    }
    if (multiple) {
      pickSend = el("button", "choice-send reply-send", "Send the ones you picked");
      pickSend.type = "button";
      pickSend.disabled = picked.length === 0;
      pickSend.addEventListener("click", function () { deliver(picked.map(function (index) { return choice.options[index]; }).join(", ")); });
      card.appendChild(pickSend);
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
      if (pickSend) pickSend.disabled = state.sent || state.sending || picked.length === 0;
      form.hidden = state.sent;
    }
    function deliver(text) {
      text = String(text || "").trim();
      if (!text || !choice.session || state.sending || state.sent) return;
      state.sending = true;
      settle();
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: choice.session, text: text, replyTo: choice.replyTo, questionText: choice.question }) }, true)
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
      if (!choice.session || state.steps.sending || state.steps.sent) return;
      state.steps.sending = true;
      steps.sync();
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: choice.session, text: text, replyTo: choice.replyTo, questionText: choice.question }) }, true)
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
  // The column shows when there is done work, unless he hid it.
  function showRail() {
    railEl.hidden = railHidden || railMobileDismissed || (!briefFilled && historyEl.hidden);
    setRail(railOn());
  }
  window.addEventListener("resize", function () {
    if (window.innerWidth > 720 && railMobileDismissed) { railMobileDismissed = false; showRail(); }
  });
  function hideRail(hidden) {
    railHidden = hidden;
    if (!hidden) railMobileDismissed = false;
    store("flyd-rail", hidden ? "off" : "on");
    railToggle.setAttribute("aria-checked", String(!hidden));
    showRail();
  }
  var railToggle = document.getElementById("rail-toggle");
  railToggle.setAttribute("aria-checked", String(!railHidden));
  railToggle.addEventListener("click", function () { hideRail(!railHidden); });
  document.getElementById("rail-hide").addEventListener("click", function () { hideRail(true); });
${CARD_SCRIPT}
${LEFT_SCRIPT}

  // A sidebar item's chat sits behind one small icon until he opens it.
  function sidebarChat(key, target) {
    var chat = artefactChat(key, target, "Say something about this…");
    var form = chat.form;
    form.hidden = !chat.state.open;
    var opener = el("button", "art-chat-open");
    opener.type = "button";
    opener.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
    opener.setAttribute("aria-label", "Chat about this item");
    opener.setAttribute("aria-expanded", String(!form.hidden));
    opener.addEventListener("click", function () {
      form.hidden = !form.hidden;
      chat.state.open = !form.hidden;
      chat.save();
      opener.setAttribute("aria-expanded", String(!form.hidden));
      if (!form.hidden) form.querySelector("textarea").focus();
    });
    return { opener: opener, form: form };
  }

  // The chat box at the foot of every artefact: his words about that one thing go
  // to firstmate naming it, and the line under the box says where they are in
  // plain words: sent, then "Flyd has it" once firstmate has read the note.
  // \`target\` is what the words answer: a fleet decision, a reply's question, or
  // the artefact itself ({ about: { title, task, url } }).
  function artefactChat(key, target, label) {
    var state = {};
    try { state = JSON.parse(sessionStorage.getItem(key) || "{}") || {}; } catch (_) {}
    if (state.receipt === "sending") state.receipt = "";
    try { state.thread = JSON.parse(store(key) || "[]"); } catch (_) {}
    if (!Array.isArray(state.thread)) state.thread = [];
    var form = el("form", "art-chat");
    form.setAttribute("aria-label", label);
    var input = el("textarea", "art-chat-input");
    input.rows = 1;
    input.maxLength = 4000;
    input.placeholder = label;
    input.setAttribute("aria-label", label);
    input.value = state.text || "";
    var commands = boxCommands(input, function () { state.text = input.value; state.error = ""; save(); paint(); });
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
    // His messages about this card and the replies that came back, oldest first,
    // kept with the card so they survive a reload and the box is never blank again.
    var thread = el("div", "art-thread");
    // Only the thread outlives the session; a choice he picked, the steps and his draft stay with this session.
    // The same card can be open in more than one place at once, so what another copy stored is
    // folded in by note id, never written over: no message, note id or answer is lost, and
    // nothing one copy has finished with comes back. Only notes that went are kept.
    function save() {
      try { sessionStorage.setItem(key, JSON.stringify(Object.assign({}, state, { thread: undefined }))); } catch (_) {}
      var stored = [];
      try { stored = JSON.parse(store(key) || "[]"); } catch (_) {}
      var mine = state.thread || [];
      var after = -1;
      (Array.isArray(stored) ? stored : []).forEach(function (other) {
        if (!other || !other.id) return;
        var at = -1;
        mine.forEach(function (entry, index) { if (entry.id === other.id) at = index; });
        if (at === -1) { mine.splice(after + 1, 0, Object.assign({}, other)); after += 1; return; }
        var entry = mine[at];
        if (!entry.answer && other.answer) entry.answer = other.answer;
        if (other.done) entry.done = true;
        after = Math.max(after, at);
      });
      state.thread = mine.slice(-50);
      store(key, JSON.stringify(state.thread.filter(function (entry) { return entry.id; })));
      paintThread();
    }
    function paintThread() {
      thread.textContent = "";
      (state.thread || []).forEach(function (entry) {
        thread.appendChild(el("p", "art-msg art-msg--you", entry.text));
        if (entry.answer) thread.appendChild(el("p", "art-msg art-msg--them", entry.answer));
      });
      thread.hidden = !(state.thread || []).length;
    }
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
    // Every note in the card without an answer is watched, so a reply lands here
    // rather than only in the conversation; the newest also says whether it was read.
    function unanswered() {
      return (state.thread || []).filter(function (entry) { return entry.id && !entry.answer && !entry.done; });
    }
    function watch() {
      if (watching) return;
      if (!unanswered().length) return;
      var asking = false;
      watching = setInterval(function () {
        if (!form.isConnected) { clearInterval(watching); watching = null; return; }
        if (asking) return;
        var waiting = unanswered();
        // Nothing left to hear back about: the card stops asking.
        if (!waiting.length) { clearInterval(watching); watching = null; return; }
        asking = true;
        Promise.all(waiting.map(function (entry) {
          return fetch("/api/note?id=" + encodeURIComponent(entry.id) + "&token=" + encodeURIComponent(VIEW_TOKEN))
            .then(function (response) { return response.ok ? response.json() : null; })
            .catch(function () { return null; });
        })).then(function (results) {
          asking = false;
          var changed = false;
          results.forEach(function (data, index) {
            if (!data) return;
            var entry = waiting[index];
            // Gone from firstmate's inbox poll after poll (one miss is only firstmate moving
            // it to handled/): nothing more will come for it. A note firstmate has taken but
            // not answered is not finished with — it can still gain a reply — so the card
            // keeps asking, as the window keeps showing it.
            var missed = data.receipt === null ? (entry.missed || 0) + 1 : 0;
            if (missed !== (entry.missed || 0)) { entry.missed = missed; changed = true; }
            if (missed >= 3) { entry.done = true; changed = true; }
            if (data.answer && data.answer.text && !entry.answer) {
              entry.answer = data.answer.text;
              if (state.receipt === "sent") state.receipt = "read";
              changed = true;
            }
            if (data.receipt === "read" && state.receipt === "sent") { state.receipt = "read"; changed = true; }
          });
          if (changed) { save(); paint(); }
        });
      }, 5000);
    }
    function deliver(text, done) {
      state.receipt = "sending";
      state.error = "";
      // His words stand in the card's own thread the moment he sends them, not when a reply comes.
      // Only the newest few dozen are kept: old ones have long scrolled off the card anyway.
      var entry = { text: text };
      state.thread = (state.thread || []).concat([entry]).slice(-50);
      paintThread();
      paint();
      var sending = takesImages ? images.slice() : [];
      var body = Object.assign({ text: text }, target);
      if (sending.length) body.images = sending.map(function (image) { return { mediaType: image.mediaType, data: image.data }; });
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, true)
        .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) throw new Error(result.data.error || "Not delivered; try again.");
          state.receipt = "sent";
          entry.id = result.data.id;
          // Only what went is cleared: one pasted while it was on its way stays for the next.
          images = images.filter(function (image) { return sending.indexOf(image) === -1; });
          paintImages();
          if (done) done();
          save();
          paint();
          watch();
        })
        .catch(function (error) {
          state.receipt = "";
          state.error = error.message || "Not delivered; try again.";
          // Nothing went, so it is not in the thread: his words stay in the box to try again.
          state.thread = (state.thread || []).filter(function (one) { return one !== entry; });
          paintThread();
          paint();
        });
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
    field.appendChild(commands);
    form.appendChild(thread);
    form.appendChild(field);
    form.appendChild(receipt);
    var chat = { form: form, state: state, deliver: deliver, save: save, onPaint: null };
    paintThread();
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
    var target = !decision ? { about: about } : decision.replyTo ? { session: drawnFrom, replyTo: decision.replyTo, questionText: decision.question } : { decision: decision.decisionId || decision.task };
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
      if (current && current !== session.id) {
        if (typingPredictions) typingPredictions.reset();
        reset();
      }
      current = session.id;
      assistant = session.assistantLabel;
      answersInSession = session.answersInSession === true;
      showTitle(session);
      loadSessions();
    });
    source.addEventListener("update", function (event) { problem.textContent = ""; apply(JSON.parse(event.data)); });
    source.addEventListener("problem", function (event) { problem.textContent = JSON.parse(event.data).error; });
    source.addEventListener("staff", function (event) { showStaff(JSON.parse(event.data)); });
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
      var sessions = (data.sessions || []).slice();
      latestSession = sessions.length ? sessions[0].id : null;
      var shown = sessions.find(function (session) { return session.id === current; });
      if (shown) showTitle(shown);
      renderHistory(sessions);
      return sessions;
    });
  }

  function showTitle(session) {
    conversationTitle.textContent = session.title || "Conversation";
    document.title = session.title + " · " + assistant;
  }

  function renderHistory(sessions) {
    var past = sessions.filter(function (session) { return session.id !== current; });
    var drawn = JSON.stringify([current, past.map(function (session) { return [session.id, session.title, session.project, ago(session.updatedAt)]; })]);
    if (drawn === historyDrawn) return;
    historyDrawn = drawn;
    var expanded = new Map(Array.from(historyList.querySelectorAll("details")).map(function (details) {
      return [details.querySelector("summary").textContent, details.open];
    }));
    var groups = new Map();
    past.forEach(function (session) {
      var name = session.project && String(session.project).trim() || "General";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(session);
    });
    var ordered = Array.from(groups.entries()).map(function (entry) {
      entry[1].sort(function (a, b) { return Date.parse(b.updatedAt) - Date.parse(a.updatedAt); });
      return { name: entry[0], sessions: entry[1], newest: Date.parse(entry[1][0].updatedAt) || 0 };
    }).sort(function (a, b) { return b.newest - a.newest; });
    historyList.textContent = "";
    historyEl.hidden = !current || ordered.length === 0;
    ordered.forEach(function (group, index) {
      var details = document.createElement("details");
      details.className = "history-group";
      var summary = document.createElement("summary");
      summary.textContent = group.name;
      details.open = expanded.has(group.name) ? expanded.get(group.name) : index === 0;
      details.appendChild(summary);
      var list = document.createElement("ul");
      list.className = "history-items";
      group.sessions.forEach(function (session) {
        var item = document.createElement("li");
        var button = document.createElement("button");
        button.type = "button";
        button.className = "history-item";
        button.appendChild(el("span", "history-item-title", session.title || "Untitled conversation"));
        button.appendChild(el("span", "history-item-age", ago(session.updatedAt)));
        button.addEventListener("click", function () {
          explicit = session.id;
          window.history.replaceState(null, "", "?session=" + encodeURIComponent(explicit));
          if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
            railMobileDismissed = true;
            showRail();
          }
          connect(explicit);
        });
        item.appendChild(button);
        list.appendChild(item);
      });
      details.appendChild(list);
      historyList.appendChild(details);
    });
    showRail();
  }

  // Without an explicit pick, follow whichever session is newest (a /clear
  // in Claude Code starts a new transcript file).
  setInterval(function () {
    loadSessions().then(function (sessions) {
      if (!explicit && sessions.length && current && sessions[0].id !== current) connect(null);
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
  var DRAFT_KEY = new URLSearchParams(location.search).get("session") || "latest";
  var DRAFT_STORE = "flyd-view-draft:" + DRAFT_KEY;
  var draftTimer = null;
  var restoring = false;
  var sendsInFlight = 0;
  // What has gone out since the window opened: a stored draft still on its way
  // back never refills the box with it, and clearing it is not held by the read.
  var sentSinceLoad = [];
  function draftState() {
    // Paging through earlier messages shows them in the box; the draft is what he had typed.
    var recalling = recall.index !== -1;
    var text = recalling ? recall.draft : input.value;
    return {
      text: text,
      selectionStart: recalling ? text.length : input.selectionStart,
      selectionEnd: recalling ? text.length : input.selectionEnd,
      attachments: attachments.filter(function (a) { return a.draftId; }).map(function (a) {
        return a.name ? { id: a.draftId, name: a.name } : { id: a.draftId, mediaType: a.mediaType, scrawlPointer: a.scrawlPointer };
      }),
      savedAt: Date.now(),
    };
  }
  function saveDraftNow(keepalive) {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!SEND_TOKEN) return;
    // Never overwrite the draft Core holds before it has been read back; a
    // message that has already gone out clearing the box is not an overwrite.
    if (restoring && !sentSinceLoad.length) return;
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
            : { url: "data:" + a.mediaType + ";base64," + a.data, mediaType: a.mediaType, data: a.data, draftId: a.id, scrawlPointer: a.scrawlPointer };
        }).slice(0, MAX_ATTACHMENTS);
        if (!newer.text && !restored.length) return;
        // The words that just went never come back; an older, different draft does.
        if (newer.text.trim() && sentSinceLoad.indexOf(newer.text.trim()) !== -1) return;
        input.value = newer.text;
        attachments = restored;
        renderAttachments();
        try { input.setSelectionRange(newer.selectionStart, newer.selectionEnd); } catch (e) { /* caret at the end */ }
        if (sentSinceLoad.length) saveDraftNow();
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
      remove.addEventListener("click", function () {
        if (attachment.scrawlPointer) input.value = input.value.replace(attachment.scrawlPointer, "").trimEnd();
        attachments.splice(index, 1); renderAttachments();
      });
      item.appendChild(remove);
      attachmentsEl.appendChild(item);
    });
    attachmentsEl.hidden = attachments.length === 0;
    grow();
  }
  // The native recorder prepares a draft. Only the existing Send action files it.
  window.flydScrawl = function (path, data) {
    var pointer = "[scrawl: " + path + "]";
    if (input.value.indexOf(pointer) !== -1) return true;
    if (attachments.length >= MAX_ATTACHMENTS || attachments.some(function (a) { return a.scrawlPointer; })) {
      problem.textContent = "Send or remove an attachment to add the recording. Saved at " + path;
      return false;
    }
    input.value += (input.value.trim() ? "\\n\\n" : "") + pointer;
    var attachment = { url: "data:image/png;base64," + data, mediaType: "image/png", data: data, scrawlPointer: pointer };
    attachments.push(attachment);
    renderAttachments();
    keepAttachment(attachment);
    return true;
  };
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
  commandMenu(input, document.getElementById("commands"), function () { typingPredictions.reset(); grow(); });

  input.addEventListener("keydown", function (event) {
    if (event.isComposing) return;
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
        if (data.routineSuggestion) {
          document.querySelector("#routines-link .prefs-about").textContent = "A repeated request is ready to keep";
          document.getElementById("routine-suggestion").hidden = false;
        }
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

  // A card from the activity column he is talking about: named over the message box and in front of what he sends.
  var aboutInfo = null;
  var aboutCleared = null;
  function chatAbout(info, onClear) {
    var was = aboutCleared;
    aboutInfo = info || null;
    aboutCleared = info ? onClear || null : null;
    var box = document.getElementById("about");
    var head = document.getElementById("about-head");
    var body = document.getElementById("about-body");
    head.textContent = "";
    body.textContent = "";
    document.getElementById("about-title").textContent = info ? info.title || "" : "";
    box.hidden = !info;
    if (info) {
      var v = kindOf(info.kind);
      box.className = "about tone-" + v.tone;
      head.appendChild(cardIcon(info.kind));
      if (v.word) head.appendChild(el("span", "about-chip", v.word));
      if (info.when) head.appendChild(el("span", "about-when", info.when));
      if (info.body) body.appendChild(info.body);
      box.scrollTop = 0;
    }
    if (info) input.focus();
    else if (was) was();
  }
  document.getElementById("about-clear").addEventListener("click", function () { chatAbout(null); input.focus(); });

  composer.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    var sending = attachments.slice();
    if ((!text && !sending.length) || !current) return;
    if (aboutInfo && text) {
      text = "About “" + aboutInfo.title + "”" + (aboutInfo.detail && aboutInfo.detail !== aboutInfo.title ? " (" + aboutInfo.detail + ")" : "") + ":\\n\\n" + text;
      chatAbout(null);
    }
    recall.index = -1;
    sentSinceLoad.push(text);
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
          if (arrived(el)) {
            if (!input.value && !attachments.length) saveDraftNow();
            el.remove();
            return;
          }
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
        if (!answersInSession && latestSession && current !== latestSession) {
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
  var air = document.getElementById("air");
  var flip = document.getElementById("flip");
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // What each kind is called on screen.
  var WORDS = { call: "needs you", live: "under way", ready: "waiting to land", landed: "landed", waiting: "held up", next: "up next", plan: "plan", news: "also", clear: "all clear", warn: "coming up" };
  // The screen is for showing the work: pictured stories lead, then his calls.
  var RANK = { pictured: 0, call: 1, note: 2, alert: 3, story: 4 };
  var DWELL = 9000;
  var scenes = [];
  var at = 0;
  var cycle = null;
  var holding = false;
  var filled = "";
  var drawnReadouts = "";
  var semanticGroups = {};
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
    sceneEl.dataset.semantic = box.semanticKind || "";
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
      var askKey = !VIEW_TOKEN || !aboutWork ? "" : box.decision ? "flyd-decision:" + (box.decision.decisionId || box.decision.task) + ":" + box.decision.question : "flyd-about:" + box.id;
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
        // A capture without a device in its name is placed by its width once it loads.
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
  // A name that names one screen settles it; a composite ("…-desktop-and-phone.png")
  // names more than one and keeps its own shape.
  function deviceOf(name) {
    name = String(name || "").toLowerCase();
    // A crop of the element a change touched keeps its own shape: it is a piece of the page, not a screen.
    if (/^element-/.test(name)) return "art";
    function width(list) { return new RegExp("(?:^|[^0-9])(?:" + list + ")(?:[^0-9]|$)").test(name); }
    var said = [];
    if (/phone|mobile|android/.test(name) || width("360|375|390|393|402|412|414|428|430")) said.push("phone");
    if (/ipad|tablet/.test(name) || width("768|810|820|834")) said.push("tablet");
    if (/desk|laptop|wide/.test(name) || width("1024|1080|1200|1280|1366|1440|1512|1536|1600|1680|1728|1920|2560")) said.push("desk");
    return said.length > 1 ? "art" : said[0] || "";
  }
  // Otherwise its own pixels say it: a phone-shaped portrait capture (under
  // 1400px wide, 1.8-2.4 times as tall as wide) is a phone shot at native
  // resolution; a taller one is a full-page capture, not a phone. Else at least
  // 1000px wide is a desktop capture, a portrait 380-560px wide (at least 1.6
  // times as tall as wide) a phone, and anything else keeps its own shape,
  // never a phone frame it is not.
  function shapeOf(w, h) {
    if (w && w < 1400 && h / w >= 1.8 && h / w <= 2.4) return "phone";
    if (w >= 1000) return "desk";
    if (w >= 380 && w <= 560 && h / w >= 1.6) return "phone";
    return "";
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
    if (scenes.length > 1 && !holding && !(document.activeElement && document.activeElement.closest(".scene-ask"))) cycle = setInterval(function () { if (lightbox.hidden && onShow()) show(at + 1, true); }, DWELL);
  }
  document.getElementById("show-prev").addEventListener("click", function () { holding = true; show(at - 1, true); schedule(); });
  document.getElementById("show-next").addEventListener("click", function () { holding = true; show(at + 1, true); schedule(); });
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
    // One scene has nowhere to step to: no arrows that do nothing.
    document.getElementById("show-nav").hidden = scenes.length < 2;
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
      box.bars.forEach(function (bar) { node.appendChild(readoutFigure(bar.value, bar.label, bar.tone)); });
      return node;
    }
    if (box.id === "landed-week" && lastScreen && lastScreen.landedWeek && lastScreen.landedWeek.length) {
      // The week's figure opens its own week's work, like every other state figure.
      var done = el("button", "ro-part k-landed ro-open");
      done.type = "button";
      done.setAttribute("aria-haspopup", "dialog");
      done.setAttribute("aria-controls", "drill");
      done.appendChild(el("b", "", box.title));
      done.addEventListener("click", function () { openDrill("landed", done); });
      node.appendChild(done);
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
  // A figure that opens what it counts: "7 need you" opens its calls, each
  // answerable where it stands; every other state opens that group's own work.
  // A figure with nothing behind it stays the plain reading it was before.
  function readoutFigure(value, label, tone) {
    var opensCalls = tone === "call" && lastScreen && lastScreen.calls && lastScreen.calls.length;
    var group = DRILL[tone];
    var opens = !!opensCalls || !!(group && lastScreen && group.pick(lastScreen).length);
    var part = el(opens ? "button" : "span", "ro-part k-" + (tone || "news") + (opens ? " ro-open" : ""));
    part.appendChild(el("b", "", String(value)));
    part.appendChild(document.createTextNode(" " + label));
    if (opens) {
      part.type = "button";
      part.setAttribute("aria-haspopup", "dialog");
      part.setAttribute("aria-controls", opensCalls ? "calls" : "drill");
      part.addEventListener("click", function () {
        if (opensCalls) showCalls(true, part);
        else openDrill(tone, part);
      });
    }
    return part;
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
  function renderSemanticContext(screen) {
    var nav = document.getElementById("semantic-context");
    nav.textContent = "";
    var objects = (screen && screen.semantic) || [];
    var focus = screen && screen.focus;
    var rest = objects.filter(function (object) {
      if (!focus || object.id === focus.id) return false;
      if (object.kind === "monitor" && object.monitor && object.monitor.phase === "quiet") return true;
      return object.lifecycle !== "resolved" || object.kind === "artifact";
    });
    semanticGroups = {};
    SEMANTIC_GROUPS.forEach(function (group) { semanticGroups[group.cls] = { group: group, items: [] }; });
    rest.forEach(function (object) { semanticGroups[semanticGroup(object)].items.push(object); });
    SEMANTIC_GROUPS.forEach(function (group) {
      var items = semanticGroups[group.cls].items;
      if (!items.length) return;
      var button = el("button", group.cls, items.length + " " + group.label);
      button.type = "button";
      button.title = items.map(function (object) { return object.subject; }).join("\\n");
      button.addEventListener("click", function () { openSemanticGroup(group, button); });
      nav.appendChild(button);
    });
  }

  // Every object lands in exactly one group: the edge can never hold work it does not name.
  function semanticGroup(object) {
    if (object.kind === "monitor") return object.monitor && object.monitor.phase === "changed" ? "needs" : "watching";
    if (object.lifecycle === "failed") return "held";
    if (object.lifecycle === "interrupted") return "needs";
    if (object.kind === "artifact") return "landed";
    if (object.lifecycle === "active") return object.activity && object.activity.phase === "needs_you" ? "needs" : "working";
    return "held";
  }
  var SEMANTIC_GROUPS = [
    { cls: "needs", label: "needs you", tone: "call" },
    { cls: "working", label: "working", tone: "live" },
    { cls: "held", label: "held up", tone: "waiting" },
    { cls: "landed", label: "landed", tone: "landed" },
    { cls: "watching", label: "watching", tone: "live" },
  ];
  var CARD_KIND = {
    decision: "call", action: "call", activity: "live", investigation: "live",
    artifact: "landed", monitor: "watching", conversation: "noted",
  };
  function semanticRow(object) {
    return {
      id: object.id,
      kind: CARD_KIND[object.kind] || "noted",
      title: object.subject,
      line: object.summary,
      project: object.project || "",
      status: object.status || "",
      detail: object.detail || object.summary,
    };
  }

  function semanticBox(object) {
    if (!object) return null;
    var tone = { conversation: "news", activity: "live", decision: "call", investigation: "news", action: "ready", artifact: "landed", monitor: object.monitor && object.monitor.phase === "changed" ? "call" : "waiting" }[object.kind] || "news";
    var children = (object.evidence || []).filter(function (work) { return work.kind === "image"; }).map(function (work) {
      return { kind: "shot", shot: { src: work.ref, label: work.label || object.subject } };
    });
    var web = (object.evidence || []).find(function (work) { return work.kind === "web" && !work.closed; });
    var decision = object.decision ? {
      task: object.decision.target,
      decisionId: object.decision.decisionId,
      question: object.decision.question,
      choices: object.decision.alternatives || [],
      recommended: object.decision.recommended,
      replyTo: object.decision.replyTo,
    } : undefined;
    var actionNeedsApproval = object.kind === "action" && object.action && object.action.requiresApproval && object.lifecycle === "interrupted";
    if (actionNeedsApproval && !decision) {
      decision = {
        task: object.action.target || object.id,
        question: object.detail || object.summary || ("Approve " + object.subject + "?"),
        choices: ["Approve", "Revise"],
      };
    }
    var kindLine = object.kind === "monitor" && object.monitor
      ? object.monitor.phase === "changed" ? object.monitor.change || object.detail || object.summary : object.monitor.condition || object.summary
      : object.detail || object.summary;
    return {
      id: object.id,
      kind: object.kind === "decision" ? "call" : object.kind === "action" ? "story" : object.kind === "artifact" ? "story" : "note",
      tone: tone,
      title: object.subject,
      line: kindLine,
      why: object.kind,
      status: object.kind === "decision" && object.decision && object.decision.decisionId ? "" : object.status || (object.activity && object.activity.phase) || (object.action && object.action.phase) || (object.monitor && object.monitor.phase) || object.lifecycle,
      project: object.project,
      at: object.updatedAt || object.createdAt,
      ref: object.source && object.source.ref,
      task: object.source && object.source.task,
      decision: decision,
      open: web ? { label: web.label || "Open", url: web.ref } : undefined,
      links: (object.evidence || []).filter(function (work) { return work.kind === "web"; }).map(function (work) { return { label: work.label || "Open", url: work.ref, closed: work.closed }; }),
      children: children,
      semantic: true,
      semanticKind: object.kind,
    };
  }

  function renderShow(next, boxes) {
    lastScreen = next;
    air.classList.toggle("on", !!next.live);
    air.textContent = next.live ? "on air" : "standby";
    // Semantic focus owns the main stage. Legacy boxes remain the compatibility
    // source for readouts/drilldowns, but they no longer get to out-rank meaning.
    var focusBox = semanticBox(next.focus);
    var sourceBoxes = boxes && boxes.length ? boxes : [{ id: "situation", kind: "note", size: "wide", title: next.title, line: next.summary, why: "where things stand" }];
    var parts = split(sourceBoxes);
    showEl.classList.toggle("semantic-workspace", !!focusBox);
    // Semantic focus owns the main stage unless a call that settled is standing in it: the
    // list is accumulating, so a card he was looking at stays where it was and only work
    // that needs him leads over it.
    if (focusBox) {
      var standing = parts.stage.filter(function (box) { return box.tone === "clear"; });
      var needsHim = !!(next.focus && next.focus.lifecycle === "interrupted");
      parts.stage = needsHim ? [focusBox].concat(standing) : standing.concat([focusBox]);
      // The plan gauge is the one instrument worth keeping beside the counts: the
      // rest either repeat them (work-state, landed-week) or belong to the old stage.
      parts.readouts = parts.readouts.filter(function (box) { return box.id === "plan"; });
      renderSemanticContext(next);
    } else {
      document.getElementById("semantic-context").textContent = "";
    }
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
    if (!drillEl.hidden) drawDrill();
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
    document.getElementById("calls-title").textContent = calls.length === 1 ? "Your decision" : calls.length + " decisions for you";
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
      if (call.decision && VIEW_TOKEN) item.appendChild(sceneAsk({ title: call.headline, decision: call.decision }, "flyd-decision:" + (call.decision.decisionId || call.decision.task) + ":" + call.decision.question));
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
    if (callsEl.isConnected && !event.defaultPrevented && event.key === "Escape" && !callsEl.hidden) { event.preventDefault(); showCalls(false); }
  });

  // A figure's own group, opened: every piece of work behind the number, one
  // plain line each, newest first, each unfolding its card detail where it stands.
  var drillEl = document.getElementById("drill");
  var drillSheet = drillEl.querySelector(".drill-sheet");
  var drillList = document.getElementById("drill-list");
  var drillTitle = document.getElementById("drill-title");
  var drillFrom = null;
  var drillKind = "";
  var drillSpec = null;
  var drawnDrill = "";
  var drillOpen = {};
  var DRILL = {
    landed: { title: "Landed", tone: "landed", pick: function (show) { return show.landedWeek || []; } },
    live: { title: "Under way", tone: "live", pick: function (show) { return show.underway || []; } },
    ready: { title: "To land", tone: "ready", pick: function (show) { return show.ready || []; } },
    waiting: { title: "Held up", tone: "waiting", pick: function (show) { return show.held || []; } },
    next: { title: "Queued", tone: "next", pick: function (show) { return show.next || []; } },
  };
  function drillWhen(item) { return item.at ? Date.parse(item.at) : 0; }
  function drillItem(item) {
    var key = item.id;
    // Where it stands, in a word or two: its state unless that only repeats the chip.
    var line = item.status && !/^(?:landed|done|queued|merged)$/i.test(item.status) ? item.status : (item.project || "");
    var open = item.links && item.links.length && !item.links[0].closed ? { url: item.links[0].url } : {};
    return visualCard(Object.assign({}, item, open), {
      kind: item.kind,
      className: "drill-card",
      key: key,
      line: line,
      when: item.at ? ago(item.at) : "",
      detail: item.detail || "",
      detailWhen: item.at ? dayOf(item.at) + ", " + clock(item.at) : "",
      linkLabel: "Open",
      open: !!drillOpen[key],
      onToggle: function (isOpen) { if (isOpen) drillOpen[key] = 1; else delete drillOpen[key]; },
    });
  }
  function drawDrill() {
    var group = drillSpec || DRILL[drillKind];
    if (!group || !lastScreen) return;
    var items = (group.rows ? group.rows() : group.pick(lastScreen)).slice().sort(function (a, b) { return drillWhen(b) - drillWhen(a); });
    var key = drillKind + "|" + JSON.stringify(items);
    if (key === drawnDrill) return;
    drawnDrill = key;
    drillSheet.className = "drill-sheet k-" + group.tone;
    drillTitle.textContent = group.title;
    drillList.textContent = "";
    if (!items.length) { drillList.appendChild(el("li", "drill-empty", "Nothing here right now.")); return; }
    items.forEach(function (item) { drillList.appendChild(drillItem(item)); });
  }
  function closeDrill() {
    drillEl.hidden = true;
    if (drillFrom && drillFrom.isConnected) drillFrom.focus();
    drillFrom = null;
  }
  function openDrill(kind, from, spec) {
    if (!spec && !DRILL[kind]) return;
    // Clicking the figure it is already showing closes it again.
    if (!drillEl.hidden && drillKind === kind) { closeDrill(); return; }
    drillKind = kind;
    drillSpec = spec || null;
    drillFrom = from || null;
    drillOpen = {};
    drawnDrill = "";
    drawDrill();
    drillEl.hidden = false;
    drillSheet.focus();
  }
  // The edge's own sheet: exactly the objects its number counted, newest first.
  function openSemanticGroup(group, from) {
    openDrill("semantic:" + group.cls, from, {
      title: capital(group.label),
      tone: group.tone,
      rows: function () {
        var held = semanticGroups[group.cls];
        return (held ? held.items : []).map(semanticRow);
      },
    });
  }
  document.getElementById("drill-close").addEventListener("click", closeDrill);
  drillEl.addEventListener("click", function (event) { if (event.target === drillEl) closeDrill(); });
  // A nested skill picker handles Escape before its sheet does.
  document.addEventListener("keydown", function (event) {
    if (drillEl.isConnected && !event.defaultPrevented && event.key === "Escape" && !drillEl.hidden) { event.preventDefault(); event.stopPropagation(); closeDrill(); }
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
      var leavingArtefact = onShow();
      if (leavingArtefact) {
        showCalls(false);
        closeDrill();
        lightbox.hidden = true;
      }
      root.setAttribute("data-screen", "terminal");
      showEl.hidden = true;
      showEl.classList.remove("power", "off");
      if (terminalAt.pinned) { toBottom(); jump.hidden = true; } else { pinned = false; restore(terminalAt.anchor); }
      flip.setAttribute("aria-checked", "false");
      if (leavingArtefact && !composer.hidden) input.focus();
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
    if (!showEl.isConnected || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest(".scene-ask, .art-chat, .reply, .passage, .prefs, .calls, .rail-phone-say")) return;
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

export function renderPage(options: { assistantLabel: string; sendToken?: string; newSession?: string }): string {
  const label = escapeHtml(options.assistantLabel);
  const token = (options.sendToken ? ` data-send-token="${escapeHtml(options.sendToken)}"` : "")
    + (options.newSession ? ` data-new-session="${escapeHtml(options.newSession)}"` : "");
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
  <span class="project-badge" id="project-badge" hidden></span>
  <span class="picker" id="conversation-title" aria-label="Current conversation"></span>
  <span class="air" id="air">standby</span>
  <a class="site" id="site" hidden target="_blank" rel="noopener noreferrer"><span class="site-kind" id="site-kind"></span><span class="site-host" id="site-host"></span><span class="site-path" id="site-path"></span></a>
  <span class="when" id="when"></span>
  <span class="controls">
    ${LEFT_BUTTON}<a href="/whatsapp" style="font-size:12px;color:var(--muted);text-decoration:none;padding:0 8px">people</a><button id="prefs-open" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="prefs">preferences</button>
    <button id="flip" type="button" role="switch" aria-checked="false" aria-label="Artefact view">artefact<span class="track" aria-hidden="true"></span></button>
  </span>
</header>
<div class="prefs" id="prefs" hidden role="dialog" aria-label="Preferences">
  <p class="prefs-title">Preferences</p>
  <button id="mode" type="button" role="switch" aria-checked="false"><span class="prefs-words"><span class="prefs-name">Full replies</span><span class="prefs-about">Every reply as written, not Flyd's reading</span></span><span class="track" aria-hidden="true"></span></button>
  <button id="theme" type="button" role="switch" aria-checked="false"><span class="prefs-words"><span class="prefs-name">Light theme</span><span class="prefs-about">Dark when off</span></span><span class="track" aria-hidden="true"></span></button>
  <button id="rail-toggle" type="button" role="switch" aria-checked="true"><span class="prefs-words"><span class="prefs-name">Right column</span><span class="prefs-about">Past conversations and finished work</span></span><span class="track" aria-hidden="true"></span></button>
  ${LEFT_PREFERENCE}
  <button id="preparation-link" type="button"><span class="prefs-words"><span class="prefs-name">Local preparation</span><span class="prefs-about">Review drafts and stop preparation</span></span><span class="prefs-go" aria-hidden="true">→</span></button>
  <button id="routines-link" type="button"><span class="prefs-words"><span class="prefs-name">Routines</span><span class="prefs-about">Useful requests, ready to use again</span></span><span class="prefs-go" aria-hidden="true">→</span></button>
  <button id="taste-link" type="button"><span class="prefs-words"><span class="prefs-name">Taste</span><span class="prefs-about">What Flyd knows about your taste</span></span><span class="prefs-go" aria-hidden="true">→</span></button>
</div>
${LEFT_HTML}
<aside class="rail" id="rail" hidden aria-label="Conversation history and done work">
  <button class="rail-hide" id="rail-hide" type="button" aria-label="Hide the column">✕</button>
  <div class="rail-pane">
  <section class="history" id="history" hidden aria-label="Past conversations"><div class="history-top"><h2 class="history-title">History</h2></div><div id="history-list"></div></section>
  <div class="brief" id="brief" hidden>
    <section class="brief-list" id="notices" hidden aria-label="Notices"></section>
    <section class="brief-list" id="done" hidden aria-label="Done"></section>
    <section class="brief-list news" id="news" hidden aria-label="News"></section>
  </div>
  </div>
</aside>
<main id="stream" aria-live="polite">
  <p class="empty" id="empty" hidden>Nothing said yet.</p>
  <div class="working" id="working" hidden aria-label="${label} is working"><span class="dots"><i></i><i></i><i></i></span></div>
</main>
<button class="jump" id="jump" type="button" hidden>↓ new</button>
<div class="lightbox" id="lightbox" hidden role="dialog" aria-label="Image"><button class="lightbox-nav lightbox-prev" type="button" aria-label="Previous image">‹</button><img id="lightbox-img" alt=""><button class="lightbox-nav lightbox-next" type="button" aria-label="Next image">›</button></div>
<div class="problem" id="problem"></div>
<a id="routine-suggestion" href="/routines" hidden style="position:fixed;bottom:150px;right:24px;font-size:14px;color:var(--accent);padding:12px;background:var(--tint);border-radius:12px">Keep this repeated request as a routine →</a>
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
  <nav class="semantic-context" id="semantic-context" aria-label="Other work"></nav>
  <div class="readouts" id="readouts" aria-label="Readouts"></div>
  <div class="calls" id="calls" hidden role="dialog" aria-modal="true" aria-labelledby="calls-title">
    <div class="calls-sheet" tabindex="-1">
      <div class="calls-top"><h2 id="calls-title">Your decisions</h2><button id="calls-close" type="button" aria-label="Close">✕</button></div>
      <ol class="calls-list" id="calls-list"></ol>
    </div>
  </div>
  <div class="drill" id="drill" hidden role="dialog" aria-modal="true" aria-labelledby="drill-title">
    <div class="drill-sheet" tabindex="-1">
      <div class="drill-top"><h2 id="drill-title"></h2><button id="drill-close" type="button" aria-label="Close">✕</button></div>
      <ul class="drill-list" id="drill-list"></ul>
    </div>
  </div>
  <div class="foot"><p class="doing" id="show-doing">Standby</p><span class="hint">type to talk · tab for the conversation</span><span id="show-nav" hidden><button class="show-nav" id="show-prev" type="button" aria-label="Previous card">←</button><button class="show-nav" id="show-next" type="button" aria-label="Next card">→</button></span></div>
</section>
<form class="composer" id="composer" hidden autocomplete="off">
  <div class="row">
    <p class="unread" id="staff" role="status" hidden></p>
    <ul class="commands" id="commands" role="listbox" aria-label="Skills and commands" hidden></ul>
    <section class="about" id="about" aria-label="What this message is about" hidden><button class="about-clear" type="button" id="about-clear" aria-label="Not about this">✕</button><div class="about-head" id="about-head"></div><p class="about-title" id="about-title"></p><div id="about-body"></div></section>
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

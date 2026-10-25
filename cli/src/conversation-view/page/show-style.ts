/*
 * Artefact view: Flyd on TV. One scene holds the screen at a time: a big
 * headline in Flyd's words, the sentence that says what it means for him, and
 * the work itself large beside it: the desktop capture in a browser, the phone
 * capture in a phone in front of it. The scenes take turns like title cards,
 * the work with pictures first. The numbers are one quiet line at the foot,
 * never a dashboard. Text fades in place: no movement, no pop. The
 * conversation stays live underneath, one switch away.
 */
export const SHOW_STYLE = `
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
  padding: var(--head-h) clamp(28px, 6vw, 104px) 0;
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
.semantic-context .failed { color: var(--k-call); }
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
.scene-head { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
.scene-head.long { -webkit-line-clamp: 3; max-width: 18em; font-size: clamp(32px, 4vw, 64px); line-height: 1.06; letter-spacing: -0.026em; }
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
/* The pattern's body: the question, the findings, the document itself, the operation. */
.screen-body { display: grid; gap: 14px; margin-top: 22px; max-width: 640px; }
.screen-body:empty { display: none; }
.screen-question { margin: 0; font: 500 clamp(18px, 1.5vw, 22px)/1.35 var(--sans); color: var(--strong); }
.screen-document { margin: 0; font: 400 17px/1.55 var(--sans); color: var(--fg); white-space: pre-wrap; }
.screen-rec { margin: 0; font: 400 16px/1.5 var(--sans); color: var(--muted); }
.screen-rec b, .screen-operation b { font-weight: 600; color: var(--strong); }
.screen-operation { margin: 0; font: 400 17px/1.5 var(--sans); color: var(--fg); }
.screen-findings { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.screen-findings h4 { margin: 0 0 2px; font: 600 16px/1.3 var(--sans); color: var(--strong); }
.screen-findings p { margin: 0; font: 400 15px/1.5 var(--sans); color: var(--fg); }
.screen-confidence { display: inline-block; margin-top: 4px; font: 500 12px/1 var(--sans); letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.screen-comparison { border-collapse: collapse; width: 100%; font: 400 15px/1.45 var(--sans); }
.screen-comparison th, .screen-comparison td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--faint); }
.screen-comparison tr:first-child th { font-weight: 600; color: var(--muted); }
.screen-metrics { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; }
.screen-metrics dt { font: 500 12px/1.4 var(--sans); letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.screen-metrics dd { margin: 0 0 0 6px; font: 400 15px/1.4 var(--sans); color: var(--fg); }
.screen-evidence { font: 500 15px/1.4 var(--sans); color: var(--accent); text-decoration: none; }
.screen-evidence:hover { text-decoration: underline; }
/* The artefact in the conversation: the same pattern, drawn where he reads. */
.inline-screen { margin: 28px 0 8px; }
.inline-screen[hidden] { display: none; }
.inline-card {
  display: grid; gap: 12px; padding: 22px 24px; border: 1px solid var(--faint);
  border-left: 3px solid var(--accent); border-radius: 12px; background: var(--tint);
}
.inline-card.k-landed { border-left-color: var(--k-landed); }
.inline-card.k-call { border-left-color: var(--k-call); }
.inline-kind { margin: 0; font: 500 12px/1 var(--sans); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.inline-head { margin: 0; font: 600 clamp(19px, 1.7vw, 25px)/1.25 var(--sans); color: var(--strong); }
.inline-head[role="button"] { cursor: pointer; }
.inline-main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
.inline-main.has-shot { grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr); }
.inline-text { min-width: 0; }
@media (max-width: 720px) { .inline-main.has-shot { grid-template-columns: minmax(0, 1fr); } }
.inline-card .screen-body { margin-top: 4px; max-width: none; }
.inline-shots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; min-width: 0; }
.inline-shots img { display: block; width: 100%; max-height: 150px; border-radius: 8px; border: 1px solid var(--faint); object-fit: cover; cursor: zoom-in; }
.inline-card .scene-ask { margin-top: 10px; max-width: none; }
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
  /* A decision with a picture and an ask stacks too: the scene is the phone's width. */
  .scene.has-shot.has-ask { grid-template-columns: minmax(0, 1fr); }
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
  .show { overflow-x: hidden; overflow-y: auto; padding: var(--head-h) 16px 0; }
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

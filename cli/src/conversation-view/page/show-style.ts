/*
 * What the Artefact (TV) view left that other places still draw: a card's
 * question and its answers, its own thread and chat box, and the work's
 * pictures framed as a browser or a phone.
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

@keyframes show-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes show-out { from { opacity: 1; } to { opacity: 0; } }

/* The page a change is on: a button that opens it, big enough to read across the room. */
a.open-page, .msg.user a.open-page { display: flex; width: fit-content; align-items: center; gap: 0.5em; max-width: 100%; padding: 0.6em 1.15em; border-radius: 999px; background: var(--accent); color: var(--bg); font: 600 15px/1.2 var(--sans); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity 160ms ease; }
.open-page:hover { opacity: 0.85; }
.open-page:focus-visible { outline: 2px solid var(--strong); outline-offset: 3px; }

.reply-open-page { margin: 0.6em 0 0.4em; }

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
/* The pair is one composition: the box keeps the pair's own shape, so the phone always stands in front of the desktop's lower right. */
.devices.pair { height: auto; aspect-ratio: 10 / 7; width: min(100%, calc(min(66vh, calc(100vh - 300px)) * 10 / 7)); margin-inline: auto; }
.devices.pair .desk { left: 0; top: 0; width: 86cqw; height: 53.75cqw; }
.devices.pair .phone { right: 0; bottom: 0; width: 23.5cqw; height: 51cqw; }
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
.screen-comparison { border-collapse: collapse; width: 100%; font: 400 15px/1.45 var(--sans); }
.screen-comparison th, .screen-comparison td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--faint); }
.screen-comparison tr:first-child th { font-weight: 600; color: var(--muted); }
.screen-metrics { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; }
.screen-metrics dt { font: 500 15px/1.4 var(--sans); color: var(--muted); }
.screen-metrics dd { margin: 0 0 0 6px; font: 400 15px/1.4 var(--sans); color: var(--fg); }
.screen-evidence { font: 500 15px/1.4 var(--sans); color: var(--accent); text-decoration: none; }
.screen-evidence:hover { text-decoration: underline; }

/* A hold with more than one decision: each in its own plain line, then what he can pick. */
.art-decisions { display: flex; flex-direction: column; gap: 16px; margin: 0 0 22px; padding: 0; list-style: none; }
.art-decision { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 12px; background: var(--tint); }
.art-decision .choices { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.art-decision-own { display: flex; gap: 8px; }
.art-decision-own[hidden] { display: none; }
.art-decision-input { flex: 1; min-width: 0; height: 36px; padding: 0 12px; border: 1px solid var(--faint); border-radius: 8px; background: var(--bg); color: var(--fg); font: 400 15px/1.3 var(--sans); }
.art-decision-own .art-chat-send { flex: none; }
.art-decision-sent { margin: 0; font: 400 13px/1.4 var(--sans); color: var(--muted); }
.art-decision-sent:empty { display: none; }
.art-decision-q { margin: 0; font: 500 17px/1.3 var(--sans); color: var(--strong); }
.art-decision-a { margin: 0; font: 400 14.5px/1.45 var(--sans); color: var(--fg); white-space: pre-wrap; overflow-wrap: anywhere; }
.art-decision-rec { margin: 0; font: 400 14px/1.45 var(--sans); color: var(--muted); }
.art-decision--done .art-decision-q { color: var(--muted); }
.art-decision-done { color: var(--muted); }
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
.choice-pick.primary:not(:disabled), .choice-pick.primary:not(:disabled):hover { color: var(--bg); background: var(--accent); border-color: var(--accent); }
.choice-pick.primary:not(:disabled) small { color: color-mix(in srgb, var(--bg) 70%, transparent); }
.choice-pick:disabled { cursor: default; }
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
.art-chat-receipt.problem { position: static; color: var(--k-waiting); }
.art-chat--receipt .art-chat-field { display: none; }
/* His messages to one card and what came back, in order: the card's own thread.
   Quiet type, no bubbles, and the newest thing he sent stays under his words. */
.art-thread { display: flex; flex-direction: column; gap: 14px; margin-bottom: 18px; }
.art-thread[hidden] { display: none; }
.art-entry { display: flex; flex-direction: column; gap: 6px; }
.art-msg { margin: 0; font: 500 17px/1.5 var(--sans); color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.art-msg--you { font-weight: 400; color: var(--fg); }
/* His answer is the substance, not a footnote: full strength and his own size, with no rule beside it. */
.art-msg--them { color: var(--strong); }
/* What Flyd is doing about his newest message: one quiet line that the answer replaces. */
.art-working { display: flex; align-items: center; gap: 9px; color: var(--muted); animation: art-in 200ms ease-out both; }
.art-pulse { flex: none; width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: art-breathe 1.4s ease-in-out infinite; }
@keyframes art-breathe { 0%, 100% { opacity: .22; transform: scale(.85); } 50% { opacity: .85; transform: scale(1); } }
@keyframes art-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .art-working, .art-pulse { animation: none; } }
/* His reply to an answer opens where the answer stands, so the thread stays in one place. */
.art-reply-wrap { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.art-reply { font: 500 13.5px/1 var(--sans); color: var(--muted); background: none; border: 0; padding: 4px 0; cursor: pointer; }
.art-reply:hover { color: var(--strong); }
.art-reply[hidden] { display: none; }
.art-failed { color: var(--strong); }
.art-retry { font: 500 13.5px/1 var(--sans); color: var(--accent); background: none; border: 0; padding: 4px 0; cursor: pointer; }
.art-retry:hover { text-decoration: underline; }
.art-chat--nested { margin-top: 4px; }
.art-msg--them { margin-bottom: 4px; }
.scene-ask .step-q { font-size: clamp(20px, 1.6vw, 26px); line-height: 1.25; }
.scene-ask .step-review { font-size: clamp(16px, 1.2vw, 19px); }

@keyframes scene-out { to { opacity: 0; } }
@keyframes scene-fade { from { opacity: 0; } to { opacity: 1; } }

.call { padding: 22px 0 24px; }
.call + .call { border-top: 1px solid var(--faint); }
.call-meta { display: flex; gap: 12px; margin: 0 0 6px; font: 500 12px/1.4 var(--mono); color: var(--muted); }
.call-head { margin: 0; font: 600 19px/1.35 var(--sans); color: var(--strong); text-wrap: pretty; }
.call-question { margin: 8px 0 0; font: 400 16px/1.5 var(--sans); color: var(--fg); text-wrap: pretty; }
.call-link { display: inline-block; margin: 8px 14px 0 0; font: 500 13px/1.4 var(--mono); color: var(--link); text-decoration: none; }

/* Each answer compact: the choices, then the chat box. */
.call .scene-ask { margin-top: 14px; max-width: none; }
.call .choice-pick { min-height: 44px; font-size: 15px; }
.call-link.closed { color: var(--muted); font-style: italic; }

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
  
  
  
  .devices { height: 44vh; }
}
@media (max-height: 680px) {
  
  
  
  
  .devices { height: 38vh; }
}
@media (max-width: 720px) {
  
  
  
  
  
  
  
  
  .devices { height: 46vh; }
  .foot .hint { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .project-badge.shown, .show.power, .show.off, .scene.in > *, .scene.in .scene-head, .scene.in .scene-line, .scene.in .scene-meta, .scene.in .scene-ask, .scene.in .scene-shot, .scene.in .scene-open,
  .scene.out > *, .ro.fade, .doing.on::before, .msg.spot { animation: none; }
  
}

/* The Artefacts view: one artefact fills the screen under the header, picture big, headline big. */
.tv { position: fixed; inset: var(--top, 56px) 0 0 0; z-index: 40; background: var(--paper, var(--bg)); overflow: auto; animation: show-in 220ms ease-out; }
.tv-stage { min-height: 100%; box-sizing: border-box; padding: 32px var(--gut, 32px) 48px; display: flex; }
.tv-scene { flex: 1; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 40px; max-width: 1400px; margin: 0 auto; width: 100%; }
.tv-pic { min-height: 0; height: min(64vh, calc(100vh - 340px)); display: flex; align-items: center; justify-content: center; }
.tv-pic img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; box-shadow: 0 18px 44px rgba(0,0,0,.18); }
.tv-pic.tv-nopic { height: 0; }
.tv-frame { width: 100%; height: 100%; border-radius: 8px; overflow: hidden; box-shadow: 0 18px 44px rgba(0,0,0,.18); background: #fff; }
.tv-frame iframe { width: 100%; height: 100%; border: 0; display: block; }
.tv-frame.tv-phone { width: min(100%, calc(min(64vh, calc(100vh - 340px)) * 0.46)); border-radius: 32px; }
.tv-words { display: grid; gap: 14px; justify-items: start; }
.tv-head { margin: 0; font: 600 clamp(32px, 4vw, 64px)/1.08 var(--sans); letter-spacing: -0.02em; color: var(--strong); text-decoration: none; text-wrap: balance; }
a.tv-head:hover { opacity: 0.8; }
.tv-line { margin: 0; font: 400 20px/1.45 var(--sans); color: var(--muted); max-width: 60ch; }
.tv-nav { display: flex; align-items: center; gap: 16px; margin-top: 24px; }
.tv-step { width: 48px; height: 48px; border: 1px solid var(--faint); border-radius: 999px; background: transparent; color: var(--strong); font-size: 20px; cursor: pointer; transition: opacity 160ms ease-out; }
.tv-step:disabled { opacity: 0.3; cursor: default; }
.tv-count { color: var(--muted); font-size: 16px; font-variant-numeric: tabular-nums; }
.tv-empty { margin: auto; color: var(--muted); font-size: 24px; }
#tv-flip[aria-checked="true"] { color: var(--strong); text-decoration: underline; text-underline-offset: 6px; }
`;

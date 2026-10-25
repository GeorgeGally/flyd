/** The message box: the card it is about, attachments, voice and the command list. */
export const COMPOSER_STYLE = `
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
/* A drop Flyd could not take: said in the box itself, where the file was headed. */
.composer .notice { margin: 0 0 0.5em; font: 12.5px/1.45 var(--mono); color: var(--accent); }
.composer .notice[hidden] { display: none; }
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
  main { padding: var(--head-h) 1em 12vh; }
  .composer .row { padding: 0 1.25em; }
  .composer .hint { display: none; }
  .time { display: none; }
  header .when { display: none; }
  /* On a phone the controls take their own row rather than running off the edge. */
  :root { --head-h: 92px; }
  header { gap: 8px 10px; padding: 0 16px; flex-wrap: wrap; align-content: center; row-gap: 4px; }
  header .controls { flex: 1 1 100%; justify-content: flex-end; margin-left: 0; gap: 2px; min-width: 0; }
  header .controls #left-open { white-space: nowrap; }
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
`;

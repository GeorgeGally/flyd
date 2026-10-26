/** The reading column, the header's page link, preferences and the right column. */
export const CHROME_STYLE = `

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
  position: fixed; top: var(--head-h); right: 0; bottom: 0; width: min(430px, 34vw); z-index: 6;
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
/* History sits under the work, a few rows a project, so it never pushes the artefacts out of view. */
.history { flex: none; padding: 20px 20px 12px; border-bottom: 1px solid var(--faint); }
.history .history-more { margin: 0 0 6px 14px; padding: 6px 0; }
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
/* What came since he last looked: one quiet word in the accent, nothing moves. */
.brief-new { color: var(--accent); }
/* Artefacts: a grid of pictures, each with its title, one line of what and when, and "open". */
.brief-list .art-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 14px; }
.brief-list .art-plain { gap: 16px; margin-top: 24px; }
.brief-list .art-grid + .art-plain { padding-top: 20px; border-top: 1px solid var(--faint); }
.art-card { display: block; min-width: 0; }
.art-card p { margin: 0; }
.art-pic { position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; margin: 0 0 10px; padding: 0; border: 0; border-radius: 8px; overflow: hidden; background: var(--tint); cursor: pointer; }
.art-pic img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.art-pic:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.art-frame { cursor: default; }
.art-frame iframe { position: absolute; top: 0; left: 0; border: 0; display: block; background: transparent; transform: scale(var(--fit, 0.3)); transform-origin: 0 0; pointer-events: none; }
.art-phone { border-radius: 8px; }
.art-card .art-title { font-size: 15px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.art-kind { margin: 0 0 4px; font: 400 13px/1.4 var(--sans); color: var(--muted); }
.art-meta { display: flex; margin: 3px 0 0; font: 400 13px/1.4 var(--sans); color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.art-line { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.art-ago { flex: none; white-space: pre; }
.art-line + .art-ago::before { content: " · "; }
.art-card .art-meta { margin-top: 3px; }
.art-card .brief-meta { margin-top: 6px; }
.art-frame-open { position: absolute; inset: 0; }
.art-frame-open:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.art-steps { margin: 8px 0 0; padding: 0 0 0 18px; font: 400 14px/1.5 var(--sans); color: var(--fg); }
.art-steps li + li { margin-top: 2px; }
.art-steps .art-steps-more { list-style: none; margin-left: -18px; color: var(--muted); }
.art-goto { padding: 0; border: 0; background: none; font: inherit; cursor: pointer; }
/* More or less like a story: two small words beside where it came from. */
.story-rate { display: inline-flex; gap: 2px; margin-left: 10px; }
.story-rate button { padding: 2px 6px; border: 0; border-radius: 6px; background: none; font: inherit; color: var(--muted); cursor: pointer; transition: color 140ms ease; }
.story-rate button:hover { color: var(--fg); }
.story-rate button:disabled { opacity: 0.5; cursor: default; }
.story-rate button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.story-told { color: var(--accent); }
:root[data-screen="show"] .rail { display: none; }

.msg { position: relative; overflow-wrap: anywhere; }
.msg[data-day]::before {
  content: attr(data-day); display: block; margin: 2.4em 0 0.4em;
  font: 500 13px/1 var(--mono); letter-spacing: 0.02em; color: var(--muted);
}
.msg.user { margin-top: 2em; }
`;

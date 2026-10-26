/**
 * The front page: the one active job (or the conversation) straight on the
 * paper in the middle, and one right column of two tabs: the jobs as cards and
 * the page's artefact column (#rail: artefacts, notices, news) as cards. Paper and ink; the only colour is the dot on what needs him.
 * Text changes by a fade in place: nothing on it moves, no button lifts.
 * Comes last in the page's style so it wins over the older column rules it
 * replaces; the few layout properties those set with stronger selectors are
 * marked !important here.
 */
export const FRONT_STYLE = `
:root[data-layout="front"] {
  --paper: #ECEAE5; --card: #F5F4F1; --sheet: #FFFFFF; --ink: #161615; --ink2: #4A4945; --mute: #76746E;
  --line: #E2DFD9; --mat: #DEDAD2; --well: #F4F2EE; --well-on: #EEEBE5; --hot: #F04E1A;
  --gut: 20px; --arts-w: 352px; --head-h: 56px; --top: var(--head-h); --tabs-h: 46px; --measure: 760px;
  --c-left: var(--gut); --c-right: calc(var(--gut) * 2 + var(--arts-w));
  /* The conversation keeps a readable measure, centred in the room the right column leaves. */
  --pad-x: max(32px, calc((100vw - var(--c-left) - var(--c-right) - var(--measure)) / 2));
  --bg: var(--sheet); --fg: #2B2A28; --strong: var(--ink); --muted: var(--mute); --faint: var(--line); --tint: var(--well);
  --accent: var(--ink); --link: #1F5F99; --sel-bg: #ECE5D8; --sel-fg: var(--ink);
  background: var(--paper);
}
:root[data-layout="front"][data-theme="dark"] .job .frame img, :root[data-layout="front"][data-theme="dark"] .rail .art-pic img { outline-color: rgba(255, 255, 255, .1); }
:root[data-layout="front"][data-theme="dark"] {
  --paper: #111110; --card: #1A1A18; --sheet: #1F1F1D; --ink: #F1EFEA; --ink2: #C9C6BF; --mute: #8E8B83;
  --line: #2F2E2B; --mat: #2A2926; --well: #272624; --well-on: #2E2D2A;
  --fg: #DEDBD4; --link: #9CC3E6; --sel-bg: #3D372D; --sel-fg: #FFF6E6;
}
.rtabs, .jobs, .stage-head, .job-view, .front-date { display: none; }
:root[data-layout="front"] body { background: transparent; font-size: 20px; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-wrap: pretty; }

/* The top line: who and what day. The controls stay, smaller. */
:root[data-layout="front"] header { height: var(--top); padding: 0 calc(var(--gut) + 4px); background: var(--paper); backdrop-filter: none; -webkit-backdrop-filter: none; gap: 20px; }
:root[data-layout="front"] header .who { color: var(--ink); font-weight: 600; font-size: 17px; letter-spacing: -0.01em; }
:root[data-layout="front"] .front-date { display: inline; color: var(--mute); font-size: 15px; font-weight: 400; white-space: nowrap; }
:root[data-layout="front"] header .picker, :root[data-layout="front"] .when, :root[data-layout="front"] #left-open, :root[data-layout="front"] #left-toggle { display: none !important; }
:root[data-layout="front"] .project-badge { display: none; }
:root[data-layout="front"] header .controls { margin-left: auto; font-size: 13px; }
:root[data-layout="front"] header .controls > * { font-size: 13px !important; }

/* The older left column gives way to the job cards. */
:root[data-layout="front"] .left { display: none !important; }

/* The right column: two quiet tabs, then whichever one is open, scrolling on its own. */
:root[data-layout="front"] .rtabs {
  display: flex; gap: 22px; position: fixed; z-index: 3; top: var(--top); right: var(--gut); width: var(--arts-w); height: var(--tabs-h);
  align-items: flex-start; padding: 6px 4px 0; background: var(--paper);
}
.rtab {
  display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0; border: 0; background: none; cursor: pointer;
  font: 400 15px/1 var(--sans); color: var(--mute); transition: color .2s ease;
}
.rtab:hover, .rtab[aria-pressed="true"] { color: var(--ink); }
.rtab[aria-pressed="true"] { font-weight: 500; }
.rtab .fdot[hidden] { display: none; }
.rtab:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; border-radius: 2px; }
:root[data-layout="front"][data-rtab="arts"] .jobs, :root[data-layout="front"][data-rtab="jobs"] .rail { display: none !important; }
:root[data-layout="front"] .jobs, :root[data-layout="front"] .rail {
  display: block; position: fixed; top: calc(var(--top) + var(--tabs-h)); bottom: 0; z-index: 3; overflow-y: auto; scrollbar-width: none;
  padding: 0 0 24px; font: 400 15px/1.5 var(--sans); color: var(--ink); background: none;
}
:root[data-layout="front"] .rail[hidden] { display: none; }
.jobs::-webkit-scrollbar, .rail::-webkit-scrollbar, .rail-pane::-webkit-scrollbar { display: none; }
:root[data-layout="front"] .jobs, :root[data-layout="front"] .rail { right: var(--gut); width: var(--arts-w); }
.fgroup { margin: 0 0 30px; }
.fhead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 0; padding: 6px 4px 10px; font: 400 13px/1.3 var(--sans); color: var(--mute); }
.fempty { margin: 0; padding: 0 4px; font-size: 14px; color: var(--mute); }
.fmore { display: block; margin: 2px 0 0; padding: 6px 4px; border: 0; background: none; font: 400 13px/1.3 var(--sans); color: var(--mute); cursor: pointer; transition: color .2s; }
.fmore:hover { color: var(--ink); }
.fdot { display: inline-block; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--hot); }

/* Job cards: quiet surfaces; the open one is white with a hairline. */
.job {
  display: block; width: 100%; margin: 0 0 8px; padding: 14px 16px 15px; border: 0; border-radius: 10px;
  background: var(--card); color: var(--ink); font: inherit; text-align: left; cursor: pointer;
  transition: background-color .2s ease, box-shadow .2s ease;
}
.job:hover { background: var(--sheet); }
.job.on { background: var(--sheet); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 12%, transparent); }
.job:focus-visible, .ver:focus-visible, .fbtn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.job .frame { margin: -4px -6px 12px; padding: 8px 8px 0; border-radius: 7px; background: var(--mat); aspect-ratio: 16 / 9; overflow: hidden; }
.job .frame img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; border-radius: 4px 4px 0 0; outline: 1px solid rgba(0, 0, 0, .1); outline-offset: -1px; }
.job.on .frame { display: none; }
.job .t { font-weight: 500; line-height: 1.35; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; text-wrap: pretty; }
.job .m { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 13px; color: var(--mute); white-space: nowrap; min-width: 0; }
.job .m .s { color: var(--ink2); }
.job .m .p { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.job .m .w { margin-left: auto; padding-left: 8px; font-variant-numeric: tabular-nums; }
/* The conversation card is just its title: who it's with goes without saying. */
.job.talk .m { display: none; }
.fnew { color: var(--hot); }
.job.done .t, .job.talk .t { font-weight: 400; color: var(--ink2); }
.job.talk.on .t { color: var(--ink); }

/* The active job's heading, on the paper like everything else in the middle. */
:root[data-layout="front"] .stage-head {
  display: block; position: fixed; z-index: 3; top: var(--top); left: var(--c-left); right: var(--c-right);
  padding: 26px var(--pad-x) 16px; background: var(--paper); transition: opacity .2s ease;
}
.crumb { display: flex; align-items: center; gap: 8px; margin: 0; font: 400 13px/1.4 var(--sans); color: var(--mute); white-space: nowrap; overflow: hidden; }
.crumb .s { color: var(--ink); }
:root[data-layout="front"]:not([data-job]) .crumb { display: none; }
:root[data-layout="front"]:not([data-job]) .stage-head h1 { margin-top: 0; }
.crumb .p { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.stage-head h1 {
  margin: 8px 0 0; font: 500 22px/1.25 var(--sans); letter-spacing: -0.015em; color: var(--ink); text-wrap: balance;
  overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
:root[data-layout="front"] .front-fade { opacity: 0; }

/* The conversation, straight on the paper. */
:root[data-layout="front"] main {
  max-width: none; margin: 0 var(--c-right) 0 var(--c-left) !important;
  padding: calc(var(--stage-head-h, 110px) + 6px) var(--pad-x) calc(var(--composer-h, 130px) + var(--gut) + 28px) !important;
  transition: opacity .2s ease;
}
:root[data-layout="front"] .msg.fresh { animation: choice-in 280ms ease both; }
/* What needs him lives in the left column; the conversation doesn't repeat it. */
:root[data-layout="front"]:not([data-screen="show"]) #show, :root[data-layout="front"] .inline-screen { display: none !important; }
/* The decision the conversation carries: the same quiet well as the message box, a hairline of the dot's colour. */
:root[data-layout="front"] .inline-card { border: 0; border-left: 2px solid var(--line); background: var(--well); }
:root[data-layout="front"] .inline-card.k-call { border-left-color: var(--hot); }
:root[data-layout="front"] .inline-kind { letter-spacing: .04em; }
/* A card's kind in plain case: a quiet word, not a shouted label. */
:root[data-layout="front"] .msg .card-meta { font: 400 13px/1.4 var(--sans); letter-spacing: 0; text-transform: none; }
:root[data-layout="front"] .empty { margin-top: 18vh; }
:root[data-layout="front"] .composer {
  left: var(--c-left); right: var(--c-right); bottom: 0; z-index: 4;
  padding: 14px var(--pad-x) calc(var(--gut) + 14px); border-radius: 0; background: var(--paper); font-size: 16px;
}
:root[data-layout="front"] .composer .row { max-width: none; margin: 0 !important; padding: 0; }
:root[data-layout="front"] .composer .field { margin-left: 0; padding: 7px 7px 7px 16px; border-radius: 12px; background: var(--sheet); align-items: center; box-shadow: 0 0 0 1px var(--line); }
:root[data-layout="front"] .composer .field:focus-within { box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 22%, transparent); }
:root[data-layout="front"] .composer #send { height: 32px; padding: 0 12px; border-radius: 8px; font: 600 12px/1 var(--mono); letter-spacing: 0.02em; color: var(--sheet); background: var(--ink); }
:root[data-layout="front"] .composer .about, :root[data-layout="front"] .composer .unread, :root[data-layout="front"] .composer .attachments { margin-left: 0; }
:root[data-layout="front"] .composer .hint { margin-top: 8px; padding-left: 2px; font-size: 11.5px; font-variant-numeric: tabular-nums; opacity: 0; transition: opacity .2s ease; }
:root[data-layout="front"] .composer:hover .hint, :root[data-layout="front"] .composer:focus-within .hint { opacity: 1; }
:root[data-layout="front"] .jump { right: calc(var(--c-right) + var(--pad-x)); bottom: calc(var(--composer-h, 130px) + var(--gut) + 12px); }

/* One job, open: what it is, its pictures large enough to judge, its words and a box. */
:root[data-layout="front"][data-job] main, :root[data-layout="front"][data-job] .composer, :root[data-layout="front"][data-job] .jump { display: none !important; }
:root[data-layout="front"][data-job] .job-view {
  display: block; margin: 0 var(--c-right) 0 var(--c-left); padding: calc(var(--stage-head-h, 110px) + 6px) var(--pad-x) calc(var(--gut) + 40px);
  font: 400 15px/1.5 var(--sans); color: var(--ink); transition: opacity .2s ease;
}
.jv-lead { margin: 0 0 20px; max-width: 64ch; color: var(--ink2); overflow-wrap: anywhere; }
.jv-work { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 20px; }
.jv-work.one { grid-template-columns: minmax(0, 1fr); }
/* The whole picture, never a crop: a choice is made on what the work actually looks like. */
.jv-view { display: flex; align-items: center; justify-content: center; width: 100%; margin: 0; padding: 20px 24px; border: 0; border-radius: 12px; background: var(--mat); overflow: hidden; cursor: zoom-in; }
.jv-view img { display: block; max-width: 100%; max-height: min(64vh, 620px); width: auto; height: auto; border-radius: 5px; box-shadow: 0 2px 14px rgba(0, 0, 0, .12); transition: opacity .2s ease; }
.jv-view img.fade { opacity: 0; }
.jv-vers { display: flex; flex-direction: column; gap: 2px; }
.ver {
  display: grid; grid-template-columns: 14px 44px minmax(0, 1fr); gap: 12px; align-items: center; width: 100%; padding: 7px 8px;
  border: 0; border-radius: 9px; background: none; color: var(--ink); font: inherit; text-align: left; cursor: pointer; transition: background-color .2s ease;
}
.ver:hover { background: var(--well); }
.ver.on { background: var(--well-on); }
.ver .i { font-size: 13px; color: var(--mute); }
.ver .th { width: 44px; height: 34px; border-radius: 4px; background: var(--mat) center top / cover no-repeat; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .05); }
.ver .n { font-size: 14px; font-weight: 500; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jv-plain { padding: 24px 28px; border-radius: 12px; background: var(--well); }
.jv-plain .big { margin: 0; font: 500 21px/1.3 var(--sans); letter-spacing: -0.01em; max-width: 34ch; overflow-wrap: anywhere; }
.jv-plain .sub { margin: 6px 0 0; font-size: 14px; color: var(--mute); }
.jv-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.fbtn {
  display: inline-flex; align-items: center; height: 32px; padding: 0 14px; border: 0; border-radius: 8px; background: none;
  box-shadow: inset 0 0 0 1px var(--line); color: var(--ink); font: 500 14px/1 var(--sans); text-decoration: none; cursor: pointer;
  white-space: nowrap; transition: background-color .2s ease;
}
.fbtn:hover { background: var(--well); }
.jv-talk { display: grid; gap: 14px; margin-top: 26px; }
.jv-msg { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 16px; }
.jv-msg .who { padding-top: 2px; font-size: 13px; line-height: 1.35; color: var(--mute); }
.jv-msg .who b { display: block; font-weight: 500; color: var(--ink); }
.jv-msg p { margin: 0; max-width: 64ch; color: var(--ink); overflow-wrap: anywhere; }
.job-view .scene-ask { max-width: none; margin-top: 22px; gap: 12px; }
.job-view > .art-chat { margin-top: 22px; }
.job-view .scene-ask .choices { display: flex; flex-wrap: wrap; gap: 8px; }
.job-view .choice-pick { min-height: 36px; padding: 8px 14px; border: 0; border-radius: 8px; background: none; box-shadow: inset 0 0 0 1px var(--line); font: 500 14px/1.3 var(--sans); color: var(--ink); max-width: 100%; }
.job-view .choice-pick:hover { background: var(--well); color: var(--ink); }
.job-view .choice-pick[aria-pressed="true"], .job-view .choice-pick[aria-pressed="true"]:hover { background: var(--ink); color: var(--sheet); box-shadow: none; }
.job-view .art-thread { gap: 10px; margin: 4px 0 6px; }
.job-view .art-msg { font-size: 15px; color: var(--ink2); }
.job-view .art-msg--you { color: var(--ink); }
.job-view .art-chat-field { padding: 6px 6px 6px 16px; border: 0; border-radius: 12px; background: var(--well); }
.job-view .art-chat-field:focus-within { background: var(--well-on); }
.job-view .art-chat-input { color: var(--ink); font-size: 15px; }
.job-view .art-chat-send { height: 32px; padding: 0 12px; border-radius: 8px; background: none; color: var(--ink2); font: 500 14px/1 var(--sans); }
.job-view .art-chat-send:not(:disabled):hover { background: var(--well-on); }
.job-view .art-chat-receipt.sent::before { color: var(--ink); }

/* The artefact column, as cards: each piece of work led by its picture on a mat. */
:root[data-layout="front"] .rail-hide { display: none; }
:root[data-layout="front"] .rail-pane { display: block; overflow: visible; }
:root[data-layout="front"] .rail .brief { padding: 0; border: 0; }
:root[data-layout="front"] .rail .brief > section, :root[data-layout="front"] .rail .brief > section + section { margin: 0 0 30px; }
:root[data-layout="front"] .rail #done { display: none; }
:root[data-layout="front"] .rail .brief-top { margin: 0; padding: 6px 4px 10px; }
:root[data-layout="front"] .rail .brief-label { font: 400 13px/1.3 var(--sans); color: var(--mute); }
:root[data-layout="front"] .rail .brief-list .art-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
:root[data-layout="front"] .rail .art-grid > .art-card:first-child { grid-column: 1 / -1; }
:root[data-layout="front"] .rail .art-card, :root[data-layout="front"] .rail .brief-list li:not(.art-card) {
  padding: 0 0 13px; border-radius: 10px; background: var(--card); overflow: hidden; transition: background-color .2s ease;
}
:root[data-layout="front"] .rail .art-card:hover { background: var(--sheet); }
:root[data-layout="front"] .rail .art-pic { margin: 0 0 11px; padding: 8px 8px 0; border-radius: 0; background: var(--mat); }
:root[data-layout="front"] .rail .art-pic img { border-radius: 4px 4px 0 0; outline: 1px solid rgba(0, 0, 0, .1); outline-offset: -1px; }
:root[data-layout="front"] .rail .art-frame iframe { top: 8px; left: 8px; border-radius: 4px 4px 0 0; background: #fff; }
:root[data-layout="front"] .rail .art-card > :not(.art-pic) { margin-left: 12px; margin-right: 12px; }
:root[data-layout="front"] .rail .art-card .art-title { font: 500 14px/1.35 var(--sans); color: var(--ink); text-wrap: balance; }
:root[data-layout="front"] .rail .art-grid > .art-card:first-child .art-title { font-size: 15px; }
:root[data-layout="front"] .rail .art-plain { gap: 8px; margin-top: 8px; }
:root[data-layout="front"] .rail .art-grid + .art-plain { padding-top: 0; border-top: 0; }
:root[data-layout="front"] .rail .art-plain .art-card { padding: 13px 0; }
:root[data-layout="front"] .rail .brief-list li:not(.art-card) { padding: 13px 14px; }
:root[data-layout="front"] .rail .brief-line { font: 500 14px/1.4 var(--sans); color: var(--ink); }
:root[data-layout="front"] .rail .brief-meta, :root[data-layout="front"] .rail .art-meta { font: 400 12.5px/1.4 var(--sans); color: var(--mute); }
:root[data-layout="front"] .rail .brief-open { color: var(--ink2); }
/* The card itself opens the piece: no "open" under it, and no file name beside its age. */
:root[data-layout="front"] .rail .art-card .brief-open, :root[data-layout="front"] .rail .art-card .art-line:not(.down) { display: none; }
:root[data-layout="front"] .rail .art-card .art-line:not(.down) + .art-ago::before { content: none; }
:root[data-layout="front"] .rail .art-card .art-ago { font-variant-numeric: tabular-nums; }
:root[data-layout="front"] .rail .brief-more { margin: 4px 0 0; padding: 6px 4px; font: 400 13px/1.3 var(--sans); color: var(--mute); }
:root[data-layout="front"] .rail .brief-more:hover { color: var(--ink); }
/* News: each story a quiet card under the edition's line. */
:root[data-layout="front"] .rail .news .brief-outcome { margin: 0 4px 10px; font-size: 14px; color: var(--ink2); }
:root[data-layout="front"] .rail .news .card-stories { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
:root[data-layout="front"] .rail .news .card-stories > li { padding: 13px 14px 14px; border-radius: 10px; background: var(--card); }
:root[data-layout="front"] .rail .news .card-stories + .brief-top { margin-top: 22px; }
:root[data-layout="front"] .rail .card-story-head { color: var(--ink); font-weight: 500; text-decoration: none; }
:root[data-layout="front"] .rail .card-story-mark, :root[data-layout="front"] .rail .card-story-src { color: var(--mute); letter-spacing: 0; text-transform: none; }

/* Past conversations, under the jobs: a quiet list. */
.fhistory:has(> .history[hidden]) { display: none; }
.jobs .history { display: block; max-height: none; padding: 0; border: 0; overflow: visible; }
.jobs .history[hidden] { display: none; }
.jobs .history-top { display: none; }
.jobs .history-group summary { padding: 6px 4px; font: 400 14px/1.3 var(--sans); color: var(--ink2); }
.jobs .history-items { padding: 0 0 6px 4px; }
.jobs .history-item { padding: 6px 4px; font-size: 14px; color: var(--ink2); }
.jobs .history-item:hover { color: var(--ink); }
.jobs .history-item-age { font-size: 12.5px; }

/* The artefact view keeps the whole screen. */
:root[data-screen="show"] .rtabs, :root[data-screen="show"] .jobs,
:root[data-screen="show"] .stage-head, :root[data-screen="show"] .job-view { display: none !important; }

/* Narrower: the right column gives up some width. */
@media (max-width: 1100px) {
  :root[data-layout="front"] { --arts-w: 288px; }
}
/* A phone: one column. Jobs and artefacts are strips of cards above the conversation. */
@media (max-width: 760px) {
  :root[data-layout="front"] { --gut: 16px; --c-left: 0px; --c-right: 0px; --pad-x: var(--gut); }
  /* No tabs on a phone: jobs and artefacts both run as strips above the conversation. */
  :root[data-layout="front"] .rtabs { display: none; }
  :root[data-layout="front"][data-rtab] .jobs, :root[data-layout="front"][data-rtab] .rail:not([hidden]) { display: block !important; }
  :root[data-layout="front"] body { font-size: 18px; background: var(--paper); }
  :root[data-layout="front"] header { padding: 0 var(--gut); flex-wrap: nowrap; }
  :root[data-layout="front"] header .controls { flex: none; margin-left: auto; }
  :root[data-layout="front"] header .controls { gap: 0; }
  :root[data-layout="front"] .front-date { display: none; }
  :root[data-layout="front"] .jobs, :root[data-layout="front"] .rail { position: static; width: auto; overflow: visible; padding: 0; }
  :root[data-layout="front"] .rail { display: block; margin-bottom: 18px; }
  :root[data-layout="front"] .rail[hidden] { display: none; }
  /* The artefacts run as a strip of cards, like the jobs. */
  :root[data-layout="front"] .rail .brief-list .art-grid { display: flex; gap: 8px; margin: 0 calc(var(--gut) * -1); padding: 0 var(--gut); overflow-x: auto; scrollbar-width: none; scroll-snap-type: x mandatory; scroll-padding: 0 var(--gut); }
  :root[data-layout="front"] .rail .art-grid::-webkit-scrollbar { display: none; }
  :root[data-layout="front"] .rail .art-grid > .art-card { flex: 0 0 220px; width: 220px; scroll-snap-align: start; }
  .fgroup { margin: 0 0 18px; }
  .fstrip { display: flex; align-items: flex-start; gap: 8px; margin: 0 calc(var(--gut) * -1); padding: 0 var(--gut); overflow-x: auto; scrollbar-width: none; scroll-snap-type: x mandatory; scroll-padding: 0 var(--gut); }
  .jobs .history { max-height: 232px; overflow-y: auto; }
  .fstrip::-webkit-scrollbar { display: none; }
  .fstrip > * { flex: 0 0 248px; width: 248px; min-width: 0; margin: 0; scroll-snap-align: start; }
  .fhead, .fempty, .fmore { padding-left: 0; padding-right: 0; }
  .jobs, :root[data-layout="front"] .rail { padding: 0 var(--gut) !important; }
  :root[data-layout="front"] .stage-head { position: static; padding: 18px var(--gut) 0; margin: 4px 0 0; }
  .stage-head h1 { font-size: 22px; }
  :root[data-layout="front"] main { margin: 0 !important; padding: 8px var(--gut) calc(var(--composer-h, 130px) + 24px) !important; min-height: 60vh; }
  :root[data-layout="front"][data-job] .job-view { margin: 0; padding: 14px var(--gut) 40px; }
  :root[data-layout="front"] .composer { left: 0; right: 0; bottom: 0; padding: 10px var(--gut) calc(12px + env(safe-area-inset-bottom)); border-radius: 0; }
  :root[data-layout="front"] .jump { right: var(--gut); }
  .jv-work { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .jv-view { padding: 12px 14px; }
  .jv-vers { flex-direction: row; overflow-x: auto; gap: 6px; }
  .ver { grid-template-columns: 44px; width: auto; flex: none; padding: 6px; }
  .ver .i, .ver .n { display: none; }
  .jv-msg { grid-template-columns: minmax(0, 1fr); gap: 2px; }
}
`;

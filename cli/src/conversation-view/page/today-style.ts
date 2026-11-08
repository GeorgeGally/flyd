/**
 * Flyd today: the header's Today and News tabs, the Today feed of the day's
 * events as cards in two columns, the News page with its weather card, the job
 * cards (project and time along the top, the picture flush with the words, the
 * next step in real counts), and the Machines tab's models and usage.
 * Comes last in the page's style, so it wins over the older front rules it
 * reshapes; the few layout properties those set with stronger selectors are
 * marked !important here.
 */
export const TODAY_STYLE = `
:root[data-layout="front"] { --text: #33312c; --chip: var(--line); }
:root[data-layout="front"][data-theme="dark"] { --text: var(--ink2); }
@keyframes fpulse { 50% { opacity: .25 } }
.fdot.pulse { animation: fpulse 2.4s ease-in-out infinite; }

/* The top line: the day in ink, then Today and News. */
.centre-tabs, .today-feed, .news-page, .news-side, .news-side-phone { display: none; }
:root[data-layout="front"] .front-date { color: var(--ink); font-size: 15px; }
:root[data-layout="front"]:not([data-theme="dark"]) .front-date { color: #000; }
:root[data-layout="front"] .centre-tabs { display: flex; gap: 18px; margin-left: 12px; }
.ctab { padding: 0; border: 0; background: none; cursor: pointer; font: 400 15px/1 var(--sans); color: var(--mute); transition: color .2s ease; }
.ctab:hover, .ctab[aria-pressed="true"] { color: var(--ink); }
.ctab[aria-pressed="true"] { font-weight: 500; }
.ctab:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; border-radius: 2px; }
:root[data-layout="front"] .empty { display: none !important; }

/* At rest the middle is Today or News, not an empty conversation. */
:root[data-layout="front"][data-centre="today"]:not([data-job]) main,
:root[data-layout="front"][data-centre="news"]:not([data-job]) main,
:root[data-layout="front"][data-centre="today"]:not([data-job]) .stage-head,
:root[data-layout="front"][data-centre="news"]:not([data-job]) .stage-head,
:root[data-layout="front"][data-centre="today"]:not([data-job]) .jump,
:root[data-layout="front"][data-centre="news"]:not([data-job]) .jump { display: none !important; }
:root[data-layout="front"][data-centre="today"]:not([data-job]) .today-feed,
:root[data-layout="front"][data-centre="news"]:not([data-job]) .news-page {
  display: block; position: fixed; z-index: 2; top: calc(var(--top) + 16px); bottom: var(--composer-h, 130px); left: var(--c-left); right: var(--c-right);
  padding: 0 var(--pad-x) 28px; overflow-y: auto; scrollbar-width: none; animation: column-in .24s ease both;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
}
.today-feed::-webkit-scrollbar, .news-page::-webkit-scrollbar, .news-side::-webkit-scrollbar { display: none; }
:root[data-screen="show"] .today-feed, :root[data-screen="show"] .news-page, :root[data-screen="show"] .news-side { display: none !important; }

/* Today: the day's events as cards, two across. */
.feed { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ev { display: block; width: 100%; margin: 0; padding: 14px 18px 16px; border: 0; border-radius: 12px; background: var(--card); color: var(--ink); font: inherit; text-align: left; }
button.ev { cursor: pointer; transition: background-color .2s ease; }
button.ev:hover { background: var(--sheet); }
.ev:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.ev time { display: block; margin: 0 0 3px; font: 400 14px/1.4 var(--sans); color: var(--mute); font-variant-numeric: tabular-nums; }
.ev time .fdot { margin-left: 9px; vertical-align: 1px; }
.ev p { margin: 0; font: 400 18px/1.36 var(--sans); letter-spacing: -.008em; color: var(--ink); text-wrap: pretty; overflow-wrap: anywhere; }
.ev.pic { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); padding: 0; background: var(--sheet); overflow: hidden; }
.ev.pic img { display: block; width: 100%; height: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: left top; }
.ev.pic > div { padding: 32px; }
.ev.pic p { font-size: 20px; }
.feed-empty { grid-column: 1 / -1; margin: 0; font: 400 17px/1.42 var(--sans); color: var(--mute); }

/* News: the stories in two columns, the weather beside them. */
.news-when { margin: 0 0 12px; font: 400 14px/1.4 var(--sans); color: var(--mute); }
.news-when[hidden] { display: none; }
.news-cols { columns: 2; column-gap: 28px; }
.story { display: block; margin: 0 0 34px; break-inside: avoid; color: var(--ink); }
.story img { display: block; width: 100%; height: 236px; margin: 0 0 14px; object-fit: cover; object-position: left top; }
.story .src { display: block; margin: 0 0 4px; font: 500 13px/1.3 var(--sans); letter-spacing: .04em; text-transform: uppercase; color: var(--ink); }
:root:not([data-theme="dark"]) .story .src { color: #000; }
.story.pic .src { margin-top: 30px; }
.story h2 { margin: 0; font: 700 21px/1.26 var(--sans); letter-spacing: -.014em; text-wrap: pretty; }
.story h2 a { color: inherit; text-decoration: none; }
.story h2 a:hover { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.story.lead h2 { max-width: 324px; font-size: 26px; line-height: 1.18; letter-spacing: -.02em; }
.story > p { margin: 6px 0 0; font: 400 17px/1.42 var(--sans); color: var(--text); text-wrap: pretty; }
.story .talk { margin-top: 18px; }
.story .talk:empty { display: none; }
.story .talk .q { padding: 20px 0 4px; font: 700 17px/1.42 var(--sans); color: var(--ink); }
.story .talk .a { font: 400 17px/1.42 var(--sans); color: var(--text); }
.story .talk .q p, .story .talk .a p { margin: 0 0 .6em; }
.story .talk .q p:last-child, .story .talk .a p:last-child { margin-bottom: 0; }
.story .talk .a.pending { color: var(--mute); }

:root[data-layout="front"][data-centre="news"]:not([data-job]) .news-side {
  display: block; position: fixed; z-index: 3; top: calc(var(--top) + 16px); bottom: 0; right: var(--gut); width: var(--arts-w);
  padding: 0 0 40px; overflow-y: auto; scrollbar-width: none; animation: column-in .24s ease both;
}
@media (min-width: 761px) {
  :root[data-layout="front"][data-centre="news"]:not([data-job]) :is(.rtabs, .jobs, .rail, .machines, .todos, .threads) { display: none !important; }
}
.wxcard { margin: 0 0 16px; padding: 16px 22px 24px; border-radius: 12px; background: var(--card); color: var(--ink); }
.wxcard .wx-top { display: flex; justify-content: space-between; align-items: center; margin: 0 0 18px; }
.wxcard .wx-tag { font: 600 13px/1.3 var(--sans); letter-spacing: .04em; text-transform: uppercase; }
.wxcard .wx-top time { font: 400 14px/1.3 var(--sans); color: var(--mute); font-variant-numeric: tabular-nums; }
.wxcard .wx-now { display: flex; align-items: center; gap: 14px; margin: 0 0 22px; }
.wxcard .wx-deg { font: 500 96px/1 var(--sans); letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.wxcard .wx-ic { display: block; width: 30px; height: 30px; }
.wxcard .wx-ic.big { width: 84px; height: 84px; margin-left: -6px; }
.wxcard .wx-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; margin: 0 -6px 16px; font: 400 15px/1.2 var(--sans); font-variant-numeric: tabular-nums; }
.wxcard button { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; padding: 8px 0; border: 0; border-radius: 8px; background: none; color: var(--ink); font: inherit; cursor: pointer; transition: background-color .2s ease; }
.wxcard button:hover { background: color-mix(in srgb, var(--chip) 55%, transparent); }
.wxcard button.on { background: var(--chip); }
.wxcard button:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.wxcard .wx-days time { font-size: 13px; color: var(--mute); }
.wxcard .wx-days .on time { color: var(--ink); }
.wxcard .wx-days .wx-ic { width: 26px; height: 26px; }
.wxcard b { font-weight: 500; }
.wxcard .wx-days span { font-size: 14px; color: var(--mute); }
.wxcard .wx-hours { display: grid; gap: 2px; margin: 0 -6px; padding: 18px 0 0; border-top: 1px solid var(--chip); list-style: none; text-align: center; font: 400 15px/1.2 var(--sans); font-variant-numeric: tabular-nums; }
.wxcard .wx-hours li { display: flex; }
.wxcard .wx-hours button { flex: 1; gap: 5px; }
.wxcard .wx-hours time { font-size: 14px; color: var(--mute); }
.wxcard .wx-hours span { font-size: 14px; color: #3f7dbd; }

/* Job cards: the project and when along the top, the picture flush with the words, the next step last. */
:root[data-layout="front"] .job { padding: 0; border-radius: 12px; overflow: hidden; }
.fhead { padding: 0 22px 20px; font: 400 14px/1.3 var(--sans); }
.jtop { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 22px 14px; }
.jtag { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 13px/1.3 var(--sans); letter-spacing: .04em; text-transform: uppercase; color: var(--ink); }
.jtag .fdot { margin-left: 9px; vertical-align: 1px; }
.jtop .w { flex: none; font: 400 14px/1.3 var(--sans); color: var(--mute); font-variant-numeric: tabular-nums; }
:root[data-layout="front"] .job .frame { height: 258px; margin: 0 22px; padding: 0; border-radius: 0; background: none; aspect-ratio: auto; }
:root[data-layout="front"] .job .frame img { object-position: left top; border-radius: 0; }
:root[data-layout="front"] .job .next {
  margin: 0; padding: 20px 22px 22px; font: 400 17px/1.42 var(--sans); color: var(--text);
  white-space: normal; overflow: visible; display: block; -webkit-line-clamp: none; text-overflow: clip; text-wrap: pretty; overflow-wrap: anywhere;
}
:root[data-layout="front"] .job.text .next { padding-top: 0; }
:root[data-layout="front"] .job .next:has(+ .act) { padding-bottom: 0; }
.job .act { display: block; padding: 14px 22px 22px; font: 600 15px/1.35 var(--sans); color: var(--ink); }
.job .act .fdot { margin-right: 9px; vertical-align: 2px; }
.job.done .jtag { color: var(--ink2); }

/* Machines: under the machines, the models and how much use is left. */
.machine-setup { display: grid; gap: 8px; margin: 8px 0 0; }
.machine-setup section { padding: 20px 22px 22px; border-radius: 12px; background: var(--card); color: var(--ink); }
.machine-setup h2 { margin: 0 0 12px; font: 600 13px/1.3 var(--sans); letter-spacing: .04em; text-transform: uppercase; }
.setup-models { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 16px; margin: 0; font: 400 15px/1.4 var(--sans); }
.setup-models dt { color: var(--mute); }
.setup-models dd { margin: 0; overflow-wrap: anywhere; }
.setup-spend { margin: 14px 0 0; font: 400 15px/1.4 var(--sans); color: var(--text); font-variant-numeric: tabular-nums; }
.setup-usage { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 22px; margin: 0; padding: 0; list-style: none; }
.setup-usage li { min-width: 0; }
.setup-usage .u-top { display: flex; justify-content: space-between; gap: 8px; font: 500 15px/1.3 var(--sans); }
.setup-usage .u-top span { font-weight: 400; color: var(--mute); font-variant-numeric: tabular-nums; }
.setup-usage .u-bar { height: 6px; margin: 8px 0 6px; border-radius: 3px; background: #d9d6ce; overflow: hidden; }
:root[data-theme="dark"] .setup-usage .u-bar { background: var(--line); }
.setup-usage .u-bar i { display: block; height: 100%; border-radius: 3px; background: var(--ink); }
.setup-usage .u-when { font: 400 13px/1.35 var(--sans); color: var(--mute); }
.setup-usage .u-when.out, .setup-usage .u-top .out { color: var(--hot); }

@media (max-width: 1000px) {
  .feed { grid-template-columns: minmax(0, 1fr); }
  .ev.pic { grid-template-columns: minmax(0, 1fr); }
  .news-cols { columns: 1; }
  .wxcard .wx-deg { font-size: 80px; }
  .wxcard .wx-ic.big { width: 70px; height: 70px; }
}

/* A phone: the wordmark, Today and News, people and preferences. The column's tabs stay, one open at a time;
   Today's feed follows the jobs, and News puts the weather above the stories. */
@media (max-width: 760px) {
  :root[data-layout="front"] header { gap: 14px; }
  :root[data-layout="front"] .centre-tabs { margin-left: 0; }
  :root[data-layout="front"] #flip { display: none !important; }
  :root[data-layout="front"] .rtabs { display: flex !important; position: static; width: auto; height: 48px; padding: 0 var(--gut); background: none; }
  :root[data-layout="front"][data-rtab]:not([data-rtab="jobs"]) .jobs,
  :root[data-layout="front"][data-rtab]:not([data-rtab="arts"]) .rail:not([hidden]),
  :root[data-layout="front"][data-rtab]:not([data-rtab="arts"]) .rail,
  :root[data-layout="front"][data-rtab]:not([data-rtab="machines"]) .machines,
  :root[data-layout="front"][data-rtab]:not([data-rtab="todo"]) .todos,
  :root[data-layout="front"][data-rtab]:not([data-rtab="threads"]) .threads { display: none !important; }
  :root[data-layout="front"] .fstrip { display: block; margin: 0; padding: 0; overflow: visible; }
  :root[data-layout="front"] .fstrip > * { width: auto; margin: 0 0 16px; }
  :root[data-layout="front"] .fhead { padding: 0 6px 16px; }
  :root[data-layout="front"] .job .frame { height: 190px; }
  :root[data-layout="front"][data-centre="today"]:not([data-job]) .today-feed,
  :root[data-layout="front"][data-centre="news"]:not([data-job]) .news-page {
    position: static; padding: 4px var(--gut) calc(var(--composer-h, 130px) + 24px); overflow: visible; -webkit-mask-image: none; mask-image: none;
  }
  :root[data-layout="front"][data-centre="today"]:not([data-rtab="jobs"]) .today-feed { display: none !important; }
  :root[data-layout="front"][data-centre="today"] .jobs { padding-bottom: 8px !important; }
  :root[data-layout="front"][data-rtab][data-centre="news"]:not([data-job]) :is(.rtabs, .jobs, .rail, .rail:not([hidden]), .machines, .todos, .threads, .news-side) { display: none !important; }
  :root[data-layout="front"][data-centre="news"] .news-side-phone { display: block; margin: 0 0 36px; }
  .wxcard .wx-deg { font-size: 72px; }
  .wxcard .wx-ic.big { width: 62px; height: 62px; }
  .story img { height: 190px; }
  .story.lead img { height: 210px; }
  .setup-usage { grid-template-columns: minmax(0, 1fr); }
}
`;

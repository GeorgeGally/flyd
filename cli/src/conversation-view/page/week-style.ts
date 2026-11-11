/**
 * The Week tab: a plain pale page with room around every part. The heading and
 * the key on one line, the hours down the left, eight day strips, and the day
 * picked told underneath in four columns. On a desktop or tablet it takes the
 * whole width (the right column steps aside, as on News); on a phone the day
 * names go to two lines and the story stacks. Comes after Today's style.
 */
export const WEEK_STYLE = `
:root[data-layout="front"] { --wk-1: #e2572e; --wk-2: #3f6fe0; --wk-3: #15140f; --wk-0: #b9b5ab; --wk-side: max(var(--gut), 5vw); }
:root[data-layout="front"][data-theme="dark"] { --wk-1: #f26a3d; --wk-2: #5b8cff; --wk-3: #e8e3d6; --wk-0: #6f7887; }
.week-page { display: none; }
:root[data-layout="front"][data-centre="week"]:not([data-job]) main,
:root[data-layout="front"][data-centre="week"]:not([data-job]) .stage-head,
:root[data-layout="front"][data-centre="week"]:not([data-job]) .jump { display: none !important; }
:root[data-layout="front"][data-centre="week"]:not([data-job]) .week-page {
  display: block; position: fixed; z-index: 2; top: var(--top); bottom: var(--composer-h, 130px); left: 0; right: 0;
  padding: 40px var(--wk-side) 48px; overflow-y: auto; scrollbar-width: none; background: var(--paper); animation: column-in .24s ease both;
}
.week-page::-webkit-scrollbar { display: none; }
:root[data-screen="show"] .week-page { display: none !important; }
@media (min-width: 761px) {
  :root[data-layout="front"][data-centre="week"]:not([data-job]) :is(.rtabs, .jobs, .rail, .machines, .todos, .threads) { display: none !important; }
}

.wk-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px 40px; flex-wrap: wrap; }
.wk-head { margin: 0; font: 800 56px/1 var(--sans); letter-spacing: -.03em; color: var(--ink); }
.wk-key { display: flex; flex-wrap: wrap; gap: 8px 26px; margin: 0 0 6px; font: 400 15px/1.3 var(--sans); color: var(--ink2); }
.wk-key i { display: inline-block; width: 10px; height: 10px; margin-right: 8px; border-radius: 2px; }
.k0 { background: var(--wk-0); } .k1 { background: var(--wk-1); } .k2 { background: var(--wk-2); } .k3 { background: var(--wk-3); }

.wk-chart { position: relative; display: flex; gap: 16px; margin-top: 52px; }
.wk-axis { position: relative; flex: none; width: 56px; margin-top: 44px; height: var(--wk-lane, 300px); font: 400 13px/1 var(--sans); color: var(--mute); font-variant-numeric: tabular-nums; }
.wk-axis span { position: absolute; left: 0; transform: translateY(-50%); }
.wk-days { flex: 1; min-width: 0; display: flex; gap: 22px; }
.wk-day { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.wk-day u { display: block; height: 44px; text-decoration: none; font: 400 15px/1.3 var(--sans); color: var(--mute); white-space: nowrap; transition: color .2s ease; }
.wk-day u b { font-weight: inherit; }
.wk-day.on u { color: var(--ink); font-weight: 700; }
.wk-lane { position: relative; display: block; height: var(--wk-lane, 300px); border-radius: 4px; background: color-mix(in srgb, var(--ink) 6%, transparent); outline: 1px solid transparent; outline-offset: 6px; transition: outline-color .2s ease; }
.wk-day.on .wk-lane { outline-color: var(--ink); }
.wk-day:focus-visible { outline: none; }
.wk-day:focus-visible .wk-lane { outline: 2px solid var(--ink); }
.wk-lane i { position: absolute; left: 0; right: 0; transform-origin: top; animation: wk-fall .9s cubic-bezier(.2,.7,.2,1) both; }
.wk-lane em { position: absolute; left: -3px; right: -3px; height: 2px; background: var(--ink); z-index: 2; }
@keyframes wk-fall { from { transform: scaleY(0); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .wk-lane i { animation: none; } }

.wk-tell { display: grid; grid-template-columns: 1.25fr 1fr 1fr 1fr; gap: 44px; align-items: start; margin: 48px 0 0 72px; }
.wk-tell h3 { margin: 0; font: 700 30px/1.1 var(--sans); letter-spacing: -.02em; color: var(--ink); text-wrap: balance; overflow-wrap: anywhere; }
.wk-tell time { display: block; margin-top: 10px; font: 400 15px/1.4 var(--sans); color: var(--mute); }
.wk-tell p { margin: 0; padding-top: 4px; font: 400 17px/1.45 var(--sans); color: var(--ink2); text-wrap: pretty; overflow-wrap: anywhere; }
.wk-tell .wk-none { grid-column: 1 / -1; color: var(--mute); }

@media (max-width: 1100px) {
  .wk-head { font-size: 44px; }
  .wk-days { gap: 12px; }
  .wk-tell { grid-template-columns: 1fr 1fr; gap: 28px 36px; }
  .wk-tell > div { grid-column: 1 / -1; }
}

/* A phone: the week under the header, the day names on two lines, the story stacked. */
@media (max-width: 760px) {
  :root[data-layout="front"][data-centre="week"]:not([data-job]) .week-page {
    position: static; padding: 20px 20px calc(var(--composer-h, 130px) + 32px); overflow: visible; background: none;
  }
  :root[data-layout="front"][data-rtab][data-centre="week"]:not([data-job]) :is(.rtabs, .jobs, .rail, .rail:not([hidden]), .machines, .todos, .threads) { display: none !important; }
  .wk-head { font-size: 30px; white-space: nowrap; }
  .wk-top { gap: 16px; }
  .wk-key { gap: 6px 14px; font-size: 13px; }
  .wk-key i { margin-right: 6px; }
  .wk-chart { gap: 6px; margin-top: 32px; margin-left: -6px; }
  .wk-axis { width: 36px; margin-top: 38px; font-size: 11px; --wk-lane: 290px; }
  .wk-days { gap: 5px; }
  .wk-day u { height: 38px; font-size: 11px; line-height: 1.25; }
  .wk-day u b { display: block; font-size: 14px; }
  .wk-lane { --wk-lane: 290px; outline-offset: 3px; }
  .wk-tell { display: block; margin: 40px 0 0; }
  .wk-tell h3 { font-size: 23px; }
  .wk-tell time { font-size: 13px; margin-top: 6px; }
  .wk-tell p { padding-top: 12px; font-size: 15px; }
}
`;

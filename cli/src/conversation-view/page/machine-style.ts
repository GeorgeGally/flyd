/**
 * The Machines screen, after the Triptych board's final Machines frame: rows of
 * machines down the middle, each a light name beside one sentence and an orange
 * button with room above it, so more servers only add rows; the models, spend
 * and usage under them; and the tool versions on a black panel where the right
 * column sits. On a phone everything stacks, the black panel after the machines.
 */
export const MACHINE_STYLE = `
.machines { display: none; }
:root[data-layout="front"][data-centre="machines"]:not([data-job]) main,
:root[data-layout="front"][data-centre="machines"]:not([data-job]) .stage-head,
:root[data-layout="front"][data-centre="machines"]:not([data-job]) .jump { display: none !important; }
:root[data-layout="front"][data-centre="machines"]:not([data-job]) .machines { display: block; }
:root[data-screen="show"] .machines { display: none !important; }
.mach-fleet {
  position: fixed; z-index: 2; top: calc(var(--top) + 16px); bottom: var(--composer-h, 130px); left: var(--c-left); right: var(--c-right);
  padding: 0 var(--pad-x) 28px; overflow-y: auto; scrollbar-width: none; animation: column-in .24s ease both;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
}
.mach-fleet::-webkit-scrollbar, .mach-tools::-webkit-scrollbar { display: none; }
.mach-tools {
  position: fixed; z-index: 3; top: var(--top); bottom: 0; right: 0; width: calc(var(--arts-w) + var(--gut));
  padding: 40px var(--gut) 48px 40px; overflow-y: auto; scrollbar-width: none; background: #000; color: #fff; animation: column-in .24s ease both;
}
.mach-tools[hidden] { display: none; }
@media (min-width: 761px) {
  :root[data-layout="front"][data-centre="machines"]:not([data-job]) :is(.rtabs, .jobs, .rail, .todos, .threads) { display: none !important; }
}

.machine-list { display: grid; }
.machine { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 36px; align-items: start; padding: 32px 0; border-bottom: 1px solid var(--line); color: var(--ink); }
.machine:first-child { padding-top: 8px; }
.machine-name { margin: 0; font: 300 32px/1.1 var(--sans); letter-spacing: -.016em; overflow-wrap: anywhere; }
.machine-say { margin: 0; max-width: 560px; font: 400 18px/1.4 var(--sans); text-wrap: pretty; overflow-wrap: anywhere; }
.machine.checking .machine-say { color: var(--mute); }
.machine-seen { margin: 6px 0 0; font: 400 15px/1.4 var(--sans); color: var(--mute); }
.mach-btn {
  display: inline-block; margin: 28px 0 0; padding: 11px 19px; border: 0; border-radius: 4px; background: var(--hot); color: #fff;
  font: 600 16px/1.3 var(--sans); cursor: pointer; white-space: nowrap; transition: filter .2s ease;
}
.mach-btn:hover { filter: brightness(1.08); }
.mach-btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.mach-btn.quiet { background: none; color: inherit; box-shadow: inset 0 0 0 1px currentColor; }
.mach-confirm { margin: 28px 0 0; }
.mach-confirm p { margin: 0; max-width: 520px; font: 500 16px/1.42 var(--sans); }
.mach-acts { display: flex; flex-wrap: wrap; gap: 10px; }
.machines .mach-acts .mach-btn { margin-top: 16px; }

.machine-open { display: flex; width: max-content; margin: 28px 0 0 156px; }
.machine-open[hidden], .machine-form[hidden] { display: none; }
.machine-form { margin: 16px 0 0; padding: 22px var(--card-pad) 24px; border-radius: var(--card-radius); background: var(--card); }
.machine-form label { display: block; margin: 0 0 16px; font: 400 13.5px/1.4 var(--sans); color: var(--ink2); }
.machine-form input { display: block; box-sizing: border-box; width: 100%; height: 40px; margin: 6px 0 0; padding: 0 12px; border: 0; border-radius: 6px; background: var(--sheet); color: var(--ink); font: 400 15px/1.3 var(--sans); }
.machine-form input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.machine-hint { margin: 0; font: 400 13px/1.45 var(--sans); color: var(--mute); text-wrap: pretty; }
.machine-error { margin: 12px 0 0; font: 400 14px/1.45 var(--sans); color: var(--ink); }
.machine-error:empty { display: none; }
.machine-acts { display: flex; gap: 10px; margin: 28px 0 0; }

.machine-setup { margin: 40px 0 0; color: var(--ink); }
.mach-routes { margin: 0 0 28px; border-bottom: 1px solid var(--line); }
.mach-route { display: grid; grid-template-columns: 156px minmax(0, 1fr); align-items: baseline; padding: 20px 0; border-top: 1px solid var(--line); }
.mach-job { font: 400 20px/1.3 var(--sans); letter-spacing: -.012em; }
.mach-model { font: 300 20px/1.3 var(--sans); letter-spacing: -.012em; overflow-wrap: anywhere; }
.setup-spend { margin: 0; max-width: 560px; font: 400 18px/1.45 var(--sans); font-variant-numeric: tabular-nums; text-wrap: pretty; }
.setup-usage { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 32px; margin: 24px 0 0; padding: 0; list-style: none; }
.setup-usage li { min-width: 0; }
.setup-usage .u-top { display: flex; justify-content: space-between; gap: 8px; font: 600 16px/1.3 var(--sans); }
.setup-usage .u-top span { font-weight: 400; color: var(--mute); font-variant-numeric: tabular-nums; }
.setup-usage .u-bar { height: 6px; margin: 7px 0 6px; border-radius: 3px; background: #d9d6ce; overflow: hidden; }
:root[data-theme="dark"] .setup-usage .u-bar { background: var(--line); }
.setup-usage .u-bar i { display: block; height: 100%; border-radius: 3px; background: var(--ink); }
.setup-usage .u-when { font: 400 14px/1.35 var(--sans); color: var(--mute); }
.setup-usage .u-when.out, .setup-usage .u-top .out { color: var(--hot); }
.setup-usage-read { margin: 18px 0 0; font: 400 14px/1.35 var(--sans); color: var(--mute); }

.mach-tools-say { margin: 0; font: 400 25px/1.18 var(--sans); letter-spacing: -.016em; text-wrap: pretty; }
.mach-tools .mach-btn { margin-top: 36px; }
.mach-tools .mach-btn:focus-visible { outline-color: #fff; }
.mach-tools .mach-confirm { margin-top: 36px; }

@media (max-width: 760px) {
  :root[data-layout="front"][data-centre="machines"]:not([data-job]) :is(.rtabs, .jobs, .rail, .rail:not([hidden]), .todos, .threads, .today-feed) { display: none !important; }
  .mach-fleet, .mach-tools { position: static; overflow: visible; -webkit-mask-image: none; mask-image: none; }
  .mach-fleet { padding: 4px var(--gut) 8px; }
  .mach-tools { width: auto; margin: 24px 0 0; padding: 30px var(--gut) calc(var(--composer-h, 130px) + 36px); }
  .machines:not(:has(.mach-tools:not([hidden]))) .mach-fleet { padding-bottom: calc(var(--composer-h, 130px) + 24px); }
  .machine { grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 26px 0; }
  .mach-btn { margin-top: 24px; white-space: normal; }
  .machine-open { margin-left: 0; }
  .mach-route { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .setup-usage { grid-template-columns: minmax(0, 1fr); }
  .mach-tools-say { font-size: 23px; }
}
`;

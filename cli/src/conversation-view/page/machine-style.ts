/**
 * The Machines screen, after the Triptych board's final Machines frame: down the
 * middle, each machine's name as a heavy headline over its one sentence in large
 * type and one dark button with room above it, so more machines only add rows;
 * in the right column, on the same paper, the tool versions in one sentence and
 * their button, the models in one sentence, the spend and the usage bars. On a
 * phone everything stacks in one column, the right column after the machines.
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
  position: fixed; z-index: 3; top: calc(var(--top) + 16px); bottom: 0; right: var(--gut); width: var(--arts-w);
  padding: 0 0 48px; overflow-y: auto; scrollbar-width: none; color: var(--ink); animation: column-in .24s ease both;
}
.mach-tools[hidden] { display: none; }
@media (min-width: 761px) {
  :root[data-layout="front"][data-centre="machines"]:not([data-job]) :is(.rtabs, .jobs, .rail, .todos, .threads) { display: none !important; }
}

.machine-list { display: grid; }
.machine { padding: 0 0 56px; color: var(--ink); }
.machine-name { margin: 0; font: 800 clamp(56px, 6.3vw, 90px)/1 var(--sans); letter-spacing: -.04em; overflow-wrap: anywhere; }
.machine-body { display: flex; flex-direction: column; align-items: flex-start; }
.machine-say { margin: 14px 0 0; font: 400 clamp(26px, 2.4vw, 34px)/1.2 var(--sans); letter-spacing: -.02em; text-wrap: pretty; overflow-wrap: anywhere; }
.machine.checking .machine-say { color: var(--mute); }
.machine-seen { margin: 10px 0 0; font: 400 16px/1.4 var(--sans); color: var(--mute); }
.machine .mach-btn, .machine .mach-confirm { align-self: flex-end; }
.mach-btn {
  display: inline-block; margin: 32px 0 0; padding: 12px 19px; border: 0; border-radius: 4px; background: #1a1814; color: #fff;
  font: 500 16px/1.3 var(--sans); cursor: pointer; white-space: nowrap; transition: opacity .2s ease;
}
:root[data-theme="dark"] .mach-btn { background: var(--ink); color: var(--paper); }
.mach-btn:hover { opacity: .86; }
.mach-btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.mach-btn.quiet, :root[data-theme="dark"] .mach-btn.quiet { background: none; color: var(--ink); box-shadow: inset 0 0 0 1px currentColor; }
.mach-confirm { margin: 32px 0 0; }
.mach-confirm p { margin: 0; max-width: 520px; font: 500 16px/1.42 var(--sans); }
.mach-acts { display: flex; flex-wrap: wrap; gap: 10px; }
.machines .mach-acts .mach-btn { margin-top: 16px; }

.machine-open { display: inline; margin: 0; padding: 0; border: 0; background: none; color: var(--mute); font: 400 15px/1.4 var(--sans); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.machine-open:hover { color: var(--ink); }
.machine-open[hidden], .machine-form[hidden] { display: none; }
.machine-form { margin: 16px 0 0; padding: 22px var(--card-pad) 24px; border-radius: var(--card-radius); background: var(--card); }
.machine-form label { display: block; margin: 0 0 16px; font: 400 13.5px/1.4 var(--sans); color: var(--ink2); }
.machine-form input { display: block; box-sizing: border-box; width: 100%; height: 40px; margin: 6px 0 0; padding: 0 12px; border: 0; border-radius: 6px; background: var(--sheet); color: var(--ink); font: 400 15px/1.3 var(--sans); }
.machine-form input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.machine-hint { margin: 0; font: 400 13px/1.45 var(--sans); color: var(--mute); text-wrap: pretty; }
.machine-error { margin: 12px 0 0; font: 400 14px/1.45 var(--sans); color: var(--ink); }
.machine-error:empty { display: none; }
.machine-acts { display: flex; gap: 10px; margin: 28px 0 0; }

.mach-tools-say, .mach-models { margin: 0; font: 400 clamp(24px, 2.4vw, 34px)/1.2 var(--sans); letter-spacing: -.02em; text-wrap: pretty; overflow-wrap: anywhere; }
#machines-tools:not(:empty) { margin: 0 0 56px; }
.machine-setup { color: var(--ink); }
.mach-models { margin: 0 0 48px; }
.setup-spend { margin: 0; font: 400 18px/1.5 var(--sans); font-variant-numeric: tabular-nums; text-wrap: pretty; }
.setup-usage { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; margin: 48px 0 0; padding: 0; list-style: none; }
.setup-usage li { min-width: 0; }
.setup-usage .u-top { display: flex; justify-content: space-between; gap: 8px; font: 600 16px/1.3 var(--sans); }
.setup-usage .u-top span { font-weight: 400; color: var(--mute); font-variant-numeric: tabular-nums; }
.setup-usage .u-bar { height: 6px; margin: 9px 0 8px; border-radius: 3px; background: #d9d6ce; overflow: hidden; }
:root[data-theme="dark"] .setup-usage .u-bar { background: var(--line); }
.setup-usage .u-bar i { display: block; height: 100%; border-radius: 3px; background: var(--ink); }
.setup-usage .u-when { font: 400 14px/1.35 var(--sans); color: var(--mute); }
.setup-usage .u-when.out, .setup-usage .u-top .out { color: var(--hot); }
.setup-usage-read { margin: 18px 0 0; font: 400 14px/1.35 var(--sans); color: var(--mute); }

@media (max-width: 760px) {
  :root[data-layout="front"][data-centre="machines"]:not([data-job]) :is(.rtabs, .jobs, .rail, .rail:not([hidden]), .todos, .threads, .today-feed) { display: none !important; }
  .mach-fleet, .mach-tools { position: static; overflow: visible; -webkit-mask-image: none; mask-image: none; }
  .mach-fleet { padding: 4px var(--gut) 8px; }
  .mach-tools { width: auto; margin: 40px 0 0; padding: 0 var(--gut) calc(var(--composer-h, 130px) + 36px); }
  .machines:not(:has(.mach-tools:not([hidden]))) .mach-fleet { padding-bottom: calc(var(--composer-h, 130px) + 24px); }
  .machine { padding-bottom: 44px; }
  .machine-name { font-size: 56px; }
  .machine-say, .mach-tools-say, .mach-models { font-size: 26px; }
  .machine .mach-btn, .machine .mach-confirm { align-self: flex-start; }
  .mach-btn { margin-top: 28px; white-space: normal; }
}
`;

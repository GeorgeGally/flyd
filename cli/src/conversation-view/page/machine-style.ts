/** The Machines tab: plain rows in the job cards' paper and type, so more servers only add rows. An offline machine is an outline; no colour says anything here. */
export const MACHINE_STYLE = `
.machines { display: none; }
:root[data-layout="front"] .machines {
  display: block; position: fixed; top: calc(var(--top) + var(--tabs-h)); bottom: 0; right: var(--gut); width: var(--arts-w); z-index: 3;
  overflow-y: auto; scrollbar-width: none; padding: 0 0 28px; animation: column-in .24s ease both;
}
.machines::-webkit-scrollbar { display: none; }
:root[data-layout="front"]:not([data-rtab="machines"]) .machines { display: none; }
@media (min-width: 761px) {
  :root[data-layout="front"][data-rtab="machines"] .jobs,
  :root[data-layout="front"][data-rtab="machines"] .rail { display: none !important; }
}
.machine-list { display: grid; gap: 8px; }
.machine { padding: 20px var(--card-pad) 22px; border-radius: var(--card-radius); background: var(--card); color: var(--ink); }
.machine.offline { background: none; box-shadow: inset 0 0 0 1px var(--line); }
.machine-top { display: flex; align-items: baseline; gap: 12px; }
.machine-name { margin: 0; font: 600 18px/1.3 var(--sans); letter-spacing: -0.012em; overflow-wrap: anywhere; }
.machine-state { margin-left: auto; font: 400 13px/1.4 var(--sans); color: var(--mute); white-space: nowrap; }
.machine.offline .machine-state { font-weight: 500; color: var(--ink); }
.machine-why { margin: 10px 0 0; font: 400 14.5px/1.45 var(--sans); color: var(--ink2); text-wrap: pretty; }
.machine-seen { margin: 4px 0 0; font: 400 13px/1.4 var(--sans); color: var(--mute); }
.machine-stats { display: grid; grid-template-columns: auto minmax(24px, 1fr) auto; gap: 8px 12px; align-items: center; margin: 14px 0 0; }
.machine-stats dt { font: 400 13.5px/1.4 var(--sans); color: var(--mute); }
.machine-stats dd { margin: 0; }
.machine-bar { height: 4px; border-radius: 2px; background: var(--mat); overflow: hidden; }
.machine-bar i { display: block; height: 100%; border-radius: 2px; background: var(--ink2); transition: width .4s ease; }
.machine-value { font: 400 13.5px/1.4 var(--sans); color: var(--ink); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.machine-stats .machine-running { grid-column: 2 / -1; font: 400 13.5px/1.45 var(--sans); color: var(--ink2); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.machine-remove { display: block; margin: 20px 0 0; padding: 0; border: 0; background: none; font: 400 13px/1.3 var(--sans); color: var(--mute); cursor: pointer; transition: color .2s; }
.machine-remove:hover { color: var(--ink); }
.machine-remove:focus-visible, .machine-form input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.machine-open { display: flex; width: max-content; margin: 32px 0 0 var(--card-pad); }
.machine-open[hidden], .machine-form[hidden] { display: none; }
.machine-form { margin: 8px 0 0; padding: 22px var(--card-pad) 24px; border-radius: var(--card-radius); background: var(--card); }
.machine-form label { display: block; margin: 0 0 16px; font: 400 13.5px/1.4 var(--sans); color: var(--ink2); }
.machine-form input { display: block; box-sizing: border-box; width: 100%; height: 40px; margin: 6px 0 0; padding: 0 12px; border: 0; border-radius: 6px; background: var(--sheet); color: var(--ink); font: 400 15px/1.3 var(--sans); }
.machine-hint { margin: 0; font: 400 13px/1.45 var(--sans); color: var(--mute); text-wrap: pretty; }
.machine-error { margin: 12px 0 0; font: 400 14px/1.45 var(--sans); color: var(--ink); }
.machine-error:empty { display: none; }
.machine-acts { display: flex; gap: 10px; margin: 28px 0 0; }

@media (max-width: 760px) {
  :root[data-layout="front"] .machines, :root[data-layout="front"]:not([data-rtab="machines"]) .machines { display: block !important; position: static; width: auto; overflow: visible; padding: 0 var(--gut) !important; margin-bottom: 26px; }
  .machine-list { display: flex; gap: 10px; }
  .machine { padding: 16px var(--card-pad) 18px; }
  .machine-open { margin-left: 0; }
}
:root[data-layout="front"][data-screen="show"] .machines, :root[data-layout="front"][data-screen="show"]:not([data-rtab="machines"]) .machines { display: none !important; }
`;

/**
 * The notch. One black sheet whichever theme the page is in: it hangs from the
 * top edge as if the island had opened, over a dimmed page. No labels over
 * things, one state colour for what needs him, a fade when a step changes.
 */
export const LIVE_STYLE = `
.island, .notch {
  --n-sheet: #0B0B0C; --n-key: #26262A; --n-line: #212124; --n-fg: #D8D6D1; --n-strong: #FAF8F4; --n-muted: #8F8D88;
  --n-live: #ECE9E3; --n-ask: hsl(40 92% 62%); --n-frame: #1A1A1D;
}
.island[hidden] { display: none; }
.island {
  position: fixed; z-index: 6; top: 0; left: 50%; transform: translateX(-50%); display: grid; grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1fr); align-items: center; min-width: 340px; height: 38px; padding: 0 24px;
  border: 0; border-radius: 0 0 18px 18px; background: var(--n-sheet); color: var(--n-live); font: 600 15px/1 var(--sans); white-space: nowrap; cursor: pointer; transition: min-width .18s ease;
}
.island:hover { min-width: 356px; }
.island:focus-visible, .notch :focus-visible { outline: 2px solid var(--n-ask); outline-offset: 2px; }
.island .l, .sheet-island .l { justify-self: end; display: flex; align-items: center; gap: 8px; }
.island .r, .sheet-island .r { justify-self: start; color: var(--n-muted); }
.island .r.on, .sheet-island .r.on { color: var(--n-ask); }
.island .l:only-child, .sheet-island .l:only-child { grid-column: 1 / -1; justify-self: center; }
.idot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--n-live); animation: notch-breathe 2.4s ease-in-out infinite; }
@keyframes notch-breathe { 50% { opacity: .2; } }

.notch { position: fixed; inset: 0; width: 100vw; max-width: none; height: 100dvh; max-height: none; margin: 0; padding: 0 0 32px; border: 0; background: rgba(16, 16, 18, .78); color: var(--n-fg); overflow-y: auto; font: 400 17px/1.45 var(--sans); -webkit-font-smoothing: antialiased; font-feature-settings: "tnum", "kern"; scrollbar-width: none; }
.notch::backdrop { background: transparent; }
.notch:not([open]) { display: none; }
.notch[open] { animation: notch-dim .18s ease both; }
.notch[open] .notch-sheet { animation: notch-drop .24s cubic-bezier(.2, .8, .2, 1) both; transform-origin: top center; }
@keyframes notch-dim { from { background: rgba(16, 16, 18, 0); } }
@keyframes notch-drop { from { opacity: 0; transform: translateY(-14px) scaleY(.97); } }
.notch-sheet:focus { outline: 0; }
.notch-sheet { position: relative; width: min(1120px, calc(100vw - 48px)); margin: 0 auto; padding: 0 36px 36px; border-radius: 0 0 36px 36px; background: var(--n-sheet); box-shadow: 0 30px 80px rgba(0, 0, 0, .45); }
.sheet-island { display: grid; grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1fr); align-items: center; width: 100%; height: 38px; padding: 0; border: 0; background: none; color: var(--n-live); font: 600 15px/1 var(--sans); cursor: pointer; }
.sheet-x { position: absolute; top: 4px; right: 20px; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; background: none; color: var(--n-muted); font: 400 15px/1 var(--sans); cursor: pointer; }
.sheet-x:hover { color: var(--n-strong); }
.notch .cols { display: grid; grid-template-columns: minmax(0, 1fr) 500px; gap: 44px; padding-top: 18px; }
.notch .pic { display: block; padding: 7px; border-radius: 12px; background: var(--n-frame); }
.notch .pic img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; border-radius: 5px; }
.notch .callblock .pic img { aspect-ratio: 16 / 8; }
.notch .q { margin: 20px 0 0; font: 600 32px/1.14 var(--sans); color: var(--n-strong); letter-spacing: -.01em; text-wrap: balance; }
.notch .callblock.quiet .q { margin-top: 12px; color: var(--n-muted); }
.notch .callblock > .q:first-child { margin-top: 6px; }
.notch .qm { margin: 12px 0 0; color: var(--n-fg); }
.notch .keys { margin-top: 32px; }
.notch .acts { display: flex; flex-wrap: wrap; gap: 10px; }
.notch .k { display: inline-block; padding: 14px 18px; border: 0; border-radius: 9px; background: var(--n-key); color: var(--n-strong); font: 600 15px/1 var(--sans); text-decoration: none; cursor: pointer; transition: background .12s ease; }
.notch .k:hover { background: #33333A; }
.notch .scene-ask { margin: 0 0 16px; }
.notch .choices { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 16px; }
.notch .choice-pick { display: inline-flex; align-items: baseline; gap: 8px; padding: 14px 18px; border: 0; border-radius: 9px; background: var(--n-key); color: var(--n-strong); font: 600 15px/1.2 var(--sans); cursor: pointer; }
.notch .choice-pick:has(small), .notch .choice-pick[aria-pressed="true"] { background: var(--n-ask); color: #17120A; }
.notch .choice-pick small { font: 500 13px/1 var(--sans); opacity: .7; }
.notch .art-decisions { margin: 0 0 16px; padding: 0 0 0 20px; }
.notch .art-chat-field { padding: 8px 8px 8px 18px; border: 0; border-radius: 12px; background: var(--n-key); }
.notch .art-chat-field:focus-within { background: #2E2E33; }
.notch .art-chat-input { background: none; color: var(--n-strong); font-size: 17px; }
.notch .art-chat-input::placeholder { color: var(--n-muted); }
.notch .art-chat-send { height: 38px; padding: 0 16px; border-radius: 8px; background: var(--n-strong); color: #0B0B0C; font: 600 15px/1 var(--sans); }
.notch .art-chat-receipt { color: var(--n-fg); }
.notch .queue { margin: 32px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--n-line); }
.notch .q-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: baseline; width: 100%; padding: 11px 0; border: 0; border-bottom: 1px solid var(--n-line); background: none; color: var(--n-fg); font: inherit; text-align: left; cursor: pointer; }
.notch .q-row b { color: var(--n-strong); font-weight: 500; transition: opacity .12s ease; }
.notch .q-row:hover b { opacity: .72; }
.notch .q-row b span { color: var(--n-muted); font-weight: 400; }
.notch .q-row i { color: var(--n-muted); font-size: 15px; font-style: normal; white-space: nowrap; }
.notch .q-row em { color: var(--n-ask); font-style: normal; }
.notch .older { display: inline-block; margin-top: 14px; padding: 0; border: 0; background: none; color: var(--n-muted); font: 400 15px/1.4 var(--sans); cursor: pointer; }
.notch .older:hover { color: var(--n-fg); }
.notch .older + .queue { margin-top: 12px; }
.notch h3 { margin: 0 0 14px; padding-top: 16px; border-top: 1px solid var(--n-line); color: var(--n-strong); font: 600 17px/1.2 var(--sans); }
.notch h3.ph { display: none; }
.notch .run { margin: 0; padding: 0; list-style: none; }
.notch .run li { padding: 0 0 14px; }
.notch .run-row { display: grid; grid-template-columns: 176px minmax(0, 1fr); gap: 18px; align-items: center; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.notch .run-row.bare { grid-template-columns: minmax(0, 1fr); padding: 2px 0; }
.notch .run-row .pic { padding: 5px; border-radius: 9px; }
.notch .run-row .pic img { border-radius: 4px; }
.notch .words { display: block; min-width: 0; }
.notch .n { display: flex; justify-content: space-between; gap: 12px; font: 600 16px/1.25 var(--sans); color: var(--n-strong); }
.notch .n b { font-weight: 600; }
.notch .n span { flex: none; color: var(--n-muted); font-weight: 500; white-space: nowrap; }
.notch .s { display: block; margin-top: 5px; color: var(--n-fg); font-size: 15px; line-height: 1.35; }
.notch .s.fresh { animation: notch-fresh .5s ease both; }
@keyframes notch-fresh { from { opacity: 0; } }
.notch .none { margin: 0 0 16px; color: var(--n-muted); }
.notch .done { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.notch .tile { display: flex; flex-direction: column; justify-content: flex-start; min-width: 0; padding: 0; border: 0; background: none; color: var(--n-fg); font: inherit; text-align: left; cursor: pointer; }
.notch .tile .pic { padding: 3px; border-radius: 7px; }
.notch .tile .pic img { border-radius: 4px; }
.notch .tile .t { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; margin-top: 6px; font-size: 13px; line-height: 1.3; }
.notch .tile .w { display: block; color: var(--n-muted); font-size: 13px; line-height: 1.3; }
@media (max-width: 760px) {
  .island { left: 0; right: 0; transform: none; min-width: 0; width: 100%; height: 40px; border-radius: 0; }
  .island:hover { min-width: 0; }
  :root[data-layout="front"] body { padding-top: 40px; }
  :root[data-layout="front"] header { top: 40px; }
  .notch { padding: 0; background: var(--n-sheet); }
  .notch-sheet { width: auto; min-height: 100%; padding: 0 16px 40px; border-radius: 0; box-shadow: none; }
  .sheet-island { height: 40px; }
  .sheet-x { right: 4px; top: 5px; }
  .notch .cols { display: flex; flex-direction: column; gap: 36px; padding-top: 8px; }
  .notch .cols > div { display: contents; }
  .notch .callblock { order: 1; }
  .notch .runblock { order: 2; }
  .notch .qblock { order: 3; }
  .notch .landblock { order: 4; }
  .notch .q { font-size: 28px; }
  .notch .queue { margin-top: 0; }
  .notch h3.ph { display: block; }
  .notch .run-row { grid-template-columns: 128px minmax(0, 1fr); align-items: start; }
  .notch .done { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .idot, .notch[open], .notch[open] .notch-sheet, .notch .s.fresh { animation: none; }
}
`;

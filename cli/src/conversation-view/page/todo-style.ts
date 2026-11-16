/** His own to-dos, inside Needs you under the calls: each item a card with its tick. */
export const TODO_STYLE = `
.todos { display: none; }
:root[data-layout="front"] .jobs .todos { display: block; margin-top: 8px; }
:root[data-layout="front"] .jobs .todos:has(#todo-lists:empty):has(.todo-said[hidden]) { display: none; }
/* Three tabs in the column's narrowest width: they close up rather than wrap. */
.rtab { flex: none; white-space: nowrap; }
@media (max-width: 960px) { :root[data-layout="front"] .rtabs { gap: 16px; } }
.todo-said { margin: 0 0 8px; padding: 0 var(--card-pad); font: 400 14px/1.4 var(--sans); color: var(--ink2); }
.todo-said[hidden] { display: none; }
.todo-list { display: grid; gap: 8px; }
.todo {
  display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 16px; align-items: start;
  padding: 22px var(--card-pad) 24px; border-radius: var(--card-radius); background: var(--card); color: var(--ink);
}
.todo-tick {
  appearance: none; -webkit-appearance: none; position: relative; display: block; width: 24px; height: 24px; margin: 0; padding: 0;
  border: 1.5px solid var(--mute); border-radius: 7px; background: none; cursor: pointer; transition: background-color .2s ease, border-color .2s ease;
}
.todo-tick:hover { border-color: var(--ink); }
.todo-tick:checked { border-color: var(--ink); background: var(--ink); }
.todo-tick:checked::after {
  content: ""; position: absolute; left: 7px; top: 2.5px; width: 6px; height: 12px;
  border: solid var(--sheet); border-width: 0 2px 2px 0; transform: rotate(42deg);
}
.todo-tick:disabled { opacity: .5; cursor: default; }
.todo-tick:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.todo-text {
  display: block; width: 100%; margin: 0; padding: 0; border: 0; background: none; color: var(--ink); text-align: left;
  font: 500 17px/1.34 var(--sans); letter-spacing: -0.011em; overflow-wrap: anywhere; text-wrap: pretty;
}
button.todo-text { cursor: pointer; }
button.todo-text:hover { text-decoration: underline; text-underline-offset: 3px; }
button.todo-text:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; border-radius: 2px; }
.todo-line { margin: 6px 0 0; font: 400 14px/1.4 var(--sans); color: var(--mute); overflow-wrap: anywhere; }

@media (max-width: 760px) {
  .todo-list { display: flex; gap: 10px; }
  .todo { grid-template-columns: 24px minmax(0, 1fr); gap: 14px; padding: 20px var(--card-pad); }
}
`;

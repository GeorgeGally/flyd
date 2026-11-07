/** The Todo tab: a field to add to the list, then each item as a card with its tick. */
export const TODO_STYLE = `
.todos { display: none; }
:root[data-layout="front"] .todos {
  display: block; position: fixed; top: calc(var(--top) + var(--tabs-h)); bottom: 0; right: var(--gut); width: var(--arts-w); z-index: 3;
  overflow-y: auto; scrollbar-width: none; padding: 0 0 28px; animation: column-in .24s ease both;
}
.todos::-webkit-scrollbar { display: none; }
:root[data-layout="front"]:not([data-rtab="todo"]) .todos { display: none; }
:root[data-screen="show"] .todos { display: none !important; }
@media (min-width: 761px) {
  :root[data-layout="front"][data-rtab="todo"] .jobs,
  :root[data-layout="front"][data-rtab="todo"] .rail { display: none !important; }
}
/* Four tabs in the column's narrowest width: they close up rather than wrap. */
.rtab { flex: none; white-space: nowrap; }
@media (max-width: 960px) { :root[data-layout="front"] .rtabs { gap: 16px; } }
.todo-new { display: flex; gap: 10px; margin: 16px 0 32px; }
.todo-new[hidden] { display: none; }
.todo-new input {
  flex: 1; min-width: 0; height: 44px; padding: 0 14px; border: 0; border-radius: var(--card-radius);
  background: var(--card); color: var(--ink); font: 400 15px/1.3 var(--sans);
}
.todo-new input::placeholder { color: var(--mute); }
.todo-new input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.todo-new button {
  flex: none; height: 44px; padding: 0 18px; border: 0; border-radius: var(--card-radius);
  background: var(--ink); color: var(--sheet); font: 500 14px/1 var(--sans); cursor: pointer;
}
.todo-new button:disabled { opacity: .5; cursor: default; }
.todo-new button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.todo-said { margin: -20px 0 24px; padding: 0 var(--card-pad); font: 400 14px/1.4 var(--sans); color: var(--ink2); }
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
.todo-done-head { margin: 44px 0 18px; padding: 0 var(--card-pad); font: 500 17px/1.3 var(--sans); color: var(--ink2); }
.todo.done { background: none; }
.todo.done .todo-text { font-weight: 400; color: var(--mute); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--mute) 55%, transparent); }

@media (max-width: 760px) {
  :root[data-layout="front"] .todos, :root[data-layout="front"]:not([data-rtab="todo"]) .todos {
    display: block; position: static; width: auto; overflow: visible; padding: 0 var(--gut) !important; margin-bottom: 26px;
  }
  :root[data-layout="front"][data-rtab][data-thread] .todos { display: none; }
  .todo-new { margin: 20px 0 22px; }
  .todo-said { margin: -10px 0 18px; padding: 0; }
  .todo-list { display: flex; gap: 10px; }
  .todo { grid-template-columns: 24px minmax(0, 1fr); gap: 14px; padding: 20px var(--card-pad); }
  .todo-done-head { margin: 26px 0 14px; padding: 0; }
}
`;

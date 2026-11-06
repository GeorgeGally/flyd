/** The Projects tab's rows, in the job cards' paper and type, and the room around his questions in a thread. */
export const THREAD_STYLE = `
.threads { display: none; }
:root[data-layout="front"] .threads {
  display: block; position: fixed; top: calc(var(--top) + var(--tabs-h)); bottom: 0; right: var(--gut); width: var(--arts-w); z-index: 3;
  overflow-y: auto; scrollbar-width: none; padding: 0 0 28px; animation: column-in .24s ease both;
}
.threads::-webkit-scrollbar { display: none; }
:root[data-layout="front"]:not([data-rtab="threads"]) .threads,
:root[data-layout="front"][data-rtab="threads"] .jobs,
:root[data-layout="front"][data-rtab="threads"] .rail { display: none !important; }
:root[data-screen="show"] .threads { display: none !important; }
.thread-list { display: grid; gap: 8px; }
.thread {
  display: flex; flex-direction: column; justify-content: flex-start; width: 100%; padding: 20px var(--card-pad) 22px; border: 0; border-radius: var(--card-radius);
  background: var(--card); color: var(--ink); font: inherit; text-align: left; cursor: pointer;
  transition: background-color .2s ease, box-shadow .2s ease;
}
.thread:hover { background: var(--sheet); }
.thread.on { background: var(--sheet); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 12%, transparent); }
.thread:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
/* A page mentioned somewhere in the thread is not the page he is on. */
:root[data-thread] .site { display: none !important; }
.thread-top { display: flex; align-items: center; gap: 8px; }
.thread-name { font: 600 18px/1.3 var(--sans); letter-spacing: -0.012em; }
.thread-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ink); }
.thread-when { margin-left: auto; padding-left: 12px; font: 400 13px/1.4 var(--sans); color: var(--mute); font-variant-numeric: tabular-nums; white-space: nowrap; }
.thread-q, .thread-a {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; text-wrap: pretty;
}
.thread-q { margin-top: 8px; font: 500 15.5px/1.4 var(--sans); color: var(--ink); }
.thread-a { margin-top: 6px; font: 400 14.5px/1.45 var(--sans); color: var(--mute); }
.thread.unread .thread-a { color: var(--ink2); }

/* A thread: each of his questions opens a new stretch of the page, its answer right under it. */
:root[data-thread] main .msg.user { margin-top: 56px; }
:root[data-thread] main .msg.user:first-of-type { margin-top: 0; }
:root[data-thread] main .msg.user + .msg.user { margin-top: 18px; }
:root[data-thread] main .msg.user + .msg.assistant { margin-top: 14px; }
:root[data-thread] main .msg.user .body { font-weight: 500; color: var(--ink); }
:root[data-layout="front"][data-thread] .stage-back { display: block; }

@media (max-width: 760px) {
  :root[data-layout="front"] .threads, :root[data-layout="front"]:not([data-rtab="threads"]) .threads { display: block !important; position: static; width: auto; overflow: visible; padding: 0 var(--gut) !important; margin-bottom: 26px; }
  /* In a thread the list stays and the strips of jobs and artefacts give way to it. */
  :root[data-layout="front"][data-rtab][data-thread] .jobs, :root[data-layout="front"][data-rtab][data-thread] .rail:not([hidden]) { display: none !important; }
  .thread-list { display: flex; gap: 10px; }
  .thread { padding: 16px var(--card-pad) 18px; }
}
`;

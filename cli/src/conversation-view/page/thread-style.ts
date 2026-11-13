/** The Projects tab's rows as a contents page, and the room around his questions in a thread. */
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
/* The Projects tab as a contents page: no cards, one entry per project split by a white hairline. An unread mark
   hangs in the gutter; the name and time share a baseline; his words, muted, then Flyd's line in one sentence. */
.thread-list { display: block; }
.thread {
  position: relative; display: block; width: 100%; padding: 15px var(--card-pad) 16px; border: 0; border-radius: var(--card-radius);
  background: none; color: var(--ink); font: inherit; text-align: left; cursor: pointer; transition: background-color .2s ease;
}
.thread + .thread::before { content: ""; position: absolute; top: 0; left: var(--card-pad); right: var(--card-pad); height: 1px; background: var(--sheet); }
.thread:hover { background: var(--card); }
.thread:hover::before, .thread:hover + .thread::before { opacity: 0; }
.thread:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
/* A page mentioned somewhere in the thread is not the page he is on. */
:root[data-thread] .site { display: none !important; }
.thread-top { display: flex; align-items: baseline; gap: 10px; padding-bottom: 4px; }
.thread-name { margin: 4px 0; font: 500 24px/1.3 var(--sans); letter-spacing: -0.012em; color: var(--fg); min-width: 0; overflow-wrap: anywhere; }
.thread .thread-dot { position: absolute; left: 12px; top: 33px; width: 7px; height: 7px; border-radius: 50%; background: var(--hot); }
.thread-when { margin-left: auto; font: 400 13px/1.3 var(--sans); color: var(--mute); font-variant-numeric: tabular-nums; white-space: nowrap; }
.thread-q, .thread-a { display: block; overflow-wrap: anywhere; text-wrap: pretty; }
.thread-q { margin: 3px 0 6px; font: 400 18px/19px var(--sans); color: var(--mute); }
.thread-a { margin: 3px 0 0; font: 400 18px/1.45 var(--sans); color: var(--ink2); }
.thread.on .thread-a { color: var(--ink); }
/* The project that moved last, with a picture, leads like a title card: framed picture, big name, the exchange. */
.thread.thread-lead { padding: 6px var(--card-pad) 30px; }
.thread-lead + .thread::before { display: none; }
.thread-frame { display: block; padding: 10px; border-radius: 10px; background: var(--card); transition: background-color .2s ease; }
.thread-lead:hover { background: none; }
.thread-lead:hover .thread-frame { background: var(--sheet); }
.thread-frame img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; border-radius: 4px; outline: 1px solid color-mix(in srgb, var(--ink) 6%, transparent); outline-offset: -1px; }
.thread-lead .thread-top { margin-top: 22px; }
.thread-lead .thread-name { font: 600 44px/1.02 var(--sans); letter-spacing: -0.03em; color: var(--ink); }
.thread-lead .thread-dot { display: none; }
.thread-lead .thread-q { margin-top: 12px; font: 500 17px/1.45 var(--sans); color: var(--ink); }
.thread-lead .thread-a { margin-top: 8px; font: 400 16px/1.55 var(--sans); color: var(--ink2); }
/* Every conversation, and what nothing could place, sit quietly under the list. */
.thread-more { display: flex; gap: 28px; margin: 36px 0 0; padding: 0 var(--card-pad); }
.thread-more button { padding: 0; border: 0; background: none; font: 400 15px/1.3 var(--sans); color: var(--mute); cursor: pointer; transition: color .2s ease; }
.thread-more button:hover, .thread-more button[aria-current="true"] { color: var(--ink); }
.thread-more button[aria-current="true"] { font-weight: 500; }

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
  .thread { padding: 14px 0 15px 18px; border-radius: 0; }
  .thread:hover { background: none; }
  .thread + .thread::before { left: 18px; right: 0; }
  .thread .thread-dot { left: 1px; top: 32px; width: 6px; height: 6px; }
  .thread.thread-lead { padding: 4px 0 26px; }
  .thread-lead .thread-name { font-size: 32px; }
  .thread-more { padding: 0 0 0 18px; }
}
`;

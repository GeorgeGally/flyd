/** Colours, type and the slim header, shared with the taste page. */
export const BASE_STYLE = `
:root {
  --bg: #101113;
  --fg: #e4e2dc;
  --strong: #f6f4ef;
  --muted: #7c7f86;
  --faint: #25272b;
  --tint: #18191c;
  --accent: #e2b877;
  --link: #9cc3e6;
  --sel-bg: #5a4b36;
  --sel-fg: #fff6e6;
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Helvetica Neue", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  color-scheme: dark;
}
:root[data-theme="light"] {
  --bg: #f6f5f1;
  --fg: #2b2b2e;
  --strong: #111113;
  --muted: #8b8880;
  --faint: #e2e0d9;
  --tint: #ecebe5;
  --accent: #a4641c;
  --link: #1f5f99;
  --sel-bg: #d9c2a6;
  --sel-fg: #1a1206;
  color-scheme: light;
}
:root { --head-h: 52px; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body {
  font: 400 27px/1.6 var(--sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-feature-settings: "kern", "liga";
}
/* One selection style; the captain's own words wear exactly the same colours. */
::selection { background: var(--sel-bg); color: var(--sel-fg); }

header {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 16px;
  height: var(--head-h); padding: 0 24px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  font: 500 14px/1 var(--sans); color: var(--muted);
}
.who { color: var(--accent); white-space: nowrap; }
.project-badge { flex: none; max-width: 18em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 12px/1.2 var(--mono); letter-spacing: 0.03em; color: var(--muted); }
.project-badge[hidden] { display: none; }
.project-badge.shown { animation: scene-fade 240ms ease both; }
.when { white-space: nowrap; font-variant-numeric: tabular-nums; }
/* One kind of control: a small text toggle. No borders; colour alone says
   which are on. */
header .controls { display: flex; align-items: center; gap: 4px; margin-left: 8px; }
header button {
  font: inherit; color: var(--muted); background: transparent; border: 0; border-radius: 6px;
  height: 28px; padding: 0 8px; cursor: pointer; white-space: nowrap; transition: color 140ms ease;
}
header button[aria-pressed="true"] { color: var(--accent); }
/* A switch: its word, then a small track whose knob and fill say on or off at a glance. */
header button[role="switch"] { display: inline-flex; align-items: center; gap: 8px; }
button[role="switch"] .track {
  position: relative; flex: none; width: 26px; height: 14px; border-radius: 7px;
  background: color-mix(in srgb, var(--muted) 34%, transparent); transition: background-color 180ms ease;
}
button[role="switch"] .track::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--muted); transition: transform 220ms cubic-bezier(.3,1.4,.5,1), background-color 180ms ease;
}
header button[role="switch"][aria-checked="true"] { color: var(--strong); }
button[role="switch"][aria-checked="true"] .track { background: var(--accent); }
button[role="switch"][aria-checked="true"] .track::after { transform: translateX(12px); background: var(--bg); }
header .air { display: none; flex: 1; align-items: center; gap: 9px; min-width: 0; white-space: nowrap; }
header .air::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); opacity: 0.5; }
header .air.on { color: var(--k-live, var(--accent)); }
header .air.on::before { background: currentColor; opacity: 1; }
/* The current conversation title stays in the header; past sessions live in the right column. */
header .picker { flex: 1; min-width: 0; display: flex; }
#conversation-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
header select {
  font: inherit; color: var(--fg); background: transparent; border: 0; border-radius: 6px;
  height: 30px; padding: 0 20px 0 6px; margin-left: -6px; cursor: pointer; max-width: 100%;
  field-sizing: content;
  appearance: none; -webkit-appearance: none; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
  background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 11px) 13px, calc(100% - 7px) 13px; background-size: 4px 4px; background-repeat: no-repeat;
}
header select:hover { background-color: var(--tint); }
header select option { color: var(--fg); background: var(--bg); }
header button:hover { color: var(--fg); }
header button[aria-pressed="true"]:hover { color: color-mix(in srgb, var(--accent) 80%, var(--strong)); }
header button[role="switch"][aria-checked="true"]:hover { color: var(--strong); }
header :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
`;

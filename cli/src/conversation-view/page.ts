import { escapeHtml } from "./markdown.js";

// The whole page: one flat column, the captain's words and the replies, a
// slim header. Everything is inline (see the CSP in server.ts); the page
// fetches nothing but this server's own /api endpoints.

const STYLE = `
:root {
  --bg: #101113;
  --fg: #e4e2dc;
  --strong: #f6f4ef;
  --muted: #7c7f86;
  --faint: #25272b;
  --tint: #18191c;
  --accent: #e2b877;
  --captain: #f1dcb7;
  --link: #9cc3e6;
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
  --captain: #5e3b10;
  --link: #1f5f99;
  color-scheme: light;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body {
  font: 400 19px/1.66 var(--sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-feature-settings: "kern", "liga";
}
::selection { background: color-mix(in srgb, var(--accent) 35%, transparent); }

header {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 14px;
  height: 46px; padding: 0 20px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid transparent;
  font: 500 12.5px/1 var(--mono); letter-spacing: 0.02em; color: var(--muted);
  transition: border-color 160ms ease;
}
header.scrolled { border-bottom-color: var(--faint); }
.who { color: var(--accent); white-space: nowrap; }
.when { white-space: nowrap; font-variant-numeric: tabular-nums; }
header button {
  font: inherit; color: var(--muted); background: transparent;
  border: 1px solid var(--faint); border-radius: 6px; height: 26px; padding: 0 8px; cursor: pointer;
}
/* The session picker doubles as the title. */
header .picker { flex: 1; min-width: 0; display: flex; }
header select {
  font: inherit; color: var(--fg); background: transparent; border: 0; border-radius: 6px;
  height: 28px; padding: 0 20px 0 6px; margin-left: -6px; cursor: pointer; max-width: 100%;
  field-sizing: content;
  appearance: none; -webkit-appearance: none; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
  background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 11px) 12px, calc(100% - 7px) 12px; background-size: 4px 4px; background-repeat: no-repeat;
}
header select:hover { background-color: var(--tint); }
header select option { color: var(--fg); background: var(--bg); }
header button:hover { color: var(--fg); border-color: color-mix(in srgb, var(--muted) 50%, transparent); }
header :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

main { max-width: 43rem; margin: 0 auto; padding: 28px 28px 30vh; }
.empty { color: var(--muted); font: 14px var(--mono); text-align: center; margin-top: 30vh; }

.msg { position: relative; overflow-wrap: anywhere; }
.msg[data-day]::before {
  content: attr(data-day); display: block; margin: 64px 0 8px;
  font: 500 11.5px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
}
.msg.user { margin-top: 56px; color: var(--captain); font-weight: 500; }
.msg.user .body::before {
  content: "›"; position: absolute; left: -1.25em; color: var(--accent);
  font: 500 1em/1.66 var(--mono);
}
.msg.user + .msg.user { margin-top: 18px; }
.msg.assistant { margin-top: 22px; }
.time {
  position: absolute; right: calc(100% + 1.9em); top: 0.5em; white-space: nowrap;
  font: 11.5px/1 var(--mono); color: var(--muted); opacity: 0; transition: opacity 140ms ease;
  font-variant-numeric: tabular-nums;
}
.msg:hover .time { opacity: 1; }
.msg.fresh { animation: rise 320ms cubic-bezier(.2,.7,.2,1); }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.body > :first-child { margin-top: 0; }
.body > :last-child { margin-bottom: 0; }
.body p { margin: 0 0 0.85em; }
.body h1, .body h2, .body h3, .body h4 { color: var(--strong); line-height: 1.3; margin: 1.5em 0 0.5em; letter-spacing: -0.01em; }
.body h1 { font-size: 1.32em; } .body h2 { font-size: 1.16em; } .body h3, .body h4 { font-size: 1em; }
.body strong { color: var(--strong); font-weight: 620; }
.msg.user strong { color: inherit; }
.body ul, .body ol { margin: 0 0 0.9em; padding-left: 1.3em; }
.body li { margin: 0.28em 0; padding-left: 0.15em; }
.body li::marker { color: var(--muted); }
.body a { color: var(--link); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--link) 40%, transparent); }
.body a:hover { text-decoration-color: currentColor; }
.body code { font: 0.84em var(--mono); background: var(--tint); padding: 0.12em 0.36em; border-radius: 5px; }
.body pre { background: var(--tint); padding: 14px 16px; border-radius: 8px; overflow-x: auto; margin: 0 0 1em; font: 14.5px/1.6 var(--mono); }
.body pre code { background: none; padding: 0; font: inherit; color: var(--fg); font-weight: 400; }
.body blockquote { margin: 0 0 1em; padding: 0 0 0 1em; border-left: 2px solid var(--faint); color: var(--muted); }
.body hr { border: 0; border-top: 1px solid var(--faint); margin: 1.6em 0; }
.body table { border-collapse: collapse; width: 100%; margin: 0.4em 0 1.1em; font-size: 0.86em; display: block; overflow-x: auto; }
.body th { text-align: left; font: 500 0.82em var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.body th, .body td { padding: 8px 14px 8px 0; border-bottom: 1px solid var(--faint); vertical-align: top; }
.pill { font: 500 0.7em var(--mono); color: var(--muted); border: 1px solid var(--faint); border-radius: 999px; padding: 0.12em 0.6em; vertical-align: 0.12em; white-space: nowrap; }

.working { margin-top: 26px; height: 20px; display: flex; gap: 6px; align-items: center; }
.working[hidden] { display: none; }
.working i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: breathe 1.4s ease-in-out infinite; }
.working i:nth-child(2) { animation-delay: .18s; } .working i:nth-child(3) { animation-delay: .36s; }
@keyframes breathe { 0%, 100% { opacity: .25; } 50% { opacity: .9; } }

.jump {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  font: 500 12.5px/1 var(--mono); color: var(--bg); background: var(--fg); border: 0;
  border-radius: 999px; padding: 9px 14px; cursor: pointer; box-shadow: 0 6px 24px rgba(0,0,0,.25);
}
.jump[hidden] { display: none; }
.problem { position: fixed; right: 16px; bottom: 16px; font: 12px var(--mono); color: var(--muted); }

@media (max-width: 720px) {
  body { font-size: 17.5px; }
  main { padding: 20px 20px 30vh 30px; }
  .time { display: none; }
  header .when { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .msg.fresh, .working i { animation: none; }
  html { scroll-behavior: auto; }
}
`;

const SCRIPT = `
(function () {
  var main = document.getElementById("stream");
  var working = document.getElementById("working");
  var jump = document.getElementById("jump");
  var header = document.querySelector("header");
  var whenEl = document.getElementById("when");
  var picker = document.getElementById("picker");
  var themeBtn = document.getElementById("theme");
  var problem = document.getElementById("problem");
  var nodes = new Map();
  var source = null;
  var current = null;
  var explicit = new URLSearchParams(location.search).get("session");
  var lastActivity = null;
  var isWorking = false;
  var first = true;

  function store(key, value) {
    try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeBtn.textContent = theme === "light" ? "dark" : "light";
  }
  applyTheme(store("flyd-view-theme") === "light" ? "light" : "dark");
  themeBtn.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    store("flyd-view-theme", next);
    applyTheme(next);
  });

  function clock(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function dayOf(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  }
  function nearBottom() {
    return document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 160;
  }
  function toBottom() { window.scrollTo(0, document.documentElement.scrollHeight); }

  function build(message) {
    var el = document.createElement("article");
    el.className = "msg " + message.role;
    var time = document.createElement("span");
    time.className = "time";
    el.appendChild(time);
    var body = document.createElement("div");
    body.className = "body";
    el.appendChild(body);
    return el;
  }
  function fill(el, message) {
    el.dataset.ts = message.timestamp || "";
    el.firstChild.textContent = message.timestamp ? clock(message.timestamp) : "";
    el.lastChild.innerHTML = message.html;
  }

  function refreshWorking() {
    var recent = lastActivity && Date.now() - new Date(lastActivity).getTime() < 10 * 60 * 1000;
    working.hidden = !(isWorking && recent);
  }
  setInterval(refreshWorking, 15000);

  function apply(update) {
    var stick = first || nearBottom();
    var added = false;
    update.messages.forEach(function (message) {
      var el = nodes.get(message.id);
      if (!el) { el = build(message); nodes.set(message.id, el); if (!first) { el.classList.add("fresh"); added = true; } }
      fill(el, message);
    });
    var keep = new Set(update.order);
    nodes.forEach(function (el, id) { if (!keep.has(id)) { el.remove(); nodes.delete(id); } });
    var cursor = main.firstElementChild;
    var day = "";
    update.order.forEach(function (id) {
      var el = nodes.get(id);
      if (el !== cursor) main.insertBefore(el, cursor); else cursor = cursor.nextElementSibling;
      var d = el.dataset.ts ? dayOf(el.dataset.ts) : "";
      if (d && d !== day) { el.dataset.day = d; day = d; } else { delete el.dataset.day; }
    });
    main.appendChild(working);
    document.getElementById("empty").hidden = update.order.length > 0;
    isWorking = update.working;
    lastActivity = update.lastActivity || lastActivity;
    refreshWorking();
    if (lastActivity) whenEl.textContent = dayOf(lastActivity) + "  " + clock(lastActivity);
    if (stick) { toBottom(); jump.hidden = true; } else if (added) { jump.hidden = false; }
    first = false;
  }

  function reset() {
    nodes.forEach(function (el) { el.remove(); });
    nodes.clear();
    first = true;
    jump.hidden = true;
  }

  function connect(sessionId) {
    if (source) source.close();
    reset();
    source = new EventSource("/api/stream" + (sessionId ? "?session=" + encodeURIComponent(sessionId) : ""));
    source.addEventListener("session", function (event) {
      var session = JSON.parse(event.data);
      current = session.id;
      document.title = session.title + " · " + session.assistantLabel;
      if (picker.value !== session.id) loadSessions();
    });
    source.addEventListener("update", function (event) { problem.textContent = ""; apply(JSON.parse(event.data)); });
    source.addEventListener("problem", function (event) { problem.textContent = JSON.parse(event.data).error; });
    source.onerror = function () { problem.textContent = "reconnecting…"; };
    source.onopen = function () { problem.textContent = ""; };
  }

  function loadSessions() {
    return fetch("/api/sessions").then(function (r) { return r.json(); }).then(function (data) {
      var sessions = data.sessions || [];
      picker.textContent = "";
      sessions.forEach(function (session, index) {
        var option = document.createElement("option");
        option.value = session.id;
        option.textContent = session.title + (index === 0 ? "" : "  ·  " + dayOf(session.updatedAt));
        picker.appendChild(option);
      });
      if (current) picker.value = current;
      return sessions;
    });
  }

  picker.addEventListener("change", function () {
    explicit = picker.value;
    history.replaceState(null, "", "?session=" + encodeURIComponent(explicit));
    connect(explicit);
  });

  // Without an explicit pick, follow whichever session is newest (a /clear
  // in Claude Code starts a new transcript file).
  setInterval(function () {
    if (explicit) return;
    loadSessions().then(function (sessions) {
      if (sessions.length && current && sessions[0].id !== current) connect(null);
    }).catch(function () {});
  }, 5000);

  window.addEventListener("scroll", function () {
    header.classList.toggle("scrolled", window.scrollY > 4);
    if (nearBottom()) jump.hidden = true;
  }, { passive: true });
  jump.addEventListener("click", function () { toBottom(); jump.hidden = true; });

  loadSessions().catch(function () {});
  connect(explicit);
})();
`;

export function renderPage(options: { assistantLabel: string }): string {
  const label = escapeHtml(options.assistantLabel);
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <span class="who">${label}</span>
  <span class="picker"><select id="picker" aria-label="Session"></select></span>
  <span class="when" id="when"></span>
  <button id="theme" type="button" aria-label="Toggle theme">light</button>
</header>
<main id="stream" aria-live="polite">
  <p class="empty" id="empty" hidden>Nothing said yet.</p>
  <div class="working" id="working" hidden aria-label="${label} is working"><i></i><i></i><i></i></div>
</main>
<button class="jump" id="jump" type="button" hidden>↓ new</button>
<div class="problem" id="problem"></div>
<!-- Input seam: a source that can accept the captain's words will render a composer here. -->
<script>${SCRIPT}</script>
</body>
</html>`;
}

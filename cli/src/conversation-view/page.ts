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
  display: flex; align-items: center; gap: 14px;
  height: 52px; padding: 0 22px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid transparent;
  font: 500 14px/1 var(--mono); letter-spacing: 0.02em; color: var(--muted);
  transition: border-color 160ms ease;
}
header.scrolled { border-bottom-color: var(--faint); }
.who { color: var(--accent); white-space: nowrap; }
.when { white-space: nowrap; font-variant-numeric: tabular-nums; }
header button {
  font: inherit; color: var(--muted); background: transparent;
  border: 1px solid var(--faint); border-radius: 6px; height: 28px; padding: 0 9px; cursor: pointer;
}
/* The session picker doubles as the title. */
header .picker { flex: 1; min-width: 0; display: flex; }
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
header button:hover { color: var(--fg); border-color: color-mix(in srgb, var(--muted) 50%, transparent); }
header :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* ~66 characters a line at the reading size. */
main { max-width: 36em; margin: 0 auto; padding: 1em 1.5em 30vh 2.2em; }
body.can-send main { padding-bottom: calc(30vh + 6em); }
.empty { color: var(--muted); font: 15px var(--mono); text-align: center; margin-top: 30vh; }

.msg { position: relative; overflow-wrap: anywhere; }
.msg[data-day]::before {
  content: attr(data-day); display: block; margin: 2.4em 0 0.4em;
  font: 500 13px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
}
.msg.user { margin-top: 2em; }
.msg.user .body::before {
  content: "›"; position: absolute; left: -1.1em; color: var(--accent);
  font: 500 1em/1.6 var(--mono);
}
/* The captain's words look exactly like selected text: the selection's
   colours, hugging each line the way a selection does. The page wraps each
   block's text in .hl. */
.msg.user .hl, .msg.user pre code {
  background: var(--sel-bg); color: var(--sel-fg);
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
}
/* Fill the whole line box, as a selection does: (1.6em line - ~1.2em glyph box) / 2. */
.msg.user .hl { padding: 0.2em 0; }
.msg.user strong, .msg.user a { color: inherit; }
.msg.user + .msg.user { margin-top: 0.5em; }
.msg.assistant { margin-top: 0.85em; }
.time {
  position: absolute; right: calc(100% + 2em); top: 0.55em; white-space: nowrap;
  font: 13px/1 var(--mono); color: var(--muted); opacity: 0; transition: opacity 140ms ease;
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
.body ul, .body ol { margin: 0 0 0.9em; padding-left: 1.3em; }
.body li { margin: 0.28em 0; padding-left: 0.15em; }
.body li::marker { color: var(--muted); }
.body a { color: var(--link); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--link) 40%, transparent); }
.body a:hover { text-decoration-color: currentColor; }
.body code { font: 0.84em var(--mono); background: var(--tint); padding: 0.12em 0.36em; border-radius: 5px; }
.body pre { background: var(--tint); padding: 0.7em 0.85em; border-radius: 0.3em; overflow-x: auto; margin: 0 0 1em; font: 0.72em/1.6 var(--mono); }
.body pre code { background: none; padding: 0; font: inherit; color: var(--fg); font-weight: 400; }
.body blockquote { margin: 0 0 1em; padding: 0 0 0 1em; border-left: 2px solid var(--faint); color: var(--muted); }
.body hr { border: 0; border-top: 1px solid var(--faint); margin: 1.6em 0; }
.body table { border-collapse: collapse; width: 100%; margin: 0.4em 0 1.1em; font-size: 0.8em; display: block; overflow-x: auto; }
.body th { text-align: left; font: 500 0.82em var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.body th, .body td { padding: 0.45em 0.8em 0.45em 0; border-bottom: 1px solid var(--faint); vertical-align: top; }
.pill { font: 500 0.7em var(--mono); color: var(--muted); border: 1px solid var(--faint); border-radius: 999px; padding: 0.12em 0.6em; vertical-align: 0.12em; white-space: nowrap; }

.working { margin-top: 1em; height: 20px; display: flex; gap: 7px; align-items: center; }
.working[hidden] { display: none; }
.working i { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); animation: breathe 1.4s ease-in-out infinite; }
.working i:nth-child(2) { animation-delay: .18s; } .working i:nth-child(3) { animation-delay: .36s; }
@keyframes breathe { 0%, 100% { opacity: .25; } 50% { opacity: .9; } }

.jump {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  font: 500 12.5px/1 var(--mono); color: var(--bg); background: var(--fg); border: 0;
  border-radius: 999px; padding: 9px 14px; cursor: pointer; box-shadow: 0 6px 24px rgba(0,0,0,.25);
}
.jump[hidden] { display: none; }
body.can-send .jump { bottom: 7.5em; font-size: 14px; }
.problem { position: fixed; right: 16px; bottom: 16px; font: 12px var(--mono); color: var(--muted); }

/* Pending: the captain's message is on its way to firstmate. */
.msg.pending { opacity: 0.72; }
.msg.pending .body { white-space: pre-wrap; }
.msg.failed { opacity: 1; outline: 1px solid color-mix(in srgb, #d0574c 60%, transparent); cursor: pointer; }
.state { display: block; margin-top: 0.3em; font: 500 13px/1.3 var(--mono); color: var(--muted); }
.msg.failed .state { color: #d0574c; }

.composer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 4;
  padding: 1.6em 0 0.9em;
  background: linear-gradient(to bottom, transparent, var(--bg) 1.4em);
  font-size: 0.8em;
}
.composer[hidden] { display: none; }
.composer .row {
  position: relative; max-width: calc(36em * 1.25); margin: 0 auto; padding: 0 1.9em 0 2.75em;
}
.composer .field {
  display: flex; align-items: flex-end; gap: 0.6em;
  background: var(--tint); border-radius: 0.4em; padding: 0.5em 0.6em 0.5em 1.75em; margin-left: -1.75em;
  border: 1px solid transparent; transition: border-color 140ms ease;
}
.composer .field:focus-within { border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.composer .field::before {
  content: "›"; position: absolute; margin-left: -1.2em; color: var(--accent); font: 500 1em/1.5 var(--mono);
}
.composer textarea {
  flex: 1; min-width: 0; resize: none; border: 0; outline: 0; background: transparent;
  color: var(--fg); font: 400 1em/1.5 var(--sans); max-height: 38vh; padding: 0;
}
.composer textarea::placeholder { color: var(--muted); font-weight: 400; }
.composer button {
  font: 500 14px/1 var(--mono); color: var(--bg); background: var(--accent); border: 0;
  border-radius: 6px; padding: 9px 12px; cursor: pointer;
}
.composer button:disabled { opacity: 0.4; cursor: default; }
.composer .hint { margin-top: 0.45em; font: 12.5px/1 var(--mono); color: var(--muted); }

@media (max-width: 720px) {
  body { font-size: 20px; }
  main { padding: 1em 1em 30vh 1.9em; }
  .composer .row { padding: 0 1em 0 2.4em; }
  .composer .hint { display: none; }
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
  var awaiting = new Set();
  var latestSession = null;
  var warnings = new Map();
  var SEND_TOKEN = document.body.dataset.sendToken || "";

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
  var BLOCK = /^(UL|OL|P|PRE|BLOCKQUOTE|TABLE|DIV|H[1-6]|HR)$/;
  // Wraps each run of inline content in a block in span.hl, so the captain's
  // words are highlighted line by line, the way a text selection is.
  function highlight(body) {
    body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, td, th").forEach(function (block) {
      var run = [];
      function flush() {
        if (!run.length) return;
        var text = run.map(function (n) { return n.textContent; }).join("");
        if (text.trim()) {
          var span = document.createElement("span");
          span.className = "hl";
          block.insertBefore(span, run[0]);
          run.forEach(function (n) { span.appendChild(n); });
        }
        run = [];
      }
      Array.prototype.slice.call(block.childNodes).forEach(function (node) {
        if (node.nodeType === 1 && BLOCK.test(node.tagName)) flush(); else run.push(node);
      });
      flush();
    });
  }
  function fill(el, message) {
    el.dataset.ts = message.timestamp || "";
    el.firstChild.textContent = message.timestamp ? clock(message.timestamp) : "";
    var body = el.querySelector(".body");
    body.innerHTML = message.html;
    if (message.role === "user") highlight(body);
    if (warnings.has(message.id)) showWarning(el, warnings.get(message.id));
  }
  // A sent note that was saved but did not wake firstmate says so.
  function showWarning(el, text) {
    if (el.querySelector(".state")) return;
    var state = document.createElement("span");
    state.className = "state";
    state.textContent = text;
    el.appendChild(state);
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
      if (!el) {
        el = build(message);
        nodes.set(message.id, el);
        // A message the page already showed optimistically arrives quietly.
        if (!first && !awaiting.has(message.id)) { el.classList.add("fresh"); added = true; }
      }
      fill(el, message);
    });
    main.querySelectorAll(".msg.pending").forEach(function (el) {
      if (el.dataset.wait && update.order.indexOf(el.dataset.wait) !== -1) { awaiting.delete(el.dataset.wait); el.remove(); }
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
    main.querySelectorAll(".msg.pending").forEach(function (el) { main.appendChild(el); });
    main.appendChild(working);
    document.getElementById("empty").hidden = update.order.length > 0 || !!main.querySelector(".msg.pending");
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
    // Optimistic copies belong to the session they were sent from.
    main.querySelectorAll(".msg.pending").forEach(function (el) { el.remove(); });
    awaiting.clear();
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
      latestSession = sessions.length ? sessions[0].id : null;
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

  // Composer: shown only when the server can deliver the captain's words.
  var composer = document.getElementById("composer");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  if (SEND_TOKEN) {
    composer.hidden = false;
    document.body.classList.add("can-send");
  }
  function grow() {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
    sendBtn.disabled = !input.value.trim();
  }
  input.addEventListener("input", grow);
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); composer.requestSubmit(); }
  });

  function pendingMessage(text) {
    var el = document.createElement("article");
    el.className = "msg user pending fresh";
    var time = document.createElement("span");
    time.className = "time";
    el.appendChild(time);
    var body = document.createElement("div");
    body.className = "body";
    var hl = document.createElement("span");
    hl.className = "hl";
    hl.textContent = text;
    body.appendChild(hl);
    el.appendChild(body);
    var state = document.createElement("span");
    state.className = "state";
    state.textContent = "sending…";
    el.appendChild(state);
    main.insertBefore(el, working);
    document.getElementById("empty").hidden = true;
    return el;
  }

  composer.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text || !current) return;
    var el = pendingMessage(text);
    input.value = "";
    grow();
    toBottom();
    fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json", "x-flyd-view-token": SEND_TOKEN },
      body: JSON.stringify({ session: current, text: text }),
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || "not sent");
        return data;
      });
    }).then(function (sent) {
      // Kept until the message shows up in the conversation itself.
      if (nodes.has(sent.id)) {
        el.remove();
        if (sent.warning) {
          warnings.set(sent.id, "saved, but firstmate was not woken: " + sent.warning);
          showWarning(nodes.get(sent.id), warnings.get(sent.id));
        }
        return;
      }
      var state = el.querySelector(".state");
      if (latestSession && current !== latestSession) {
        // Firstmate answers in its live session; the note is shown there.
        state.textContent = "delivered · shows in the latest session";
        return;
      }
      el.dataset.wait = sent.id;
      awaiting.add(sent.id);
      if (sent.warning) warnings.set(sent.id, "saved, but firstmate was not woken: " + sent.warning);
      state.textContent = warnings.get(sent.id) || "delivered";
    }).catch(function (error) {
      el.classList.add("failed");
      el.querySelector(".state").textContent = "not sent: " + error.message + " (click to dismiss)";
      el.addEventListener("click", function () { el.remove(); });
      if (!input.value) { input.value = text; grow(); }
    });
  });

  loadSessions().catch(function () {});
  connect(explicit);
})();
`;

export function renderPage(options: { assistantLabel: string; sendToken?: string }): string {
  const label = escapeHtml(options.assistantLabel);
  const token = options.sendToken ? ` data-send-token="${escapeHtml(options.sendToken)}"` : "";
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label}</title>
<style>${STYLE}</style>
</head>
<body${token}>
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
<form class="composer" id="composer" hidden autocomplete="off">
  <div class="row">
    <div class="field">
      <textarea id="input" rows="1" placeholder="Message ${label}" aria-label="Message ${label}"></textarea>
      <button id="send" type="submit" disabled>send</button>
    </div>
    <div class="hint">enter to send · shift+enter for a new line</div>
  </div>
</form>
<script>${SCRIPT}</script>
</body>
</html>`;
}

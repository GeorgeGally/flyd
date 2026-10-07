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
main { max-width: 36em; margin: 0 auto; padding: 1em 1.5em 30vh; }
body.can-send main { padding-bottom: calc(30vh + 6em + max(72px, 9vh)); }
.empty { color: var(--muted); font: 15px var(--mono); text-align: center; margin-top: 30vh; }

.msg { position: relative; overflow-wrap: anywhere; }
.msg[data-day]::before {
  content: attr(data-day); display: block; margin: 2.4em 0 0.4em;
  font: 500 13px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
}
.msg.user { margin-top: 2em; }
/* The captain's words look exactly like selected text: the selection's
   colours, hugging each line the way a selection does. The page wraps each
   block's text in .hl. */
.msg.user .hl {
  background: var(--sel-bg); color: var(--sel-fg);
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
}
/* Pasted code: one solid highlighted block, indentation kept, no per-line bars. */
.msg.user pre { background: var(--sel-bg); color: var(--sel-fg); line-height: 1.6; }
.msg.user pre code { background: none; color: inherit; }
/* Taller lines so the padded highlights of wrapped lines do not touch. */
.msg.user .body { line-height: 2.1; }
/* Horizontal "padding" comes from side shadows in the same colour: WebKit
   draws them on every wrapped line, so each line's highlight starts at the
   same left edge (inline padding and margins only reach the first line
   there), and the text itself stays aligned with the replies. */
.msg.user .hl {
  padding: 0.35em 0;
  box-shadow: 0.6em 0 0 var(--sel-bg), -0.6em 0 0 var(--sel-bg);
}
.msg.user strong, .msg.user a { color: inherit; }
.msg.user + .msg.user { margin-top: 0.9em; }
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
body.can-send .jump { bottom: calc(110px + max(72px, 9vh)); font-size: 14px; }
.problem { position: fixed; right: 16px; bottom: 16px; font: 12px var(--mono); color: var(--muted); }

/* Summary view: a long reply leads with its plain-English summary; the full
   reply waits behind "more". Full view shows replies whole. */
.summary { color: var(--strong); }
.summary > :first-child { margin-top: 0; }
.summary > :last-child { margin-bottom: 0; }
.summary p { margin: 0 0 0.5em; }
.summary.pending::after, .compare.pending::after { content: "summarising…"; display: block; margin-top: 0.2em; font: 13px/1.3 var(--mono); color: var(--muted); }
.compare { margin-top: 0.5em; padding-left: 0.8em; border-left: 2px solid var(--faint); color: var(--muted); font-size: 0.86em; }
.compare::before { content: "model"; display: block; font: 500 12px/1.6 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; }
.compare p { margin: 0; }
.more {
  display: inline-block; margin: 0.35em 0 0; padding: 2px 0; border: 0; background: none; cursor: pointer;
  font: 500 13px/1.4 var(--mono); color: var(--muted); letter-spacing: 0.02em;
}
.more:hover { color: var(--fg); }
.msg.has-summary > .body { margin-top: 0.7em; }
:root:not([data-view="full"]) .msg.has-summary:not(.open) > .body { display: none; }
:root[data-view="full"] .msg.has-summary .more,
:root[data-view="full"] .msg.has-summary .compare,
:root[data-view="full"] .msg.has-summary:not([data-summary="author"]) .summary { display: none; }
:root[data-view="full"] .msg.has-summary:not([data-summary="author"]) > .body { margin-top: 0; }

/* Pasted images: thumbnails under the message, full size on click. */
.shots { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.45em; }
.shot { font: inherit; padding: 0; border: 1px solid var(--faint); border-radius: 0.25em; background: var(--tint); cursor: zoom-in; overflow: hidden; line-height: 0; }
.shot img { display: block; width: auto; height: auto; max-height: 9em; max-width: min(22em, calc(100vw - 3em)); }
.shot:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.lightbox {
  position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, #000 82%, transparent); cursor: zoom-out; padding: 3vh 3vw;
}
.lightbox[hidden] { display: none; }
.lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }

/* Pending: the captain's message is on its way to firstmate. */
.msg.pending { opacity: 0.72; }
.msg.pending .body { white-space: pre-wrap; }
.msg.failed { opacity: 1; outline: 1px solid color-mix(in srgb, #d0574c 60%, transparent); cursor: pointer; }
.state { display: block; margin-top: 0.3em; font: 500 13px/1.3 var(--mono); color: var(--muted); }
.msg.failed .state { color: #d0574c; }

.composer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 4;
  /* Lifted clear of the window's bottom edge. */
  padding: 1.6em 0 max(72px, 9vh);
  background: linear-gradient(to bottom, transparent, var(--bg) 1.4em);
  font-size: 0.8em;
}
.composer[hidden] { display: none; }
.composer .row {
  position: relative; max-width: calc(36em * 1.25); margin: 0 auto; padding: 0 1.875em;
}
.composer .field {
  display: flex; align-items: flex-end; gap: 0.6em;
  background: var(--tint); border-radius: 0.4em; padding: 0.5em 0.6em 0.5em 0.75em; margin-left: -0.75em;
  border: 0; transition: background-color 140ms ease;
}
/* No border (the captain asked); focus and state show as a change of fill. */
.composer .field:focus-within { background: color-mix(in srgb, var(--fg) 6%, var(--tint)); }
.composer textarea {
  flex: 1; min-width: 0; resize: none; border: 0; outline: 0; background: transparent;
  color: var(--fg); font: 400 1em/1.5 var(--sans); max-height: 38vh; padding: 0;
}
.composer textarea::placeholder { color: var(--muted); font-weight: 400; }
.composer button {
  font: 800 14px/1 var(--mono); letter-spacing: -0.03em; text-transform: uppercase;
  color: var(--bg); background: var(--accent); border: 0;
  border-radius: 6px; padding: 9px 12px; cursor: pointer;
}
.composer button:disabled { opacity: 0.4; cursor: default; }
.attachments { display: flex; flex-wrap: wrap; gap: 0.5em; margin: 0 0 0.5em; }
.attachments[hidden] { display: none; }
.attachment { position: relative; line-height: 0; border: 1px solid var(--faint); border-radius: 6px; overflow: hidden; background: var(--tint); }
.attachment img { display: block; height: 72px; max-width: 160px; object-fit: cover; }
.attachment button {
  position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; padding: 0; border-radius: 50%;
  font: 600 13px/22px var(--mono); color: var(--fg); background: color-mix(in srgb, var(--bg) 80%, transparent);
}
.composer.dropping .field { background: color-mix(in srgb, var(--accent) 16%, var(--tint)); }
/* Push-to-talk (Fn+Control in Flyd.app): the box shows it is listening. */
.composer.listening .field, .composer.transcribing .field { background: color-mix(in srgb, var(--accent) 12%, var(--tint)); }
.composer.listening .hint::before { content: "● listening   "; color: var(--accent); animation: breathe 1.4s ease-in-out infinite; }
.composer.transcribing .hint::before { content: "… writing it down   "; color: var(--accent); }
/* "/" lists the assistant's skills and commands, like Claude Code's prompt. */
.commands {
  position: absolute; left: 1.875em; right: 1.875em; bottom: calc(100% + 0.4em); z-index: 6;
  max-height: 46vh; overflow-y: auto; margin: 0 0 0 -0.75em; padding: 0.3em; list-style: none;
  background: var(--tint); border-radius: 0.4em; box-shadow: 0 10px 30px rgba(0,0,0,.35);
}
.commands[hidden] { display: none; }
.commands li { display: flex; gap: 0.9em; align-items: baseline; padding: 0.38em 0.6em; border-radius: 0.3em; cursor: pointer; }
.commands li.selected { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.commands .name { font: 500 0.82em var(--mono); color: var(--fg); white-space: nowrap; }
.commands .about { font-size: 0.66em; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.commands .none { font: 0.72em var(--mono); color: var(--muted); cursor: default; }
.composer .hint { margin-top: 0.45em; min-height: 1em; font: 12.5px/1 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

@media (max-width: 720px) {
  body { font-size: 20px; }
  main { padding: 1em 1em 30vh; }
  .composer .row { padding: 0 1.25em; }
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
    // Inside Flyd.app the window's title bar follows the page.
    try { window.webkit.messageHandlers.flyd.postMessage({ theme: theme }); } catch (e) { /* in a browser */ }
  }
  applyTheme(store("flyd-view-theme") === "light" ? "light" : "dark");
  var modeBtn = document.getElementById("mode");
  function applyMode(mode) {
    document.documentElement.setAttribute("data-view", mode);
    modeBtn.textContent = mode === "full" ? "summary" : "full";
  }
  applyMode(store("flyd-view-mode") === "full" ? "full" : "summary");
  modeBtn.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-view") === "full" ? "summary" : "full";
    store("flyd-view-mode", next);
    applyMode(next);
  });
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
    var old = el.querySelector(".shots");
    if (old) old.remove();
    if (message.images && message.images.length) {
      body.after(shots(message.images.map(function (id) {
        return "/api/image?session=" + encodeURIComponent(current || "") + "&id=" + encodeURIComponent(id);
      })));
    }
    if (message.role === "assistant") summarize(el, message);
    if (warnings.has(message.id)) showWarning(el, warnings.get(message.id));
  }
  function summarize(el, message) {
    ["summary", "compare", "more"].forEach(function (name) {
      var old = el.querySelector(":scope > ." + name);
      if (old) old.remove();
    });
    el.classList.toggle("has-summary", !!message.summary);
    if (!message.summary) { delete el.dataset.summary; return; }
    el.dataset.summary = message.summary.source;
    var body = el.querySelector(".body");
    var summary = document.createElement("div");
    summary.className = "summary" + (message.summary.pending ? " pending" : "");
    summary.innerHTML = message.summary.html;
    el.insertBefore(summary, body);
    if (message.compare) {
      var compare = document.createElement("div");
      compare.className = "compare" + (message.compare.pending ? " pending" : "");
      compare.innerHTML = message.compare.html;
      el.insertBefore(compare, body);
    }
    var more = document.createElement("button");
    more.type = "button";
    more.className = "more";
    more.textContent = el.classList.contains("open") ? "less" : "more";
    more.setAttribute("aria-expanded", el.classList.contains("open") ? "true" : "false");
    more.addEventListener("click", function () {
      var open = el.classList.toggle("open");
      more.textContent = open ? "less" : "more";
      more.setAttribute("aria-expanded", open ? "true" : "false");
    });
    el.insertBefore(more, body);
  }
  function shots(urls) {
    var row = document.createElement("div");
    row.className = "shots";
    urls.forEach(function (url) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "shot";
      button.setAttribute("aria-label", "Open image");
      var img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = url;
      button.appendChild(img);
      button.addEventListener("click", function () { openImage(url); });
      row.appendChild(button);
    });
    return row;
  }
  var lightbox = document.getElementById("lightbox");
  function openImage(url) {
    document.getElementById("lightbox-img").src = url;
    lightbox.hidden = false;
  }
  lightbox.addEventListener("click", function () { lightbox.hidden = true; });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") lightbox.hidden = true; });

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
    if (update.context) { usage.context = update.context; renderUsage(); }
    lastActivity = update.lastActivity || lastActivity;
    refreshWorking();
    if (lastActivity) whenEl.textContent = dayOf(lastActivity) + "  " + clock(lastActivity);
    if (stick) { toBottom(); jump.hidden = true; } else if (added) { jump.hidden = false; }
    first = false;
  }

  // Under the message box: how full the context is, and the plan's limits.
  var usageEl = document.getElementById("usage");
  var usage = { context: null, plan: null };
  function compact(n) {
    return n >= 1000000 ? (Math.round(n / 100000) / 10) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
  }
  function renderUsage() {
    var parts = [];
    if (usage.context) {
      var c = usage.context;
      parts.push("context " + Math.round((c.tokens / c.window) * 100) + "% · " + compact(c.tokens) + " of " + compact(c.window));
    }
    if (usage.plan) {
      usage.plan.windows.forEach(function (w) {
        parts.push(w.label + " " + Math.round(w.percentRemaining) + "% left" + (w.resetsAt ? ", resets " + dayOf(w.resetsAt) + " " + clock(w.resetsAt) : ""));
      });
    }
    usageEl.textContent = parts.join("   ·   ");
  }
  function loadPlan() {
    fetch("/api/plan").then(function (r) { return r.json(); }).then(function (data) { usage.plan = data.plan; renderUsage(); }).catch(function () {});
  }
  loadPlan();
  setInterval(loadPlan, 60000);

  function reset() {
    nodes.forEach(function (el) { el.remove(); });
    nodes.clear();
    usage.context = null;
    renderUsage();
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
  var attachmentsEl = document.getElementById("attachments");
  var attachments = [];
  var MAX_ATTACHMENTS = 4;
  function grow() {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
    sendBtn.disabled = !input.value.trim() && attachments.length === 0;
  }
  function renderAttachments() {
    attachmentsEl.textContent = "";
    attachments.forEach(function (attachment, index) {
      var item = document.createElement("div");
      item.className = "attachment";
      var img = document.createElement("img");
      img.src = attachment.url;
      img.alt = "";
      item.appendChild(img);
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove image");
      remove.addEventListener("click", function () { attachments.splice(index, 1); renderAttachments(); });
      item.appendChild(remove);
      attachmentsEl.appendChild(item);
    });
    attachmentsEl.hidden = attachments.length === 0;
    grow();
  }
  function addImages(files) {
    Array.prototype.forEach.call(files, function (file) {
      if (!file || file.type.indexOf("image/") !== 0 || attachments.length >= MAX_ATTACHMENTS) return;
      var reader = new FileReader();
      reader.onload = function () {
        var url = String(reader.result);
        if (attachments.length >= MAX_ATTACHMENTS) return;
        attachments.push({ url: url, mediaType: file.type, data: url.slice(url.indexOf(",") + 1) });
        renderAttachments();
      };
      reader.readAsDataURL(file);
    });
  }
  input.addEventListener("paste", function (event) {
    var files = Array.prototype.map.call((event.clipboardData && event.clipboardData.items) || [], function (item) {
      return item.kind === "file" ? item.getAsFile() : null;
    }).filter(function (file) { return file && file.type.indexOf("image/") === 0; });
    if (!files.length) return;
    event.preventDefault();
    addImages(files);
  });
  // Images can be dropped anywhere on the page; a stray drop never navigates away.
  document.addEventListener("dragover", function (event) {
    if (composer.hidden) return;
    event.preventDefault();
    composer.classList.add("dropping");
  });
  document.addEventListener("dragleave", function (event) {
    if (!event.relatedTarget) composer.classList.remove("dropping");
  });
  document.addEventListener("drop", function (event) {
    if (composer.hidden) return;
    event.preventDefault();
    composer.classList.remove("dropping");
    if (event.dataTransfer) addImages(event.dataTransfer.files);
  });
  input.addEventListener("input", grow);
  // Terminal-style history: Up on the first line recalls earlier messages,
  // newest first; Down walks back and finally restores the draft.
  var recall = { list: [], index: -1, draft: "" };
  function captainHistory() {
    var list = [];
    main.querySelectorAll(".msg.user .body").forEach(function (body) {
      var text = (body.innerText || body.textContent || "").trim();
      if (text && text !== list[list.length - 1]) list.push(text);
    });
    return list;
  }
  function setRecalled(text) {
    input.value = text;
    grow();
    input.setSelectionRange(text.length, text.length);
  }
  // "/" at the start of the box: the assistant's skills and commands.
  var commandsEl = document.getElementById("commands");
  var commandList = null;
  var commandMatches = [];
  var commandIndex = 0;
  function loadCommands() {
    if (commandList) return Promise.resolve(commandList);
    return fetch("/api/commands").then(function (r) { return r.json(); }).then(function (data) {
      commandList = data.commands || [];
      return commandList;
    }).catch(function () { return []; });
  }
  function closeCommands() {
    commandsEl.hidden = true;
    commandMatches = [];
  }
  function renderCommands() {
    commandsEl.textContent = "";
    if (!commandMatches.length) {
      var none = document.createElement("li");
      none.className = "none";
      none.textContent = "No skill or command matches " + input.value;
      commandsEl.appendChild(none);
      return;
    }
    commandMatches.forEach(function (command, index) {
      var item = document.createElement("li");
      item.setAttribute("role", "option");
      item.className = index === commandIndex ? "selected" : "";
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = "/" + command.name;
      var about = document.createElement("span");
      about.className = "about";
      about.textContent = command.description;
      item.appendChild(name);
      item.appendChild(about);
      item.addEventListener("mousedown", function (event) { event.preventDefault(); chooseCommand(index); });
      commandsEl.appendChild(item);
    });
    var selected = commandsEl.children[commandIndex];
    if (selected && selected.scrollIntoView) selected.scrollIntoView({ block: "nearest" });
  }
  function updateCommands() {
    var typed = /^\\/([\\w:.-]*)$/.exec(input.value);
    if (!typed) { closeCommands(); return; }
    var query = typed[1].toLowerCase();
    loadCommands().then(function (list) {
      if (!/^\\/([\\w:.-]*)$/.test(input.value)) return;
      var starts = list.filter(function (c) { return c.name.toLowerCase().indexOf(query) === 0; });
      var contains = list.filter(function (c) { return c.name.toLowerCase().indexOf(query) > 0; });
      commandMatches = starts.concat(contains).slice(0, 50);
      commandIndex = 0;
      commandsEl.hidden = false;
      renderCommands();
    });
  }
  function chooseCommand(index) {
    var command = commandMatches[index];
    if (!command) return;
    input.value = "/" + command.name + " ";
    closeCommands();
    grow();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  input.addEventListener("input", updateCommands);
  input.addEventListener("blur", function () { setTimeout(closeCommands, 150); });

  input.addEventListener("keydown", function (event) {
    if (event.isComposing) return;
    if (!commandsEl.hidden) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (commandMatches.length) {
          commandIndex = (commandIndex + (event.key === "ArrowDown" ? 1 : commandMatches.length - 1)) % commandMatches.length;
          renderCommands();
        }
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && commandMatches.length) {
        event.preventDefault();
        chooseCommand(commandIndex);
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); closeCommands(); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); return; }
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    var value = input.value;
    if (event.key === "ArrowUp") {
      var onFirstLine = value.lastIndexOf("\\n", input.selectionStart - 1) === -1;
      if (!onFirstLine) return;
      if (recall.index === -1) {
        recall.list = captainHistory();
        if (!recall.list.length) return;
        recall.draft = value;
        recall.index = recall.list.length;
      }
      if (recall.index === 0) { event.preventDefault(); return; }
      event.preventDefault();
      recall.index -= 1;
      setRecalled(recall.list[recall.index]);
    } else if (event.key === "ArrowDown") {
      if (recall.index === -1) return;
      var onLastLine = value.indexOf("\\n", input.selectionEnd) === -1;
      if (!onLastLine) return;
      event.preventDefault();
      recall.index += 1;
      if (recall.index >= recall.list.length) {
        recall.index = -1;
        setRecalled(recall.draft);
      } else {
        setRecalled(recall.list[recall.index]);
      }
    }
  });
  // Editing a recalled message makes it the draft.
  input.addEventListener("input", function () { recall.index = -1; });

  function pendingMessage(text, images) {
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
    if (text) body.appendChild(hl);
    el.appendChild(body);
    if (images.length) el.appendChild(shots(images.map(function (image) { return image.url; })));
    var state = document.createElement("span");
    state.className = "state";
    state.textContent = "sending…";
    el.appendChild(state);
    main.insertBefore(el, working);
    document.getElementById("empty").hidden = true;
    return el;
  }

  // A tiny electronic blip when a message goes out: synthesized, no file.
  var audio = null;
  function wakeAudio() {
    try {
      var Context = window.AudioContext || window.webkitAudioContext;
      if (!audio && Context) audio = new Context();
      if (audio && audio.state === "suspended") audio.resume();
    } catch (e) { audio = null; }
  }
  function blip() {
    if (!audio) return;
    try {
      var t = audio.currentTime;
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1500, t);
      osc.frequency.exponentialRampToValueAtTime(950, t + 0.07);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    } catch (e) { /* sound is a nicety */ }
  }

  function post(payload) {
    return fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json", "x-flyd-view-token": SEND_TOKEN },
      body: payload,
    }).then(function (response) {
      return response.json().then(function (data) { return { response: response, data: data }; });
    });
  }
  // After the view restarts, its token changes; an open tab fetches the new
  // one and tries once more.
  function deliver(payload, retry) {
    return post(payload).then(function (result) {
      if (result.response.status === 403 && retry) {
        return fetch("/api/token").then(function (r) { return r.json(); }).then(function (data) {
          if (!data.token) throw new Error(result.data.error || "not sent");
          SEND_TOKEN = data.token;
          return deliver(payload, false);
        });
      }
      if (!result.response.ok) throw new Error(result.data.error || "not sent");
      return result.data;
    });
  }

  // Push-to-talk from Flyd.app: the words appear in the box as they are
  // heard and go out on release like a typed message. Whatever was typed
  // before stays in front of them.
  var voiceBase = null;
  function joinVoice(text) {
    return voiceBase && voiceBase.trim() ? voiceBase.trimEnd() + " " + text : text;
  }
  function endVoice() {
    composer.classList.remove("listening", "transcribing");
    voiceBase = null;
  }
  window.flydVoice = {
    start: function () {
      if (composer.hidden) return;
      voiceBase = input.value;
      composer.classList.add("listening");
      composer.classList.remove("transcribing");
    },
    draft: function (text) {
      if (voiceBase === null) return;
      input.value = joinVoice(text);
      grow();
    },
    transcribing: function () {
      composer.classList.remove("listening");
      composer.classList.add("transcribing");
    },
    send: function (text) {
      if (voiceBase === null) voiceBase = input.value;
      input.value = joinVoice(text).trim();
      endVoice();
      grow();
      if (!input.value) return;
      // A window that was never shown may still be connecting: wait for the
      // session before sending, rather than dropping the message.
      var tries = 0;
      (function submitWhenReady() {
        if (current) { composer.requestSubmit(); return; }
        if (tries++ < 100) setTimeout(submitWhenReady, 200);
        else problem.textContent = "Not sent: the conversation did not load";
      })();
    },
    cancel: function (message) {
      if (voiceBase !== null) { input.value = voiceBase; grow(); }
      endVoice();
      if (message) problem.textContent = message;
    },
  };

  composer.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    var images = attachments.slice();
    if ((!text && !images.length) || !current) return;
    recall.index = -1;
    // Created inside the key press, as browsers require for audio.
    wakeAudio();
    var el = pendingMessage(text, images);
    input.value = "";
    attachments = [];
    renderAttachments();
    toBottom();
    var payload = JSON.stringify({
      session: current,
      text: text,
      images: images.map(function (image) { return { mediaType: image.mediaType, data: image.data }; }),
    });
    deliver(payload, true).then(function (sent) {
      blip();
      // Inside Flyd.app the notch island says "sent".
      try { window.webkit.messageHandlers.flyd.postMessage({ sent: true }); } catch (e) { /* in a browser */ }
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
      if (!input.value && !attachments.length) { input.value = text; attachments = images; renderAttachments(); }
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
  <button id="mode" type="button" aria-label="Switch between summaries and full replies">full</button>
  <button id="theme" type="button" aria-label="Toggle theme">light</button>
</header>
<main id="stream" aria-live="polite">
  <p class="empty" id="empty" hidden>Nothing said yet.</p>
  <div class="working" id="working" hidden aria-label="${label} is working"><i></i><i></i><i></i></div>
</main>
<button class="jump" id="jump" type="button" hidden>↓ new</button>
<div class="lightbox" id="lightbox" hidden role="dialog" aria-label="Image"><img id="lightbox-img" alt=""></div>
<div class="problem" id="problem"></div>
<form class="composer" id="composer" hidden autocomplete="off">
  <div class="row">
    <ul class="commands" id="commands" role="listbox" aria-label="Skills and commands" hidden></ul>
    <div class="attachments" id="attachments" hidden></div>
    <div class="field">
      <textarea id="input" rows="1" placeholder="Message ${label}" aria-label="Message ${label}"></textarea>
      <button id="send" type="submit" disabled aria-label="Send to ${label}">AHOY</button>
    </div>
    <div class="hint" id="usage"></div>
  </div>
</form>
<script>${SCRIPT}</script>
</body>
</html>`;
}

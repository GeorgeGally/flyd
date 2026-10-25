/** The page script's opening: shared state, preferences, theme and scroll keeping.
 * It opens the one IIFE the later parts run inside; script-show.ts closes it. */
// Core runs under tsx/esbuild with keepNames, so a function inlined with
// toString() can carry __name(...) calls; without this shim they throw and
// take the whole page script down.
export const CORE_SCRIPT = `
var __name = function (f) { return f; };
(function () {
  var main = document.getElementById("stream");
  var working = document.getElementById("working");
  var jump = document.getElementById("jump");
  var whenEl = document.getElementById("when");
  var conversationTitle = document.getElementById("conversation-title");
  var historyEl = document.getElementById("history");
  var historyList = document.getElementById("history-list");
  var themeBtn = document.getElementById("theme");
  var problem = document.getElementById("problem");
  var nodes = new Map();
  var source = null;
  var current = null;
  var drawnFrom = null;
  var explicit = new URLSearchParams(location.search).get("session") || (function () {
    var fresh = document.body.dataset.newSession;
    if (!fresh) return null;
    try {
      var kept = sessionStorage.getItem("flyd-window-session");
      if (kept) return kept;
      sessionStorage.setItem("flyd-window-session", fresh);
    } catch (_) {}
    return fresh;
  })();
  var railMobileDismissed = !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);
  var historyDrawn = "";
  var lastActivity = null;
  var isWorking = false;
  var first = true;
  var awaiting = new Set();
  var latestSession = null;
  var answersInSession = false;
  var warnings = new Map();
  var SEND_TOKEN = document.body.dataset.sendToken || "";
  var VIEW_TOKEN = SEND_TOKEN;
  var assistant = document.title || "the assistant";

  function store(key, value) {
    try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeBtn.setAttribute("aria-checked", String(theme === "light"));
    // Inside Flyd.app the window's title bar follows the page.
    try { window.webkit.messageHandlers.flyd.postMessage({ theme: theme }); } catch (e) { /* in a browser */ }
  }
  applyTheme(store("flyd-view-theme") === "dark" ? "dark" : "light");
  var modeBtn = document.getElementById("mode");
  // One switch, FULL: off is Flyd's reading of every reply, on is everything as it was written.
  function applyMode(mode) {
    document.documentElement.setAttribute("data-view", mode);
    modeBtn.setAttribute("aria-checked", String(mode === "full"));
  }
  applyMode(store("flyd-view-mode") === "full" ? "full" : "summary");
  modeBtn.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-view") === "full" ? "summary" : "full";
    store("flyd-view-mode", next);
    // The heights change everywhere: stay on the latest message, or on the one he was reading.
    keepPlace(function () { applyMode(next); });
  });
  document.getElementById("routine-suggestion").addEventListener("click", function (event) { event.preventDefault(); location.href = "/routines?session=" + encodeURIComponent(current || "latest"); });
  document.getElementById("preparation-link").addEventListener("click", function () { location.href = "/preparation?session=" + encodeURIComponent(current || "latest"); });
  document.getElementById("routines-link").addEventListener("click", function () { location.href = "/routines?session=" + encodeURIComponent(current || "latest"); });
  document.getElementById("taste-link").addEventListener("click", function () { location.href = "/taste?token=" + encodeURIComponent(VIEW_TOKEN); });
  themeBtn.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    store("flyd-view-theme", next);
    applyTheme(next);
  });
  // Preferences: a small panel under the header, closed by Escape or a click elsewhere.
  var prefs = document.getElementById("prefs");
  var prefsOpen = document.getElementById("prefs-open");
  function showPrefs(open) {
    prefs.hidden = !open;
    prefsOpen.setAttribute("aria-expanded", String(open));
  }
  prefsOpen.addEventListener("click", function () { showPrefs(prefs.hidden); });
  document.addEventListener("click", function (event) {
    if (!prefs.hidden && event.target instanceof Node && !prefs.contains(event.target) && !prefsOpen.contains(event.target)) showPrefs(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !prefs.hidden) { event.preventDefault(); showPrefs(false); prefsOpen.focus(); }
  });

  // The page the work is on, in the header for as long as there is one.
  var siteEl = document.getElementById("site");
  function renderSite(page) {
    siteEl.hidden = !page;
    if (!page) return;
    siteEl.href = page.url;
    siteEl.title = page.url;
    siteEl.className = "site " + (page.local ? "site--local" : "site--live");
    siteEl.setAttribute("aria-label", "Working on " + page.url + (page.local ? ", a local preview" : ", the live site"));
    document.getElementById("site-kind").textContent = page.local ? "local" : "live";
    document.getElementById("site-host").textContent = page.host;
    document.getElementById("site-path").textContent = page.label;
  }

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
  // Pinned: he is reading the latest message, so whatever changes keeps him
  // there. Only his own scrolling up unpins it.
  var pinned = true;
  function onConversation() { return document.documentElement.getAttribute("data-screen") !== "show" && !document.documentElement.hasAttribute("data-job"); }
  function toBottom() { pinned = true; window.scrollTo(0, document.documentElement.scrollHeight); }
  // The message at the top of the window and where it sits, so a change above
  // it cannot move what he is reading (WebKit has no scroll anchoring).
  function anchor() {
    var list = main.querySelectorAll(".msg");
    for (var i = 0; i < list.length; i += 1) {
      var box = list[i].getBoundingClientRect();
      if (box.height > 0 && box.bottom > 64) return { node: list[i], top: box.top };
    }
    return null;
  }
  function restore(at) {
    if (!at || !at.node.isConnected) return;
    var box = at.node.getBoundingClientRect();
    if (box.height > 0) window.scrollBy(0, box.top - at.top);
  }
  function keepPlace(change) {
    if (!onConversation()) { change(); return; }
    var wasPinned = pinned;
    var at = wasPinned ? null : anchor();
    change();
    if (wasPinned) toBottom(); else restore(at);
  }

`;

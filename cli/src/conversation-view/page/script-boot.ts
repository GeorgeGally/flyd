/**
 * The page script's last part: the small helpers every other part shares, then the
 * start: the view's token, the conversations, and the live stream. It closes the IIFE
 * script-core.ts opens.
 */
export const BOOT_SCRIPT = `
  function ago(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return "";
    var minutes = Math.round(ms / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.round(minutes / 60);
    return hours < 24 ? hours + "h ago" : Math.round(hours / 24) + "d ago";
  }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function withToken(src) { return src + (src.indexOf("?") < 0 ? "?" : "&") + "token=" + encodeURIComponent(VIEW_TOKEN); }
  // A lab page on disk opens through the window's file route, whose token sits in the path.
  function sentence(text) { text = String(text || "").trim(); return text && !/[.!?…:]$/.test(text) ? text + "." : text; }
  function capital(text) { text = String(text || ""); return text.charAt(0).toUpperCase() + text.slice(1); }

  // Words as compared for repeats: case, punctuation and spacing set aside.
  function wordsOf(text) { return String(text || "").toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, " ").trim(); }
  // What of this text has not been said yet on the card: each sentence once, whatever its case or
  // punctuation, and none that an earlier line already holds whole. What it keeps is added to said.
  function unsaid(text, said) {
    var parts = String(text || "").replace(/\\s+/g, " ").trim().split(/(?<=[.!?;])\\s+/);
    var whole = wordsOf(text);
    if (!whole) return "";
    var held = function (key) {
      return said.some(function (before) { return before === key || (key.length >= 12 && (" " + before + " ").indexOf(" " + key + " ") >= 0); });
    };
    if (held(whole)) return "";
    var kept = parts.filter(function (part) {
      var key = wordsOf(part);
      if (!key || held(key)) return false;
      said.push(key);
      return true;
    });
    if (kept.length) said.push(whole);
    return kept.join(" ");
  }


  var waitingForViewToken = !VIEW_TOKEN;
  (VIEW_TOKEN ? Promise.resolve({ token: VIEW_TOKEN }) : fetch("/api/token").then(function (r) { return r.json(); }))
    .then(function (data) {
      VIEW_TOKEN = data.token;
      if (waitingForViewToken && VIEW_TOKEN) { loadMachines(); if (centre === "news") loadWeather(); }
      return loadSessions();
    })
    .then(function () { connect(explicit); })
    .catch(function () { problem.textContent = "reconnecting…"; });
})();
`;

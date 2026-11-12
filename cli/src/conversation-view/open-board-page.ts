import { BASE_STYLE } from "./page/base-style.js";

// The page an "Open board" button opens: a calm line while Flyd makes sure
// Liesel is serving the board (starting it when it is down), then the board
// itself in this same tab. A board Liesel no longer knows, or a Liesel that
// would not start, is said plainly with one way forward.

export function renderOpenBoardPage(key: string, token: string): string {
  const data = JSON.stringify({ key, token }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opening the board</title>
<style>
${BASE_STYLE}
body { min-height: 100vh; display: grid; place-items: center; font-family: var(--sans); padding: 16px; }
main { display: grid; justify-items: center; gap: 18px; text-align: center; max-width: 360px; }
.spin { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--faint); border-top-color: var(--accent); animation: turn 900ms linear infinite; }
main.done .spin { display: none; }
h1 { margin: 0; font-size: 15px; font-weight: 500; color: var(--strong); letter-spacing: 0; }
p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted); min-height: 1.5em; }
a.retry { display: none; font-size: 13px; color: var(--link); text-decoration: none; }
main.failed a.retry { display: inline; }
@keyframes turn { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2400ms; } }
</style>
</head>
<body>
<main id="box" role="status" aria-live="polite">
  <div class="spin" aria-hidden="true"></div>
  <h1 id="head">One moment, opening the board</h1>
  <p id="line"></p>
  <a class="retry" id="retry" href="">Try again</a>
</main>
<script>
(function () {
  var data = ${data};
  try { if (localStorage.getItem("flyd-view-theme") === "dark") document.documentElement.setAttribute("data-theme", "dark"); } catch (e) {}
  var box = document.getElementById("box");
  var head = document.getElementById("head");
  var line = document.getElementById("line");
  document.getElementById("retry").href = location.pathname;
  var slow = setTimeout(function () { line.textContent = "Starting the board server. This takes a few seconds."; }, 1500);
  function say(title, words, state) {
    clearTimeout(slow);
    box.className = "done " + (state || "");
    head.textContent = title;
    line.textContent = words;
  }
  var loopback = /^(127\\.0\\.0\\.1|localhost|\\[::1\\])$/.test(location.hostname);
  fetch("/api/open-board?board=" + encodeURIComponent(data.key) + "&token=" + encodeURIComponent(data.token), { cache: "no-store" })
    .then(function (response) { return response.json(); })
    .then(function (answer) {
      if (answer.state === "ready") { location.replace(loopback ? answer.local : answer.public); return; }
      if (answer.state === "missing") { say("This board no longer exists", "Liesel doesn't have it any more, so there is nothing to open."); return; }
      say("The board didn't open", "The board server didn't start. Its log is in ~/.easel/server.log.", "failed");
    })
    .catch(function () { say("The board didn't open", "Flyd couldn't check on the board server.", "failed"); });
})();
</script>
</body>
</html>`;
}

// Flyd's left column: what Flyd itself is doing now and has done lately, as
// quiet cards. The page assembles these three strings into its own style,
// markup and script; the script runs inside the page's closure and borrows its
// el(), ago(), patch() and store().

/** Where the inline column starts to fit beside the chat and the right column. */
export const LEFT_INLINE_MIN = 1480;

export const LEFT_STYLE = `
/* The left column: what Flyd is doing, in the same quiet cards as the right. */
:root { --left-w: min(300px, 22vw); }
.left {
  position: fixed; top: 52px; left: 0; bottom: 0; width: var(--left-w); z-index: 6;
  display: flex; flex-direction: column; background: var(--bg);
  box-shadow: 18px 0 44px rgba(0, 0, 0, 0.22);
}
.left[hidden] { display: none; }
.left-hide {
  position: absolute; top: 10px; right: 10px; z-index: 1; font: 500 14px/1 var(--sans); color: var(--muted);
  background: transparent; border: 0; cursor: pointer; padding: 6px 8px; border-radius: 6px; transition: color 140ms ease;
}
.left-hide:hover { color: var(--fg); }
.left-hide:focus-visible, .left-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.left-tab { margin: 0; padding: 14px 20px 10px; font: 500 14px/1.2 var(--sans); color: var(--accent); }
.left-tab span { display: inline-block; padding-bottom: 6px; border-bottom: 1px solid var(--accent); }
.left-pane { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 20px 40px; }
.left-pane > section + section { margin-top: 28px; }
.left-label { margin: 0 0 12px; font: 600 14px/1.2 var(--sans); color: var(--muted); }
.left-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.left-card { display: block; min-width: 0; padding: 14px 16px 15px; border-radius: 12px; background: var(--tint); }
.left-card.is-now::before { content: ""; float: left; width: 6px; height: 6px; margin: 8px 8px 0 0; border-radius: 50%; background: var(--k-live); }
.left-title { margin: 0; font: 500 15px/1.45 var(--sans); color: var(--strong); overflow-wrap: anywhere; text-wrap: pretty; }
.left-line { margin: 4px 0 0; font: 400 14px/1.45 var(--sans); color: var(--fg); overflow-wrap: anywhere; text-wrap: pretty; }
.left-meta { display: block; margin-top: 8px; font: 400 13px/1.4 var(--sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.left-card.is-quiet .left-title { font-weight: 400; color: var(--muted); }
.left-more { margin: 14px 0 0; padding: 2px 0; border: 0; background: none; cursor: pointer; font: 500 13px/1.3 var(--sans); color: var(--muted); transition: color 140ms ease; }
.left-more:hover { color: var(--fg); }
.left-more[hidden] { display: none; }

/* Wide enough, the column sits beside the chat; the chat narrows to fit and otherwise stays centred between the two columns. */
@media (min-width: 1480px) {
  :root[data-left="inline"] main { margin-left: max(calc(var(--left-w) + 1.5em), calc(50% + var(--left-w) / 2 - 18.75em)); }
  :root[data-left="inline"] .composer .row { margin-left: max(calc(var(--left-w) + 1.875em), calc(50% + var(--left-w) / 2 - 23.4em)); margin-right: 0; }
  :root[data-left="inline"][data-rail="on"] main { margin-left: max(calc(var(--left-w) + 1.5em), calc(50% + (var(--left-w) - min(430px, 34vw)) / 2 - 18.75em)); }
  :root[data-left="inline"][data-rail="on"] .composer .row { margin-left: max(calc(var(--left-w) + 1.875em), calc(50% + (var(--left-w) - min(430px, 34vw)) / 2 - 23.4em)); margin-right: calc(min(430px, 34vw) + 1.875em); }
}
/* Narrower, it is a drawer over the chat, opened from the header; on a phone it is the screen. */
@media (max-width: 1479px) {
  .left { width: min(340px, 86vw); }
}
@media (max-width: 720px) {
  .left { width: 100vw; z-index: 7; }
  .left-tab { padding-right: 56px; }
}
`;

export const LEFT_BUTTON = `<button id="left-open" type="button" aria-pressed="false" aria-controls="left">activity</button>`;

export const LEFT_PREFERENCE = `<button id="left-toggle" type="button" role="switch" aria-checked="true"><span class="prefs-words"><span class="prefs-name">Activity column</span><span class="prefs-about">What Flyd is doing and has done</span></span><span class="track" aria-hidden="true"></span></button>`;

export const LEFT_HTML = `<aside class="left" id="left" hidden aria-label="What Flyd is doing">
  <button class="left-hide" id="left-hide" type="button" aria-label="Hide the column">✕</button>
  <h2 class="left-tab"><span>Activity</span></h2>
  <div class="left-pane">
    <section aria-label="Right now"><h3 class="left-label">Right now</h3><ul class="left-list" id="left-now"></ul></section>
    <section aria-label="Earlier"><h3 class="left-label">Earlier</h3><ul class="left-list" id="left-recent"></ul><button class="left-more" id="left-more" type="button" hidden></button></section>
  </div>
</aside>`;

export const LEFT_SCRIPT = `
  // The left column: Flyd's own activity. Open by default only where it fits beside the chat.
  var leftEl = document.getElementById("left");
  var leftNowEl = document.getElementById("left-now");
  var leftRecentEl = document.getElementById("left-recent");
  var leftMoreEl = document.getElementById("left-more");
  var leftOpenEl = document.getElementById("left-open");
  var leftToggleEl = document.getElementById("left-toggle");
  var leftWide = window.matchMedia ? window.matchMedia("(min-width: ${LEFT_INLINE_MIN}px)") : null;
  var leftPref = store("flyd-left");
  var leftPanel = null;
  var leftAll = false;
  var LEFT_FEW = 5;
  function leftIsOpen() { return leftPref === "on" || (leftPref !== "off" && !!leftWide && leftWide.matches); }
  function setLeft() {
    var on = !!leftPanel && leftIsOpen();
    document.documentElement.setAttribute("data-left", on ? (leftWide && leftWide.matches ? "inline" : "drawer") : "off");
    leftEl.hidden = !on;
    leftOpenEl.hidden = !leftPanel;
    leftOpenEl.setAttribute("aria-pressed", String(on));
    leftToggleEl.setAttribute("aria-checked", String(leftIsOpen()));
  }
  function chooseLeft(open) {
    leftPref = open ? "on" : "off";
    store("flyd-left", leftPref);
    setLeft();
  }
  function activityCard(item, live) {
    var card = el("li", "left-card" + (live ? " is-now" : ""));
    card.dataset.key = item.id + "|" + (live ? "now" : "done");
    card.appendChild(el("p", "left-title", item.title));
    if (item.line) card.appendChild(el("p", "left-line", item.line));
    card.appendChild(el("span", "left-meta", (live ? "Started " : "") + ago(item.at)));
    return card;
  }
  function drawActivity() {
    if (!leftPanel) return;
    var now = leftPanel.now || [];
    var recent = leftPanel.recent || [];
    var nowCards = now.map(function (item) { return activityCard(item, true); });
    if (!nowCards.length) {
      var quiet = el("li", "left-card is-quiet");
      quiet.dataset.key = "quiet|" + (recent.length ? recent[0].at : "");
      quiet.appendChild(el("p", "left-title", "Nothing under way right now."));
      if (recent.length) quiet.appendChild(el("span", "left-meta", "Last active " + ago(recent[0].at)));
      nowCards.push(quiet);
    }
    patch(leftNowEl, nowCards);
    var shown = leftAll ? recent : recent.slice(0, LEFT_FEW);
    patch(leftRecentEl, shown.map(function (item) { return activityCard(item, false); }));
    leftRecentEl.parentElement.hidden = !recent.length;
    leftMoreEl.hidden = recent.length <= LEFT_FEW;
    leftMoreEl.textContent = leftAll ? "Show fewer" : "Show " + (recent.length - LEFT_FEW) + " more";
  }
  function renderActivity(panel) {
    if (panel) leftPanel = panel;
    drawActivity();
    setLeft();
  }
  leftMoreEl.addEventListener("click", function () { leftAll = !leftAll; drawActivity(); });
  leftOpenEl.addEventListener("click", function () { chooseLeft(!leftIsOpen()); });
  leftToggleEl.addEventListener("click", function () { chooseLeft(!leftIsOpen()); });
  document.getElementById("left-hide").addEventListener("click", function () { chooseLeft(false); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !leftEl.hidden && document.documentElement.getAttribute("data-left") === "drawer" && prefs.hidden) chooseLeft(false);
  });
  if (leftWide && leftWide.addEventListener) leftWide.addEventListener("change", setLeft);
  // Times in the cards move on while nothing else does.
  setInterval(drawActivity, 60000);
  setLeft();
`;

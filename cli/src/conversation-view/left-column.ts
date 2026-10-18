// Flyd's left column: what Flyd itself is doing now and has done lately, as a
// wall of short visual cards — an icon for the kind of thing, a status chip, a
// line, and how long ago. The page assembles these three strings into its own
// style, markup and script; the script runs inside the page's closure and
// borrows its el(), ago(), patch() and store(), and the shared card system.

import { CARD_STYLE } from "./cards.js";

/** Where the column starts to open by itself: wide enough for it, the chat and the right column. */
export const LEFT_INLINE_MIN = 1480;

export const LEFT_STYLE = `
/* The left column: what Flyd is doing, in the same cards as the rest of the product. Open by default only where it fits beside the chat. */
:root { --left-w: min(320px, 23vw); }
.left {
  position: fixed; top: 52px; left: 0; bottom: 0; width: var(--left-w); z-index: 6;
  display: flex; flex-direction: column; background: var(--bg);
  box-shadow: 18px 0 44px rgba(0, 0, 0, 0.22);
}
.left[hidden] { display: none; }
.left-hide {
  position: absolute; top: 12px; right: 12px; z-index: 1; font: 500 14px/1 var(--sans); color: var(--muted);
  background: transparent; border: 0; cursor: pointer; padding: 7px 9px; border-radius: 7px; transition: color 140ms ease;
}
.left-hide:hover { color: var(--fg); }
.left-hide:focus-visible, .left-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.left-head { padding: 16px 20px 6px; }
.left-tab { margin: 0; font: 500 15px/1.2 var(--sans); color: var(--accent); }
.left-tab span { display: inline-block; padding-bottom: 6px; border-bottom: 1px solid var(--accent); }
.left-live { margin: 14px 0 0; font: 400 15px/1.4 var(--sans); color: var(--fg); }
.left-pane { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 20px 40px; }
.left-pane > section + section { margin-top: 30px; }
.left-label { margin: 0 0 14px; font: 600 14px/1.2 var(--sans); color: var(--muted); }
.left-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.left-week[hidden] { display: none; }
/* The earlier list runs down one hairline: a card's icon tile sits on it, and the line shows in the gaps between. */
.left-timeline { position: relative; }
.left-timeline::before { content: ""; position: absolute; left: 33px; top: 6px; bottom: 6px; width: 1px; background: var(--faint); }
.left-timeline > .left-card { position: relative; z-index: 1; }
.left-timeline .card-icon { box-shadow: 0 0 0 3px var(--tint); }
.left-card { background: var(--tint); }
.left-card.is-quiet .card-line { font-weight: 400; color: var(--muted); }
.left-timeline .left-card.is-quiet .card-icon { box-shadow: 0 0 0 3px var(--tint); }
.left-more { margin: 18px 0 0; padding: 4px 0; border: 0; background: none; cursor: pointer; font: 500 14px/1.3 var(--sans); color: var(--muted); transition: color 140ms ease; }
.left-more:hover { color: var(--fg); }
.left-more[hidden] { display: none; }

/* Open, the column takes its width off the chat, which narrows to fit and otherwise stays centred between the two columns; it never sits under it. */
@media (min-width: 721px) {
  :root[data-left="open"] main { margin-left: max(calc(var(--left-w) + 1.5em), calc(50% + var(--left-w) / 2 - 18.75em)); }
  :root[data-left="open"] .composer .row { margin-left: max(calc(var(--left-w) + 1.875em), calc(50% + var(--left-w) / 2 - 23.4em)); margin-right: 0; }
  :root[data-left="open"][data-rail="on"] main { margin-left: max(calc(var(--left-w) + 1.5em), calc(50% + (var(--left-w) - min(430px, 34vw)) / 2 - 18.75em)); }
  :root[data-left="open"][data-rail="on"] .composer .row { margin-left: max(calc(var(--left-w) + 1.875em), calc(50% + (var(--left-w) - min(430px, 34vw)) / 2 - 23.4em)); margin-right: calc(min(430px, 34vw) + 1.875em); }
}
/* On a phone it is the screen. */
@media (max-width: 720px) {
  .left { width: 100vw; z-index: 7; }
  .left-tab { padding-right: 56px; }
}
` + CARD_STYLE;

export const LEFT_BUTTON = `<button id="left-open" type="button" aria-pressed="false" aria-controls="left">activity</button>`;

export const LEFT_PREFERENCE = `<button id="left-toggle" type="button" role="switch" aria-checked="true"><span class="prefs-words"><span class="prefs-name">Activity column</span><span class="prefs-about">What Flyd is doing and has done</span></span><span class="track" aria-hidden="true"></span></button>`;

export const LEFT_HTML = `<aside class="left" id="left" hidden aria-label="What Flyd is doing">
  <button class="left-hide" id="left-hide" type="button" aria-label="Hide the column">✕</button>
  <div class="left-head">
    <h2 class="left-tab"><span>Activity</span></h2>
    <p class="left-live" id="left-live">Nothing under way.</p>
  </div>
  <div class="left-pane">
    <section class="left-week" id="left-week-section" aria-label="This week" hidden>
      <h3 class="left-label">This week</h3>
      <div class="mini-bars" id="left-week"></div>
    </section>
    <section aria-label="Right now"><h3 class="left-label">Right now</h3><ul class="left-list" id="left-now"></ul></section>
    <section aria-label="Earlier"><h3 class="left-label">Earlier</h3><ul class="left-list left-timeline" id="left-recent"></ul><button class="left-more" id="left-more" type="button" hidden></button></section>
  </div>
</aside>`;

export const LEFT_SCRIPT = `
  // The left column: Flyd's own activity. Open by default only where it fits beside the chat.
  var leftEl = document.getElementById("left");
  var leftNowEl = document.getElementById("left-now");
  var leftRecentEl = document.getElementById("left-recent");
  var leftMoreEl = document.getElementById("left-more");
  var leftLiveEl = document.getElementById("left-live");
  var leftWeekEl = document.getElementById("left-week");
  var leftWeekSection = document.getElementById("left-week-section");
  var leftOpenEl = document.getElementById("left-open");
  var leftToggleEl = document.getElementById("left-toggle");
  var leftWide = window.matchMedia ? window.matchMedia("(min-width: ${LEFT_INLINE_MIN}px)") : null;
  var leftPref = store("flyd-left");
  var leftPanel = null;
  var leftAll = false;
  // The cards he has opened to read their detail, kept across the column's own re-renders.
  var leftOpen = {};
  var LEFT_FEW = 5;
  function leftIsOpen() { return leftPref === "on" || (leftPref !== "off" && !!leftWide && leftWide.matches); }
  function setLeft() {
    var on = !!leftPanel && leftIsOpen();
    document.documentElement.setAttribute("data-left", on ? "open" : "off");
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
  // The week's little chart: a bar a day, straight on the column, the tallest day full height.
  function drawWeek(week) {
    if (!week || !week.length) { leftWeekSection.hidden = true; return; }
    leftWeekSection.hidden = false;
    var max = 1;
    week.forEach(function (day) { if (day.count > max) max = day.count; });
    var date = new Date();
    var today = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    patch(leftWeekEl, week.map(function (day) {
      var bar = el("i", day.day === today ? "today" : day.count ? "on" : "");
      bar.dataset.key = day.day;
      bar.style.height = (day.count ? Math.max(7, Math.round((day.count / max) * 36)) : 4) + "px";
      bar.title = day.day + ": " + day.count;
      return bar;
    }));
  }
  function activityKey(item, live) { return item.id + "|" + (live ? "now" : "done"); }
  function activityCard(item, live) {
    var key = activityKey(item, live);
    return visualCard(item, {
      className: "left-card" + (live ? " is-now" : ""),
      key: key,
      when: (live ? "Started " : "") + ago(item.at),
      whenClass: "left-meta",
      titleClass: "left-title",
      // Clicking a card opens what it did in full, and exactly when.
      detail: item.detail || "",
      detailWhen: item.at ? dayOf(item.at) + ", " + clock(item.at) : "",
      open: !!leftOpen[key],
      onToggle: function (open) { if (open) leftOpen[key] = 1; else delete leftOpen[key]; },
      dismiss: true,
      onHide: drawActivity,
    });
  }
  function quietCard(recent) {
    var last = recent[0];
    var key = "quiet|" + (last ? last.at : "");
    return visualCard({ kind: "clear", title: "Nothing under way right now." }, {
      className: "left-card is-quiet",
      key: key,
      when: last ? "Last active " + ago(last.at) : "",
      whenClass: "left-meta",
      titleClass: "left-title",
      // Its detail is the last thing Flyd did, and exactly when.
      detail: last ? last.title || "" : undefined,
      detailWhen: last && last.at ? dayOf(last.at) + ", " + clock(last.at) : "",
      open: !!leftOpen[key],
      onToggle: function (open) { if (open) leftOpen[key] = 1; else delete leftOpen[key]; },
    });
  }
  function drawActivity() {
    if (!leftPanel) return;
    var now = (leftPanel.now || []).filter(function (item) { return !cardGone(activityKey(item, true)); });
    var recent = (leftPanel.recent || []).filter(function (item) { return !cardGone(activityKey(item, false)); });
    leftLiveEl.textContent = now.length ? "Working on " + now.length + (now.length === 1 ? " thing." : " things.") : "Nothing under way.";
    drawWeek(leftPanel.week);
    var nowCards = now.map(function (item) { return activityCard(item, true); });
    if (!nowCards.length) nowCards.push(quietCard(recent));
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
    if (event.key !== "Escape") return;
    // An open card's detail closes first; only then does Escape take the column itself away.
    if (leftEl.querySelector(".card.is-open")) { leftOpen = {}; drawActivity(); return; }
    if (!leftEl.hidden && !(leftWide && leftWide.matches) && prefs.hidden) chooseLeft(false);
  });
  if (leftWide && leftWide.addEventListener) leftWide.addEventListener("change", setLeft);
  // Times in the cards move on while nothing else does.
  setInterval(drawActivity, 60000);
  setLeft();
`;

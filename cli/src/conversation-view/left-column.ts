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
.left-week[hidden], .left-semantic[hidden] { display: none; }
.left-semantic .scene-ask { margin-top: 10px; width: 100%; }
.left-semantic .scene-ask .choices { grid-template-columns: 1fr; gap: 6px; }
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
.left-card.is-open { background: color-mix(in srgb, var(--tint) 52%, var(--faint)); }

/* A card opened from the column: a page beside it with room to read, the column keeping its place with that card lit. */
:root { --sheet-w: min(430px, 30vw); }
.left-sheet { position: fixed; top: 52px; bottom: 0; left: var(--left-w); width: var(--sheet-w); z-index: 6; overflow-y: auto; padding: 30px 32px 48px; background: var(--bg); animation: card-in 200ms ease both; }
.left-sheet[hidden] { display: none; }
.left-sheet-top { display: flex; align-items: center; gap: 12px; padding-right: 44px; }
.left-sheet .card-icon, .left-sheet .card-meta { color: var(--tone, var(--muted)); }
.left-sheet .card-meta { flex: 1; }
.left-sheet-x { position: absolute; top: 28px; right: 24px; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: none; cursor: pointer; font: 400 16px/32px var(--sans); color: var(--muted); transition: color 140ms ease, background 140ms ease; }
.left-sheet-x:hover { color: var(--strong); background: var(--tint); }
.left-sheet-x:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.left-sheet-title { margin: 22px 0 0; font: 600 27px/1.2 var(--sans); letter-spacing: -0.02em; color: var(--strong); text-wrap: pretty; overflow-wrap: anywhere; }
.left-sheet-text { margin: 16px 0 0; font: 400 17px/1.55 var(--sans); color: var(--fg); text-wrap: pretty; overflow-wrap: anywhere; white-space: pre-line; }
.left-sheet-text[hidden], .left-sheet-when[hidden] { display: none; }
.left-sheet-when { margin: 24px 0 0; font: 500 13px/1.4 var(--sans); letter-spacing: 0.02em; color: var(--muted); font-variant-numeric: tabular-nums; }
.left-sheet .card-stories { margin-top: 24px; }

/* Open, the column takes its width off the chat, which narrows to fit and otherwise stays centred between the two columns; it never sits under it. */
@media (min-width: 721px) {
  :root[data-left="open"] main { margin-left: max(calc(var(--left-w) + 1.5em), calc(50% + var(--left-w) / 2 - 18.75em)); }
  :root[data-left="open"] .composer .row { margin-left: max(calc(var(--left-w) + 1.875em), calc(50% + var(--left-w) / 2 - 23.4em)); margin-right: 0; }
  :root[data-left="open"][data-rail="on"] main { margin-left: max(calc(var(--left-w) + 1.5em), calc(50% + (var(--left-w) - min(430px, 34vw)) / 2 - 18.75em)); }
  :root[data-left="open"][data-rail="on"] .composer .row { margin-left: max(calc(var(--left-w) + 1.875em), calc(50% + (var(--left-w) - min(430px, 34vw)) / 2 - 23.4em)); margin-right: calc(min(430px, 34vw) + 1.875em); }
  /* With a card open beside the column, the chat moves over for it too. */
  :root[data-left="open"][data-left-sheet="open"] main { margin-left: calc(var(--left-w) + var(--sheet-w) + 1.5em); }
  :root[data-left="open"][data-left-sheet="open"] .composer .row { margin-left: calc(var(--left-w) + var(--sheet-w) + 1.875em); }
}
/* On a phone it is the screen. */
@media (max-width: 720px) {
  .left { width: 100vw; z-index: 7; }
  .left-tab { padding-right: 56px; }
  .left-sheet { left: 0; width: 100vw; z-index: 8; padding: 26px 20px 40px; }
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
    <section class="left-semantic" id="left-semantic-section" aria-label="Tasks" hidden><h3 class="left-label">Tasks</h3><ul class="left-list" id="left-semantic"></ul></section>
    <section aria-label="Right now"><h3 class="left-label">Right now</h3><ul class="left-list" id="left-now"></ul></section>
    <section aria-label="Earlier"><h3 class="left-label">Earlier</h3><ul class="left-list left-timeline" id="left-recent"></ul><button class="left-more" id="left-more" type="button" hidden></button></section>
  </div>
</aside>
<section class="left-sheet" id="left-sheet" hidden aria-label="Activity detail">
  <button class="left-sheet-x" id="left-sheet-close" type="button" aria-label="Close">✕</button>
  <div class="left-sheet-top" id="left-sheet-top"></div>
  <h2 class="left-sheet-title" id="left-sheet-title"></h2>
  <p class="left-sheet-text" id="left-sheet-line" hidden></p>
  <p class="left-sheet-text" id="left-sheet-detail" hidden></p>
  <div id="left-sheet-extra"></div>
  <p class="left-sheet-when" id="left-sheet-when" hidden></p>
</section>`;

export const LEFT_SCRIPT = `
  // The left column: Flyd's own activity. Open by default only where it fits beside the chat.
  var leftEl = document.getElementById("left");
  var leftSemanticEl = document.getElementById("left-semantic");
  var leftSemanticSection = document.getElementById("left-semantic-section");
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
  // The card he has opened beside the column, kept across the column's own re-renders.
  var leftSheet = null;
  var leftSheetEl = document.getElementById("left-sheet");
  var TONE_COLOUR = { call: "var(--k-call)", live: "var(--k-live)", done: "var(--k-landed)", held: "var(--k-waiting)", ready: "var(--k-ready)", memory: "var(--accent)", quiet: "var(--muted)" };
  var LEFT_FEW = 5;
  function leftIsOpen() { return leftPref === "on" || (leftPref !== "off" && !!leftWide && leftWide.matches); }
  function setLeft() {
    var on = !!leftPanel && leftIsOpen();
    document.documentElement.setAttribute("data-left", on ? "open" : "off");
    leftEl.hidden = !on;
    leftOpenEl.hidden = !leftPanel;
    leftOpenEl.setAttribute("aria-pressed", String(on));
    leftToggleEl.setAttribute("aria-checked", String(leftIsOpen()));
    if (!on && leftSheet) closeSheet();
  }
  // The open card's page: what kind of thing it is and when, its title, everything it has to say.
  function drawSheet() {
    var s = leftSheet;
    leftSheetEl.hidden = !s;
    document.documentElement.setAttribute("data-left-sheet", s ? "open" : "off");
    if (!s) return;
    var v = kindOf(s.kind);
    leftSheetEl.style.setProperty("--tone", TONE_COLOUR[v.tone] || "var(--muted)");
    var top = document.getElementById("left-sheet-top");
    top.textContent = "";
    top.appendChild(cardIcon(s.kind));
    var chip = el("span", "card-meta", v.word || "");
    if (s.when) chip.appendChild(el("span", "card-when", s.when));
    top.appendChild(chip);
    document.getElementById("left-sheet-title").textContent = s.title || "";
    var line = document.getElementById("left-sheet-line");
    line.textContent = s.line || "";
    line.hidden = !s.line;
    var detail = document.getElementById("left-sheet-detail");
    detail.textContent = s.detail && s.detail !== s.line && s.detail !== s.title ? s.detail : "";
    detail.hidden = !detail.textContent;
    var extra = document.getElementById("left-sheet-extra");
    extra.textContent = "";
    var stories = storiesNode(s.stories);
    if (stories) extra.appendChild(stories);
    var whenEl = document.getElementById("left-sheet-when");
    whenEl.textContent = s.detailWhen || "";
    whenEl.hidden = !s.detailWhen;
  }
  function openSheet(info) {
    // Clicking the open card again puts it away.
    leftSheet = leftSheet && leftSheet.key === info.key ? null : info;
    drawSheet();
    drawActivity();
    if (leftSheet) leftSheetEl.scrollTop = 0;
  }
  function closeSheet() { leftSheet = null; drawSheet(); drawActivity(); }
  // What a card hands its page when he opens it.
  function sheetOpts(info) {
    return { open: !!leftSheet && leftSheet.key === info.key, onOpen: function () { openSheet(info); } };
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
  // The stories behind a news card: the headline as a link, a line of gist, and where it came from.
  function storiesNode(stories) {
    if (!stories || !stories.length) return undefined;
    var list = el("ul", "card-stories");
    stories.forEach(function (story) {
      var li = el("li", "");
      var a = el("a", "card-story-head", story.title);
      a.href = story.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.appendChild(a);
      if (story.gist) li.appendChild(el("p", "card-story-line", story.gist));
      if (story.source) li.appendChild(el("p", "card-story-src", story.source));
      list.appendChild(li);
    });
    return list;
  }
  function activityCard(item, live) {
    var key = activityKey(item, live);
    return visualCard(item, Object.assign({
      className: "left-card" + (live ? " is-now" : ""),
      key: key,
      when: (live ? "Started " : "") + ago(item.at),
      whenClass: "left-meta",
      titleClass: "left-title",
      // Clicking a card opens what it did in full, and exactly when.
      detail: item.detail || "",
      detailWhen: item.at ? dayOf(item.at) + ", " + clock(item.at) : "",
      extra: storiesNode(item.stories),
      dismiss: true,
      onHide: drawActivity,
    }, sheetOpts({ key: key, kind: item.kind, title: item.title, line: item.line, detail: item.detail, stories: item.stories, when: (live ? "Started " : "") + ago(item.at), detailWhen: item.at ? dayOf(item.at) + ", " + clock(item.at) : "" })));
  }
  function leftSemanticVisual(activity) {
    var phase = activity.activity && activity.activity.phase;
    return phase === "needs_you" ? "call"
      : phase === "paused" ? "waiting"
      : phase === "ready" ? "ready"
      : phase === "finished" ? "landed"
      : phase === "queued" ? "next"
      : "live";
  }
  function leftSemanticActivityCard(activity) {
    var phase = activity.activity && activity.activity.phase || "working";
    var visual = leftSemanticVisual(activity);
    var at = activity.activity && activity.activity.started || activity.updatedAt || activity.createdAt || "";
    // The semantic id is stable; the patch key includes phase so the card's
    // contents refresh in place when its state changes without duplicating it.
    var key = activity.id + "|semantic|" + phase;
    var when = phase === "working" && at ? "Started " + ago(at) : phase === "finished" && at ? ago(at) : "";
    var card = visualCard({
      kind: visual,
      title: activity.subject,
      line: activity.detail || activity.summary || "",
      at: at,
    }, Object.assign({
      className: "left-card semantic-activity",
      key: key,
      when: when,
      whenClass: "left-meta",
      titleClass: "left-title",
      detail: activity.detail || activity.summary || "",
      detailWhen: at ? dayOf(at) + ", " + clock(at) : "",
      dismiss: phase === "finished",
      onHide: drawActivity,
    }, sheetOpts({ key: key, kind: visual, title: activity.subject, line: activity.summary || "", detail: activity.detail || "", when: when, detailWhen: at ? dayOf(at) + ", " + clock(at) : "" })));
    card.dataset.semanticId = activity.id;
    card.dataset.phase = phase;
    if (activity.decision && phase === "needs_you" && VIEW_TOKEN) {
      // The question sits under the card's words, never beside them in the card's row.
      (card.querySelector(".card-text") || card).appendChild(sceneAsk({
        title: activity.subject,
        decision: {
          task: activity.decision.target || activity.source.task || activity.id,
          question: activity.decision.question,
          choices: activity.decision.alternatives || [],
          recommended: activity.decision.recommended,
          replyTo: activity.decision.replyTo,
        },
      }, "flyd-activity:" + activity.id + ":" + activity.decision.question));
    }
    return card;
  }
  function drawSemanticActivities(activities) {
    activities = (activities || []).filter(function (activity) {
      return !cardGone(activity.id + "|semantic|" + (activity.activity && activity.activity.phase || "working"));
    });
    leftSemanticSection.hidden = !activities.length;
    patch(leftSemanticEl, activities.map(leftSemanticActivityCard));
  }
  function quietCard(recent) {
    var last = recent[0];
    var key = "quiet|" + (last ? last.at : "");
    var when = last ? "Last active " + ago(last.at) : "";
    return visualCard({ kind: "clear", title: "Nothing under way right now." }, Object.assign({
      className: "left-card is-quiet",
      key: key,
      when: when,
      whenClass: "left-meta",
      titleClass: "left-title",
      // Its detail is the last thing Flyd did, and exactly when.
      detail: last ? last.title || "" : undefined,
      detailWhen: last && last.at ? dayOf(last.at) + ", " + clock(last.at) : "",
    }, sheetOpts({ key: key, kind: "clear", title: "Nothing under way right now.", detail: last ? "Last thing done: " + (last.title || "") : "", when: when, detailWhen: last && last.at ? dayOf(last.at) + ", " + clock(last.at) : "" })));
  }
  function drawActivity() {
    if (!leftPanel) return;
    var semantic = leftPanel.semantic || [];
    var semanticTasks = {};
    semantic.forEach(function (activity) { if (activity.source && activity.source.task) semanticTasks["job:" + activity.source.task] = true; });
    var now = (leftPanel.now || []).filter(function (item) { return !semanticTasks[item.id] && !cardGone(activityKey(item, true)); });
    var recent = (leftPanel.recent || []).filter(function (item) { return !semanticTasks[item.id] && !cardGone(activityKey(item, false)); });
    var moving = semantic.filter(function (activity) { return activity.activity && activity.activity.phase !== "finished"; }).length + now.length;
    leftLiveEl.textContent = moving ? "Working on " + moving + (moving === 1 ? " thing." : " things.") : "Nothing under way.";
    drawSemanticActivities(semantic);
    drawWeek(leftPanel.week);
    var nowCards = now.map(function (item) { return activityCard(item, true); });
    if (!nowCards.length) nowCards.push(quietCard(recent));
    patch(leftNowEl, nowCards);
    var shown = leftAll ? recent : recent.slice(0, LEFT_FEW);
    patch(leftRecentEl, shown.map(function (item) { return activityCard(item, false); }));
    leftRecentEl.parentElement.hidden = !recent.length;
    leftMoreEl.hidden = recent.length <= LEFT_FEW;
    leftMoreEl.textContent = leftAll ? "Show fewer" : "Show " + (recent.length - LEFT_FEW) + " more";
    // The open card has left the column: its page goes with it.
    if (leftSheet && !Array.prototype.some.call(leftEl.querySelectorAll(".left-card"), function (c) { return c.dataset.key === leftSheet.key; })) { leftSheet = null; drawSheet(); }
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
  document.getElementById("left-sheet-close").addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    // An open card's detail closes first; only then does Escape take the column itself away.
    if (leftSheet) { closeSheet(); return; }
    if (!leftEl.hidden && !(leftWide && leftWide.matches) && prefs.hidden) chooseLeft(false);
  });
  if (leftWide && leftWide.addEventListener) leftWide.addEventListener("change", setLeft);
  // Times in the cards move on while nothing else does.
  setInterval(drawActivity, 60000);
  setLeft();
`;

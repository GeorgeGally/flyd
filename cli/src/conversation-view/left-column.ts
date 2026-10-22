// Flyd's left column: what needs George — decisions and reviews. The page assembles these three strings into its own
// style, markup and script; the script runs inside the page's closure and
// borrows its el(), ago(), patch() and store(), and the shared card system.

import { CARD_STYLE } from "./cards.js";

/** Where the column starts to open by itself: wide enough for it, the chat and the right column. */
export const LEFT_INLINE_MIN = 1480;

export const LEFT_STYLE = `
/* The left column: what needs him, in the same cards as the rest of the product. Open by default only where it fits beside the chat, and always while something needs him. */
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
.left-hide:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.left-head { padding: 16px 20px 6px; }
.left-tab { margin: 0; font: 500 15px/1.2 var(--sans); color: var(--accent); }
.left-tab span { display: inline-block; padding-bottom: 6px; border-bottom: 1px solid var(--accent); }
.left-pane { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 20px 40px; }
.left-pane > section + section { margin-top: 30px; }
.left-list { display: grid; gap: 20px; margin: 0; padding: 0; list-style: none; }
.left-semantic[hidden] { display: none; }
.left-semantic .scene-ask { margin-top: 18px; width: 100%; }
.left-semantic .scene-ask .choices { grid-template-columns: 1fr; gap: 6px; }
.left-card { background: var(--tint); }
.left-semantic .card-line { margin-top: 0; font-size: 17px; }
.left-card.is-open { background: color-mix(in srgb, var(--tint) 52%, var(--faint)); }


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

export const LEFT_BUTTON = `<button id="left-open" type="button" aria-pressed="false" aria-controls="left">Needs you</button>`;

export const LEFT_PREFERENCE = `<button id="left-toggle" type="button" role="switch" aria-checked="true"><span class="prefs-words"><span class="prefs-name">Needs you</span><span class="prefs-about">Decisions and reviews</span></span><span class="track" aria-hidden="true"></span></button>`;

export const LEFT_HTML = `<aside class="left" id="left" hidden aria-label="What needs you">
  <button class="left-hide" id="left-hide" type="button" aria-label="Hide the column">✕</button>
  <div class="left-head">
    <h2 class="left-tab"><span>Needs you</span></h2>
  </div>
  <div class="left-pane">
    <section class="needs left-needs" id="needs" hidden aria-label="Needs you"></section>
    <section class="left-semantic" id="left-semantic-section" aria-label="Needs you" hidden><ul class="left-list" id="left-semantic"></ul></section>
  </div>
</aside>`;

export const LEFT_SCRIPT = `
  // The left column: what needs him. Open by default only where it fits beside the chat; there a new item opens it once by itself,
  // and the header button always counts what waits.
  var leftEl = document.getElementById("left");
  var leftSemanticEl = document.getElementById("left-semantic");
  var leftSemanticSection = document.getElementById("left-semantic-section");
  var leftHideEl = document.getElementById("left-hide");
  var leftOpenEl = document.getElementById("left-open");
  var leftToggleEl = document.getElementById("left-toggle");
  var leftWide = window.matchMedia ? window.matchMedia("(min-width: ${LEFT_INLINE_MIN}px)") : null;
  var leftPref = store("flyd-left");
  var leftPanel = null;
  var leftCallIds = [];
  var leftSeen = [];
  try { leftSeen = JSON.parse(store("flyd-left-seen") || "[]"); } catch (_) {}
  if (!Array.isArray(leftSeen)) leftSeen = [];
  // Opened by a new item on a wide window: for now only, never written over his choice.
  var leftAuto = false;
  // The card he is talking to Flyd about in the main chat, lit in the column.
  var leftAbout = null;
  function leftIsOpen() { return leftPref === "on" || (leftPref !== "off" && !!leftWide && leftWide.matches); }
  function leftShown() { return leftIsOpen() || (leftAuto && !!leftWide && leftWide.matches); }
  function leftNeedIds() {
    var ids = leftCallIds.slice();
    Array.prototype.forEach.call(leftSemanticEl.children, function (card) { if (card.dataset.semanticId) ids.push(card.dataset.semanticId); });
    return ids;
  }
  function setNeeds(ids) {
    leftCallIds = ids;
    setLeft();
  }
  function setLeft() {
    var ids = leftNeedIds();
    var fresh = ids.filter(function (id) { return leftSeen.indexOf(id) < 0; });
    if (fresh.length) {
      leftSeen = leftSeen.concat(fresh).slice(-300);
      store("flyd-left-seen", JSON.stringify(leftSeen));
      if (leftWide && leftWide.matches) leftAuto = true;
    }
    var on = ids.length > 0 && leftShown();
    document.documentElement.setAttribute("data-left", on ? "open" : "off");
    leftEl.hidden = !on;
    leftOpenEl.hidden = !ids.length;
    leftOpenEl.textContent = "Needs you" + (ids.length ? " · " + ids.length : "");
    leftOpenEl.setAttribute("aria-pressed", String(on));
    leftToggleEl.setAttribute("aria-checked", String(leftIsOpen()));
  }
  // Clicking a card takes it to the main chat: the message box says what it is about, and he talks there.
  function aboutCard(info) {
    if (leftAbout === info.key) { chatAbout(null); return; }
    chatAbout(Object.assign({ body: aboutBody(info) }, info), function () { leftAbout = null; drawActivity(); });
    leftAbout = info.key;
    drawActivity();
  }
  // Everything a card has to say, shown over the message box: its line, its full detail, exactly when.
  function aboutBody(info) {
    var box = el("div", "");
    if (info.line) box.appendChild(el("p", "about-text", info.line));
    if (info.detail && info.detail !== info.line && info.detail !== info.title) box.appendChild(el("p", "about-text", info.detail));
    // Its pictures (the designs a call asks him to pick between), each named, opening full size; then its links.
    var evidence = info.evidence || [];
    var pictures = evidence.filter(function (object) { return object.kind === "image" && !object.closed; });
    if (pictures.length) {
      var grid = el("div", "about-shots");
      pictures.forEach(function (picture) {
        var src = withToken(picture.ref);
        var shot = el("button", "about-shot");
        shot.type = "button";
        shot.setAttribute("aria-label", "Open " + (picture.label || "image"));
        var img = el("img", "");
        img.src = src;
        img.alt = "";
        img.loading = "lazy";
        shot.appendChild(img);
        if (picture.label) shot.appendChild(el("span", "about-shot-name", picture.label.replace(/\\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ")));
        shot.addEventListener("click", function () { openImage(src); });
        grid.appendChild(shot);
      });
      box.appendChild(grid);
    }
    evidence.filter(function (object) { return object.kind === "web" && !object.closed; }).forEach(function (link) {
      var a = el("a", "card-link", (link.label || "Open") + " ↗");
      a.href = link.ref;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      box.appendChild(a);
    });
    if (info.detailWhen) box.appendChild(el("p", "about-at", info.detailWhen));
    return box;
  }
  // What a card hands the chat when he clicks it.
  function chatOpts(info) {
    return { open: leftAbout === info.key, onOpen: function () { aboutCard(info); } };
  }
  function chooseLeft(open) {
    leftAuto = false;
    leftPref = open ? "on" : "off";
    store("flyd-left", leftPref);
    setLeft();
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
  // Only decisions and reviews belong in his column. Work stalled inside the fleet belongs to Flyd.
  function leftActionable(activity) {
    var phase = activity.activity && activity.activity.phase;
    var decides = activity.kind === "decision" || phase === "needs_you" || !!activity.decision;
    return decides || phase === "ready";
  }
  function leftSemanticActivityCard(activity) {
    var phase = activity.activity && activity.activity.phase || "working";
    var visual = leftSemanticVisual(activity);
    var at = activity.activity && activity.activity.started || activity.updatedAt || activity.createdAt || "";
    // The semantic id is stable; the patch key includes phase so the card's
    // contents refresh in place when its state changes without duplicating it.
    var key = activity.id + "|semantic|" + phase;
    var when = phase === "working" && at ? "Started " + ago(at) : phase === "finished" && at ? ago(at) : "";
    var open = phase === "ready" ? (activity.evidence || []).find(function (object) { return object.kind === "web" && !object.closed; }) : null;
    var card = visualCard({
      kind: visual,
      title: phase === "ready" ? "Review: " + activity.subject : activity.subject,
      line: activity.detail || activity.summary || "",
      at: at,
      url: open ? open.ref : "",
    }, Object.assign({
      className: "left-card semantic-activity",
      key: key,
      when: when,
      whenClass: "left-meta",
      titleClass: "left-title",
      // The card is its title; everything else shows over the message box when he clicks it.
      line: "",
      detail: activity.detail || activity.summary || "",
      detailWhen: at ? dayOf(at) + ", " + clock(at) : "",
      dismiss: phase === "finished",
      onHide: drawActivity,
      chat: true,
    }, chatOpts({ key: key, kind: visual, title: activity.subject, when: when, line: activity.summary || "", detail: activity.decision && phase === "needs_you" ? activity.decision.question : activity.detail || "", evidence: activity.evidence, detailWhen: at ? dayOf(at) + ", " + clock(at) : "" })));
    card.querySelectorAll(".card-icon, .card-meta").forEach(function (node) { node.remove(); });
    // A decision or a result carries its picture beside the words when it has one.
    var picture = (activity.evidence || []).find(function (object) { return object.kind === "image" && !object.closed; });
    if (picture) {
      var thumb = el("button", "card-thumb");
      thumb.type = "button";
      thumb.setAttribute("aria-label", "Open " + (picture.label || "image"));
      var img = el("img");
      img.src = withToken(picture.ref);
      img.alt = "";
      img.loading = "lazy";
      thumb.appendChild(img);
      thumb.addEventListener("click", function (event) {
        event.stopPropagation();
        openImage(withToken(picture.ref));
      });
      card.appendChild(thumb);
    }
    card.dataset.semanticId = activity.id;
    card.dataset.phase = phase;
    return card;
  }
  function drawSemanticActivities(activities) {
    activities = (activities || []).filter(function (activity) {
      return !cardGone(activity.id + "|semantic|" + (activity.activity && activity.activity.phase || "working"));
    });
    leftSemanticSection.hidden = !activities.length;
    patch(leftSemanticEl, activities.map(leftSemanticActivityCard));
  }
  function drawActivity() {
    if (!leftPanel) return;
    drawSemanticActivities((leftPanel.semantic || []).filter(leftActionable));
  }
  function renderActivity(panel) {
    if (panel) leftPanel = panel;
    drawActivity();
    setLeft();
  }
  leftOpenEl.addEventListener("click", function () { chooseLeft(!leftShown()); });
  leftToggleEl.addEventListener("click", function () { chooseLeft(!leftIsOpen()); });
  leftHideEl.addEventListener("click", function () { chooseLeft(false); });
  // Heard last, on the window: an Escape that closed something else is not his word to put the column away.
  window.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // An open card's detail closes first; only then does Escape take the column itself away, never from a box he types in.
    if (leftAbout) { chatAbout(null); return; }
    var from = event.target;
    if (from && from.closest && from.closest("input, textarea, select, [contenteditable]")) return;
    if (!leftEl.hidden) chooseLeft(false);
  });
  if (leftWide && leftWide.addEventListener) leftWide.addEventListener("change", setLeft);
  // Times in the cards move on while nothing else does.
  setInterval(drawActivity, 60000);
  setLeft();
`;

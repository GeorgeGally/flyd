/**
 * The Artefacts view: Flyd on TV. One artefact at a time fills the screen, its picture big and its
 * headline big under it, with ← and → (or the arrow keys) to move between them. The Artefacts
 * switch at the top right (or Escape) flips back to the conversation, and the choice is remembered.
 * It draws the same artefacts the right column's Artefacts tab does, pictures first.
 */
export const SHOW_SCRIPT = `
  var tvEl = document.getElementById("tv");
  var tvFlip = document.getElementById("tv-flip");
  var tvStage = document.getElementById("tv-stage");
  var tvAt = 0;
  var tvDrawn = "";
  var TV_KEY = "flyd-view-tv";

  function tvOn() { return document.documentElement.getAttribute("data-tv") === "on"; }
  // A headline is short and clean: never a held question dumped whole. Its first sentence or clause,
  // any "Recommended: …" riding on it dropped, cut at a word under 64 characters.
  function tvHead(card) {
    var text = String(card.title || "").replace(/\\s+/g, " ").trim();
    text = text.replace(/\\s*\\(?(?:recommended|i recommend|recommend)[:\\s].*$/i, "");
    var first = text.split(/(?<=[.!?])\\s+|;\\s+|\\s+[—–-]\\s+(?=[A-Z])/)[0] || text;
    first = first.replace(/[\\s,:;.…]+$/, "");
    if (first.length > 64) first = first.slice(0, 64).replace(/\\s+\\S*$/, "") + "…";
    return first || card.label || "Untitled";
  }
  function tvCards() {
    var cards = artefactCards(lastArtefacts || []);
    return cards.filter(pictured).concat(cards.filter(function (card) { return !pictured(card); }));
  }
  function tvPicture(card) {
    if (card.image) {
      var img = el("img", "");
      img.src = ownSrc(card.image);
      img.alt = "";
      return img;
    }
    if (!pictured(card)) return null;
    // A page is laid out at its own width and scaled to fit, like a screenshot of it.
    var box = el("div", "tv-frame" + (card.phone ? " tv-phone" : ""));
    var frame = el("iframe", "");
    frame.src = card.preview;
    frame.tabIndex = -1;
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", card.title || "");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
    box.appendChild(frame);
    return box;
  }
  function tvDraw() {
    if (!tvOn()) return;
    var cards = tvCards();
    if (tvAt >= cards.length) tvAt = Math.max(0, cards.length - 1);
    var card = cards[tvAt];
    var key = JSON.stringify([card || null, tvAt, cards.length]);
    if (key === tvDrawn) return;
    tvDrawn = key;
    tvStage.textContent = "";
    if (!card) {
      tvStage.appendChild(el("p", "tv-empty", "Nothing made yet."));
      return;
    }
    var scene = el("article", "tv-scene");
    var pic = el("div", "tv-pic");
    var picture = tvPicture(card);
    if (picture) pic.appendChild(picture); else pic.classList.add("tv-nopic");
    scene.appendChild(pic);
    var words = el("div", "tv-words");
    var href = card.url && !card.down ? ownSrc(card.url) : "";
    var head = el(href ? "a" : "h1", "tv-head", tvHead(card));
    if (href) { head.href = href; head.target = "_blank"; head.rel = "noopener noreferrer"; }
    words.appendChild(head);
    var said = [];
    unsaid(tvHead(card), said);
    var line = unsaid(card.line, said);
    var meta = [line, card.at ? ago(card.at) : ""].filter(Boolean).join(" · ");
    if (meta) words.appendChild(el("p", "tv-line", meta));
    var nav = el("div", "tv-nav");
    var prev = el("button", "tv-step", "←");
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous artefact");
    prev.disabled = tvAt === 0;
    prev.addEventListener("click", function () { tvMove(-1); });
    var count = el("span", "tv-count", (tvAt + 1) + " of " + cards.length);
    var next = el("button", "tv-step", "→");
    next.type = "button";
    next.setAttribute("aria-label", "Next artefact");
    next.disabled = tvAt >= cards.length - 1;
    next.addEventListener("click", function () { tvMove(1); });
    nav.appendChild(prev); nav.appendChild(count); nav.appendChild(next);
    words.appendChild(nav);
    scene.appendChild(words);
    tvStage.appendChild(scene);
  }
  function tvMove(by) {
    var count = tvCards().length;
    tvAt = Math.min(Math.max(0, tvAt + by), Math.max(0, count - 1));
    tvDraw();
  }
  // The right column's artefacts changed: the view follows when it is up.
  function tvRedraw() { tvDraw(); }
  function tvSet(on) {
    document.documentElement.setAttribute("data-tv", on ? "on" : "off");
    tvEl.hidden = !on;
    tvFlip.setAttribute("aria-checked", String(on));
    store(TV_KEY, on ? "on" : "off");
    tvDrawn = "";
    tvDraw();
  }
  tvFlip.addEventListener("click", function () { tvSet(!tvOn()); });
  document.addEventListener("keydown", function (event) {
    if (!tvOn() || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !prefs.hidden || !lightbox.hidden) return;
    var from = event.target;
    if (from && from.closest && from.closest("input, textarea, select, [contenteditable]")) return;
    if (event.key === "Escape") { event.preventDefault(); tvSet(false); }
    else if (event.key === "ArrowRight") { event.preventDefault(); tvMove(1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); tvMove(-1); }
  });
  tvSet(store(TV_KEY) === "on");
`;

/** The artefact view (Flyd on TV), the screen switch, then the page's start-up. Closes the IIFE. */
export const SHOW_SCRIPT = `
  // Artefact view: Flyd on TV. Core's boxes become scenes that take turns,
  // one at a time like title cards: the work with pictures of it first (in a
  // browser and a phone), then the calls only he can make, what Flyd sees
  // coming, and the stories told in words. The instruments become one quiet
  // line under the stage. The
  // "artefact" switch (or Tab) flips between it and the conversation, and the
  // choice is remembered; the conversation keeps streaming underneath.
  var showEl = document.getElementById("show");
  var sceneEl = document.getElementById("scene");
  var sceneHead = document.getElementById("scene-head");
  var sceneLine = document.getElementById("scene-line");
  var sceneMeta = document.getElementById("scene-meta");
  var ticksEl = document.getElementById("ticks");
  var readoutsEl = document.getElementById("readouts");
  var showDoing = document.getElementById("show-doing");
  var air = document.getElementById("air");
  var flip = document.getElementById("flip");
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // What each kind is called on screen.
  var WORDS = { call: "needs you", live: "under way", ready: "waiting to land", landed: "landed", waiting: "held up", next: "up next", plan: "plan", news: "also", clear: "all clear", warn: "coming up" };
  // The screen is for showing the work: pictured stories lead, then his calls.
  var RANK = { pictured: 0, call: 1, note: 2, alert: 3, story: 4 };
  var DWELL = 9000;
  var scenes = [];
  var at = 0;
  var cycle = null;
  var holding = false;
  var filled = "";
  var drawnReadouts = "";
  var semanticGroups = {};
  var lastScreen = null;
  // Where the conversation was: the latest message unless he had scrolled up.
  var terminalAt = { pinned: true, anchor: null };

  function onShow() { return document.documentElement.getAttribute("data-screen") === "show"; }
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
  function sentence(text) { text = String(text || "").trim(); return text && !/[.!?…:]$/.test(text) ? text + "." : text; }
  function capital(text) { text = String(text || ""); return text.charAt(0).toUpperCase() + text.slice(1); }

  // Core's boxes, split: what holds the stage in turn, and the readouts under it.
  function split(boxes) {
    var stage = [];
    var readouts = [];
    function place(box) {
      if (box.kind === "group") { (box.children || []).forEach(place); return; }
      if (box.kind in RANK) stage.push(box); else if (box.kind !== "shot") readouts.push(box);
    }
    boxes.forEach(place);
    // A stable sort: the work with pictures, then calls, the situation, what is coming, the stories in words.
    function rank(box) { return box.kind === "story" && shotsOf(box).length ? RANK.pictured : RANK[box.kind]; }
    stage = stage.map(function (box, index) { return { box: box, index: index }; })
      .sort(function (a, b) { return (rank(a.box) - rank(b.box)) || (a.index - b.index); })
      .map(function (entry) { return entry.box; });
    return { stage: stage, readouts: readouts };
  }
  function kindWord(box) {
    if (box.status === "report available") return "earlier report";
    if (box.kind === "note") return box.why || "where things stand";
    if (box.tone === "news") return box.why || WORDS.news;
    return WORDS[box.kind === "alert" ? "warn" : box.tone] || box.why || "";
  }
  function shotsOf(box) {
    return (box.children || []).filter(function (child) { return child.kind === "shot" && child.shot; }).map(function (child) { return child.shot; });
  }

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

  // The pattern's body, drawn from the reviewed blocks the Screen team owns.
  // Anything already said in the headline or the line is not repeated: see unsaid().
  function screenBody(box, said) {
    var screen = box.screen;
    if (!screen || !screen.blocks || !screen.blocks.length) return null;
    if (!said) { said = []; unsaid(box.title, said); unsaid(box.line, said); }
    var wrap = el("div", "screen-body");
    var known = {};
    (box.links || []).forEach(function (link) { known[link.url] = true; });
    screen.blocks.forEach(function (block) {
      if (block.kind === "choices") return;
      if (block.kind === "question" || block.kind === "document" || block.kind === "recommendation" || block.kind === "operation") {
        var text = String(block.text || "").trim();
        if (!text) return;
        if (block.kind === "document") {
          // A document is prose laid out as written: kept whole, unless every word of it was already said.
          if (!unsaid(text, said.slice())) return;
          unsaid(text, said);
        } else {
          text = unsaid(text, said);
          if (!text) return;
        }
        if (block.kind === "recommendation") {
          var rec = el("p", "screen-rec");
          rec.appendChild(el("b", "", "Recommended"));
          rec.appendChild(document.createTextNode(" " + text));
          wrap.appendChild(rec);
          return;
        }
        if (block.kind === "operation") {
          var op = el("p", "screen-operation");
          op.appendChild(el("b", "", "Approve: "));
          op.appendChild(document.createTextNode(text));
          wrap.appendChild(op);
          return;
        }
        wrap.appendChild(el("p", block.kind === "question" ? "screen-question" : "screen-document", text));
        return;
      }
      if (block.kind === "findings") {
        var list = el("ul", "screen-findings");
        (block.items || []).forEach(function (finding) {
          var item = el("li", "");
          item.appendChild(el("h4", "", finding.heading));
          if (finding.summary) item.appendChild(el("p", "", finding.summary));
          if (finding.confidence) item.appendChild(el("span", "screen-confidence", finding.confidence + " confidence"));
          list.appendChild(item);
        });
        if (list.childNodes.length) wrap.appendChild(list);
        return;
      }
      if (block.kind === "comparison") {
        var table = el("table", "screen-comparison");
        var head = el("tr", "");
        head.appendChild(el("th", "", ""));
        (block.criteria || []).forEach(function (criterion) { head.appendChild(el("th", "", criterion)); });
        table.appendChild(head);
        (block.alternatives || []).forEach(function (alternative) {
          var row = el("tr", "");
          row.appendChild(el("th", "", alternative.name));
          (alternative.values || []).forEach(function (value) { row.appendChild(el("td", "", value)); });
          table.appendChild(row);
        });
        wrap.appendChild(table);
        return;
      }
      if (block.kind === "metrics") {
        var metrics = el("dl", "screen-metrics");
        (block.items || []).forEach(function (metric) {
          metrics.appendChild(el("dt", "", metric.label));
          metrics.appendChild(el("dd", "", metric.value));
        });
        if (metrics.childNodes.length) wrap.appendChild(metrics);
        return;
      }
      if (block.kind === "evidence") {
        (block.items || []).forEach(function (work) {
          if (work.closed || known[work.ref]) return;
          known[work.ref] = true;
          var a = el("a", "screen-evidence", (work.label || "Open") + " ↗");
          a.href = work.ref;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          wrap.appendChild(a);
        });
        return;
      }
    });
    return wrap.childNodes.length ? wrap : null;
  }

  function fillScene(box) {
    filled = JSON.stringify(box);
    var shots = shotsOf(box);
    var screen = box.screen;
    var below = !!(screen && screen.visual === "below");
    sceneEl.className = "scene k-" + (box.kind === "alert" ? "warn" : box.tone || "news") + (shots.length && !below ? " has-shot" : "") + (box.decision || (screen && screen.action && screen.action !== "none") ? " has-ask" : "");
    sceneEl.dataset.semantic = box.semanticKind || "";
    sceneEl.dataset.pattern = screen ? screen.pattern : "";
    if (sceneEl.dataset.id !== box.id) sceneEl.parentElement.scrollTop = 0;
    sceneEl.dataset.id = box.id;
    sceneHead.textContent = box.title;
    sceneHead.classList.toggle("long", box.title.length > 80);
    if (box.ref || box.semantic) {
      sceneHead.setAttribute("role", "button");
      sceneHead.tabIndex = 0;
      sceneHead.dataset.ref = box.ref || "";
      sceneHead.dataset.inline = box.semantic ? "1" : "";
      sceneHead.title = "Open in the conversation";
    } else {
      sceneHead.removeAttribute("role");
      sceneHead.removeAttribute("tabindex");
      sceneHead.removeAttribute("title");
      sceneHead.dataset.ref = "";
      sceneHead.dataset.inline = "";
    }
    var hasDocument = !!(screen && screen.blocks && screen.blocks.some(function (block) { return block.kind === "document"; }));
    // Each sentence once on the card: the headline, then only what the line adds, then only what the body adds.
    var said = [];
    unsaid(box.title, said);
    var line = !hasDocument ? unsaid(box.line, said) : "";
    sceneLine.textContent = line ? sentence(capital(line)) : "";
    var oldOpen = sceneEl.querySelector(".scene-open");
    if (oldOpen) oldOpen.remove();
    if (box.open) sceneLine.after(pageButton(box.open, "scene-open"));
    // The body the pattern promises, under the headline: the question, what was
    // found, the document itself, the operation being approved. The ask below
    // owns the interactive part, so choices are never drawn twice.
    var oldBody = sceneEl.querySelector(".screen-body");
    if (oldBody) oldBody.remove();
    var body = screenBody(box, said);
    if (body) sceneLine.after(body);
    // Every scene takes his words about it at its foot; a question's options answer it in one tap.
    var oldAsk = sceneEl.querySelector(".scene-ask");
    var askKey = askKeyFor(box);
    if (oldAsk && oldAsk.dataset.key !== askKey) oldAsk.remove();
    if (askKey && !(oldAsk && oldAsk.isConnected)) sceneEl.querySelector(".scene-text").appendChild(sceneAsk(box, askKey));
    sceneMeta.textContent = "";
    var word = kindWord(box);
    if (word) sceneMeta.appendChild(el("span", "kind", word));
    if (box.project) sceneMeta.appendChild(el("span", "project", box.project));
    if (box.status && box.status !== word) sceneMeta.appendChild(el("span", "status", box.status));
    (box.links || []).forEach(function (link) {
      // A page on this machine that stopped answering is said in words, never a dead link.
      if (link.closed) { sceneMeta.appendChild(el("span", "closed", "The review page for this has closed")); return; }
      var a = el("a", "", link.label);
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      sceneMeta.appendChild(a);
    });
    if (box.at) {
      var when = el("span", "ago", ago(box.at));
      when.dataset.at = box.at;
      sceneMeta.appendChild(when);
    }
    var old = sceneEl.querySelector(".scene-shot");
    if (old) old.remove();
    if (!shots.length) return;
    var figure = el("figure", "scene-shot");
    var stage = el("div", "devices");
    figure.appendChild(stage);
    var looks = shots.map(function (shot) { return { src: withToken(shot.src), label: shot.label, device: deviceOf(shot.label) }; });
    // What holds the stage: the desktop and phone captures as a pair, else the one chosen.
    var slots = { desk: null, phone: null, chosen: looks[0] };
    looks.forEach(function (look) { if (look.device === "desk" && !slots.desk) slots.desk = look; if (look.device === "phone" && !slots.phone) slots.phone = look; });
    function device(look) {
      var node = el("div", "device " + (look.device || "art"));
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", "Open " + look.label);
      if (look.device === "desk") { var bar = el("div", "bar"); bar.appendChild(el("i")); bar.appendChild(el("i")); bar.appendChild(el("i")); node.appendChild(bar); }
      var img = el("img");
      img.alt = "Screenshot: " + box.title;
      img.src = look.src;
      img.addEventListener("load", function () {
        // A capture without a device in its name is placed by its width once it loads.
        if (!look.device) {
          var shape = shapeOf(img.naturalWidth, img.naturalHeight);
          if (shape) { look.device = shape; if (shape === "phone" && !slots.phone) slots.phone = look; if (shape === "desk" && !slots.desk) slots.desk = look; place(); return; }
        }
        if (look.device) { img.dataset.aim = "1"; aimAtContent(img); }
      });
      node.appendChild(img);
      node.addEventListener("click", function () { openImage(look.src); });
      node.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openImage(look.src); } });
      return node;
    }
    function place() {
      var chosen = slots.chosen;
      var pair = slots.desk && slots.phone && (chosen === slots.desk || chosen === slots.phone);
      var shown = pair ? [slots.desk, slots.phone] : [chosen];
      var key = shown.map(function (look) { return look.src + "|" + (look.device || ""); }).join(" ");
      if (stage.dataset.key === key) return;
      stage.dataset.key = key;
      stage.className = "devices " + (pair ? "pair" : "one");
      stage.textContent = "";
      shown.forEach(function (look) { stage.appendChild(device(look)); });
    }
    place();
    if (looks.length > 1) {
      var thumbs = el("div", "thumbs");
      looks.forEach(function (look, index) {
        var thumb = el("img", index === 0 ? "on" : "");
        thumb.alt = look.label;
        thumb.tabIndex = 0;
        thumb.setAttribute("role", "button");
        thumb.src = look.src;
        // Rolling over a thumbnail brings it up (beside its partner device); a tap does the same on a phone.
        function choose() {
          if (look.device === "desk") slots.desk = look;
          if (look.device === "phone") slots.phone = look;
          slots.chosen = look;
          place();
          thumbs.querySelectorAll("img").forEach(function (other) { other.classList.toggle("on", other === thumb); });
        }
        thumb.addEventListener("mouseenter", choose);
        thumb.addEventListener("click", choose);
        thumb.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } });
        thumbs.appendChild(thumb);
      });
      figure.appendChild(thumbs);
    }
    sceneEl.appendChild(figure);
  }
  // A full-page capture taller than its frame shows from the top, as a device
  // would, unless the top is nearly empty (a form centred low on a tall page
  // left the browser frame a blank colour): then the frame moves down to the
  // stretch of the page with the most on it.
  function aimAtContent(img) {
    var frame = img.getBoundingClientRect();
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!frame.width || !frame.height || !w || !h) return;
    img.style.objectPosition = "";
    var seen = w * frame.height / frame.width;
    if (h <= seen * 1.05) return;
    var cols = 96, rows = Math.max(2, Math.min(600, Math.round(cols * h / w)));
    var pixels;
    try {
      var canvas = document.createElement("canvas");
      canvas.width = cols;
      canvas.height = rows;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, cols, rows);
      pixels = ctx.getImageData(0, 0, cols, rows).data;
    } catch (_) { return; }
    // How much is drawn on each row: the change in brightness from pixel to pixel.
    function lum(x, y) { var i = (y * cols + x) * 4; return pixels[i] * .3 + pixels[i + 1] * .59 + pixels[i + 2] * .11; }
    var busy = [];
    for (var y = 0; y < rows; y++) {
      var sum = 0;
      for (var x = 1; x < cols; x++) sum += Math.abs(lum(x, y) - lum(x - 1, y)) + (y ? Math.abs(lum(x, y) - lum(x, y - 1)) : 0);
      busy.push(sum);
    }
    var span = Math.max(1, Math.min(rows, Math.round(rows * seen / h)));
    var run = 0;
    for (var i = 0; i < span; i++) run += busy[i];
    var top = run, best = run, at = 0;
    for (var start = 1; start + span <= rows; start++) {
      run += busy[start + span - 1] - busy[start - 1];
      if (run > best) { best = run; at = start; }
    }
    // The top stays when it holds a fair share of what the page shows at its busiest.
    if (top >= best * 0.6 || rows === span) return;
    // A little of what is above it stays in view, so the content does not start at the frame's very edge.
    at = Math.max(0, at - Math.round(span * 0.06));
    img.style.objectPosition = "center " + (at / (rows - span) * 100).toFixed(1) + "%";
  }
  function aimShown() {
    if (onShow()) sceneEl.querySelectorAll(".device img[data-aim]").forEach(aimAtContent);
  }
  window.addEventListener("resize", aimShown);
  // What a capture was taken on, from its name: "desktop-1440.png", "phone.png", "ipad.png".
  // A name that names one screen settles it; a composite ("…-desktop-and-phone.png")
  // names more than one and keeps its own shape.
  function deviceOf(name) {
    name = String(name || "").toLowerCase();
    // A crop of the element a change touched keeps its own shape: it is a piece of the page, not a screen.
    if (/^element-/.test(name)) return "art";
    function width(list) { return new RegExp("(?:^|[^0-9])(?:" + list + ")(?:[^0-9]|$)").test(name); }
    var said = [];
    if (/phone|mobile|android/.test(name) || width("360|375|390|393|402|412|414|428|430")) said.push("phone");
    if (/ipad|tablet/.test(name) || width("768|810|820|834")) said.push("tablet");
    if (/desk|laptop|wide/.test(name) || width("1024|1080|1200|1280|1366|1440|1512|1536|1600|1680|1728|1920|2560")) said.push("desk");
    return said.length > 1 ? "art" : said[0] || "";
  }
  // Otherwise its own pixels say it: a phone-shaped portrait capture (under
  // 1400px wide, 1.8-2.4 times as tall as wide) is a phone shot at native
  // resolution; a taller one is a full-page capture, not a phone. Else at least
  // 1000px wide is a desktop capture, a portrait 380-560px wide (at least 1.6
  // times as tall as wide) a phone, and anything else keeps its own shape,
  // never a phone frame it is not.
  function shapeOf(w, h) {
    if (w && w < 1400 && h / w >= 1.8 && h / w <= 2.4) return "phone";
    if (w >= 1000) return "desk";
    if (w >= 380 && w <= 560 && h / w >= 1.6) return "phone";
    return "";
  }
  function markTicks() {
    Array.prototype.forEach.call(ticksEl.children, function (tick, index) {
      tick.classList.remove("on");
      tick.classList.toggle("held", holding);
      if (index === at) {
        void tick.offsetWidth;
        tick.classList.add("on");
      }
      tick.setAttribute("aria-current", index === at ? "true" : "false");
    });
  }
  function show(index, animate) {
    if (!scenes.length) return;
    at = (index + scenes.length) % scenes.length;
    var box = scenes[at];
    if (!animate || reduced || !onShow()) {
      sceneEl.classList.remove("out");
      fillScene(box);
      markTicks();
      return;
    }
    sceneEl.classList.remove("in");
    sceneEl.classList.add("out");
    setTimeout(function () {
      fillScene(box);
      sceneEl.classList.add("in");
      markTicks();
    }, 220);
  }
  function schedule() {
    clearInterval(cycle);
    cycle = null;
    if (scenes.length > 1 && !holding && !(document.activeElement && document.activeElement.closest(".scene-ask"))) cycle = setInterval(function () { if (lightbox.hidden && onShow()) show(at + 1, true); }, DWELL);
  }
  document.getElementById("show-prev").addEventListener("click", function () { holding = true; show(at - 1, true); schedule(); });
  document.getElementById("show-next").addEventListener("click", function () { holding = true; show(at + 1, true); schedule(); });
  function hold(on) {
    holding = on;
    markTicks();
    schedule();
  }
  sceneEl.addEventListener("mouseenter", function () { hold(true); });
  sceneEl.addEventListener("mouseleave", function () { hold(false); });
  sceneEl.addEventListener("focusin", function () { hold(true); });
  sceneEl.addEventListener("focusout", function (event) { if (!sceneEl.contains(event.relatedTarget)) hold(false); });
  ticksEl.addEventListener("mouseleave", function () { hold(false); });
  function openScene() {
    if (sceneHead.dataset.ref) { openInTerminal(sceneHead.dataset.ref); return; }
    if (sceneHead.dataset.inline) openInlineCard();
  }
  sceneHead.addEventListener("click", openScene);
  sceneHead.addEventListener("keydown", function (event) {
    if ((sceneHead.dataset.ref || sceneHead.dataset.inline) && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openScene(); }
  });
  function renderTicks() {
    ticksEl.textContent = "";
    ticksEl.hidden = scenes.length < 2;
    // One scene has nowhere to step to: no arrows that do nothing.
    document.getElementById("show-nav").hidden = scenes.length < 2;
    scenes.forEach(function (box, index) {
      var tick = el("button", "k-" + (box.kind === "alert" ? "warn" : box.tone || "news"));
      tick.type = "button";
      tick.setAttribute("aria-label", (kindWord(box) ? kindWord(box) + ": " : "") + box.title);
      tick.style.setProperty("--dwell", DWELL + "ms");
      // Hover, not click: resting on a line brings its scene up.
      function choose() { holding = true; if (index !== at) show(index, true); else markTicks(); schedule(); }
      tick.addEventListener("mouseenter", choose);
      tick.addEventListener("focus", choose);
      tick.addEventListener("click", choose);
      ticksEl.appendChild(tick);
    });
    markTicks();
  }

  // The numbers: one quiet line, each reading a few words with its figure.
  function drawReadout(box) {
    var node = el("span", "ro");
    node.dataset.id = box.id;
    if (box.id === "work-state" && box.bars) {
      box.bars.forEach(function (bar) { node.appendChild(readoutFigure(bar.value, bar.label, bar.tone)); });
      return node;
    }
    if (box.id === "landed-week" && lastScreen && lastScreen.landedWeek && lastScreen.landedWeek.length) {
      // The week's figure opens its own week's work, like every other state figure.
      var done = el("button", "ro-part k-landed ro-open");
      done.type = "button";
      done.setAttribute("aria-haspopup", "dialog");
      done.setAttribute("aria-controls", "drill");
      done.appendChild(el("b", "", box.title));
      done.addEventListener("click", function () { openDrill("landed", done); });
      node.appendChild(done);
      return node;
    }
    if (box.gauges && box.gauges.length) {
      box.gauges.forEach(function (gauge) {
        var part = el("span", "ro-part");
        if (gauge.resetsAt) part.title = "resets " + new Date(gauge.resetsAt).toLocaleString();
        part.appendChild(document.createTextNode("Claude " + gauge.label + " "));
        part.appendChild(el("b", "", gauge.used + "%"));
        part.appendChild(document.createTextNode(" used"));
        node.appendChild(part);
      });
      return node;
    }
    node.appendChild(el("b", "", box.title));
    if (box.line) node.appendChild(document.createTextNode(" " + box.line));
    return node;
  }
  // A figure that opens what it counts: "7 need you" opens its calls, each
  // answerable where it stands; every other state opens that group's own work.
  // A figure with nothing behind it stays the plain reading it was before.
  function readoutFigure(value, label, tone) {
    var opensCalls = tone === "call" && lastScreen && lastScreen.calls && lastScreen.calls.length;
    var group = DRILL[tone];
    var opens = !!opensCalls || !!(group && lastScreen && group.pick(lastScreen).length);
    var part = el(opens ? "button" : "span", "ro-part k-" + (tone || "news") + (opens ? " ro-open" : ""));
    part.appendChild(el("b", "", String(value)));
    part.appendChild(document.createTextNode(" " + label));
    if (opens) {
      part.type = "button";
      part.setAttribute("aria-haspopup", "dialog");
      part.setAttribute("aria-controls", opensCalls ? "calls" : "drill");
      part.addEventListener("click", function () {
        if (opensCalls) showCalls(true, part);
        else openDrill(tone, part);
      });
    }
    return part;
  }
  function flicker() {
    if (reduced) return;
    readoutsEl.querySelectorAll(".ro").forEach(function (node) {
      node.classList.remove("fade");
      void node.offsetWidth;
      node.classList.add("fade");
    });
  }
  function renderReadouts(readouts) {
    var key = JSON.stringify([readouts, !!(lastScreen && lastScreen.calls && lastScreen.calls.length)]);
    if (key === drawnReadouts) return;
    var first = drawnReadouts === "";
    drawnReadouts = key;
    readoutsEl.textContent = "";
    readouts.forEach(function (box) { readoutsEl.appendChild(drawReadout(box)); });
    if (!first && onShow()) flicker();
  }
  function renderDoing() {
    if (!lastScreen) return;
    showDoing.classList.toggle("on", !!lastScreen.live);
    showDoing.textContent = lastScreen.live ? lastScreen.doing || "" : "Standby" + (lastScreen.read ? ". Fleet read " + ago(lastScreen.read) : "");
  }
  function renderSemanticContext(screen) {
    var nav = document.getElementById("semantic-context");
    // The edge is rebuilt on every screen update; the button he was on keeps the
    // focus, and a rebuild that changed the counts is announced.
    var held = document.activeElement && nav.contains(document.activeElement) ? document.activeElement.dataset.group : "";
    var before = nav.dataset.counts || "";
    nav.textContent = "";
    var objects = (screen && screen.semantic) || [];
    var focus = screen && screen.focus;
    // The focus object is on the stage, not in the edge; everything else lands in
    // exactly one group, so nothing can vanish without being named.
    var rest = objects.filter(function (object) {
      return !(focus && object.id === focus.id);
    });
    semanticGroups = {};
    SEMANTIC_GROUPS.forEach(function (group) { semanticGroups[group.cls] = { group: group, items: [] }; });
    // The needs group is the one list the corner and the headline count also read,
    // so the three can never name different numbers.
    var needs = (screen && screen.needs) || [];
    var needIds = {};
    needs.forEach(function (object) { needIds[object.id] = true; });
    semanticGroups.needs.items = needs.slice();
    rest.forEach(function (object) {
      if (needIds[object.id]) return;
      semanticGroups[semanticGroup(object)].items.push(object);
    });
    var counts = [];
    SEMANTIC_GROUPS.forEach(function (group) {
      var items = semanticGroups[group.cls].items;
      if (!items.length) return;
      counts.push(items.length + " " + group.label);
      var button = el("button", group.cls, items.length + " " + group.label);
      button.type = "button";
      button.dataset.group = group.cls;
      button.setAttribute("aria-label", items.length + " " + group.label);
      button.title = items.map(function (object) { return object.subject; }).join("\\n");
      button.addEventListener("click", function () { openSemanticGroup(group, button); });
      nav.appendChild(button);
    });
    nav.dataset.counts = counts.join(", ");
    if (held) {
      var back = nav.querySelector('[data-group="' + held + '"]');
      if (back) back.focus();
    }
    // Meaningful changes are announced; an unchanged edge stays quiet.
    nav.setAttribute("aria-live", before !== nav.dataset.counts ? "polite" : "off");
  }

  // Every object lands in exactly one group: the edge can never hold work it does not name.
  function semanticGroup(object) {
    if (object.kind === "monitor") return object.monitor && object.monitor.phase === "changed" ? "needs" : "watching";
    if (object.lifecycle === "failed") return "failed";
    if (object.lifecycle === "resolved") return "landed";
    if (object.lifecycle === "interrupted") return "needs";
    if (object.kind === "artifact") return "landed";
    if (object.lifecycle === "active") return object.activity && object.activity.phase === "needs_you" ? "needs" : "working";
    return "held";
  }
  var SEMANTIC_GROUPS = [
    { cls: "needs", label: "needs you", tone: "call" },
    { cls: "working", label: "working", tone: "live" },
    { cls: "held", label: "held up", tone: "waiting" },
    { cls: "failed", label: "failed", tone: "warn" },
    { cls: "landed", label: "landed", tone: "landed" },
    { cls: "watching", label: "watching", tone: "live" },
  ];
  var CARD_KIND = {
    decision: "call", action: "call", activity: "live", investigation: "live",
    artifact: "landed", monitor: "watching", conversation: "noted",
  };
  function semanticRow(object) {
    return {
      id: object.id,
      kind: CARD_KIND[object.kind] || "noted",
      title: object.subject,
      line: object.summary,
      project: object.project || "",
      status: object.status || "",
      detail: object.detail || object.summary,
    };
  }

  function semanticBox(object) {
    if (!object) return null;
    var tone = { conversation: "news", activity: "live", decision: "call", investigation: "news", action: "ready", artifact: "landed", monitor: object.monitor && object.monitor.phase === "changed" ? "call" : "waiting" }[object.kind] || "news";
    var children = (object.evidence || []).filter(function (work) { return work.kind === "image"; }).map(function (work) {
      return { kind: "shot", shot: { src: work.ref, label: work.label || object.subject } };
    });
    var web = (object.evidence || []).find(function (work) { return work.kind === "web" && !work.closed; });
    var decision = object.decision ? {
      task: object.decision.target,
      decisionId: object.decision.decisionId,
      question: object.decision.question,
      choices: object.decision.alternatives || [],
      recommended: object.decision.recommended,
      replyTo: object.decision.replyTo,
    } : undefined;
    var actionNeedsApproval = object.kind === "action" && object.action && object.action.requiresApproval && object.lifecycle === "interrupted";
    if (actionNeedsApproval && !decision) {
      decision = {
        task: object.action.target || object.id,
        question: object.detail || object.summary || ("Approve " + object.subject + "?"),
        choices: ["Approve", "Revise"],
      };
    }
    var kindLine = object.kind === "monitor" && object.monitor
      ? object.monitor.phase === "changed" ? object.monitor.change || object.detail || object.summary : object.monitor.condition || object.summary
      : object.detail || object.summary;
    return {
      id: object.id,
      kind: object.kind === "decision" ? "call" : object.kind === "action" ? "story" : object.kind === "artifact" ? "story" : "note",
      tone: tone,
      title: object.subject,
      line: kindLine,
      why: object.kind,
      status: object.kind === "decision" && object.decision && object.decision.decisionId ? "" : object.status || (object.activity && object.activity.phase) || (object.action && object.action.phase) || (object.monitor && object.monitor.phase) || object.lifecycle,
      project: object.project,
      at: object.updatedAt || object.createdAt,
      ref: object.source && object.source.ref,
      task: object.source && object.source.task,
      decision: decision,
      open: web ? { label: web.label || "Open", url: web.ref } : undefined,
      links: (object.evidence || []).filter(function (work) { return work.kind === "web"; }).map(function (work) { return { label: work.label || "Open", url: work.ref, closed: work.closed }; }),
      children: children,
      semantic: true,
      semanticKind: object.kind,
      screen: object.screen,
    };
  }

  function askKeyFor(box) {
    var shots = shotsOf(box);
    var aboutWork = box.decision || box.task || box.ref || box.open || (box.links && box.links.length) || shots.length;
    if (!VIEW_TOKEN || !aboutWork) return "";
    return box.decision ? "flyd-decision:" + (box.decision.decisionId || box.decision.task) + ":" + box.decision.question : "flyd-about:" + box.id;
  }

  // The artefact lives in the conversation: the same reviewed pattern, drawn
  // where he reads, with its own visual beside the words when one exists.
  var inlineEl = document.getElementById("inline-screen");
  var inlineDrawn = "";
  var INLINE_KIND = { decision: "Needs you", ask: "Needs you", artefact: "Landed", result: "Result", status: "Under way", comparison: "Comparison", briefing: "Briefing", answer: "Answer" };
  function renderInlineScreen(show) {
    var object = show && show.focus;
    var box = object ? semanticBox(object) : null;
    var usable = box && box.screen && (box.screen.blocks.length || box.decision);
    var key = usable ? JSON.stringify([box.id, box.screen, box.title, box.line, box.decision, box.children]) : "";
    if (!usable) { inlineEl.hidden = true; inlineEl.textContent = ""; inlineDrawn = ""; return; }
    if (key === inlineDrawn) return;
    inlineDrawn = key;
    inlineEl.hidden = false;
    inlineEl.textContent = "";
    var card = el("div", "inline-card k-" + (box.tone || "news"));
    card.appendChild(el("p", "inline-kind", INLINE_KIND[box.screen.meaning] || "Flyd"));
    var head = el("h2", "inline-head", box.title);
    var main = el("div", "inline-main");
    var text = el("div", "inline-text");
    text.appendChild(head);
    // The card shows no line of its own: only the headline counts as said.
    var inlineSaid = [];
    unsaid(box.title, inlineSaid);
    var body = screenBody(box, inlineSaid);
    if (body) text.appendChild(body);
    var askKey = askKeyFor(box);
    if (askKey) text.appendChild(sceneAsk(box, askKey));
    main.appendChild(text);
    var shots = (box.children || []).filter(function (child) { return child.kind === "shot" && child.shot; });
    if (shots.length) {
      var gallery = el("div", "inline-shots");
      shots.slice(0, 3).forEach(function (child) {
        var src = withToken(child.shot.src);
        var img = el("img");
        img.src = src;
        img.alt = "Screenshot: " + box.title;
        img.addEventListener("click", function () { openImage(src); });
        gallery.appendChild(img);
      });
      main.appendChild(gallery);
      main.classList.add("has-shot");
    }
    card.appendChild(main);
    inlineEl.appendChild(card);
  }
  function openInlineCard() {
    setScreen("terminal");
    if (inlineEl.hidden) return;
    inlineEl.scrollIntoView({ block: "center" });
    var head = inlineEl.querySelector(".inline-head");
    if (!head) return;
    head.classList.remove("spot");
    void head.offsetWidth;
    head.classList.add("spot");
  }

  function renderShow(next, boxes) {
    lastScreen = next;
    air.classList.toggle("on", !!next.live);
    air.textContent = next.live ? "on air" : "standby";
    // Semantic focus owns the main stage. Legacy boxes remain the compatibility
    // source for readouts/drilldowns, but they no longer get to out-rank meaning.
    var focusBox = semanticBox(next.focus);
    var sourceBoxes = boxes && boxes.length ? boxes : [{ id: "situation", kind: "note", size: "wide", title: next.title, line: next.summary, why: "where things stand" }];
    var parts = split(sourceBoxes);
    showEl.classList.toggle("semantic-workspace", !!focusBox);
    // Semantic focus owns the main stage unless a call that settled is standing in it: the
    // list is accumulating, so a card he was looking at stays where it was and only work
    // that needs him leads over it.
    if (focusBox) {
      // The focus leads when it needs him; the rest of the semantic work and any
      // settled call follows it. Legacy presentation cards stay out of its way.
      // A finished artefact is never a scene of its own: it lives in the right column.
      var standing = parts.stage.filter(function (box) { return (box.tone === "clear" || box.semanticKind) && box.semanticKind !== "artifact"; });
      var needsHim = !!(next.focus && next.focus.lifecycle === "interrupted");
      parts.stage = needsHim ? [focusBox].concat(standing) : standing.concat([focusBox]);
      // The plan gauge is the one instrument worth keeping beside the counts: the
      // rest either repeat them (work-state, landed-week) or belong to the old stage.
      parts.readouts = parts.readouts.filter(function (box) { return box.id === "plan"; });
      renderSemanticContext(next);
    } else {
      document.getElementById("semantic-context").textContent = "";
    }
    var current = scenes[at] ? scenes[at].id : null;
    var sameSet = parts.stage.length === scenes.length && parts.stage.every(function (box, index) { return box.id === scenes[index].id; });
    scenes = parts.stage;
    if (!sameSet) {
      var keep = scenes.findIndex(function (box) { return box.id === current; });
      at = keep >= 0 ? keep : 0;
      renderTicks();
      schedule();
    }
    if (scenes.length && JSON.stringify(scenes[at]) !== filled) fillScene(scenes[at]);
    renderReadouts(parts.readouts);
    renderDoing();
    renderInlineScreen(next);
    // The artefact sits at the foot of the conversation, above the working dots.
    if (inlineEl.parentElement === main) main.insertBefore(inlineEl, working);
    if (!callsEl.hidden) drawCalls();
    if (!drillEl.hidden) drawDrill();
  }

  // What needs him, every one: a sheet over the artefact, each call with its question and a way to answer.
  var callsEl = document.getElementById("calls");
  var callsList = document.getElementById("calls-list");
  var callsFrom = null;
  var drawnCalls = "";
  function drawCalls() {
    var calls = (lastScreen && lastScreen.calls) || [];
    var key = JSON.stringify(calls);
    if (key === drawnCalls) return;
    drawnCalls = key;
    var open = {};
    callsList.querySelectorAll(".call").forEach(function (node) { open[node.dataset.id] = node.contains(document.activeElement); });
    document.getElementById("calls-title").textContent = calls.length === 1 ? "Your decision" : calls.length + " decisions for you";
    callsList.textContent = "";
    calls.forEach(function (call, index) {
      var item = el("li", "call");
      item.dataset.id = call.id;
      var meta = el("p", "call-meta");
      if (call.project) meta.appendChild(el("span", "", call.project));
      if (call.at) meta.appendChild(el("span", "", ago(call.at)));
      if (meta.childNodes.length) item.appendChild(meta);
      item.appendChild(el("h3", "call-head", call.headline));
      // Under the question, the work it is about when Flyd has put the question in plain words; else the question whole.
      var question = call.decision && call.decision.question;
      if (call.detail && call.detail !== call.headline) item.appendChild(el("p", "call-question", sentence(capital(call.detail))));
      else if (question && question !== call.headline) item.appendChild(el("p", "call-question", sentence(capital(question))));
      (call.links || []).forEach(function (link) {
        if (link.closed) { item.appendChild(el("p", "call-link closed", "The review page for this has closed")); return; }
        var a = el("a", "call-link", link.label + " ↗");
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        item.appendChild(a);
      });
      if (call.decision && VIEW_TOKEN) item.appendChild(sceneAsk({ title: call.headline, decision: call.decision }, "flyd-decision:" + (call.decision.decisionId || call.decision.task) + ":" + call.decision.question));
      callsList.appendChild(item);
    });
  }
  function showCalls(open, from) {
    if (open) { callsFrom = from || null; drawnCalls = ""; drawCalls(); }
    callsEl.hidden = !open;
    if (open) callsEl.querySelector(".calls-sheet").focus();
    else if (callsFrom && callsFrom.isConnected) callsFrom.focus();
  }
  document.getElementById("calls-close").addEventListener("click", function () { showCalls(false); });
  callsEl.addEventListener("click", function (event) { if (event.target === callsEl) showCalls(false); });
  document.addEventListener("keydown", function (event) {
    if (callsEl.isConnected && !event.defaultPrevented && event.key === "Escape" && !callsEl.hidden) { event.preventDefault(); showCalls(false); }
  });

  // A figure's own group, opened: every piece of work behind the number, one
  // plain line each, newest first, each unfolding its card detail where it stands.
  var drillEl = document.getElementById("drill");
  var drillSheet = drillEl.querySelector(".drill-sheet");
  var drillList = document.getElementById("drill-list");
  var drillTitle = document.getElementById("drill-title");
  var drillFrom = null;
  var drillKind = "";
  var drillSpec = null;
  var drawnDrill = "";
  var drillOpen = {};
  var DRILL = {
    landed: { title: "Landed", tone: "landed", pick: function (show) { return show.landedWeek || []; } },
    live: { title: "Under way", tone: "live", pick: function (show) { return show.underway || []; } },
    ready: { title: "To land", tone: "ready", pick: function (show) { return show.ready || []; } },
    waiting: { title: "Held up", tone: "waiting", pick: function (show) { return show.held || []; } },
    next: { title: "Queued", tone: "next", pick: function (show) { return show.next || []; } },
  };
  function drillWhen(item) { return item.at ? Date.parse(item.at) : 0; }
  function drillItem(item) {
    var key = item.id;
    // Where it stands, in a word or two: its state unless that only repeats the chip.
    var line = item.status && !/^(?:landed|done|queued|merged)$/i.test(item.status) ? item.status : (item.project || "");
    var open = item.links && item.links.length && !item.links[0].closed ? { url: item.links[0].url } : {};
    return visualCard(Object.assign({}, item, open), {
      kind: item.kind,
      className: "drill-card",
      key: key,
      line: line,
      when: item.at ? ago(item.at) : "",
      detail: item.detail || "",
      detailWhen: item.at ? dayOf(item.at) + ", " + clock(item.at) : "",
      linkLabel: "Open",
      open: !!drillOpen[key],
      onToggle: function (isOpen) { if (isOpen) drillOpen[key] = 1; else delete drillOpen[key]; },
    });
  }
  function drawDrill() {
    var group = drillSpec || DRILL[drillKind];
    if (!group || !lastScreen) return;
    var items = (group.rows ? group.rows() : group.pick(lastScreen)).slice().sort(function (a, b) { return drillWhen(b) - drillWhen(a); });
    var key = drillKind + "|" + JSON.stringify(items);
    if (key === drawnDrill) return;
    drawnDrill = key;
    drillSheet.className = "drill-sheet k-" + group.tone;
    drillTitle.textContent = group.title;
    drillList.textContent = "";
    if (!items.length) { drillList.appendChild(el("li", "drill-empty", "Nothing here right now.")); return; }
    items.forEach(function (item) { drillList.appendChild(drillItem(item)); });
  }
  function closeDrill() {
    drillEl.hidden = true;
    if (drillFrom && drillFrom.isConnected) drillFrom.focus();
    drillFrom = null;
  }
  function openDrill(kind, from, spec) {
    if (!spec && !DRILL[kind]) return;
    // Clicking the figure it is already showing closes it again.
    if (!drillEl.hidden && drillKind === kind) { closeDrill(); return; }
    drillKind = kind;
    drillSpec = spec || null;
    drillFrom = from || null;
    drillOpen = {};
    drawnDrill = "";
    drawDrill();
    drillEl.hidden = false;
    drillSheet.focus();
  }
  // The edge's own sheet: exactly the objects its number counted, newest first.
  function openSemanticGroup(group, from) {
    openDrill("semantic:" + group.cls, from, {
      title: capital(group.label),
      tone: group.tone,
      rows: function () {
        var held = semanticGroups[group.cls];
        return (held ? held.items : []).map(semanticRow);
      },
    });
  }
  document.getElementById("drill-close").addEventListener("click", closeDrill);
  drillEl.addEventListener("click", function (event) { if (event.target === drillEl) closeDrill(); });
  // A nested skill picker handles Escape before its sheet does.
  document.addEventListener("keydown", function (event) {
    if (drillEl.isConnected && !event.defaultPrevented && event.key === "Escape" && !drillEl.hidden) { event.preventDefault(); event.stopPropagation(); closeDrill(); }
  });
  setInterval(function () {
    sceneMeta.querySelectorAll(".ago").forEach(function (node) { node.textContent = ago(node.dataset.at); });
    renderDoing();
  }, 30000);

  function applyScreen(next, animate) {
    var root = document.documentElement;
    if (next === "show") {
      if (!onShow() && root.hasAttribute("data-screen")) terminalAt = { pinned: pinned, anchor: pinned ? null : anchor() };
      root.setAttribute("data-screen", "show");
      showEl.hidden = false;
      showEl.classList.remove("off");
      aimShown();
      if (animate && !reduced) {
        showEl.classList.remove("power");
        void showEl.offsetWidth;
        showEl.classList.add("power");
        if (scenes.length) { sceneEl.classList.remove("out"); sceneEl.classList.remove("in"); void sceneEl.offsetWidth; sceneEl.classList.add("in"); }
        flicker();
      }
      flip.setAttribute("aria-checked", "true");
    } else {
      var leavingArtefact = onShow();
      if (leavingArtefact) {
        showCalls(false);
        closeDrill();
        lightbox.hidden = true;
      }
      root.setAttribute("data-screen", "terminal");
      showEl.hidden = true;
      showEl.classList.remove("power", "off");
      if (terminalAt.pinned) { toBottom(); jump.hidden = true; } else { pinned = false; restore(terminalAt.anchor); }
      flip.setAttribute("aria-checked", "false");
      if (leavingArtefact && !composer.hidden) input.focus();
    }
  }
  function setScreen(next) {
    store("flyd-view-screen", next);
    if (next === "show") { applyScreen("show", true); return; }
    if (reduced) { applyScreen("terminal", false); return; }
    // The set switches off, then the conversation.
    showEl.classList.add("off");
    setTimeout(function () { if (showEl.classList.contains("off")) applyScreen("terminal", false); }, 170);
  }
  flip.addEventListener("click", function () {
    if (showEl.classList.contains("off")) return;
    setScreen(onShow() ? "terminal" : "show");
  });
  document.addEventListener("keydown", function (event) {
    if (!showEl.isConnected || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest(".scene-ask, .art-chat, .reply, .passage, .prefs, .calls, .rail-phone-say")) return;
    // Tab swaps between the conversation and the artefact, from anywhere. Left
    // alone while the "/" list or a typing suggestion has claimed the key.
    if (event.key === "Tab") {
      event.preventDefault();
      if (showEl.classList.contains("off")) return;
      setScreen(onShow() ? "terminal" : "show");
      return;
    }
    if (showEl.hidden || !lightbox.hidden) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      holding = true;
      show(at + (event.key === "ArrowRight" ? 1 : -1), true);
      schedule();
      return;
    }
    // Typing talks to Flyd: the conversation comes back with the message box, and the key lands in it.
    if (event.key.length === 1 && event.key !== " " && !composer.hidden) {
      // At once, not after the switch-off: a hidden box cannot take the key.
      store("flyd-view-screen", "terminal");
      applyScreen("terminal", false);
      input.focus();
    }
  });
  // A scene opens its message in the conversation.
  function openInTerminal(ref) {
    store("flyd-view-screen", "terminal");
    var target = ref ? nodes.get(ref) : null;
    terminalAt = { pinned: !target, anchor: null };
    applyScreen("terminal", false);
    if (!target) return;
    if (target.classList.contains("has-summary") && !target.classList.contains("open")) {
      var more = target.querySelector(":scope > .more");
      if (more) more.click();
    }
    pinned = false;
    target.scrollIntoView({ block: "center" });
    target.classList.remove("spot");
    void target.offsetWidth;
    target.classList.add("spot");
  }
  applyScreen(store("flyd-view-screen") === "show" ? "show" : "terminal", false);

  (VIEW_TOKEN ? Promise.resolve({ token: VIEW_TOKEN }) : fetch("/api/token").then(function (r) { return r.json(); }))
    .then(function (data) {
      VIEW_TOKEN = data.token;
      return loadSessions();
    })
    .then(function () { connect(explicit); })
    .catch(function () { problem.textContent = "reconnecting…"; });
})();
`;

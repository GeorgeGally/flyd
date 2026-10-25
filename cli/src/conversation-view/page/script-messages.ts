import { UNREAD_AFTER_MS } from "../note-receipts.js";

/** Drawing messages: bodies, receipts, staff cards, living lines and stream updates. */
export const MESSAGES_SCRIPT = `
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
    el.querySelectorAll(":scope > .shots, :scope > .reply-open-page").forEach(function (old) { old.remove(); });
    var oldDocs = el.querySelector(".docs");
    if (oldDocs) oldDocs.remove();
    if (message.files && message.files.length) body.after(docs(message.files));
    if (message.images && message.images.length) {
      body.after(shots(message.images.map(function (id) {
        return "/api/image?session=" + encodeURIComponent(current || "") + "&id=" + encodeURIComponent(id);
      })));
    }
    // The screenshot firstmate looked at leads its answer: under his words, before the outcome line.
    if (message.shots && message.shots.length) {
      var answerShots = shots(message.shots.map(withToken), "reply-shots");
      if (message.role === "user") body.after(answerShots); else body.before(answerShots);
    }
    // The page the answer changed opens from a button beside its picture.
    if (message.page) {
      var opener = pageButton(message.page, "reply-open-page");
      var after = el.querySelector(":scope > .reply-shots");
      if (message.role === "user") (after || body).after(opener); else body.before(opener);
    }
    pairing(el, message);
    var ref = el.querySelector(":scope > .reply-ref");
    if (ref) ref.remove();
    if (message.replyQuote) {
      ref = document.createElement("span");
      ref.className = "reply-ref";
      ref.textContent = "Replying to “" + message.replyQuote + "”";
      el.insertBefore(ref, body);
    }
    wireAuto(el, message, body.textContent.trim());
    wireReply(el, message);
    if (message.role === "assistant") {
      el.classList.toggle("routine", !!message.routine);
      // Something to act on (rules to paste, steps) shows whole until he folds it.
      if (message.expanded && !el.dataset.folded) el.classList.add("open");
      summarize(el, message);
      staffCard(el, message);
      wireAsks(body);
    }
    wireChoice(el, message);
    receipt(el, message);
    if (warnings.has(message.id)) showWarning(el, warnings.get(message.id));
  }
  // A note to firstmate says whether firstmate has read it: "sent", then "read by firstmate"; then the outcome
  // firstmate said in its own chat, on the same line in the same face.
  var UNREAD_AFTER_MS = ${UNREAD_AFTER_MS};
  function outcomeOf(message) { return message.role === "user" && message.settled && message.waiting ? message.waiting : ""; }
  function receipt(el, message) {
    var line = el.querySelector(":scope > .receipt");
    var outcome = outcomeOf(message);
    if (outcome) el.dataset.outcome = outcome; else delete el.dataset.outcome;
    if (!message.receipt && !outcome) { if (line) line.remove(); delete el.dataset.receipt; return; }
    if (!line) {
      line = document.createElement("span");
      line.className = "receipt";
    }
    // Right under his own words and attachments, above the screenshot and line of the answer.
    var own = el.querySelectorAll(":scope > .body, :scope > .docs, :scope > .shots:not(.reply-shots)");
    var mine = own[own.length - 1];
    if (mine.nextSibling !== line) mine.after(line);
    if (message.receipt) el.dataset.receipt = message.receipt; else delete el.dataset.receipt;
    el.dataset.note = message.id;
    receiptLine(el, line);
  }
  function receiptLine(el, line) {
    var outcome = el.dataset.outcome;
    line.classList.toggle("outcome", !!outcome);
    if (outcome) {
      line.classList.remove("late");
      if (line.dataset.line !== outcome) { line.dataset.line = outcome; linkLine(line, outcome); }
      return;
    }
    delete line.dataset.line;
    var read = el.dataset.receipt === "read";
    var age = el.dataset.ts ? Date.now() - new Date(el.dataset.ts).getTime() : 0;
    // A note firstmate answered was read, even if the acknowledgement never came.
    var answered = nodes.has("note-reply:" + (el.dataset.note || "").replace(/^note:/, ""));
    var late = !read && !answered && age > UNREAD_AFTER_MS;
    var text = read ? "read by firstmate" : late ? "sent · not read by firstmate yet" : "sent";
    if (line.textContent !== text) line.textContent = text;
    line.classList.toggle("late", late);
  }
  // A note crosses into unread as time passes, with nothing new on the stream.
  setInterval(function () {
    main.querySelectorAll(".msg > .receipt").forEach(function (line) { receiptLine(line.parentNode, line); });
  }, 15000);
  // Coding work Flyd found stuck and could not settle, said plainly over the message box.
  var staffEl = document.getElementById("staff");
  function showStaff(staff) {
    staffEl.hidden = !staff.text;
    staffEl.textContent = staff.text || "";
  }
  // A question waits for its own answer; firstmate's session lines are relayed updates. Once firstmate said the
  // outcome (it sits on the receipt line), the living line carries on only while work on this message does.
  function pairing(el, message) {
    var queued = el.querySelector(":scope > .queued");
    var line = outcomeOf(message) ? message.doing || "" : message.waiting;
    if (!line) { if (queued) queued.remove(); queued = null; }
    else if (!queued) {
      queued = document.createElement("span");
      queued.className = "queued";
      queued.setAttribute("role", "status");
      // Picks up where the optimistic copy's line left off: no jump.
      setLine(queued, carried.get(message.id) || line);
      carried.delete(message.id);
      el.appendChild(queued);
      living(queued, line);
    } else living(queued, line);
    if (queued) {
      queued.classList.toggle("still", !!message.waitingFailed);
      queued.classList.toggle("settled", false);
    }
    el.classList.toggle("answer", !!message.answers);
    el.classList.toggle("aside", !!message.aside);
    var label = el.querySelector(":scope > .aside-label");
    if (label) label.remove();
    if (message.aside) {
      label = document.createElement("span");
      label.className = "aside-label";
      label.textContent = "update";
      el.insertBefore(label, el.querySelector(".body"));
    }
  }
  // A relayed staff update is a compact card: a dot for what kind of news it is, one line, its link, its picture.
  var CARD_WORDS = { landed: "Done", decision: "Your call", blocker: "Stuck", underway: "Under way", note: "" };
  function linkWord(url) {
    return /\\/pull\\/\\d+/.test(url) ? "Open the change ↗" : url.replace(/^https?:\\/\\/(www\\.)?/, "").replace(/\\/$/, "") + " ↗";
  }
  // Several pieces of work in one reply: its opening line, then a compact card each, never paragraphs.
  var OUTCOME_WORDS = { landed: "Done", underway: "Under way", needs: "Your call", stuck: "Stuck", note: "", handled: "Handled" };
  function outcomeCards(outcomes) {
    var box = document.createElement("div");
    box.className = "outcomes";
    if (outcomes.lead) box.appendChild(Object.assign(document.createElement("p"), { className: "outcomes-lead", textContent: outcomes.lead }));
    outcomes.items.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "card card-compact card-" + item.state;
      var text = document.createElement("div");
      text.className = "card-text";
      if (OUTCOME_WORDS[item.state]) text.appendChild(Object.assign(document.createElement("span"), { className: "card-meta", textContent: OUTCOME_WORDS[item.state] }));
      text.appendChild(Object.assign(document.createElement("p"), { className: "card-line", textContent: item.title }));
      if (item.line) text.appendChild(Object.assign(document.createElement("p"), { className: "card-sub", textContent: item.line }));
      if (item.url) text.appendChild(Object.assign(document.createElement("a"), { className: "card-link", href: item.url, target: "_blank", rel: "noopener noreferrer", textContent: linkWord(item.url) }));
      card.appendChild(text);
      box.appendChild(card);
    });
    return box;
  }
  function staffCard(el, message) {
    var old = el.querySelector(":scope > .card, :scope > .outcomes");
    if (old) old.remove();
    el.classList.toggle("carded", !!(message.card || message.outcomes));
    el.classList.toggle("carded-decision", !message.outcomes && !!message.card && message.card.kind === "decision");
    if (message.outcomes) {
      el.insertBefore(outcomeCards(message.outcomes), el.querySelector(":scope > .summary") || el.querySelector(":scope > .body"));
      return;
    }
    if (!message.card) return;
    var box = document.createElement("div");
    box.className = "card card-" + message.card.kind;
    var text = document.createElement("div");
    text.className = "card-text";
    if (CARD_WORDS[message.card.kind]) text.appendChild(Object.assign(document.createElement("span"), { className: "card-meta", textContent: CARD_WORDS[message.card.kind] }));
    text.appendChild(Object.assign(document.createElement("p"), { className: "card-line", textContent: message.card.line }));
    if (message.card.sub) text.appendChild(Object.assign(document.createElement("p"), { className: "card-sub", textContent: message.card.sub }));
    if (message.card.url) {
      var link = Object.assign(document.createElement("a"), { className: "card-link", href: message.card.url, target: "_blank", rel: "noopener noreferrer", textContent: linkWord(message.card.url) });
      text.appendChild(link);
    }
    box.appendChild(text);
    // Its screenshot, small, beside the line: the picture says what changed.
    var shot = el.querySelector(":scope > .reply-shots");
    if (shot) { shot.classList.add("card-thumb"); box.appendChild(shot); }
    el.insertBefore(box, el.querySelector(":scope > .summary") || el.querySelector(":scope > .body"));
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
    // Flyd's whole reading already leads; what waits behind it is the reply as firstmate wrote it.
    var word = message.summary.source === "brief" ? "as written" : "more";
    more.type = "button";
    more.className = "more";
    more.textContent = el.classList.contains("open") ? "less" : word;
    more.setAttribute("aria-expanded", el.classList.contains("open") ? "true" : "false");
    more.addEventListener("click", function () {
      pinned = false;
      var open = el.classList.toggle("open");
      if (!open) el.dataset.folded = "1";
      more.textContent = open ? "less" : word;
      more.setAttribute("aria-expanded", open ? "true" : "false");
    });
    el.insertBefore(more, body);
  }
  // The page a change is on, as a button that opens it in his browser.
  function pageButton(page, kind) {
    var a = document.createElement("a");
    a.className = "open-page " + kind;
    a.href = page.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = page.url;
    a.setAttribute("aria-label", "Open " + page.url);
    a.textContent = page.label + " ↗";
    return a;
  }
  function shots(urls, kind) {
    var row = document.createElement("div");
    row.className = "shots" + (kind ? " " + kind : "");
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
  function fileKind(name) {
    var dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toUpperCase() : "FILE";
  }
  function docs(names) {
    var row = document.createElement("div");
    row.className = "docs";
    names.forEach(function (name) {
      var chip = document.createElement("span");
      chip.className = "doc";
      chip.title = name;
      var kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = fileKind(name);
      var label = document.createElement("span");
      label.className = "name";
      label.textContent = name;
      chip.appendChild(kind);
      chip.appendChild(label);
      row.appendChild(chip);
    });
    return row;
  }
  var lightbox = document.getElementById("lightbox");
  var lightboxImages = [];
  var lightboxIndex = 0;
  function openImage(url) {
    var shown = new URL(url, location.href).href;
    lightboxImages = Array.from(document.querySelectorAll("img")).filter(function (image) {
      return image.id !== "lightbox-img" && !image.closest("[hidden]");
    }).map(function (image) { return image.currentSrc || image.src; }).filter(function (imageUrl, i, all) { return imageUrl && all.indexOf(imageUrl) === i; });
    lightboxIndex = lightboxImages.indexOf(shown);
    if (lightboxIndex < 0) { lightboxImages.unshift(shown); lightboxIndex = 0; }
    document.getElementById("lightbox-img").src = lightboxImages[lightboxIndex];
    lightbox.hidden = false;
  }
  function stepLightbox(direction) {
    if (!lightboxImages.length) return;
    lightboxIndex = (lightboxIndex + direction + lightboxImages.length) % lightboxImages.length;
    document.getElementById("lightbox-img").src = lightboxImages[lightboxIndex];
  }
  document.querySelector(".lightbox-prev").addEventListener("click", function (event) { event.stopPropagation(); stepLightbox(-1); });
  document.querySelector(".lightbox-next").addEventListener("click", function (event) { event.stopPropagation(); stepLightbox(1); });
  lightbox.addEventListener("click", function (event) { if (event.target === lightbox) lightbox.hidden = true; });
  document.addEventListener("keydown", function (event) {
    if (lightbox.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); lightbox.hidden = true; }
    else if (event.key === "ArrowRight") stepLightbox(1);
    else if (event.key === "ArrowLeft") stepLightbox(-1);
  });

  // A sent note that was saved but did not wake firstmate says so.
  function showWarning(el, text) {
    if (el.querySelector(".state")) return;
    var state = document.createElement("span");
    state.className = "state";
    state.textContent = text;
    el.appendChild(state);
  }

  // The one line under his newest message changes in place, with a calm
  // swap, never growing into a log.
  var carried = new Map();
  // A line can carry links: a bare web address, or "[label](address)"; each opens like any other link.
  var LINE_LINK = /\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)|https?:\\/\\/[^\\s<>"'\`)\\]]*[^\\s<>"'\`)\\].,;:!?…]/g;
  function linkLine(node, text) {
    text = String(text || "");
    node.textContent = "";
    var at = 0;
    text.replace(LINE_LINK, function (whole, label, href, offset) {
      if (offset > at) node.appendChild(document.createTextNode(text.slice(at, offset)));
      var link = document.createElement("a");
      link.href = href || whole;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = label || whole;
      node.appendChild(link);
      at = offset + whole.length;
      return whole;
    });
    if (at < text.length) node.appendChild(document.createTextNode(text.slice(at)));
  }
  // The words sit in their own span so a link inside them flows as text beside the line's dot.
  function setLine(line, text) {
    line.dataset.line = text;
    var words = line.querySelector(":scope > .line-words");
    if (!words) {
      line.textContent = "";
      words = document.createElement("span");
      words.className = "line-words";
      line.appendChild(words);
    }
    linkLine(words, text);
  }
  function living(line, text) {
    if (line.dataset.line === text) return;
    setLine(line, text);
    line.classList.remove("swap");
    void line.offsetWidth;
    line.classList.add("swap");
  }
  // A message whose send was in doubt has landed when, with no other note of his on its
  // way, a note the page had not seen arrives, written no earlier than the send, that no
  // other send was told is its own, carrying what he sent: his words with only markdown
  // taken out, or as many pictures and files and no words.
  var delivered = new Set();
  var notesOut = 0;
  function letters(text) { return text.toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function carries(typed, shown) {
    if (shown.length < typed.length * 0.6) return false;
    var at = 0;
    for (var i = 0; i < typed.length && at < shown.length; i += 1) if (typed[i] === shown[at]) at += 1;
    return at === shown.length;
  }
  function arrived(el) {
    if (notesOut) return false;
    var found = false;
    nodes.forEach(function (node, id) {
      if (found || el.knownIds.has(id) || delivered.has(id) || !node.classList.contains("user") || !node.dataset.ts) return;
      if (new Date(node.dataset.ts).getTime() < el.sentAt - 5000) return;
      var shown = letters(node.querySelector(".body").textContent);
      var attached = node.querySelectorAll(":scope > .shots:not(.reply-shots) .shot, :scope > .docs .doc").length;
      found = el.typed ? !!shown && carries(el.typed, shown) : !shown && attached === el.attached;
    });
    return found;
  }
  function clearLanded() {
    main.querySelectorAll(".msg.pending.unsure").forEach(function (el) {
      if (!arrived(el)) return;
      el.remove();
      if (!input.value && !attachments.length) saveDraftNow();
    });
  }
  function refreshWorking() {
    var recent = lastActivity && Date.now() - new Date(lastActivity).getTime() < 10 * 60 * 1000;
    // While his newest message's own line says what is happening, the dots would only repeat it.
    var shown = main.querySelectorAll(".msg");
    var last = shown[shown.length - 1];
    var speaking = !!(last && last.querySelector(":scope > .queued:not(.still):not(.settled)"));
    working.hidden = !(isWorking && recent) || speaking;
  }
  setInterval(refreshWorking, 15000);

  function apply(update) {
    drawnFrom = current;
    var stick = first || pinned;
    var at = stick || !onConversation() ? null : anchor();
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
    clearLanded();
    var keep = new Set(update.order);
    nodes.forEach(function (el, id) { if (!keep.has(id)) { el.remove(); nodes.delete(id); } });
    var cursor = main.firstElementChild;
    var day = "";
    var previous = null;
    update.order.forEach(function (id) {
      var el = nodes.get(id);
      if (el !== cursor) main.insertBefore(el, cursor); else cursor = cursor.nextElementSibling;
      el.classList.toggle("aside-first", el.classList.contains("aside") && !(previous && previous.classList.contains("aside")));
      previous = el;
      // A reply sits under its question, whenever it was written: no day marker of its own.
      var d = el.dataset.ts && !el.classList.contains("answer") ? dayOf(el.dataset.ts) : "";
      if (d && d !== day) { el.dataset.day = d; day = d; } else { delete el.dataset.day; }
    });
    main.querySelectorAll(".msg.pending").forEach(function (el) { main.appendChild(el); });
    main.appendChild(working);
    document.getElementById("empty").hidden = update.order.length > 0 || !!main.querySelector(".msg.pending");
    isWorking = update.working;
    var projectBadge = document.getElementById("project-badge");
    if (projectBadge.textContent !== (update.project || "")) {
      projectBadge.textContent = update.project || "";
      projectBadge.hidden = !update.project;
      projectBadge.classList.remove("shown");
      if (update.project) { void projectBadge.offsetWidth; projectBadge.classList.add("shown"); }
    }
    if (update.context) { usage.context = update.context; renderUsage(); }
    lastActivity = update.lastActivity || lastActivity;
    refreshWorking();
    if (lastActivity) whenEl.textContent = dayOf(lastActivity) + "  " + clock(lastActivity);
    if (!onConversation()) { /* the terminal is hidden; it finds its place when it comes back */ }
    else if (stick) { toBottom(); jump.hidden = true; } else { restore(at); if (added) jump.hidden = false; }
    first = false;
    if (update.show) renderShow(update.show, update.boxes);
    renderSite(update.page);
    notices = (update.rail && update.rail.notices) || [];
    if (update.rail) renderArtefacts(update.rail.artefacts || []);
    renderBrief(update.show);
    renderActivity(update.leftColumn);
    if (update.leftColumn) drawNews(update.leftColumn.recent);
    renderFront(update);
  }

`;

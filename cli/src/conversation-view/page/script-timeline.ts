/**
 * The timeline is home. What needs George and what finished today arrive in the
 * conversation as Flyd's own messages, among his words in time order; a reply
 * goes under the message it answers (the one message box carries it there),
 * and a job opens in place, under its message. Core placed each item once
 * (placement.ts) and said it in its words: nothing here re-sorts or re-words
 * them. Runs inside the page script's closure after the front page's script
 * and borrows its helpers (el, frontJobs, frontAnswer, frontLine, frontTitle,
 * frontWhen, frontJobPicks, frontShots, frontSelect, frontActive, main, working).
 */
export const TIMELINE_SCRIPT = `
  var workNodes = new Map();
  // Jobs he opened from the column: they stay in the timeline for this window.
  var workKept = {};
  // The conversation only grows at the bottom. A job's message takes its place once, when it is
  // first said, and keeps it: its own record changing, or his words naming its project (which
  // moves the column's time for it), changes what it says, never where it stands.
  // Where each one was said is kept in his browser, so a reload puts it back in the same place.
  var WORK_SAID = "flyd-timeline-said";
  // A place kept from an earlier visit is trusted for two days; an id the board reuses later is new again.
  var WORK_SAID_KEEP_MS = 2 * 24 * 60 * 60 * 1000;
  // Where this page said each one, even after it left the board for a while (a worker pausing changes its card).
  var workSeenAt = {};
  var workSaid = {};
  try { workSaid = JSON.parse(localStorage.getItem(WORK_SAID) || "{}") || {}; } catch (_) { workSaid = {}; }
  function keepWorkSaid() {
    var ids = Object.keys(workSaid);
    if (ids.length > 400) ids.slice(0, ids.length - 400).forEach(function (id) { delete workSaid[id]; });
    try { localStorage.setItem(WORK_SAID, JSON.stringify(workSaid)); } catch (_) {}
  }
  // Placed in this conversation; a new conversation places them afresh (reset, script-session.ts).
  var workPlaced = new Set();
  var workDrawnOnce = false;
  function workUnplace() { workPlaced.clear(); workDrawnOnce = false; }
  // The newest time among the conversation's own words now on the page.
  function newestSaid() {
    var newest = NaN;
    main.querySelectorAll(":scope > .msg:not(.work):not(.pending)").forEach(function (msg) {
      var ts = Date.parse(msg.dataset.ts || "");
      if (!isNaN(ts) && !(ts <= newest)) newest = ts;
    });
    return newest;
  }
  // When the message was said: where this page said it before; on the board when the page came, where
  // an earlier visit said it, else its own time (never one a conversation lent it); arriving later, at
  // the bottom, after everything already said.
  function workSaidAt(job) {
    if (workSeenAt[job.id]) return workSeenAt[job.id];
    var kept = Date.parse(workSaid[job.id] || "");
    var own = Date.parse(job.toldAt || job.at || "");
    if (!workDrawnOnce && !isNaN(kept) && Date.now() - kept < WORK_SAID_KEEP_MS) own = kept;
    else if (workDrawnOnce) {
      var newest = newestSaid();
      if (isNaN(own) || own < newest) own = newest;
      if (isNaN(own)) own = Date.now();
    }
    if (isNaN(own)) return "";
    workSeenAt[job.id] = workSaid[job.id] = new Date(own).toISOString();
    keepWorkSaid();
    return workSeenAt[job.id];
  }
  function workToday(iso) {
    var d = new Date(iso);
    return !isNaN(d) && d.toDateString() === new Date().toDateString();
  }
  var WORK_ASK_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
  function workStale(job) {
    var at = Date.parse(job.at || "");
    return !isNaN(at) && Date.now() - at > WORK_ASK_KEEP_MS;
  }
  function workWords(job) {
    return String(job.project || "").toLowerCase() + "|" + String(job.ask || job.next || job.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  // The newest ask carrying these words is the one shown; an older card saying the same is a duplicate.
  function workFirstOfItsWords(job) {
    var words = workWords(job);
    var at = Date.parse(job.at || "") || 0;
    return !Array.from(frontJobs.values()).some(function (other) {
      if (other === job || other.group !== "needs" || other.quiet || workWords(other) !== words) return false;
      var when = Date.parse(other.at || "") || 0;
      return when > at || (when === at && other.id < job.id);
    });
  }
  // What the timeline carries: every current ask, work under way, what finished today, and anything he opened.
  function workInTimeline(job) {
    // A card he closed (✕, or OK on finished work) stays closed, across refreshes too.
    if (cardGone(job.id) && frontActive !== job.id) return false;
    if (workKept[job.id]) return true;
    // An ask is his only while it is current: a quiet (old) call, an ask over three days old, or a second
    // card saying the same thing as one already shown never reaches the chat.
    if (job.group === "needs") return !job.quiet && !workStale(job) && workFirstOfItsWords(job);
    if (job.group === "moving" && job.state === PLACE_STATES.running) return true;
    // What finished today is one line at the bottom; it opens into the notes when he asks.
    if (job.group === "done" && !job.bare && workToday(job.at)) return workDoneOpen;
    // Once said, it stays where it was said while the board carries it: a job pausing or queueing
    // is told in place, never taken out and said again further down.
    return workNodes.has(job.id) && !job.bare;
  }
  function workMessage(job) {
    var node = workNodes.get(job.id);
    if (!node) {
      node = el("article", "msg assistant work");
      node.dataset.job = job.id;
      node.appendChild(el("div", "work-body"));
      // One plain control on every card: ✕ closes it for good, without opening anything.
      node.appendChild(cardClose(job.id));
      workNodes.set(job.id, node);
    }
    if (!workPlaced.has(job.id)) node.dataset.ts = workSaidAt(job);
    node.classList.toggle("needs", job.group === "needs");
    var body = node.firstChild;
    var line = frontLine(job);
    var title = frontTitle(job.title);
    var finished = job.group === "done";
    // What finished is told as a small plain message under what he asked, not as a card.
    node.classList.toggle("note", finished);
    var open = !finished && frontActive === job.id;
    var drawn = JSON.stringify([job.state, title, line, job.project, job.at, job.shots && job.shots[0], job.choices, job.recommended, open, frontPicked(job)]);
    if (body.dataset.drawn === drawn) return node;
    body.dataset.drawn = drawn;
    var meta = [job.project, job.state, job.at ? frontWhen(job.at) : ""].filter(Boolean).join(" · ");
    if (finished) {
      body.innerHTML = '<p class="work-note">' + frontEsc(title) + (line && line !== title ? " " + frontEsc(line) : "") + '</p>'
        + '<p class="work-note-meta">' + frontEsc(meta)
        + (VIEW_TOKEN ? '<button type="button" class="work-reply" data-reply-job="' + frontEsc(job.id) + '">Reply</button>' : "") + '</p>';
      return node;
    }
    var shot = !open && job.group !== "moving" && job.shots && job.shots[0] ? job.shots[0] : null;
    // No status line above the title: the dot says it needs him or is moving, the title says the rest.
    body.innerHTML = '<p class="work-title">' + (job.group === "needs" ? '<i class="fdot" aria-hidden="true"></i>' : job.group === "moving" ? '<i class="fdot pulse" aria-hidden="true"></i>' : "") + frontEsc(title) + '</p>'
      + (line && line !== title && !open ? '<p class="work-line">' + frontEsc(line) + '</p>' : "")
      + (shot ? (finished ? '<div class="work-shot"><img src="' + frontEsc(shot.src) + '" alt="" loading="lazy"></div>' : '<button type="button" class="work-shot" data-open-job="' + frontEsc(job.id) + '"><img src="' + frontEsc(shot.src) + '" alt="" loading="lazy"></button>') : "")
      + (open ? "" : frontJobPicks(job))
      + '<div class="work-acts">'
      + (VIEW_TOKEN && (!job.handled || finished) && !open ? '<button type="button" class="work-reply" data-reply-job="' + frontEsc(job.id) + '">Reply</button>' : "")
      + (finished ? '<button type="button" class="work-ok" data-ok-job="' + frontEsc(job.id) + '">OK</button>' : '<button type="button" class="work-open" data-open-job="' + frontEsc(job.id) + '" aria-expanded="' + (open ? "true" : "false") + '">' + (open ? "Fold away" : "Open") + '</button>')
      + '</div>';
    return node;
  }
  // A message sits where the time it was said puts it among his words, once; one with no time goes last.
  function placeWork(node) {
    var id = node.dataset.job;
    if (workPlaced.has(id) && node.parentElement === main) return;
    workPlaced.add(id);
    var at = Date.parse(node.dataset.ts || "");
    var before = main.querySelector(":scope > .msg.pending") || working;
    if (!isNaN(at)) {
      // Jobs at the same moment keep one order (by id), so each redraw finds them already in place.
      var later = Array.prototype.find.call(main.querySelectorAll(":scope > .msg"), function (msg) {
        var ts = Date.parse(msg.dataset.ts || "");
        if (msg === node || isNaN(ts)) return false;
        return ts > at || (ts === at && !!msg.dataset.job && msg.dataset.job > node.dataset.job);
      });
      if (later) before = later;
    }
    if (node.nextSibling !== before || node.parentElement !== main) main.insertBefore(node, before);
  }
  var workDoneOpen = false;
  var workDoneNode = null;
  function workDoneToday() {
    return Array.from(frontJobs.values()).filter(function (job) {
      return job.group === "done" && !job.bare && workToday(job.at) && !(cardGone(job.id) && frontActive !== job.id);
    });
  }
  // "Done today: 12 CapFive, 5 Pixel demo", one line instead of a block of notes.
  function drawDoneSummary() {
    var done = workDoneToday();
    if (!done.length) { if (workDoneNode) { workDoneNode.remove(); workDoneNode = null; } return; }
    if (!workDoneNode) {
      workDoneNode = el("article", "msg assistant work note done-sum");
      workDoneNode.addEventListener("click", function (event) {
        if (!event.target.closest(".work-more")) return;
        workDoneOpen = !workDoneOpen;
        drawTimeline();
      });
    }
    var counts = {};
    var order = [];
    done.forEach(function (job) {
      var name = job.project || "Other";
      if (!counts[name]) { counts[name] = 0; order.push(name); }
      counts[name]++;
    });
    order.sort(function (a, b) { return counts[b] - counts[a]; });
    var words = "Done today: " + order.map(function (name) { return counts[name] + " " + name; }).join(", ");
    var drawn = JSON.stringify([words, workDoneOpen]);
    if (workDoneNode.dataset.drawn !== drawn) {
      workDoneNode.dataset.drawn = drawn;
      workDoneNode.innerHTML = '<p class="work-note">' + frontEsc(words) + '<button type="button" class="work-more" aria-expanded="' + workDoneOpen + '">' + (workDoneOpen ? "Hide" : "Show") + '</button></p>';
    }
    var before = main.querySelector(":scope > .msg.pending") || working;
    if (workDoneNode.nextSibling !== before || workDoneNode.parentElement !== main) main.insertBefore(workDoneNode, before);
  }
  // A line naming the day wherever the conversation crosses into a new one.
  var DAY_SEP_MS = 0;
  function drawDays() {
    var last = "";
    Array.prototype.forEach.call(main.querySelectorAll(":scope > .msg, :scope > .day-sep"), function (node) {
      if (node.classList.contains("day-sep")) {
        var next = node.nextElementSibling;
        var nextDay = next && next.classList.contains("msg") && !next.classList.contains("done-sum") ? workDayOf(next) : "";
        if (!nextDay || nextDay === last || node.dataset.day !== nextDay) node.remove();
        return;
      }
      var day = node.classList.contains("done-sum") ? "" : workDayOf(node);
      if (!day || day === last) return;
      last = day;
      var prev = node.previousElementSibling;
      if (prev && prev.classList.contains("day-sep") && prev.dataset.day === day) return;
      var sep = el("p", "day-sep");
      sep.dataset.day = day;
      sep.textContent = workDayWords(day);
      main.insertBefore(sep, node);
    });
  }
  function workDayOf(node) {
    var d = new Date(node.dataset.ts || "");
    return isNaN(d) ? "" : d.toDateString();
  }
  function workDayWords(day) {
    var d = new Date(day);
    var days = Math.round((new Date(new Date().toDateString()) - d) / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }
  var dayPending = false;
  if (window.MutationObserver) new MutationObserver(function (changes) {
    if (dayPending || changes.every(function (change) { return Array.prototype.every.call(change.addedNodes, function (n) { return n.classList && n.classList.contains("day-sep"); }) && Array.prototype.every.call(change.removedNodes, function (n) { return n.classList && n.classList.contains("day-sep"); }); })) return;
    dayPending = true;
    setTimeout(function () { dayPending = false; drawDays(); }, DAY_SEP_MS);
  }).observe(main, { childList: true });
  function drawTimeline() {
    var jobs = Array.from(frontJobs.values()).filter(workInTimeline);
    var shown = {};
    jobs.forEach(function (job) {
      shown[job.id] = true;
      placeWork(workMessage(job));
    });
    workNodes.forEach(function (node, id) {
      if (shown[id]) return;
      node.remove();
      workNodes.delete(id);
      workPlaced.delete(id);
    });
    drawDoneSummary();
    if (frontUpdate && Array.isArray(frontUpdate.jobs) && frontUpdate.jobsFleetKnown === true) workDrawnOnce = true;
    // A job open in the timeline holds its detail under its message.
    var open = workNodes.get(frontActive);
    if (open && jobView.parentElement !== open) open.appendChild(jobView);
  }
  // A job opened from the column joins the timeline and opens where its message stands.
  function workHold(id) {
    if (id && id !== "talk") workKept[id] = true;
    drawTimeline();
    return workNodes.get(id) || null;
  }
  main.addEventListener("click", function (event) {
    var ok = event.target.closest(".work-ok");
    if (ok) {
      cardDismiss(ok.dataset.okJob);
      drawTimeline();
      if (lastBrief) renderBrief(lastBrief);
      return;
    }
    var closer = event.target.closest(".work-close");
    if (closer) {
      var shut = closer.dataset.closeKey;
      if (frontActive === shut) frontSelect("talk");
      cardDismiss(shut);
      drawTimeline();
      if (lastBrief) renderBrief(lastBrief);
      return;
    }
    // Reply opens the card's own box on the card itself; what he sends goes to that card's thread.
    var reply = event.target.closest(".work-reply");
    if (reply) {
      var job = frontJobs.get(reply.dataset.replyJob);
      var card = workNodes.get(reply.dataset.replyJob);
      if (!job || !card) return;
      var chat = frontAnswer(job).chat;
      var box = card.querySelector(":scope > .work-reply-box");
      if (!box) { box = el("div", "work-reply-box"); card.appendChild(box); }
      if (chat.form.parentElement !== box) box.appendChild(chat.form);
      chat.form.hidden = false;
      chat.reply("");
      return;
    }
    var pick = event.target.closest(".work .jpick");
    if (pick) {
      var asked = frontJobs.get(pick.dataset.pickJob);
      if (!asked || pick.disabled) return;
      var answer = frontAnswer(asked);
      pickChoice(answer.chat, answer.key, frontDecision(asked), pick.dataset.pick, function () { drawTimeline(); frontDrawn.jobs = ""; frontDrawJobs(Array.from(frontJobs.values())); });
      return;
    }
    var opener = event.target.closest("[data-open-job]");
    if (opener) frontSelect(frontActive === opener.dataset.openJob ? "talk" : opener.dataset.openJob);
  });
  // A link from outside (the island, a notification, ?job=) opens one item in place in the timeline.
  // "needs" means whatever needs him first. Before the board has come, the link waits for it.
  var workLinked = null;
  try { workLinked = new URLSearchParams(location.search).get("job"); } catch (_) {}
  var workLinkedAt = Date.now();
  function workOpenLinked() {
    if (!workLinked || !frontUpdate || !Array.isArray(frontUpdate.jobs)) return;
    var id = workLinked;
    if (id === "needs") {
      var first = frontUpdate.jobs.find(function (job) { return job.group === "needs"; });
      id = first ? first.id : "talk";
    }
    if (id !== "talk" && !frontJobs.has(id)) {
      if (Date.now() - workLinkedAt > 30000) workLinked = null;
      return;
    }
    workLinked = null;
    if (typeof setCentre === "function") setCentre("talk", true);
    if (frontActive === id) { var node = workNodes.get(id); if (node) node.scrollIntoView({ block: "start" }); return; }
    frontSelect(id);
  }
  window.flydOpen = function (id) {
    workLinked = String(id || "needs");
    workLinkedAt = Date.now();
    workOpenLinked();
    return true;
  };
  // The front page's redraw carries the timeline along.
  var renderFrontTimeline = renderFront;
  renderFront = function (update) {
    renderFrontTimeline(update);
    if (frontUpdate) { drawTimeline(); workOpenLinked(); }
  };
`;

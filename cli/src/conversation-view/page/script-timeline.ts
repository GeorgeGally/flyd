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
  // What the timeline carries: every ask, work under way, what finished today, and anything he opened.
  function workInTimeline(job) {
    // A card he closed (✕, or OK on finished work) stays closed, across refreshes too.
    if (cardGone(job.id) && frontActive !== job.id) return false;
    if (workKept[job.id] || job.group === "needs") return true;
    if (job.group === "moving" && job.state === PLACE_STATES.running) return true;
    if (job.group === "done" && !job.bare && workToday(job.at)) return true;
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
    body.innerHTML = '<p class="work-meta">' + (job.group === "needs" ? '<i class="fdot" aria-hidden="true"></i>' : job.group === "moving" ? '<i class="fdot pulse" aria-hidden="true"></i>' : "") + frontEsc(meta) + '</p>'
      + '<p class="work-title">' + frontEsc(title) + '</p>'
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

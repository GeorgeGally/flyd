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
  function workToday(iso) {
    var d = new Date(iso);
    return !isNaN(d) && d.toDateString() === new Date().toDateString();
  }
  // What the timeline carries: every ask, work under way, what finished today, and anything he opened.
  function workInTimeline(job) {
    if (workKept[job.id] || job.group === "needs") return true;
    if (job.group === "moving") return job.state === PLACE_STATES.running;
    return job.group === "done" && !job.bare && workToday(job.at);
  }
  function workMessage(job) {
    var node = workNodes.get(job.id);
    if (!node) {
      node = el("article", "msg assistant work");
      node.dataset.job = job.id;
      node.appendChild(el("div", "work-body"));
      workNodes.set(job.id, node);
    }
    node.dataset.ts = job.at || "";
    node.classList.toggle("needs", job.group === "needs");
    var body = node.firstChild;
    var line = frontLine(job);
    var title = frontTitle(job.title);
    var open = frontActive === job.id;
    var drawn = JSON.stringify([job.state, title, line, job.project, job.at, job.shots && job.shots[0], job.choices, job.recommended, open, frontPicked(job)]);
    if (body.dataset.drawn === drawn) return node;
    body.dataset.drawn = drawn;
    var meta = [job.project, job.state, job.at ? frontWhen(job.at) : ""].filter(Boolean).join(" · ");
    var shot = !open && job.group !== "moving" && job.shots && job.shots[0] ? job.shots[0] : null;
    body.innerHTML = '<p class="work-meta">' + (job.group === "needs" ? '<i class="fdot" aria-hidden="true"></i>' : job.group === "moving" ? '<i class="fdot pulse" aria-hidden="true"></i>' : "") + frontEsc(meta) + '</p>'
      + '<p class="work-title">' + frontEsc(title) + '</p>'
      + (line && line !== title && !open ? '<p class="work-line">' + frontEsc(line) + '</p>' : "")
      + (shot ? '<button type="button" class="work-shot" data-open-job="' + frontEsc(job.id) + '"><img src="' + frontEsc(shot.src) + '" alt="" loading="lazy"></button>' : "")
      + (open ? "" : frontJobPicks(job))
      + '<div class="work-acts">'
      + (VIEW_TOKEN && !job.handled && !open ? '<button type="button" class="work-reply" data-reply-job="' + frontEsc(job.id) + '">Reply</button>' : "")
      + '<button type="button" class="work-open" data-open-job="' + frontEsc(job.id) + '" aria-expanded="' + (open ? "true" : "false") + '">' + (open ? "Fold away" : "Open") + '</button>'
      + '</div>';
    return node;
  }
  // Each message sits where its time puts it among his words; one with no time goes last.
  function placeWork(node) {
    var at = Date.parse(node.dataset.ts || "");
    var before = working;
    if (!isNaN(at)) {
      var later = Array.prototype.find.call(main.querySelectorAll(":scope > .msg"), function (msg) {
        var ts = Date.parse(msg.dataset.ts || "");
        return msg !== node && !isNaN(ts) && ts > at;
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
    });
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
    var reply = event.target.closest(".work-reply");
    if (reply) {
      var job = frontJobs.get(reply.dataset.replyJob);
      if (job) frontAnswer(job).chat.reply("");
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
  function workOpenLinked() {
    if (!workLinked || !frontUpdate || !Array.isArray(frontUpdate.jobs)) return;
    var id = workLinked;
    if (id === "needs") {
      var first = frontUpdate.jobs.find(function (job) { return job.group === "needs"; });
      id = first ? first.id : "talk";
    }
    workLinked = null;
    if (typeof setCentre === "function") setCentre("talk", true);
    if (id !== "talk" && !frontJobs.has(id)) return;
    if (frontActive === id) { var node = workNodes.get(id); if (node) node.scrollIntoView({ block: "start" }); return; }
    frontSelect(id);
  }
  window.flydOpen = function (id) {
    workLinked = String(id || "needs");
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

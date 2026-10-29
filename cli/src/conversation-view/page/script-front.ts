/**
 * The front page: the one open job (or the conversation) in the middle; the
 * right column is two tabs, the jobs as cards and the page's own artefact
 * column (#rail: artefacts, notices, news), restyled as cards by front-style.ts.
 * Every job comes from the stream's own update: show.needs and show.focus (one
 * list of what needs him, a finished design lab among them), the fleet's
 * working and landed work, and the left column's activities; a group with
 * nothing in it says so. Runs inside the page script's closure and borrows its
 * helpers (el, ago, clock, withToken, sceneAsk, artefactChat, openImage, store,
 * cardRead, itemKey). Job kinds are mapped in one place (frontJobsOf), so a new
 * kind of card is one more mapping there.
 */
export const FRONT_SCRIPT = `
  // The front page: jobs, the one open job, artefacts.
  var frontRoot = document.documentElement;
  var jobsEl = document.getElementById("jobs");
  var jobsList = document.getElementById("jobs-list");
  var jobView = document.getElementById("job-view");
  var stageHead = document.getElementById("stage-head");
  var stageCrumb = document.getElementById("stage-crumb");
  var stageTitle = document.getElementById("stage-title");
  var frontDate = document.getElementById("front-date");
  var frontJobs = new Map();
  var frontActive = "talk";
  try { frontActive = sessionStorage.getItem("flyd-front-job") || "talk"; } catch (_) {}
  var frontOpen = { done: false };
  var frontUpdate = null;
  var frontDrawn = { jobs: "", view: "", viewId: "" };
  var frontVersion = {};
  var DONE_FEW_FRONT = 5;

  // The right column holds two tabs, jobs and artefacts; the choice is remembered.
  var rtabs = document.getElementById("rtabs");
  var rtabDot = document.getElementById("rtab-dot");
  function frontTab(name) {
    frontRoot.dataset.rtab = name;
    rtabs.querySelectorAll(".rtab").forEach(function (tab) { tab.setAttribute("aria-pressed", String(tab.dataset.rtab === name)); });
    try { localStorage.setItem("flyd-front-tab", name); } catch (_) {}
  }
  var savedTab = "jobs";
  try { savedTab = localStorage.getItem("flyd-front-tab") || "jobs"; } catch (_) {}
  frontTab(savedTab === "arts" ? "arts" : "jobs");
  rtabs.addEventListener("click", function (event) {
    var tab = event.target.closest(".rtab");
    if (tab) frontTab(tab.dataset.rtab);
  });

  function frontEsc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function frontText(text) { return String(text || "").replace(/[ \\t\\r\\n]+/g, " ").trim(); }
  // A card's title in his words: no backstage preamble, and a raw link shown as its site.
  function frontTitle(text) {
    return frontText(text).replace(/^self-improvement for flyd:\\s*/i, "")
      .replace(/https?:\\/\\/(?:www\\.)?([^\\/\\s]+)\\S*/g, "$1");
  }
  function frontProject(project) {
    var name = shortName(project || "");
    if (name.charAt(0) === "/") name = name.split("/").filter(Boolean).pop() || name;
    return name;
  }
  // A day written without a time is that day where he is, not midnight in London.
  function frontDay(iso) {
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(iso || "")) {
      var parts = iso.split("-");
      return new Date(+parts[0], +parts[1] - 1, +parts[2]);
    }
    return new Date(iso);
  }
  function frontWhen(iso) {
    if (!iso) return "";
    var d = frontDay(iso);
    if (isNaN(d)) return "";
    var days = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
    var dateOnly = iso.length <= 10;
    if (days <= 0) return dateOnly ? "Today" : clock(iso);
    if (days === 1) return "Yesterday";
    if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { day: "numeric", month: "short" });
  }
  function frontAge(iso) { var d = frontDay(iso); return isNaN(d) ? Infinity : Date.now() - d.getTime(); }
  function frontShotName(label) {
    var base = String(label || "").replace(/[.][a-z0-9]+$/i, "");
    // A lab's review shot names its version: "v2-front-page-desktop" reads "V2 · Front page".
    var version = /^v(\\d+)[-_](.+?)(?:[-_](desktop|phone|mobile|tablet))?$/i.exec(base);
    if (version) {
      var device = (version[3] || "").toLowerCase();
      return "V" + version[1] + " · " + capital(version[2].replace(/[-_]+/g, " ")) + (device && device !== "desktop" ? " · " + device : "");
    }
    return capital(base.replace(/[-_]+/g, " ").trim());
  }
  function frontShots(list) {
    return (list || []).filter(function (shot) { return shot && shot.src; }).map(function (shot) {
      return { src: withToken(shot.src), label: frontShotName(shot.label) };
    });
  }
  // The candidates a lab put up: the desktop page large, its phone view beside it.
  function frontPreviews(list) {
    return (list || []).filter(function (preview) { return preview && preview.image; }).map(function (preview) {
      return { label: frontText(preview.label), image: withToken(preview.image), phone: preview.phone ? withToken(preview.phone) : "" };
    });
  }
  function frontEvidenceShots(evidence) {
    return frontShots((evidence || []).filter(function (object) { return object.kind === "image" && !object.closed; }).map(function (object) {
      return { src: object.ref, label: object.label };
    }));
  }
  // A long headline: its first sentence heads the job, the rest reads under it.
  function frontSplit(text) {
    if (text.length <= 110) return { title: text, rest: "" };
    var best = -1;
    [". ", "? "].forEach(function (mark) {
      var at = text.indexOf(mark, 24);
      if (at > 0 && at < 150 && (best < 0 || at < best)) best = at;
    });
    if (best < 0) {
      var cut = text.lastIndexOf(" ", 96);
      if (cut < 40) cut = 96;
      return { title: text.slice(0, cut) + "…", rest: "…" + text.slice(cut).trim() };
    }
    return { title: text.slice(0, best + 1), rest: text.slice(best + 2) };
  }
  // The question heads the card, so a detail that starts by saying it again keeps only what it adds.
  function frontTail(detail, title) {
    var text = frontText(detail);
    var head = frontText(title);
    if (!text || !head || text.toLowerCase().indexOf(head.toLowerCase()) !== 0) return text;
    return text.slice(head.length).replace(/^[\\s:.–—-]+/, "");
  }
  var FRONT_WORKING = { live: "Working", ready: "Ready to land", waiting: "Waiting", next: "Queued" };
  var FRONT_PHASE = { needs_you: "needs", ready: "working", working: "working", queued: "working", paused: "working", finished: "done" };

  // The same test Core uses for "needs George" (semantic.ts needsGeorge).
  function frontNeeds(object) {
    var phase = object.activity && object.activity.phase;
    return object.kind === "decision" || object.lifecycle === "interrupted" || !!(object.monitor && object.monitor.phase === "changed") || phase === "needs_you" || phase === "ready";
  }
  // One semantic object as a job: a design lab, a review, a decision with no fleet call behind it.
  function frontObjectJob(object, group) {
    var phase = object.activity && object.activity.phase || "";
    var lab = String(object.id).indexOf("lab:") === 0;
    var decision = object.decision && (object.decision.alternatives || object.decision.choices) ? {
      decisionId: object.decision.decisionId, task: object.decision.target || object.decision.task || "", question: object.decision.question || object.subject,
      choices: object.decision.alternatives || object.decision.choices || [],
    } : null;
    return {
      id: object.id, group: group || (frontNeeds(object) ? "needs" : FRONT_PHASE[phase] || "working"),
      state: lab ? "Lab ready for review" : object.status || (phase ? capital(String(phase).replace(/_/g, " ")) : "Needs you"),
      title: frontTitle(object.subject), project: frontProject(object.project),
      at: object.updatedAt || object.activity && object.activity.started || object.createdAt,
      shots: frontEvidenceShots(object.evidence), detail: frontText(object.detail || object.summary), previews: frontPreviews(object.previews),
      links: (object.evidence || []).filter(function (one) { return one.kind === "web" && !one.closed; }).map(function (one) { return { label: one.label, url: one.ref }; }),
      decision: decision, task: object.source && object.source.task || "",
    };
  }
  // Every job the stream knows, in three groups: what needs him, what is under way, what landed.
  function frontJobsOf(update) {
    var show = update.show || {};
    var jobs = [];
    var seen = {};
    var tasks = {};
    function add(job) {
      if (!job.title || seen[job.id] || (job.task && tasks[job.group + ":" + job.task])) return;
      seen[job.id] = true;
      if (job.task) tasks[job.group + ":" + job.task] = true;
      jobs.push(job);
    }
    var calls = {};
    (show.calls || []).forEach(function (call) { calls[call.id] = call; });
    function callJob(call) {
      return { id: call.id, group: "needs", state: call.status || "Needs your choice", title: frontTitle(call.headline), project: frontProject(call.project),
        at: call.at, shots: frontShots(call.shots), previews: frontPreviews(call.previews), detail: frontText(call.detail), links: call.links || [], decision: call.decision || null, task: call.task || "" };
    }
    // What needs him is one list (the corner, the count and the drill read it too): the focus, then the rest.
    // A call carries its pictures and its choices; anything else (a finished design lab) is drawn from its own object.
    if (show.needs) {
      var focus = show.focus && frontNeeds(show.focus) ? [show.focus] : [];
      focus.concat(show.needs).forEach(function (object) {
        var call = calls[object.source && object.source.showItemId];
        add(call ? callJob(call) : frontObjectJob(object, "needs"));
      });
    } else {
      (show.calls || []).forEach(function (call) { add(callJob(call)); });
    }
    [show.underway, show.ready, show.held, show.next].forEach(function (list) {
      (list || []).forEach(function (item) {
        add({ id: item.id, group: "working", state: FRONT_WORKING[item.kind] || capital(item.status || "Working"), title: frontTitle(item.headline), project: frontProject(item.project),
          at: item.at || item.started, shots: frontShots(item.shots), previews: frontPreviews(item.previews), detail: frontText(item.detail || item.why), links: item.links || [], decision: item.decision || null, task: item.task || "" });
      });
    });
    // Anything else the left column carries (a review, an activity) becomes a card of its kind.
    ((update.leftColumn && update.leftColumn.semantic) || []).forEach(function (activity) {
      var from = activity.source && activity.source.showItemId;
      if (from && seen[from]) return;
      add(frontObjectJob(activity));
    });
    var landed = (show.done || []).concat(show.landedWeek || []);
    landed.sort(function (a, b) { return frontAge(a.at) - frontAge(b.at); });
    // New: Flyd first saw it after he last looked at Done (the same record the Done list keeps).
    var doneSeen = cardRead("flyd-done-seen");
    landed.forEach(function (item) {
      add({ id: item.id, group: "done", state: "Landed", title: frontTitle(item.headline), project: frontProject(item.project), at: item.at,
        shots: frontShots(item.shots), previews: frontPreviews(item.previews), detail: frontText(item.detail || item.why), links: item.links || [], decision: null, task: item.task || "",
        fresh: isNew(item, doneSeen) });
    });
    return jobs;
  }
  function frontTalk(update) {
    return { id: "talk", group: "talk", state: update.working ? "Working" : "With " + assistant, title: conversationTitle.textContent || "New conversation",
      project: frontProject(update.project), at: lastActivity || "" };
  }

  function frontJobCard(job) {
    var pic = job.shots && job.shots.length
      ? '<div class="frame"><img src="' + frontEsc(job.shots[0].src) + '" alt="" loading="lazy"></div>' : "";
    // The title says what it is; a line under it says what the work is, and the foot carries state, project and when.
    var detail = job.detail ? '<div class="d">' + frontEsc(job.detail) + '</div>' : "";
    // "Landed" under "Done" says nothing the group has not; a plain "needs …" is the group's own word.
    var state = job.group === "done" || /^needs\\b/i.test(job.state) ? "" : job.state;
    return '<button type="button" class="job ' + job.group + (job.id === frontActive ? " on" : "") + '" data-job="' + frontEsc(job.id) + '"'
      + (job.id === frontActive ? ' aria-current="true"' : "") + '>' + pic
      + '<div class="t">' + frontEsc(job.title) + '</div>' + detail + '<div class="m">' + frontMeta([state, job.project])
      + '<span class="w">' + (job.fresh ? '<span class="fnew">New</span> ' : "") + frontEsc(frontWhen(job.at)) + '</span></div></button>';
  }
  // A card's state and project, as many as it has; the group above it already says "needs you".
  function frontMeta(parts) {
    return parts.map(function (part, index) { return part ? '<span class="' + (index ? "p" : "s") + '">' + frontEsc(part) + '</span>' : ""; })
      .filter(Boolean).join('<span aria-hidden="true">·</span>');
  }
  function frontGroup(label, count, body, extra) {
    return '<section class="fgroup"><h2 class="fhead"><span>' + frontEsc(label) + '</span><span>' + (count === "" ? "" : count) + '</span></h2>'
      + '<div class="fstrip">' + body + '</div>' + (extra || "") + '</section>';
  }
  function frontDrawJobs(talk, jobs) {
    // Until the fleet has been read, an empty group is unknown, not empty.
    var known = !!(frontUpdate && frontUpdate.show && frontUpdate.show.read);
    var unread = '<p class="fempty">Not read yet.</p>';
    var needs = jobs.filter(function (job) { return job.group === "needs"; });
    var working = jobs.filter(function (job) { return job.group === "working"; });
    var done = jobs.filter(function (job) { return job.group === "done"; });
    var shownDone = frontOpen.done ? done : done.slice(0, DONE_FEW_FRONT);
    rtabDot.hidden = !needs.length;
    var html = frontGroup("Conversation", "", frontJobCard(talk))
      + (needs.length ? frontGroup("Needs you", needs.length, needs.map(frontJobCard).join("")) : frontGroup("Needs you", known ? 0 : "", "", known ? '<p class="fempty">Nothing waits on you.</p>' : unread))
      + (working.length ? frontGroup("Working", working.length, working.map(frontJobCard).join("")) : frontGroup("Working", known ? 0 : "", "", known ? '<p class="fempty">Nothing is running right now.</p>' : unread))
      + (done.length ? frontGroup("Done", done.length, shownDone.map(frontJobCard).join(""),
          done.length > DONE_FEW_FRONT ? '<button type="button" class="fmore" data-more="done">' + (frontOpen.done ? "Show fewer" : "Show all " + done.length) + '</button>' : "")
        : frontGroup("Done", known ? 0 : "", "", known ? '<p class="fempty">Nothing landed this week.</p>' : unread));
    if (html === frontDrawn.jobs) return;
    frontDrawn.jobs = html;
    jobsList.innerHTML = html;
  }

  // The open job's heading: what the open job is, its state, where and when.
  function frontHead(job) {
    var dot = job.group === "needs" ? '<span class="fdot" aria-hidden="true"></span>' : "";
    stageCrumb.innerHTML = dot + '<span class="s">' + frontEsc(job.state) + '</span>'
      + (job.project ? '<span aria-hidden="true">·</span><span class="p">' + frontEsc(job.project) + '</span>' : "")
      + (job.at ? '<span aria-hidden="true">·</span><span>' + frontEsc(frontWhen(job.at)) + '</span>' : "");
    var title = frontSplit(job.title).title;
    if (stageTitle.textContent !== title) stageTitle.textContent = title;
  }
  function frontWork(job) {
    var shots = job.shots;
    if (!shots.length) {
      var plain = el("div", "jv-plain");
      plain.appendChild(el("p", "big", sentence(job.state)));
      var sub = [job.project, frontWhen(job.at)].filter(Boolean).join(" · ");
      if (sub) plain.appendChild(el("p", "sub", sub));
      return plain;
    }
    var at = Math.min(frontVersion[job.id] || 0, shots.length - 1);
    var work = el("div", "jv-work" + (shots.length > 1 ? "" : " one"));
    var view = el("button", "jv-view");
    view.type = "button";
    view.setAttribute("aria-label", "Open the picture full size");
    var img = el("img");
    img.src = shots[at].src;
    img.alt = shots[at].label;
    view.appendChild(img);
    view.addEventListener("click", function () { openImage(img.src); });
    work.appendChild(view);
    if (shots.length > 1) {
      var vers = el("div", "jv-vers");
      vers.setAttribute("role", "group");
      vers.setAttribute("aria-label", "Pictures");
      shots.forEach(function (shot, index) {
        var ver = el("button", "ver" + (index === at ? " on" : ""));
        ver.type = "button";
        ver.setAttribute("aria-pressed", String(index === at));
        ver.appendChild(el("span", "i", String(index + 1)));
        var th = el("span", "th");
        th.style.backgroundImage = "url('" + shot.src.replace(/'/g, "%27") + "')";
        ver.appendChild(th);
        ver.appendChild(el("span", "n", shot.label || "Picture " + (index + 1)));
        ver.addEventListener("click", function () {
          if (frontVersion[job.id] === index) return;
          frontVersion[job.id] = index;
          vers.querySelectorAll(".ver").forEach(function (one, i) { one.classList.toggle("on", i === index); one.setAttribute("aria-pressed", String(i === index)); });
          img.classList.add("fade");
          setTimeout(function () {
            img.onload = function () { img.classList.remove("fade"); };
            img.src = shot.src;
            img.alt = shot.label;
          }, 180);
        });
        vers.appendChild(ver);
      });
      work.appendChild(vers);
    }
    return work;
  }
  // Every candidate the lab put up, one under another: its desktop page large
  // with its phone view beside it, named as the lab's report names it. Clicking
  // either opens it full size; the choices stay under them.
  function frontCandidates(job) {
    var wrap = el("div", "jv-candidates");
    job.previews.forEach(function (preview) {
      var candidate = el("figure", "jv-candidate");
      candidate.appendChild(el("figcaption", "", preview.label));
      var pair = el("div", "jv-pair");
      pair.appendChild(frontCandidatePicture(preview.image, preview.label, "jv-view"));
      if (preview.phone) pair.appendChild(frontCandidatePicture(preview.phone, preview.label + " on a phone", "jv-phone"));
      candidate.appendChild(pair);
      wrap.appendChild(candidate);
    });
    return wrap;
  }
  function frontCandidatePicture(src, label, look) {
    var view = el("button", look);
    view.type = "button";
    view.setAttribute("aria-label", "Open " + label + " full size");
    var img = el("img");
    img.src = src;
    img.alt = label;
    img.loading = "lazy";
    view.appendChild(img);
    view.addEventListener("click", function () { openImage(src); });
    return view;
  }
  function frontJobView(job) {
    var parts = [];
    var split = frontSplit(job.title);
    var said = frontTail(job.detail, job.title);
    var talk = null;
    if (said) {
      talk = el("div", "jv-talk");
      var msg = el("div", "jv-msg flyd");
      var who = el("div", "who");
      who.appendChild(el("b", "", assistant));
      if (job.at) who.appendChild(document.createTextNode(frontWhen(job.at)));
      msg.appendChild(who);
      msg.appendChild(el("p", "", said));
      talk.appendChild(msg);
    }
    if (split.rest) parts.push(el("p", "jv-lead", split.rest));
    // Every design fills the card, so what Flyd said about them stays above them, in sight.
    if (job.previews.length) {
      if (talk) parts.push(talk);
      parts.push(frontCandidates(job));
    } else if (job.shots.length || !(split.rest || said)) parts.push(frontWork(job));
    var links = (job.links || []).filter(function (link) { return link && link.url && !link.closed; });
    if (links.length) {
      var acts = el("div", "jv-acts");
      links.forEach(function (link) {
        var a = el("a", "fbtn", link.label || "Open");
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        acts.appendChild(a);
      });
      parts.push(acts);
    }
    if (talk && !job.previews.length) parts.push(talk);
    if (VIEW_TOKEN) {
      if (job.decision) {
        parts.push(sceneAsk({ title: job.title, decision: job.decision }, "flyd-decision:" + (job.decision.decisionId || job.decision.task) + ":" + job.decision.question));
      } else {
        var about = { title: job.title };
        if (job.task) about.task = job.task;
        if (links.length) about.url = links[0].url;
        parts.push(artefactChat("flyd-front:" + job.id, { about: about }, "Message " + assistant + " about this job").form);
      }
    }
    return parts;
  }
  function frontStage() {
    if (!frontUpdate) return;
    var job = frontActive === "talk" ? null : frontJobs.get(frontActive);
    if (!job) {
      frontActive = "talk";
      frontRoot.removeAttribute("data-job");
      frontHead(frontTalk(frontUpdate));
      frontDrawn.view = "";
      frontDrawn.viewId = "";
      jobView.textContent = "";
      return;
    }
    frontRoot.setAttribute("data-job", job.id);
    frontHead(job);
    var drawn = JSON.stringify([job.id, job.state, job.title, job.detail, job.shots, job.previews, job.links, job.decision]);
    // A job already open stays as he left it while he is typing in it.
    if (drawn === frontDrawn.view || (frontDrawn.viewId === job.id && jobView.contains(document.activeElement))) return;
    frontDrawn.view = drawn;
    frontDrawn.viewId = job.id;
    jobView.replaceChildren.apply(jobView, frontJobView(job));
  }
  // Another job takes the middle: the old one fades out where it stands, the new one fades in.
  function frontSelect(id) {
    if (id === frontActive) return;
    frontActive = id;
    try { sessionStorage.setItem("flyd-front-job", id); } catch (_) {}
    jobsEl.querySelectorAll(".job").forEach(function (card) {
      var on = card.dataset.job === id;
      card.classList.toggle("on", on);
      if (on) card.setAttribute("aria-current", "true"); else card.removeAttribute("aria-current");
    });
    frontDrawn.jobs = "";
    var fading = [stageHead, jobView, main];
    fading.forEach(function (node) { node.classList.add("front-fade"); });
    setTimeout(function () {
      frontStage();
      if (frontUpdate) frontDrawJobs(frontTalk(frontUpdate), Array.from(frontJobs.values()));
      // On a phone the middle sits under the strips of cards: the job opens where its heading is.
      var stacked = getComputedStyle(stageHead).position !== "fixed";
      if (id === "talk") { if (pinned) toBottom(); }
      else window.scrollTo(0, stacked ? Math.max(0, stageHead.getBoundingClientRect().top + window.scrollY - document.querySelector("header").offsetHeight) : 0);
      fading.forEach(function (node) { node.classList.remove("front-fade"); });
    }, 200);
  }

  function renderFront(update) {
    if (update) frontUpdate = update;
    if (!frontUpdate) return;
    var jobs = frontJobsOf(frontUpdate);
    frontJobs = new Map(jobs.map(function (job) { return [job.id, job]; }));
    frontDrawJobs(frontTalk(frontUpdate), jobs);
    frontStage();
  }

  jobsEl.addEventListener("click", function (event) {
    var more = event.target.closest(".fmore");
    if (more) { frontOpen[more.dataset.more] = !frontOpen[more.dataset.more]; renderFront(); return; }
    var card = event.target.closest(".job");
    if (card) frontSelect(card.dataset.job);
  });
  // Past conversations sit under the jobs; opening one brings the conversation back to the middle.
  (function () {
    var group = el("section", "fgroup fhistory");
    var head = el("h2", "fhead");
    head.appendChild(el("span", "", "Earlier conversations"));
    group.appendChild(head);
    group.appendChild(historyEl);
    jobsEl.appendChild(group);
    historyList.addEventListener("click", function (event) { if (event.target.closest(".history-item")) frontSelect("talk"); });
  })();
  window.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || event.defaultPrevented || frontActive === "talk" || !lightbox.hidden) return;
    var from = event.target;
    if (from && from.closest && from.closest("input, textarea, select, [contenteditable]")) return;
    frontSelect("talk");
  });
  // The conversation's heading follows its title as it changes.
  if (window.MutationObserver) new MutationObserver(function () { if (frontActive === "talk") frontStage(); }).observe(conversationTitle, { childList: true, characterData: true, subtree: true });
  // The heading and the message box take the room they need; the conversation keeps clear of both.
  if (window.ResizeObserver) {
    new ResizeObserver(function () { frontRoot.style.setProperty("--stage-head-h", stageHead.offsetHeight + "px"); }).observe(stageHead);
    new ResizeObserver(function () { frontRoot.style.setProperty("--composer-h", composer.offsetHeight + "px"); }).observe(composer);
    // On a phone the cards sit above the conversation: a reader at the latest message stays there as they fill in.
    var keepLatest = new ResizeObserver(function () { if (pinned && onConversation()) toBottom(); });
    keepLatest.observe(jobsEl);
    keepLatest.observe(railEl);
  }
  function frontToday() { frontDate.textContent = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }); }
  frontToday();
  setInterval(function () { frontToday(); renderFront(); }, 60000);
`;

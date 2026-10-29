/**
 * The front page: the one open job (or the conversation) in the middle; the
 * right column is two tabs, the jobs as cards and the page's own artefact
 * column (#rail: artefacts, notices, news), restyled as cards by front-style.ts.
 * When the stream sends update.jobs, those are the cards: a project George is
 * moving, with the digest already stored on it. The page never asks for a new
 * reading while drawing. Without that list it still maps the fleet (frontJobsOf).
 * A group with nothing in it says something true. Runs inside the page script's
 * closure and borrows its helpers (el, ago, clock, withToken, sceneAsk,
 * artefactChat, openImage, store, cardRead, itemKey, connect).
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
  // A card's title in his words: no backstage preamble, nobody spoken of in the third person, a raw link as its site.
  function frontTitle(text) {
    return frontText(text).replace(/^self-improvement for flyd[:.]?\\s*/i, "")
      .replace(/^act on flyd's note about task \\S+[:.]?\\s*/i, "")
      .replace(/\\bgeorge's\\b/gi, "your")
      .replace(/\\bgeorge\\b/gi, "you")
      .replace(/\\bthe captain's\\b/gi, "your")
      .replace(/\\bthe captain\\b/gi, "you")
      .replace(/https?:\\/\\/(?:www\\.)?([^\\/\\s]+)\\S*/g, "$1");
  }
  // A card's title in his words: the framing gone, and a long run-on cut at its first sentence.
  function frontHeading(text, project) {
    if (/^act on\\s+(?:george's|the captain's|his|your)?\\s*answer\\b/i.test(frontText(text))) {
      return "Carrying out your choice" + (project ? " on " + project : "");
    }
    var line = frontTitle(text);
    if (line.length <= 92) return line;
    var first = /^.{20,92}?[.!?](?=\\s|$)/.exec(line);
    if (first) return first[0];
    var cut = line.lastIndexOf(" ", 88);
    return (cut > 40 ? line.slice(0, cut) : line.slice(0, 88)).replace(/[\\s,;:-]+$/, "") + "…";
  }
  // A working or waiting row says what happens next in one short sentence, never a run-on summary.
  function frontNext(job) {
    var said = frontTitle(job.detail);
    if (!said) return "";
    var parts = said.split(/(?<=[.!?])\\s+/);
    // Where it stands, when a sentence says so ("Waiting for your pick: …"), heads the row; else what comes next.
    var standing = parts.filter(function (part) { return /^(waiting|working|queued|ready|paused|running|landed|next)\\b/i.test(part); });
    // One whole sentence, never a sentence cut in half: where it stands, else the shortest that fits a line.
    var fits = parts.filter(function (part) { return part.length <= 90; });
    var line = standing[0] || fits[0] || parts[0];
    if (line.length > 90) line = line.slice(0, 88).replace(/\\s+\\S*$/, "") + "…";
    return line.charAt(0).toUpperCase() + line.slice(1);
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
      // Every decision the work puts to him, so the card says what they are and which is done.
      decisions: object.decision.decisions,
      recommended: object.decision.recommended,
    } : null;
    return {
      id: object.id, group: group || (frontNeeds(object) ? "needs" : FRONT_PHASE[phase] || "working"),
      state: lab ? "Lab ready for review" : object.status || (phase ? capital(String(phase).replace(/_/g, " ")) : "Needs you"),
      title: frontHeading(object.subject, frontProject(object.project)), project: frontProject(object.project),
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
      return { id: call.id, group: "needs", state: call.status || "Needs your choice", title: frontHeading(call.headline, frontProject(call.project)), project: frontProject(call.project),
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
        add({ id: item.id, group: "working", state: FRONT_WORKING[item.kind] || capital(item.status || "Working"), title: frontHeading(item.headline, frontProject(item.project)), project: frontProject(item.project),
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
      add({ id: item.id, group: "done", state: "Landed", title: frontHeading(item.headline, frontProject(item.project)), project: frontProject(item.project), at: item.at,
        shots: frontShots(item.shots), previews: frontPreviews(item.previews), detail: frontText(item.detail || item.why), links: item.links || [], decision: null, task: item.task || "",
        fresh: isNew(item, doneSeen) });
    });
    return jobs;
  }
  function frontTalk(update) {
    return { id: "talk", group: "talk", state: update.working ? "Working" : "With " + assistant, title: conversationTitle.textContent || "New conversation",
      project: frontProject(update.project), at: lastActivity || "" };
  }

  function frontDigest(job) {
    var digest = job.digest;
    if (!digest || !(digest.changed || digest.means || digest.needed)) return "";
    return '<p class="digest">' + [digest.changed, digest.means, digest.needed].filter(Boolean).map(frontEsc).join("<br>") + '</p>';
  }
  function frontJobCard(job) {
    var pic = job.shots && job.shots.length
      ? '<div class="frame"><img src="' + frontEsc(job.shots[0].src) + '" alt="" loading="lazy"></div>' : "";
    var dot = job.group === "needs" ? '<span class="fdot" aria-hidden="true"></span>' : "";
    var reading = frontDigest(job);
    if (!reading && job.next) {
      var who = job.owner && job.owner !== "you" ? ' <span class="own">· ' + frontEsc(job.owner) + '</span>' : "";
      reading = '<p class="next">' + frontEsc(job.next) + who + '</p>';
    }
    // With no digest or next line, one whole sentence says what the work is: a working row says what happens next.
    if (!reading) {
      var line = job.group === "working" ? frontNext(job) : frontTitle(job.detail);
      if (line) reading = '<p class="next">' + frontEsc(line) + '</p>';
    }
    // "Landed" under "Done" says nothing the group has not; a plain "needs …" is the group's own word.
    var state = job.group === "done" || /^needs\\b/i.test(job.state) ? "" : job.state;
    return '<button type="button" class="job ' + job.group + (job.id === frontActive ? " on" : "") + '" data-job="' + frontEsc(job.id) + '"'
      + (job.id === frontActive ? ' aria-current="true"' : "") + '>' + pic
      + '<div class="t">' + frontEsc(job.title) + '</div>' + reading + '<div class="m">' + dot + frontMeta([state, job.project])
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
  function frontDrawJobs(jobs) {
    // A jobs array is the list. Until one arrives, an empty fleet group is unknown.
    var listed = !!(frontUpdate && Array.isArray(frontUpdate.jobs));
    var known = listed || !!(frontUpdate && frontUpdate.show && frontUpdate.show.read);
    var fleetKnown = listed ? !!frontUpdate.jobsFleetKnown : known;
    var unread = '<p class="fempty">Not read yet.</p>';
    var needs = jobs.filter(function (job) { return job.group === "needs"; });
    var working = jobs.filter(function (job) { return job.group === "working"; });
    var waiting = jobs.filter(function (job) { return job.group === "waiting"; });
    var done = jobs.filter(function (job) { return job.group === "done"; });
    var shownDone = frontOpen.done ? done : done.slice(0, DONE_FEW_FRONT);
    var needsEmpty = listed ? "No decision is waiting." : "Nothing waits on you.";
    var workingEmpty = listed && !fleetKnown ? "No run has reported yet." : "Nothing is running right now.";
    var doneEmpty = listed ? "Nothing has landed lately." : "Nothing landed this week.";
    rtabDot.hidden = !needs.length;
    var html = (needs.length ? frontGroup("Needs you", needs.length, needs.map(frontJobCard).join("")) : frontGroup("Needs you", known ? 0 : "", "", known ? '<p class="fempty">' + needsEmpty + '</p>' : unread))
      + (working.length ? frontGroup("Working", working.length, working.map(frontJobCard).join("")) : frontGroup("Working", known ? 0 : "", "", known ? '<p class="fempty">' + workingEmpty + '</p>' : unread))
      + (listed ? (waiting.length ? frontGroup("Waiting", waiting.length, waiting.map(frontJobCard).join("")) : frontGroup("Waiting", 0, "", '<p class="fempty">Nothing is waiting.</p>')) : "")
      + (done.length ? frontGroup("Done", done.length, shownDone.map(frontJobCard).join(""),
          done.length > DONE_FEW_FRONT ? '<button type="button" class="fmore" data-more="done">' + (frontOpen.done ? "Show fewer" : "Show all " + done.length) + '</button>' : "")
        : frontGroup("Done", known ? 0 : "", "", known ? '<p class="fempty">' + doneEmpty + '</p>' : unread))
      + (listed && VIEW_TOKEN ? '<form class="job-new"><input name="name" maxlength="60" placeholder="New job" aria-label="New job"><button type="submit">Add</button></form>' : "");
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

  function frontHttp(url) { return /^https?:\\/\\//i.test(url || "") ? url : ""; }
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
  function frontDetailTalk(job) {
    var talk = el("div", "jv-talk");
    var msg = el("div", "jv-msg flyd");
    var who = el("div", "who");
    who.appendChild(el("b", "", assistant));
    if (job.at) who.appendChild(document.createTextNode(frontWhen(job.at)));
    msg.appendChild(who);
    msg.appendChild(el("p", "", job.detail));
    talk.appendChild(msg);
    return talk;
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

    if (job.ask) parts.push(el("p", "jv-ask", job.ask));
    if (job.digest && (job.digest.changed || job.digest.means || job.digest.needed)) {
      var block = el("div", "jv-digest");
      [["Changed", job.digest.changed], ["Means", job.digest.means], ["Needed", job.digest.needed]].forEach(function (pair) {
        if (!pair[1]) return;
        var line = el("p");
        line.appendChild(el("b", "", pair[0]));
        line.appendChild(document.createTextNode(" " + pair[1]));
        block.appendChild(line);
      });
      var href = frontHttp(job.digest.link);
      if (href) {
        var full = el("a", "fbtn", "Open the full artifact");
        full.href = href;
        full.target = "_blank";
        full.rel = "noopener noreferrer";
        block.appendChild(full);
      }
      parts.push(block);
    } else if (job.next) {
      var next = el("p", "jv-next", job.next);
      if (job.owner) next.appendChild(el("span", "own", job.owner === "you" ? " · you" : " · " + job.owner));
      parts.push(next);
    }
    // With no picture, the words are the work; a block only repeats the state when there are none.
    // Every design fills the card, so what Flyd said about them stays above them, in sight.
    if (job.previews && job.previews.length) {
      if (job.detail) parts.push(frontDetailTalk(job));
      parts.push(frontCandidates(job));
    } else if (job.shots.length || !(split.rest || job.detail || job.ask || job.next || (job.digest && job.digest.changed))) parts.push(frontWork(job));
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

    (job.threads || []).forEach(function (thread, index) {
      if (!index) {
        var time = el("div", "jv-time");
        time.appendChild(el("p", "jv-k", "Timeline"));
        parts.push(time);
      }
      var row = thread.kind === "conversation" ? el("button", "jv-thread", thread.title || "Conversation") : el("p", "jv-thread", thread.title || "Run");
      if (row.tagName === "BUTTON") {
        row.type = "button";
        row.addEventListener("click", function () { connect(thread.id); frontSelect("talk"); });
      }
      parts[parts.length - 1].appendChild(row);
    });
    if (job.files && job.files.length) parts.push(el("p", "jv-files", job.files.map(function (file) { return file.label; }).join(" · ")));
    if (VIEW_TOKEN && Array.isArray(frontUpdate.jobs)) {
      var edit = el("form", "jv-edit");
      var name = el("input");
      name.name = "name";
      name.value = job.title;
      name.maxLength = 60;
      name.setAttribute("aria-label", "Rename this job");
      var rename = el("button", "fbtn", "Rename");
      rename.type = "submit";
      var close = el("button", "fbtn", "Close");
      close.type = "button";
      close.addEventListener("click", function () { frontPostJob({ op: "close", id: job.id }); });
      edit.appendChild(name);
      edit.appendChild(rename);
      edit.appendChild(close);
      edit.addEventListener("submit", function (event) {
        event.preventDefault();
        frontPostJob({ op: "rename", id: job.id, name: name.value });
      });
      parts.push(edit);
    }
    if (job.detail && !(job.previews && job.previews.length)) parts.push(frontDetailTalk(job));
    if (VIEW_TOKEN) {
      if (job.decision) {
        parts.push(sceneAsk({ title: job.title, decision: job.decision }, "flyd-decision:" + (job.decision.decisionId || job.decision.task)));
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
    var drawn = JSON.stringify([job.id, job.state, job.title, job.detail, job.shots, job.previews, job.links, job.decision, job.next, job.ask, job.digest, job.threads, job.files]);
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
      if (frontUpdate) frontDrawJobs(Array.from(frontJobs.values()));
      // On a phone the middle sits under the strips of cards: the job opens where its heading is.
      var stacked = getComputedStyle(stageHead).position !== "fixed";
      if (id === "talk") { if (pinned) toBottom(); }
      else window.scrollTo(0, stacked ? Math.max(0, stageHead.getBoundingClientRect().top + window.scrollY - document.querySelector("header").offsetHeight) : 0);
      fading.forEach(function (node) { node.classList.remove("front-fade"); });
    }, 200);
  }

  function frontListedJob(job) {
    return {
      id: job.id, group: job.group, state: job.state || "", title: frontTitle(job.title), project: job.project || "",
      at: job.at || "", next: job.next || "", owner: job.owner || "", ask: job.ask || "", because: job.because || "",
      digest: job.digest || null, shots: frontShots(job.shots), links: job.links || [], files: job.files || [],
      threads: job.threads || [], detail: job.detail || "", decision: job.decision || null, task: job.task || "",
    };
  }
  function frontPostJob(body) {
    if (!VIEW_TOKEN) return;
    fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": VIEW_TOKEN }, body: JSON.stringify(body) })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!frontUpdate || !Array.isArray(frontUpdate.jobs) || !data.job) return;
        frontUpdate.jobs = frontUpdate.jobs.filter(function (job) { return job.id !== data.job.id && job.id !== body.id; }).concat([data.job]);
        frontDrawn.jobs = "";
        frontDrawn.view = "";
        if (body.op === "close" && frontActive === body.id) frontActive = "talk";
        renderFront();
      })
      .catch(function () {});
  }
  function renderFront(update) {
    if (update) frontUpdate = update;
    if (!frontUpdate) return;
    var jobs = Array.isArray(frontUpdate.jobs) ? frontUpdate.jobs.map(frontListedJob) : frontJobsOf(frontUpdate);
    frontJobs = new Map(jobs.map(function (job) { return [job.id, job]; }));
    frontDrawJobs(jobs);
    frontStage();
  }

  jobsEl.addEventListener("click", function (event) {
    var more = event.target.closest(".fmore");
    if (more) { frontOpen[more.dataset.more] = !frontOpen[more.dataset.more]; renderFront(); return; }
    var card = event.target.closest(".job");
    if (card) frontSelect(card.dataset.job);
  });
  jobsEl.addEventListener("submit", function (event) {
    var form = event.target.closest("form.job-new");
    if (!form) return;
    event.preventDefault();
    var name = form.name.value;
    form.name.value = "";
    frontPostJob({ op: "create", name: name });
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
  document.getElementById("stage-back").addEventListener("click", function () { frontSelect("talk"); });
  window.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || event.defaultPrevented || frontActive === "talk" || !lightbox.hidden) return;
    var from = event.target;
    if (from && from.closest && from.closest("input, textarea, select, [contenteditable]")) return;
    frontSelect("talk");
  });
  // The conversation's heading follows its title as it changes, and so does its card in the column.
  if (window.MutationObserver) new MutationObserver(function () {
    if (!frontUpdate) return;
    frontDrawJobs(frontTalk(frontUpdate), Array.from(frontJobs.values()));
    if (frontActive === "talk") frontStage();
  }).observe(conversationTitle, { childList: true, characterData: true, subtree: true });
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

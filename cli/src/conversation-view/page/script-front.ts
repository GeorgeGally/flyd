/**
 * The front page: the one open job (or the conversation) in the middle; the
 * right column is two tabs, the jobs as cards and the page's own artefact
 * column (#rail: artefacts, notices, news), restyled as cards by front-style.ts.
 * When the stream sends update.jobs, those are the cards: a project George is
 * moving, with the digest already stored on it. The page never asks for a new
 * reading while drawing. Without that list it still maps the fleet (frontJobsOf).
 * A conversation with nothing said yet shows today's feed in the middle. The
 * header's second tab is the News desk: stories, weather and horoscope, and his
 * words there go to the story in front of him through its article conversation.
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
  frontTab(savedTab === "arts" || savedTab === "threads" ? savedTab : "jobs");
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
    return object.kind === "decision" || (object.lifecycle === "interrupted" && object.status !== "paused") || !!(object.monitor && object.monitor.phase === "changed") || phase === "needs_you" || phase === "ready";
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

  // What a card says is read at a glance: one whole sentence that fits, else cut at a word. All of it is in the open job.
  function frontGlance(text, room) {
    var line = frontText(text);
    if (line.length <= room) return line;
    var first = new RegExp("^.{12," + room + "}?[.!?](?=\\\\s|$)").exec(line);
    if (first) return first[0];
    // A clause that stands on its own reads better than a sentence cut short.
    var clause = /^(.{24,})(?:[;:—–]\\s|\\s(?:so|because|which|while|but|with)\\s|,\\s(?:and|so|but)\\s)/.exec(line.slice(0, room + 8));
    if (clause && clause[1].length <= room) return clause[1].replace(/[\\s,]+$/, "");
    var cut = line.lastIndexOf(" ", room - 1);
    return (cut > room / 2 ? line.slice(0, cut) : line.slice(0, room - 1)).replace(/[\\s,;:-]+$/, "").replace(/\\s(?:the|a|an|as|of|in|on|to|and|or|for|with|by|at)$/i, "") + "…";
  }
  // The one line: what he must do, else what changed, else what comes next.
  function frontLine(job) {
    var digest = job.digest || {};
    var needed = digest.needed && !/^(nothing|none|n\\/a)\\b/i.test(digest.needed) ? digest.needed : "";
    var said = needed || digest.changed || digest.means || job.next || (job.group === "working" ? frontNext(job) : frontTitle(job.detail));
    return said && frontText(said).toLowerCase() !== frontText(job.title).toLowerCase() ? frontGlance(said, 52) : "";
  }
  var FRONT_COUNT = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  function frontCounted(count) { return FRONT_COUNT[count] || String(count); }
  // What he must do, said only when it means something: how many wait on him, or how many to pick from.
  function frontMust(job) {
    if (/^lab ready/i.test(job.state)) return job.state;
    if (job.group !== "needs" || !job.decision) return "";
    var open = (job.decision.decisions || []).filter(function (one) { return one && !one.done; });
    if (open.length > 1) return frontCounted(open.length) + " to approve";
    var choices = (job.decision.choices || []).length;
    return choices > 2 ? "Pick one of " + frontCounted(choices).toLowerCase() : "";
  }
  // A card: its project and time on top, the picture lined up with the words, one short line, and what he must do.
  function frontJobCard(job) {
    var pic = job.shots && job.shots.length ? '<img class="shot" src="' + frontEsc(job.shots[0].src) + '" alt="" loading="lazy">' : "";
    // On the job list the title is the project's name; a mapped fleet row has a sentence for a title and its project beside it.
    var name = job.listed ? job.title : job.project;
    var line = frontLine(job);
    var title = job.listed ? "" : '<span class="t">' + frontEsc(frontGlance(job.title, 60)) + '</span>';
    var going = job.group === "working" && !/paus|wait|held/i.test(job.state);
    var must = frontMust(job);
    return '<button type="button" class="job ' + job.group + (pic ? "" : " text") + (job.id === frontActive ? " on" : "") + '" data-job="' + frontEsc(job.id) + '"'
      + (job.id === frontActive ? ' aria-current="true"' : "") + '>'
      + '<span class="top"><span class="tag' + (going ? " go" : "") + '">' + frontEsc(frontGlance(name, 28)) + '</span>'
      + '<span class="w">' + (job.fresh ? '<span class="fnew">New</span> ' : "") + frontEsc(frontWhen(job.at)) + '</span></span>'
      + pic + title + (line ? '<span class="next">' + frontEsc(line) + '</span>' : "")
      + (must ? '<span class="act"><span class="fdot" aria-hidden="true"></span>' + frontEsc(must) + '</span>' : "") + '</button>';
  }
  function frontGroup(label, count, body, extra) {
    return '<section class="fgroup"><h2 class="fhead"><span>' + frontEsc(label) + '</span><span>' + (count === "" ? "" : count) + '</span></h2>'
      + '<div class="fstrip">' + body + '</div>' + (extra || "") + '</section>';
  }
  // The card that offers to link WhatsApp: it stays until he says Done, and Chat opens a conversation for help with it.
  function frontOfferCard() {
    var card = frontUpdate && frontUpdate.whatsappCard;
    if (!card || !VIEW_TOKEN) return "";
    return '<section class="dcard offer"><div class="dtop"><span class="tag">WhatsApp</span></div>'
      + '<p class="offer-line"><a href="' + frontEsc(card.url) + '" target="_blank" rel="noopener noreferrer">' + frontEsc(card.title) + '</a></p><p class="offer-sub">' + frontEsc(card.line) + '</p>'
      + '<div class="offer-acts"><button type="button" class="fbtn" data-offer="done">Done</button><button type="button" class="fbtn" data-offer="chat">Chat</button></div></section>';
  }
  function frontOfferAct(act) {
    var card = frontUpdate && frontUpdate.whatsappCard;
    if (!card) return;
    if (act === "chat") {
      frontSelect("talk");
      chatAbout({ kind: "decision", key: "whatsapp", title: card.title, detail: card.line });
      return;
    }
    fetch("/api/whatsapp-offer", { method: "POST", headers: { "x-flyd-view-token": VIEW_TOKEN } }).catch(function () {});
    frontUpdate.whatsappCard = null;
    renderFront();
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
    var html = frontOfferCard() + (needs.length ? frontGroup("Needs you", needs.length, needs.map(frontJobCard).join("")) : frontGroup("Needs you", known ? 0 : "", "", known ? '<p class="fempty">' + needsEmpty + '</p>' : unread))
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
  function frontHead(job, closable) {
    var dot = job.group === "needs" ? '<span class="fdot" aria-hidden="true"></span>' : "";
    stageCrumb.innerHTML = dot + '<span class="s">' + frontEsc(job.state) + '</span>'
      + (job.project ? '<span aria-hidden="true">·</span><span class="p">' + frontEsc(job.project) + '</span>' : "")
      + (job.at ? '<span aria-hidden="true">·</span><span>' + frontEsc(frontWhen(job.at)) + '</span>' : "");
    // A job on the board closes from its heading: one quiet action, never a row in its timeline.
    if (closable) {
      var close = el("button", "crumb-close", "Close");
      close.type = "button";
      close.addEventListener("click", function () { frontPostJob({ op: "close", id: job.id }); });
      stageCrumb.appendChild(close);
    }
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
    if (job.detail && !(job.previews && job.previews.length)) parts.push(frontDetailTalk(job));
    if (VIEW_TOKEN) {
      if (job.domainRun) {
        parts.push(artefactChat("flyd-domain:" + job.domainRun, { domainRun: job.domainRun, jobTitle: job.title, questionText: job.questionIdentity }, "Your answer…").form);
      } else if (job.decision) {
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
    frontHead(job, VIEW_TOKEN && Array.isArray(frontUpdate.jobs));
    var drawn = JSON.stringify([job.id, job.state, job.title, job.detail, job.shots, job.previews, job.links, job.decision, job.domainRun, job.questionIdentity, job.next, job.ask, job.digest, job.threads, job.files]);
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
      id: job.id, listed: true, group: job.group, state: job.state || "", title: frontTitle(job.title), project: job.project || "",
      at: job.at || "", next: job.next || "", owner: job.owner || "", ask: job.ask || "", questionIdentity: job.questionIdentity || "", because: job.because || "",
      digest: job.digest || null, shots: frontShots(job.shots), links: job.links || [], files: job.files || [],
      threads: job.threads || [], detail: job.detail || "", decision: job.decision || null, task: job.task || "", domainRun: job.domainRun || "",
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
    frontFeed();
    if (frontRoot.dataset.fmode === "news" && !deskRead && VIEW_TOKEN) deskLoad();
  }

  // Today's feed: the home page when nothing has been said in this conversation.
  var feedEl = document.getElementById("today-feed");
  var feedDrawn = "";
  function feedWhen(iso) {
    var when = frontWhen(iso);
    if (iso.length <= 10) return when;
    var time = clock(iso);
    return when && when !== time ? when + " " + time : time;
  }
  function frontFeed() {
    var notes = frontUpdate.today;
    var said = (frontUpdate.order || []).length > 0 || !!main.querySelector(".msg.pending");
    var shows = Array.isArray(notes) && !said && !articleStarters.length && !inThread();
    if (shows && feedEl.hidden && frontRoot.dataset.fmode !== "news") window.scrollTo(0, 0);
    feedEl.hidden = !shows;
    frontRoot.toggleAttribute("data-feed", shows);
    if (!shows) return;
    document.getElementById("empty").hidden = true;
    var html = notes.map(function (note) {
      return '<article class="ev' + (note.moving ? " now" : "") + '"><time>' + frontEsc(feedWhen(note.at)) + '</time><p>' + frontEsc(frontTitle(note.text))
        + (note.aside ? ' <span>' + frontEsc(note.aside) + '</span>' : "") + '</p>'
        + (note.shot ? '<img src="' + frontEsc(withToken(note.shot)) + '" alt="" loading="lazy">' : "") + '</article>';
    }).join("") || '<p class="today-quiet">Nothing has moved yet today.</p>';
    if (html === feedDrawn) return;
    feedDrawn = html;
    feedEl.innerHTML = html;
  }

  // The header's two tabs. News keeps the message box and gives it to the story being read.
  var fmodeEl = document.getElementById("fmode");
  var deskNews = document.getElementById("desk-news");
  var deskSide = document.getElementById("desk-side");
  var boxWords = input.placeholder;
  var deskRead = false;
  var deskRetries = 0;
  var deskPicked = null;
  function frontMode(name) {
    if (frontRoot.dataset.fmode === name) return;
    frontRoot.dataset.fmode = name;
    fmodeEl.querySelectorAll("button").forEach(function (tab) { tab.setAttribute("aria-pressed", String(tab.dataset.mode === name)); });
    try { sessionStorage.setItem("flyd-front-mode", name); } catch (_) {}
    window.scrollTo(0, 0);
    if (name === "news") { deskLoad(); deskFollow(); }
    else { input.placeholder = boxWords; if (pinned) toBottom(); }
  }
  fmodeEl.addEventListener("click", function (event) {
    var tab = event.target.closest("button");
    if (tab) frontMode(tab.dataset.mode);
  });
  function deskLoad() {
    if (!VIEW_TOKEN) return;
    deskRead = true;
    fetch("/api/desk?token=" + encodeURIComponent(VIEW_TOKEN)).then(function (response) { return response.ok ? response.json() : null; })
      .then(function (desk) {
        if (!desk) return;
        deskDraw(desk);
        // Just after Core starts the first readings are still on their way.
        if ((!desk.weather || !desk.horoscope) && deskRetries++ < 3) setTimeout(deskLoad, 4000);
      }).catch(function () {});
  }
  function deskDay(day) { return new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)); }
  function deskSameDay(day) { return deskDay(day).toDateString() === new Date().toDateString(); }
  function deskStory(story, index) {
    var art = el("article", "dstory" + (index === 0 ? " lead" : ""));
    art.tabIndex = 0;
    art.story = story;
    if (story.image && story.image.indexOf("/api/story-image?") === 0) {
      var img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", function () { img.remove(); });
      img.src = withToken(story.image);
      art.appendChild(img);
    }
    var src = el("a", "src", story.source || "Read it");
    src.href = story.url;
    src.target = "_blank";
    src.rel = "noopener noreferrer";
    src.addEventListener("click", function (event) { event.stopPropagation(); });
    art.appendChild(src);
    art.appendChild(el("h2", "", story.title));
    if (story.gist) art.appendChild(el("p", "", story.gist));
    art.addEventListener("click", function () { deskPick(art); input.focus(); });
    return art;
  }
  function deskPick(art) {
    deskNews.querySelectorAll(".dstory").forEach(function (one) { one.classList.toggle("on", one === art); });
    deskPicked = art ? art.story : null;
    if (frontRoot.dataset.fmode === "news") input.placeholder = deskPicked ? "Ask about " + frontGlance(deskPicked.title, 40) : boxWords;
  }
  // The box follows the story he is reading.
  function deskFollow() {
    if (frontRoot.dataset.fmode !== "news") return;
    var line = document.querySelector("header").offsetHeight + 60;
    var stories = Array.prototype.slice.call(deskNews.querySelectorAll(".dstory"));
    deskPick(stories.filter(function (one) { return one.getBoundingClientRect().bottom > line; })[0] || stories[0] || null);
  }
  window.addEventListener("scroll", deskFollow, { passive: true });
  function deskDraw(desk) {
    var stories = desk.news && desk.news.stories || [];
    var body = stories.map(deskStory);
    var head = desk.news && !deskSameDay(desk.news.updated)
      ? [el("p", "desk-head", "Last updated " + deskDay(desk.news.updated).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }))] : [];
    deskNews.replaceChildren.apply(deskNews, head.concat(body.length ? body : [el("p", "desk-head", "No news yet.")]));
    deskFollow();
    deskSide.innerHTML = (desk.weather ? deskWeather(desk.weather) : "") + (desk.horoscope ? deskHoroscope(desk.horoscope) : "");
  }
  function wxKind(code, night) {
    if (code <= 1) return night ? "moon" : "sun";
    if (code === 2) return night ? "cloud" : "few";
    if (code === 3 || code === 45 || code === 48) return "cloud";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    return code >= 95 ? "storm" : "rain";
  }
  function wxIcon(kind, big) { return '<svg class="ic' + (big ? " big" : "") + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#wx-' + kind + '"/></svg>'; }
  function deg(value) { return Math.round(value) + "°"; }
  function deskWeather(weather) {
    var hours = (weather.hours || []).filter(function (hour, index) { return index % 2 === 1 && typeof hour.code === "number"; }).slice(0, 6).map(function (hour) {
      return '<li><time>' + frontEsc(hour.at.slice(11, 16)) + '</time>' + wxIcon(wxKind(hour.code, hour.night)) + '<b>' + deg(hour.tempC) + '</b><span>' + Math.round(hour.rainChance) + '%</span></li>';
    }).join("");
    var days = (weather.days || []).slice(0, 5).map(function (day) {
      return '<li><time>' + frontEsc(deskDay(day.day).toLocaleDateString([], { weekday: "short" })) + '</time>' + wxIcon(wxKind(day.code)) + '<b>' + deg(day.highC) + '</b><span>' + deg(day.lowC) + '</span></li>';
    }).join("");
    return '<section class="dcard"><div class="dtop"><span class="tag">' + frontEsc(weather.place || "Weather") + '</span><time>' + frontEsc(clock(weather.read)) + '</time></div>'
      + '<div class="wx-now">' + wxIcon(wxKind(weather.code, weather.night), true) + '<div class="deg">' + deg(weather.tempC) + '</div></div>'
      + (hours ? '<ul class="wx">' + hours + '</ul>' : "") + (days ? '<ul class="wx days">' + days + '</ul>' : "") + '</section>';
  }
  function deskHoroscope(reading) {
    return '<section class="dcard"><div class="dtop"><span class="tag">' + frontEsc(reading.sign) + '</span><time>' + frontEsc(frontWhen(reading.day)) + '</time></div>'
      + '<p class="say">' + frontEsc(reading.text) + '</p><a class="by" href="' + frontEsc(frontHttp(reading.url)) + '" target="_blank" rel="noopener noreferrer">' + frontEsc(reading.source) + '</a></section>';
  }
  // His words on the News tab: the story's own conversation opens, then takes them. Nothing leaves the box until it has.
  function deskSends(text) {
    if (frontRoot.dataset.fmode !== "news" || !deskPicked) return false;
    openArticle(deskPicked, text);
    return true;
  }
  function deskSay(session, words) {
    var tries = 0;
    (function when() {
      if (current === session) { input.value = words; composer.requestSubmit(); return; }
      if (tries++ < 100) setTimeout(when, 100);
    })();
  }

  jobsEl.addEventListener("click", function (event) {
    var offer = event.target.closest("[data-offer]");
    if (offer) { frontOfferAct(offer.dataset.offer); return; }
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
  document.getElementById("stage-back").addEventListener("click", function () {
    frontSelect("talk");
    if (!inThread()) return;
    // Out of a thread: back to this window's own conversation.
    explicit = null;
    try { explicit = sessionStorage.getItem("flyd-window-session"); } catch (_) {}
    window.history.replaceState(null, "", location.pathname);
    connect(explicit);
    loadThreads();
  });
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
  setInterval(function () { if (frontRoot.dataset.fmode === "news") deskLoad(); }, 600000);
  (function () {
    var saved = "today";
    try { saved = sessionStorage.getItem("flyd-front-mode") || "today"; } catch (_) {}
    frontRoot.dataset.fmode = "today";
    if (saved === "news") frontMode("news");
  })();
  function frontToday() { frontDate.textContent = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }); }
  frontToday();
  setInterval(function () { frontToday(); renderFront(); }, 60000);
`;

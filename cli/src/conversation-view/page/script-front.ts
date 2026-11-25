/**
 * The front page: the one open job (or the conversation) in the middle; the
 * right column is two tabs, the jobs as cards and the page's own artefact
 * column (#rail: artefacts, notices, news), restyled as cards by front-style.ts.
 * When the stream sends update.jobs, those are the cards: a project George is
 * moving, with the digest already stored on it. The page never asks for a new
 * reading while drawing. Core places every card (placement.ts); the page never re-sorts them.
 * A group with nothing in it says something true. Runs inside the page script's
 * closure and borrows its helpers (el, ago, clock, withToken, sceneAsk,
 * artefactChat, openImage, store, cardRead, itemKey, connect).
 */
import { PLACE_WORDS, STATE_WORDS } from "../placement.js";

export const FRONT_SCRIPT = `
  // The one set of words for where work sits, as Core says it (placement.ts).
  var PLACE_WORDS = ${JSON.stringify(PLACE_WORDS)};
  var PLACE_STATES = ${JSON.stringify(STATE_WORDS)};
  // The front page: jobs, the one open job, artefacts.
  var frontRoot = document.documentElement;
  var jobsEl = document.getElementById("jobs");
  var jobsList = document.getElementById("jobs-list");
  var todosEl = document.getElementById("todos");
  var jobView = document.getElementById("job-view");
  var stageHead = document.getElementById("stage-head");
  var stageCrumb = document.getElementById("stage-crumb");
  var stageTitle = document.getElementById("stage-title");
  var stageSub = document.getElementById("stage-sub");
  var frontDate = document.getElementById("front-date");
  var frontJobs = new Map();
  var frontActive = "talk";
  try { frontActive = sessionStorage.getItem("flyd-front-job") || "talk"; } catch (_) {}
  var frontOpen = { done: false };
  var frontUpdate = null;
  var frontDrawn = { jobs: "", view: "", viewId: "" };
  var frontVersion = {};
  var DONE_FEW_FRONT = 5;
  var MOVING_FEW_FRONT = 8;

  // The right column's tabs; the choice is remembered.
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
    if (!tab) return;
    frontTab(tab.dataset.rtab);
    frontKeepTyping();
  });
  // Changing what the right column shows never leaves the message box without the keys: they go back to it,
  // unless he is in another field. Not on a phone, where focusing would raise the keyboard uninvited.
  function frontKeepTyping() {
    if (composer.hidden || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) return;
    var active = document.activeElement;
    if (active && active !== input && active.closest && active.closest("input, textarea, select, [contenteditable]")) return;
    try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
  }

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
  // A card's title in his words, with the framing gone.
  function frontHeading(text, project) {
    if (/^act on\\s+(?:george's|the captain's|his|your)?\\s*answer\\b/i.test(frontText(text))) {
      return "Carrying out your choice" + (project ? " on " + project : "");
    }
    return frontTitle(text);
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
  function frontTalk(update) {
    return { id: "talk", group: "talk", state: update.working ? "Working" : "With " + assistant, title: conversationTitle.textContent || "New conversation",
      project: frontProject(update.project), at: lastActivity || "" };
  }

  // The one line: what he must do, else what changed, else what comes next.
  function frontLine(job) {
    var digest = job.digest || {};
    var needed = digest.needed && !/^(nothing|none|n\\/a)\\b/i.test(digest.needed) ? digest.needed : "";
    var said = needed || digest.changed || job.next || job.ask || frontTitle(job.detail);
    return frontText(said || job.title);
  }
  // The card's action line: a concrete next step in real counts or Flyd's own pick, else nothing.
  function frontAction(job) {
    var decision = job.group === "needs" && job.decision;
    if (!decision) return "";
    var list = Array.isArray(decision.decisions) ? decision.decisions : [];
    if (list.length > 1) return list.filter(function (one) { return one && one.done; }).length + " of " + list.length + " decided";
    return decision.recommended ? "Go with " + frontText(choiceLabel(job.labels, decision.recommended)) : "";
  }
  // A job card: the picture (work under way is words only), what it says, its next step, then the project and when in plain words; no label above it.
  // A decision with a few named answers takes them on the card itself, one tap each, the recommended one first.
  function frontJobPicks(job) {
    if (!VIEW_TOKEN || job.group !== "needs" || !job.choices || !job.choices.length) return "";
    var picked = frontPicked(job);
    var buttons = choicesInOrder(job.choices, job.recommended).map(function (choice) {
      var on = picked && picked.choice === choice;
      return '<button type="button" class="jpick' + (choice === job.recommended ? " primary" : "") + '" data-pick-job="' + frontEsc(job.id) + '" data-pick="' + frontEsc(choice) + '"'
        + ' aria-pressed="' + (on ? "true" : "false") + '"' + (picked ? " disabled" : "") + '>' + frontEsc(choiceLabel(job.labels, choice)) + '</button>';
    }).join("");
    return '<div class="jpicks" role="group" aria-label="Answers">' + buttons + '</div>'
      + (picked ? '<p class="jsent" role="status">' + frontEsc(picked.line) + '</p>' : "");
  }
  function frontJobCard(job) {
    var picks = frontJobPicks(job);
    var card = frontJobButton(job, !!picks);
    return picks ? '<div class="jobask' + (job.id === frontActive ? " on" : "") + '">' + card + picks + '</div>' : card;
  }
  function frontJobButton(job, picks) {
    // Work under way is words only; every other card may lead with its picture.
    var moving = job.group === "moving" && job.state === "Working";
    var pic = !moving && job.shots && job.shots.length
      ? '<div class="frame"><img src="' + frontEsc(job.shots[0].src) + '" alt="" loading="lazy"></div>' : "";
    var line = frontLine(job);
    var reading = line ? '<p class="next">' + frontEsc(line) + '</p>' : "";
    // Buttons that say the answers need no line naming Flyd's pick.
    var action = picks ? "" : frontAction(job);
    var tag = job.project || sideNowLine(job.title, 40);
    return '<button type="button" class="job ' + job.group + (pic ? "" : " text") + (job.id === frontActive ? " on" : "") + '" data-job="' + frontEsc(job.id) + '"'
      + (job.id === frontActive ? ' aria-current="true"' : "") + '>'
      + pic + reading + (action ? '<span class="act"><i class="fdot" aria-hidden="true"></i>' + frontEsc(action) + '</span>' : "")
      + '<span class="jfoot"><span class="jproject">' + frontEsc(tag) + '</span>'
      + '<span class="w">' + (job.fresh ? '<span class="fnew">New</span> ' : "") + frontEsc(frontWhen(job.at)) + '</span></span></button>';
  }
  function frontGroup(label, count, body, extra) {
    return '<section class="fgroup"><h2 class="fhead"><span>' + frontEsc(label) + '</span><span>' + (count === "" ? "" : count) + '</span></h2>'
      + '<div class="fstrip">' + body + '</div>' + (extra || "") + '</section>';
  }
  // A section that holds many shows its newest few, with the rest one tap away.
  function frontSection(key, label, list, empty, few) {
    if (!list.length) return frontGroup(label, 0, "", '<p class="fempty">' + empty + '</p>');
    var shown = frontOpen[key] ? list : list.slice(0, few);
    return frontGroup(label, list.length, shown.map(frontJobCard).join(""),
      list.length > few ? '<button type="button" class="fmore" data-more="' + key + '">' + (frontOpen[key] ? "Show fewer" : "Show all " + list.length) + '</button>' : "");
  }
  // Next remembers whether he opened it, across redraws.
  jobsList.addEventListener("toggle", function (event) {
    if (event.target.classList && event.target.classList.contains("fnext")) frontOpen.next = event.target.open;
  }, true);
  // Work not yet under way: one closed line with its count, opened on a tap.
  function frontNext(list) {
    if (!list.length) return "";
    return '<details class="fgroup fnext"' + (frontOpen.next ? " open" : "") + '><summary class="fhead"><span>Next</span><span>' + list.length + '</span></summary>'
      + '<div class="fstrip">' + list.map(frontJobCard).join("") + '</div></details>';
  }
  // One line a job: the project, a small dot that tells where it stands when pointed at, and what is happening now.
  // A line that changed since it was last drawn rises into place, the way a live status line does; nothing overlaps.
  var frontLinesSaid = {};
  var frontLinesFresh = {};
  function frontNowLine(job) {
    var tone = job.group === "done" ? "done" : "moving";
    var line = sideNowLine(frontLine(job));
    var detail = sideDotDetail(job, frontWhen(job.at));
    return '<button type="button" class="job line ' + job.group + (job.id === frontActive ? " on" : "") + '" data-job="' + frontEsc(job.id) + '"'
      + (job.id === frontActive ? ' aria-current="true"' : "") + '>'
      + '<span class="ltop"><span class="jproject">' + frontEsc(job.project || sideNowLine(job.title, 40)) + '</span>'
      + '<i class="ldot" data-tone="' + tone + '" title="' + frontEsc(detail) + '" role="img" aria-label="' + frontEsc(detail) + '"></i></span>'
      + '<span class="next' + (frontLinesFresh[job.id] ? " swap-in" : "") + '">' + frontEsc(line) + '</span></button>';
  }
  // Now: what is under way, then what finished lately, each as one line.
  function frontNow(moving, done) {
    var lines = moving.concat(done);
    if (!lines.length) return frontGroup("Now", 0, "", '<p class="fempty">Nothing is under way right now.</p>');
    var few = moving.slice(0, MOVING_FEW_FRONT).concat(done.slice(0, DONE_FEW_FRONT));
    var shown = frontOpen.now ? lines : few;
    return '<section class="fgroup fnow"><h2 class="fhead"><span>Now</span><span>' + lines.length + '</span></h2>'
      + '<div class="flines">' + shown.map(frontNowLine).join("") + '</div>'
      + (lines.length > few.length ? '<button type="button" class="fmore" data-more="now">' + (frontOpen.now ? "Show fewer" : "Show all " + lines.length) + '</button>' : "") + '</section>';
  }
  // Made: his newest artefacts as picture cards, always on the home column; the Made tab keeps all of them.
  var MADE_FEW_FRONT = 3;
  function frontMadeKey(card) { return card.id || card.title; }
  function frontMadeCards() {
    var all = typeof lastArtefacts !== "undefined" ? lastArtefacts : [];
    return all.filter(function (card) { return card && card.title && !card.down && (card.image || card.preview) && !(/^landed:/.test(card.id) && !card.image); })
      .sort(function (a, b) { return (b.image ? 1 : 0) - (a.image ? 1 : 0); });
  }
  function frontMadeCard(card) {
    var line = sideFlat(card.line);
    var by = (line && line !== sideFlat(card.title) ? sideNowLine(line, 60) + (card.at ? " · " : "") : "") + (card.at ? ago(card.at) : "");
    var href = card.url ? (/^\\/api\\//.test(card.url) ? withToken(card.url) : card.url) : "";
    var inner = (card.image ? '<span class="cframe"><img src="' + frontEsc(/^\\/api\\//.test(card.image) ? withToken(card.image) : card.image) + '" alt="" loading="lazy"></span>' : "")
      + '<span class="ctitle">' + frontEsc(sideFlat(card.title)) + '</span>'
      + (by ? '<span class="cby">' + frontEsc(by) + '</span>' : "");
    return href
      ? '<a class="ccard" href="' + frontEsc(href) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
      : '<div class="ccard">' + inner + '</div>';
  }
  function frontMade() {
    var cards = frontMadeCards();
    if (!cards.length) return frontGroup("Made", 0, "", '<p class="fempty">Nothing made yet.</p>');
    return '<section class="fgroup fmade"><h2 class="fhead"><span>Made</span><span>' + cards.length + '</span></h2>'
      + '<div class="ccards">' + cards.slice(0, MADE_FEW_FRONT).map(frontMadeCard).join("") + '</div>'
      + (cards.length > MADE_FEW_FRONT ? '<button type="button" class="fmore" data-made-all>See all ' + cards.length + '</button>' : "") + '</section>';
  }
  // For this chat: what the page already holds that matches what he is talking about. A picture only when the item means it to be seen.
  function frontChatWords() {
    return Array.prototype.slice.call(document.querySelectorAll("#stream .msg.user .body")).slice(-3).map(function (body) { return body.textContent || ""; });
  }
  function frontChatItems() {
    var items = [];
    (typeof lastArtefacts !== "undefined" ? lastArtefacts : []).forEach(function (card) {
      if (!card || !card.title) return;
      items.push({ kind: "Made", title: card.title, text: card.line || "", at: card.at || "", url: card.url && !card.down ? (/^\\/api\\//.test(card.url) ? withToken(card.url) : card.url) : "" });
    });
    var left = frontUpdate && frontUpdate.leftColumn;
    ((left && left.recent) || []).forEach(function (item) {
      if (!item || item.kind !== "news") return;
      (item.stories || []).forEach(function (story) {
        var own = typeof story.image === "string" && story.image.indexOf("/api/story-image?") === 0;
        items.push({ kind: "News", title: story.title || "", text: story.gist || "", by: story.source || "", at: item.at || "", url: frontHttp(story.url),
          image: own ? withToken(story.image) : "", intentional: own && (story.media === "image" || story.media === "video") });
      });
    });
    return items;
  }
  function frontChatCard(item) {
    var picture = sidePicture(item);
    var by = item.kind + (item.by ? " · " + item.by : item.at ? " · " + frontWhen(item.at) : "");
    var inner = (picture ? '<span class="cframe"><img src="' + frontEsc(picture) + '" alt="" loading="lazy"></span>' : "")
      + '<span class="ctitle">' + frontEsc(sideFlat(item.title)) + '</span>'
      + (item.text ? '<span class="ctext">' + frontEsc(sideNowLine(item.text, 140)) + '</span>' : "")
      + '<span class="cby">' + frontEsc(by) + '</span>';
    return item.url
      ? '<a class="ccard" href="' + frontEsc(item.url) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
      : '<div class="ccard">' + inner + '</div>';
  }
  // What he is talking about is looked up once the chat settles (a pause after his newest words), or when he asks for more;
  // never on every change. Scout's stories already on the page match at once; the Evidence Engine's arrive after.
  var CHAT_SETTLE_MS = 2000;
  var frontChat = { key: "", terms: [], looking: false, found: [], fresh: false, waiting: "", timer: 0, ask: 0 };
  function frontChatSettle() {
    var terms = sideTerms(frontChatWords());
    var key = terms.join(",");
    if (frontChat.waiting && key === frontChat.waiting) return;
    clearTimeout(frontChat.timer);
    frontChat.waiting = "";
    if (key === frontChat.key) return;
    if (!terms.length) { frontChat.ask++; frontChat.key = ""; frontChat.terms = []; frontChat.found = []; frontChat.looking = false; return; }
    frontChat.waiting = key;
    frontChat.timer = setTimeout(function () { frontChat.waiting = ""; frontChatLook(terms); }, frontChat.key ? CHAT_SETTLE_MS : 0);
  }
  function frontChatLook(terms) {
    var ask = ++frontChat.ask;
    frontChat.key = terms.join(",");
    frontChat.terms = terms;
    frontChat.found = [];
    frontChat.looking = !!VIEW_TOKEN;
    frontChatRedraw();
    if (!VIEW_TOKEN) return;
    var done = function (items) {
      if (ask !== frontChat.ask) return;
      frontChat.looking = false;
      frontChat.found = Array.isArray(items) ? items.filter(function (item) { return item && item.title; }).map(function (item) {
        return { kind: item.kind || "Fact", title: item.title, text: item.text || "", by: item.by || "", at: item.at || "", url: frontHttp(item.url) };
      }) : [];
      frontChat.fresh = true;
      frontChatRedraw();
    };
    fetch(withToken("/api/inspirations?q=" + encodeURIComponent(frontChat.key)))
      .then(function (response) { return response.ok ? response.json() : {}; })
      .then(function (data) { done(data && data.items); }, function () { done([]); });
  }
  function frontChatRedraw() {
    frontDrawn.jobs = "";
    if (frontUpdate) frontDrawJobs(Array.from(frontJobs.values()));
  }
  function frontForChat() {
    var terms = frontChat.terms;
    if (!terms.length) return "";
    var seen = {};
    var found = sideMatches(frontChatItems(), terms, 4).concat(frontChat.found).filter(function (item) {
      var key = item.url || item.title;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, 8);
    // Nothing that matches, and nothing still being looked for, takes no room at all.
    if (!found.length && !frontChat.looking) return "";
    var arrive = frontChat.fresh;
    frontChat.fresh = false;
    var cards = found.map(function (item, at) {
      var card = frontChatCard(item);
      return arrive ? card.replace('class="ccard"', 'class="ccard arrive" style="--i:' + at + '"') : card;
    }).join("");
    var shimmer = frontChat.looking ? '<div class="ccard shimmer" aria-hidden="true"><span></span><span></span><span></span></div>'.repeat(found.length ? 1 : 3) : "";
    return '<section class="fgroup fchat"><h2 class="fhead"><span>For this chat</span><span></span></h2>'
      + '<p class="fterms" role="status">' + (frontChat.looking ? "Looking for " + frontEsc(terms.join(", ")) + "…" : "From " + frontEsc(terms.join(", "))) + '</p>'
      + '<div class="ccards">' + cards + shimmer + '</div>'
      + (frontChat.looking ? "" : '<button type="button" class="fmore" data-chat-more>Find more</button>') + '</section>';
  }
  // On a phone the sidebar folds into one live line under the top line: what needs him first, else what is moving.
  var nowStrip = document.getElementById("now-strip");
  var nowStripDot = document.getElementById("now-strip-dot");
  var nowStripText = document.getElementById("now-strip-text");
  function frontStrip(needs, lines) {
    if (!nowStrip) return;
    var lead = needs[0] || lines[0];
    nowStrip.hidden = false;
    var said = lead ? (lead.project ? lead.project + ": " : "") + sideNowLine(frontLine(lead)) : "Nothing is under way right now.";
    nowStripDot.dataset.tone = !lead ? "idle" : lead.group === "needs" ? "needs" : lead.group === "done" ? "done" : "moving";
    nowStripDot.title = lead ? sideDotDetail(lead, frontWhen(lead.at)) : "";
    if (nowStripText.textContent !== said) {
      nowStripText.textContent = said;
      nowStripText.classList.remove("swap-in");
      void nowStripText.offsetWidth;
      nowStripText.classList.add("swap-in");
    }
  }
  if (nowStrip) {
    nowStrip.addEventListener("click", function () { frontRoot.toggleAttribute("data-sheet"); });
    jobsEl.addEventListener("click", function (event) {
      if (event.target.closest(".job, .ccard, .sheet-close")) frontRoot.removeAttribute("data-sheet");
    });
  }
  // His move first, as Core placed it; then one line a job for what is moving and what finished; what waits folds under Next.
  function frontDrawJobs(jobs) {
    var listed = !!(frontUpdate && Array.isArray(frontUpdate.jobs));
    var needs = jobs.filter(function (job) { return job.group === "needs"; });
    // Now holds work actually under way, then what finished lately; queued, paused and held-up work waits folded under Next.
    var moving = jobs.filter(function (job) { return job.group === "moving" && String(job.state).indexOf(PLACE_STATES.running) === 0; });
    var next = jobs.filter(function (job) { return job.group === "moving" && String(job.state).indexOf(PLACE_STATES.running) !== 0; });
    var done = jobs.filter(function (job) { return job.group === "done" && !job.bare; });
    var lines = moving.concat(done);
    var said = {};
    frontLinesFresh = {};
    lines.forEach(function (job) {
      said[job.id] = sideNowLine(frontLine(job));
      if (frontLinesSaid[job.id] !== undefined && frontLinesSaid[job.id] !== said[job.id]) frontLinesFresh[job.id] = true;
    });
    frontLinesSaid = said;
    rtabDot.hidden = !needs.length;
    if (listed) frontStrip(needs, lines);
    frontChatSettle();
    var html = !listed ? '<p class="fempty">Checking…</p>'
      : frontSection("needs", PLACE_WORDS.needs, needs, "No decision is waiting.", Infinity)
        + frontNow(moving, done)
        + frontMade()
        + frontNext(next)
        + frontForChat();
    if (html === frontDrawn.jobs) return;
    frontDrawn.jobs = html;
    if (todosEl) jobsEl.insertAdjacentElement("afterend", todosEl);
    jobsList.innerHTML = html;
    var needsGroup = listed && jobsList.querySelector(".fgroup");
    if (todosEl && needsGroup) needsGroup.insertBefore(todosEl, needsGroup.querySelector(".fstrip").nextSibling);
    frontNeedsCount();
  }
  // Needs you counts his calls and his own to-dos alike.
  function frontNeedsCount() {
    var needsGroup = jobsList.querySelector(".fgroup");
    var todos = needsGroup && needsGroup.querySelector("#todos");
    if (!todos) return;
    var count = needsGroup.querySelectorAll(".fstrip .job").length + todos.querySelectorAll(".todo").length;
    var empty = needsGroup.querySelector(":scope > .fempty");
    if (empty) empty.hidden = count > 0;
    needsGroup.querySelector(".fhead span:last-child").textContent = count ? String(count) : "0";
  }

  // The open job's heading: what the open job is, then its state, where and when said as one plain line under it; nothing above the title.
  function frontHead(job, closable) {
    stageCrumb.textContent = "";
    var where = (job.state || "") + (job.project ? (job.state ? " in " : "In ") + job.project : "") + (job.at ? (job.state || job.project ? ", " : "") + frontWhen(job.at) : "");
    var dot = job.group === "needs" ? '<span class="fdot" aria-hidden="true"></span>' : "";
    stageSub.innerHTML = where ? dot + '<span>' + frontEsc(where) + '</span>' : "";
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
    var shown = el("div", "jv-shot");
    shown.appendChild(view);
    var foot = el("div", "jv-shot-foot");
    var named = el("span", "jv-shot-name", shots[at].label || "Picture " + (at + 1));
    foot.appendChild(named);
    var reply = frontReplyButton(job, function () { var shot = shots[frontVersion[job.id] || 0] || shots[0]; return { label: shot.label || "Picture " + ((frontVersion[job.id] || 0) + 1), src: shot.src }; });
    if (reply) foot.appendChild(reply);
    shown.appendChild(foot);
    work.appendChild(shown);
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
          named.textContent = shot.label || "Picture " + (index + 1);
          if (reply) reply.setAttribute("aria-label", "Reply about " + named.textContent);
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
      var caption = el("figcaption", "");
      caption.appendChild(el("span", "", preview.label));
      var reply = frontReplyButton(job, function () { return { label: preview.label, src: preview.image }; });
      if (reply) caption.appendChild(reply);
      candidate.appendChild(caption);
      var pair = el("div", "jv-pair");
      pair.appendChild(frontCandidatePicture(preview.image, preview.label, "jv-view"));
      if (preview.phone) pair.appendChild(frontCandidatePicture(preview.phone, preview.label + " on a phone", "jv-phone"));
      candidate.appendChild(pair);
      wrap.appendChild(candidate);
    });
    return wrap;
  }
  // A reply about one picture: the job's own box opens on it, naming the picture, with the picture attached.
  // \`picked\` says which picture at the moment he taps, so a version switched to since is the one quoted.
  function frontReplyButton(job, picked) {
    if (!VIEW_TOKEN || job.handled) return null;
    var button = el("button", "fbtn jv-reply", "Reply to this picture");
    button.type = "button";
    button.setAttribute("aria-label", "Reply about " + picked().label);
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      var shot = picked();
      frontAnswer(job).chat.quote(shot.label, shot.src);
    });
    return button;
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
    if (job.digest && (job.digest.changed || job.digest.needed)) {
      // Flyd telling him: what changed, then what he needs to do. One sentence a line, no labels.
      var block = el("div", "jv-digest");
      var needed = job.digest.needed && !/^(nothing|none|n\\/a)\\b/i.test(job.digest.needed) ? job.digest.needed : "";
      [job.digest.changed, needed].forEach(function (said) {
        if (said) block.appendChild(el("p", "", said));
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
      // Only whether the move is his: who on the staff carries it is Flyd's business.
      if (job.owner === "you") next.appendChild(el("span", "own", " · you"));
      parts.push(next);
    }
    // With no picture, the words are the work; a block only repeats the state when there are none.
    // Every design fills the card, so what Flyd said about them stays above them, in sight.
    if (job.previews && job.previews.length) {
      if (job.detail) parts.push(frontDetailTalk(job));
      parts.push(frontCandidates(job));
    } else if (job.shots.length || !(split.rest || job.detail || job.ask || job.next || (job.digest && job.digest.changed))) parts.push(frontWork(job));
    var links = (job.links || []).filter(function (link) { return link && link.url && !link.closed; });
    // The job itself can always be answered from the top: Reply takes him to its box.
    var replyJob = VIEW_TOKEN && !job.handled;
    var seeWork = document.body.dataset.workCanvas === "1" && Boolean((job.shots && job.shots.length) || (job.previews && job.previews.length));
    if (links.length || replyJob || seeWork) {
      var acts = el("div", "jv-acts");
      if (replyJob) {
        var replyAll = el("button", "fbtn jv-reply", "Reply");
        replyAll.type = "button";
        replyAll.setAttribute("aria-label", "Reply about this job");
        replyAll.addEventListener("click", function () { frontAnswer(job).chat.quote("", ""); });
        acts.appendChild(replyAll);
      }
      if (seeWork) {
        var canvas = el("a", "fbtn", "See work");
        canvas.href = "/work";
        acts.appendChild(canvas);
      }
      links.forEach(function (link) {
        var a = el("a", "fbtn", link.label || "Open");
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        acts.appendChild(a);
      });
      parts.push(acts);
    }

    // The Timeline sits behind one small link, closed until he opens it; each entry is said whole.
    if ((job.threads || []).length) {
      var time = el("div", "jv-time");
      var timeKey = "flyd-timeline:" + job.id;
      var opened = false;
      try { opened = sessionStorage.getItem(timeKey) === "open"; } catch (_) {}
      var toggle = el("button", "jv-time-toggle", "Timeline");
      toggle.type = "button";
      var entries = el("div", "jv-time-list");
      entries.id = "jv-time-" + job.id.replace(/[^A-Za-z0-9_-]/g, "-");
      toggle.setAttribute("aria-controls", entries.id);
      toggle.setAttribute("aria-expanded", String(opened));
      entries.hidden = !opened;
      toggle.addEventListener("click", function () {
        entries.hidden = !entries.hidden;
        toggle.setAttribute("aria-expanded", String(!entries.hidden));
        try { sessionStorage.setItem(timeKey, entries.hidden ? "closed" : "open"); } catch (_) {}
      });
      job.threads.forEach(function (thread) {
        var said = thread.full || thread.title || (thread.kind === "conversation" ? "Conversation" : "Run");
        var row = thread.kind === "conversation" ? el("button", "jv-thread", said) : el("p", "jv-thread", said);
        if (row.tagName === "BUTTON") {
          row.type = "button";
          row.addEventListener("click", function () { setCentre("talk", true); connect(thread.id); frontSelect("talk"); });
        }
        entries.appendChild(row);
      });
      time.appendChild(toggle);
      time.appendChild(entries);
      parts.push(time);
    }
    if (job.files && job.files.length) parts.push(el("p", "jv-files", job.files.map(function (file) { return file.label; }).join(" · ")));
    if (job.detail && !(job.previews && job.previews.length)) parts.push(frontDetailTalk(job));
    if (VIEW_TOKEN) {
      if (job.handled) {
        parts.push(artefactChat("flyd-handled:" + job.handled.decisionId, { decisionFollowUp: job.handled.decisionId, decisionTask: job.handled.task, jobTitle: job.title }, "Your own answer takes this back…").form);
      } else {
        // The answers the decision names are buttons over the box, the same ones the job's card carries.
        var answer = frontAnswer(job);
        var asked = frontDecision(job);
        parts.push(asked ? sceneAsk({ title: job.title, decision: asked }, answer.key, answer.chat) : answer.chat.form);
        answer.chat.watch();
      }
    }
    return parts;
  }
  // Where his answer to a job goes, the same from its card and from the open job: the run that
  // waits on it, its fleet decision, or the job itself. One chat per card, so both places share it.
  var frontChats = {};
  function frontAnswerTarget(job) {
    if (job.handled) return { key: "flyd-handled:" + job.handled.decisionId, target: { decisionFollowUp: job.handled.decisionId, decisionTask: job.handled.task, jobTitle: job.title }, label: "Your own answer takes this back…" };
    if (job.domainRun && !job.handled) return { key: "flyd-domain:" + job.domainRun, target: { domainRun: job.domainRun, jobTitle: job.title, questionText: job.questionIdentity }, label: "Your answer…" };
    if (job.decision) {
      var decision = frontDecision(job);
      return { key: "flyd-decision:" + (decision.decisionId || decision.task), target: askTarget({ title: job.title, decision: decision }), label: askLabel(decision), earlier: decision.question ? "flyd-decision:" + (decision.decisionId || decision.task) + ":" + decision.question : "" };
    }
    var about = { title: job.title };
    if (job.task) about.task = job.task;
    var link = (job.links || []).find(function (one) { return one && one.url && !one.closed; });
    if (link) about.url = link.url;
    return { key: "flyd-front:" + job.id, target: { about: about }, label: "Message " + assistant + " about this job" };
  }
  function frontAnswer(job) {
    var to = frontAnswerTarget(job);
    var label = job.choices && job.choices.length ? "Or say something else…" : to.label;
    var id = to.key + "\\n" + JSON.stringify(to.target) + "\\n" + label;
    if (!frontChats[id]) {
      var chat = artefactChat(to.key, to.target, label, to.earlier || "");
      // A note sent from the open job, or one that did not go, shows on the card too.
      chat.afterPaint = function () { if (frontUpdate) frontDrawJobs(Array.from(frontJobs.values())); };
      chat.answerKey = to.key;
      frontChats[id] = chat;
    }
    return { key: to.key, chat: frontChats[id] };
  }
  // The decision the open job asks, with the answers the card offers; null when it names none and has no decision.
  function frontDecision(job) {
    var choices = job.choices && job.choices.length ? job.choices : null;
    var labels = job.labels || {};
    if (job.decision) return Object.assign({}, job.decision, choices ? { choices: choices, recommended: job.recommended || job.decision.recommended } : {}, { labels: labels });
    // Several numbered questions from the run: one card each, answered on their own.
    if (job.decisions && job.decisions.length > 1) return { question: job.ask || "", questionIdentity: job.questionIdentity || "", choices: [], decisions: job.decisions, labels: labels };
    if (!choices) return null;
    return { question: job.ask || "", questionIdentity: job.questionIdentity || "", choices: choices, recommended: job.recommended || "", labels: labels };
  }
  // What has become of an answer sent from a card's button: on its way, sent, or not delivered.
  function frontPicked(job) {
    var key = frontAnswerTarget(job).key;
    var pending = choicePending[key];
    var stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(key) || "{}") || {}; } catch (_) {}
    var chosen = pending || pickedFor(stored, frontDecision(job)) || "";
    if (!chosen) return null;
    if (!pending) return { choice: chosen, line: "Sent to " + assistant };
    var failed = Object.keys(frontChats).some(function (id) {
      var chat = frontChats[id];
      return chat.answerKey === key && (chat.state.thread || []).some(function (entry) { return entry.text === pending && entry.failed; });
    });
    return { choice: chosen, line: failed ? "Not delivered. Open it to try again." : "Sending…" };
  }
  function frontStage() {
    if (!frontUpdate) return;
    var job = frontActive === "talk" ? null : frontJobs.get(frontActive);
    if (!job || job.group === "done") {
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
    // The job opens in place, under its own message in the timeline.
    if (typeof workHold === "function") workHold(job.id);
    var drawn = JSON.stringify([job.id, job.state, job.title, job.detail, job.shots, job.previews, job.links, job.decision, job.domainRun, job.questionIdentity, job.next, job.ask, job.digest, job.threads, job.files, job.choices, job.recommended, job.decisions]);
    // A job already open stays as he left it while he is typing in it.
    if (drawn === frontDrawn.view || (frontDrawn.viewId === job.id && jobView.contains(document.activeElement))) return;
    frontDrawn.view = drawn;
    frontDrawn.viewId = job.id;
    jobView.replaceChildren.apply(jobView, frontJobView(job));
  }
  // Another job takes the middle: the old one fades out where it stands, the new one fades in.
  function frontSelect(id) {
    var selected = frontJobs.get(id);
    if (selected && selected.group === "done") {
      if (frontActive !== "talk") frontSelect("talk");
      var message = workHold(id);
      if (message) message.scrollIntoView({ block: "start" });
      return;
    }
    if (id === frontActive) return;
    frontActive = id;
    try { sessionStorage.setItem("flyd-front-job", id); } catch (_) {}
    jobsEl.querySelectorAll(".job").forEach(function (card) {
      var on = card.dataset.job === id;
      card.classList.toggle("on", on);
      if (on) card.setAttribute("aria-current", "true"); else card.removeAttribute("aria-current");
    });
    frontDrawn.jobs = "";
    // The conversation stays; the job unfolds under its own message in it.
    frontStage();
    if (frontUpdate) frontDrawJobs(Array.from(frontJobs.values()));
    if (typeof drawTimeline === "function") drawTimeline();
    if (id === "talk") return;
    var node = typeof workNodes === "undefined" ? null : workNodes.get(id);
    if (!node) return;
    pinned = false;
    var head = document.querySelector("header");
    var above = (head ? head.offsetHeight : 0) + (getComputedStyle(stageHead).position === "fixed" ? stageHead.offsetHeight : 0);
    window.scrollTo(0, Math.max(0, node.getBoundingClientRect().top + window.scrollY - above - 16));
  }

  function frontListedJob(job) {
    return {
      id: job.id, group: job.group, state: job.state || "", title: frontTitle(job.title), project: job.project || "",
      at: job.at || "", toldAt: job.toldAt || "", next: job.next || "", owner: job.owner || "", ask: job.ask || "", questionIdentity: job.questionIdentity || "", because: job.because || "",
      digest: job.digest || null, shots: frontShots(job.shots), links: job.links || [], files: job.files || [],
      threads: job.threads || [], detail: job.detail || "", decision: job.decision || null, task: job.task || "", domainRun: job.domainRun || "",
      choices: Array.isArray(job.choices) ? job.choices : [], recommended: job.recommended || "", labels: job.labels && typeof job.labels === "object" ? job.labels : {},
      decisions: Array.isArray(job.decisions) ? job.decisions : [],
      handled: job.handled && job.handled.decisionId ? { decisionId: job.handled.decisionId, task: job.handled.task || "" } : null,
      bare: job.bare === true,
    };
  }
  function frontPostJob(body) {
    if (!VIEW_TOKEN) return;
    fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": VIEW_TOKEN }, body: JSON.stringify(body) })
      .then(function (response) { return response.json().catch(function () { return {}; }).then(function (data) { return { ok: response.ok, data: data }; }); })
      .then(function (reply) {
        var data = reply.data || {};
        // A refused edit says why where he is typing; it never fails silently.
        if (!reply.ok || !data.job) { noteRefusal(data.error || (body.op === "close" ? "Flyd couldn't close that." : "Flyd couldn't change that.")); return; }
        noteRefusal("");
        if (!frontUpdate || !Array.isArray(frontUpdate.jobs)) return;
        frontUpdate.jobs = frontUpdate.jobs.filter(function (job) { return job.id !== data.job.id && job.id !== body.id; }).concat([data.job]);
        frontDrawn.jobs = "";
        frontDrawn.view = "";
        if (body.op === "close" && frontActive === body.id) frontActive = "talk";
        renderFront();
      })
      .catch(function () { noteRefusal(body.op === "close" ? "Flyd couldn't close that. The view lost its connection." : "Flyd couldn't change that. The view lost its connection."); });
  }
  function renderFront(update) {
    if (update) frontUpdate = update;
    if (!frontUpdate) return;
    var jobs = (Array.isArray(frontUpdate.jobs) ? frontUpdate.jobs : []).map(frontListedJob);
    frontJobs = new Map(jobs.map(function (job) { return [job.id, job]; }));
    frontDrawJobs(jobs);
    frontStage();
  }

  jobsEl.addEventListener("click", function (event) {
    if (event.target.closest("[data-chat-more]")) { clearTimeout(frontChat.timer); frontChat.waiting = ""; frontChatLook(frontChat.terms); return; }
    if (event.target.closest("[data-made-all]")) { frontRoot.removeAttribute("data-sheet"); frontTab("arts"); return; }
    var more = event.target.closest(".fmore");
    if (more) { frontOpen[more.dataset.more] = !frontOpen[more.dataset.more]; renderFront(); return; }
    var pick = event.target.closest(".jpick");
    if (pick) {
      var job = frontJobs.get(pick.dataset.pickJob);
      if (!job || pick.disabled) return;
      var answer = frontAnswer(job);
      pickChoice(answer.chat, answer.key, frontDecision(job), pick.dataset.pick, function () { frontDrawn.jobs = ""; frontDrawJobs(Array.from(frontJobs.values())); });
      return;
    }
    var card = event.target.closest(".job");
    if (card) frontSelect(card.dataset.job);
  });
  // Earlier conversations fold away at the top of the timeline; opening one brings it to the middle.
  (function () {
    var group = el("details", "earlier");
    group.appendChild(el("summary", "", "Earlier conversations"));
    group.appendChild(historyEl);
    main.insertBefore(group, main.firstChild);
    historyList.addEventListener("click", function (event) { if (event.target.closest(".history-item")) frontSelect("talk"); });
  })();
  document.getElementById("stage-back").addEventListener("click", function () {
    setCentre("talk", true);
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
    setCentre("talk", true);
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

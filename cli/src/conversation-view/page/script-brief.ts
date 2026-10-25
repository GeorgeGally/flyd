/** The right column's brief: notices, needs, done work, news and the keyed patching. */
export const BRIEF_SCRIPT = `
  // Done items are read from firstmate's own records on every update.
  var briefEl = document.getElementById("brief");
  var needsEl = document.getElementById("needs");
  var doneEl = document.getElementById("done");
  var noticesEl = document.getElementById("notices");
  var artefactsEl = document.getElementById("artefacts");
  var briefNewsEl = document.getElementById("brief-news");
  // Notices other tools sent instead of macOS notifications, newest first.
  var notices = [];
  var newsEl = document.getElementById("news");
  var briefFilled = false;
  var lastBrief = null;
  var needsAt = Number(store("flyd-needs-at")) || 0;
  var needsShown = "";
  var needsDrawn = "";
  var doneAll = false;
  var DONE_FEW = 6;
  // "GNM (Good Neighbours Market)" is GNM on a line this small.
  function shortName(project) { return project ? String(project).replace(/\\s*\\([^)]*\\)\\s*$/, "") : ""; }
  function briefTop(label, extra) {
    var top = el("div", "brief-top");
    if (label) top.appendChild(el("h2", "brief-label", label));
    if (extra) top.appendChild(extra);
    return top;
  }
  // What he has put away is kept by the shared cards (cardGone). Nothing else leaves the column on its own:
  // what came since he last looked is marked new instead.
  var DAY_MS = 24 * 60 * 60 * 1000;
  // A card with no task of its own is named only by its place in the list, so it is kept by its words instead.
  function itemKey(item) { return item.task ? item.id : item.headline; }
  /** A Done item no longer listed is forgotten once it is this old. */
  var SEEN_KEPT_MS = 3 * DAY_MS;
  // When he last looked at the window: what Flyd first saw after that is new to him. A first visit marks nothing.
  var doneLooked = Number(store("flyd-done-looked")) || 0;
  if (!doneLooked) { store("flyd-done-looked", String(Date.now())); doneLooked = Number.MAX_SAFE_INTEGER; }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { store("flyd-done-looked", String(Date.now())); return; }
    doneLooked = Number(store("flyd-done-looked")) || doneLooked;
    if (lastBrief) renderBrief(lastBrief);
  });
  window.addEventListener("pagehide", function () { store("flyd-done-looked", String(Date.now())); });
  // Only the newest few hundred are kept; old ones have long left the column anyway.
  function newest(times, first) {
    var kept = {};
    var rank = function (key) { return first && first[key] ? 1 : 0; };
    Object.keys(times).sort(function (a, b) { return rank(b) - rank(a) || times[b] - times[a]; }).slice(0, 300).forEach(function (key) { kept[key] = times[key]; });
    return kept;
  }
  function seenDone(items) {
    var seen = cardRead("flyd-done-seen");
    var now = Date.now();
    var listed = {};
    items.forEach(function (item) {
      var key = itemKey(item);
      listed[key] = true;
      if (!seen[key]) seen[key] = now;
    });
    Object.keys(seen).forEach(function (key) { if (!listed[key] && now - seen[key] > SEEN_KEPT_MS) delete seen[key]; });
    seen = newest(seen, listed);
    store("flyd-done-seen", JSON.stringify(seen));
    return seen;
  }
  function stillShown(item) {
    return !(item.task && cardGone(item.id));
  }
  /** Whether Flyd first saw it after he last looked. */
  function isNew(item, seen) {
    var first = seen && seen[itemKey(item)];
    return !!first && first > doneLooked;
  }
  // One piece of finished work: its picture, its title, one short line on the outcome, then "open" and how long ago.
  function briefItem(item, meta, fresh) {
    var li = el("li", "card brief-card" + (fresh ? " is-new" : ""));
    li.dataset.key = item.id || item.headline;
    // Its picture, when the work has one: the small thumbnail says what changed, and opens full size on click.
    if (item.shots && item.shots.length) {
      var shotSrc = withToken(item.shots[0].src);
      var thumb = el("button", "card-thumb");
      thumb.type = "button";
      thumb.setAttribute("aria-label", "Open image");
      var img = el("img", "");
      img.src = shotSrc;
      img.alt = "";
      img.loading = "lazy";
      thumb.appendChild(img);
      thumb.addEventListener("click", function () { openImage(shotSrc); });
      li.appendChild(thumb);
    }
    var text = el("div", "card-text");
    text.appendChild(el("p", "card-line brief-line", item.headline));
    var outcome = String(item.detail || "").replace(/\\s+/g, " ").trim();
    if (outcome.length > 110) outcome = outcome.slice(0, 109).replace(/\\s+\\S*$/, "") + "…";
    if (outcome) text.appendChild(el("p", "brief-outcome", outcome));
    var foot = el("p", "brief-meta");
    var link = item.open || (item.links || []).find(function (one) { return !one.closed; });
    if (link) {
      var a = el("a", "brief-open", "open");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      foot.appendChild(a);
    }
    if (fresh) foot.appendChild(el("span", "brief-new", "New"));
    if (meta) foot.appendChild(document.createTextNode(fresh && meta ? " · " + meta : meta));
    if (foot.firstChild) text.appendChild(foot);
    li.appendChild(text);
    if (item.task) {
      var close = el("button", "card-dismiss", "✕");
      close.type = "button";
      close.setAttribute("aria-label", "Hide this");
      close.addEventListener("click", function () {
        cardDismiss(item.id);
        li.classList.add("leaving");
        setTimeout(function () { renderBrief(lastBrief); }, 220);
      });
      li.appendChild(close);
    }
    return li;
  }
  function drawSemanticDecisions(decisions) {
    if (!decisions.length) { needsEl.hidden = true; needsEl.textContent = ""; needsDrawn = ""; needsShown = ""; return; }
    // A Decision is the object. Navigation changes which Decision is in focus;
    // legacy call position is no longer its identity.
    var index = decisions.findIndex(function (decision) { return decision.id === needsShown; });
    if (index < 0) index = Math.min(needsAt, decisions.length - 1);
    needsAt = index;
    needsShown = decisions[index].id;
    store("flyd-needs-at", String(index));
    var decision = decisions[index];
    var key = JSON.stringify([decision, index, decisions.length]);
    needsEl.hidden = false;
    if (key === needsDrawn) return;
    needsDrawn = key;
    needsEl.textContent = "";
    var nav = null;
    if (decisions.length > 1) {
      nav = el("span", "needs-nav");
      var back = el("button", "", "‹");
      back.type = "button";
      back.setAttribute("aria-label", "The one before");
      back.disabled = index === 0;
      var forward = el("button", "", "›");
      forward.type = "button";
      forward.setAttribute("aria-label", "The next one");
      forward.disabled = index === decisions.length - 1;
      back.addEventListener("click", function () { needsShown = decisions[Math.max(0, index - 1)].id; drawSemanticDecisions(decisions); });
      forward.addEventListener("click", function () { needsShown = decisions[Math.min(decisions.length - 1, index + 1)].id; drawSemanticDecisions(decisions); });
      nav.appendChild(back);
      nav.appendChild(el("span", "", (index + 1) + " of " + decisions.length));
      nav.appendChild(forward);
    }
    if (nav) needsEl.appendChild(briefTop("", nav));
    needsEl.dataset.semanticId = decision.id;
    var meta = [shortName(decision.project), decision.createdAt ? ago(decision.createdAt) : ""].filter(Boolean).join(" · ");
    if (meta) needsEl.appendChild(el("p", "needs-meta", meta));
    needsEl.appendChild(el("h3", "needs-head", decision.subject));
    var question = decision.decision && decision.decision.question;
    var said = [];
    unsaid(decision.subject, said);
    var detail = unsaid(decision.detail, said) || unsaid(question, said) || (decision.summary !== "waiting on you" ? unsaid(decision.summary, said) : "");
    if (detail) needsEl.appendChild(el("p", "needs-detail", sentence(capital(detail))));

    var images = (decision.evidence || []).filter(function (object) { return object.kind === "image"; });
    if (images.length) needsEl.appendChild(shots(images.map(function (object) { return withToken(object.ref); }), "decision-evidence"));

    var advice = decision.decision && decision.decision.recommended ? "I'd pick " + decision.decision.recommended + "." : "";
    if (advice) {
      var rec = el("p", "needs-rec");
      rec.appendChild(el("b", "", "Recommended"));
      rec.appendChild(document.createTextNode(advice));
      needsEl.appendChild(rec);
    }
    (decision.evidence || []).filter(function (object) { return object.kind === "web" && !object.closed; }).forEach(function (object) {
      var a = el("a", "call-link", (object.label || "Open") + " ↗");
      a.href = object.ref;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      needsEl.appendChild(a);
    });
    if (decision.decision && VIEW_TOKEN) {
      needsEl.appendChild(sceneAsk({
        title: decision.subject,
        decision: {
          task: decision.decision.target,
          decisionId: decision.decision.decisionId,
          question: decision.decision.question,
          choices: decision.decision.alternatives || [],
          recommended: decision.decision.recommended,
          replyTo: decision.decision.replyTo,
        },
      }, "flyd-decision:" + decision.id + ":" + decision.decision.question));
    }
  }
  function drawNeeds(calls) {
    if (!calls.length) { needsEl.hidden = true; needsEl.textContent = ""; needsDrawn = ""; needsShown = ""; return; }
    // The same call stays while it is there; once answered, the next one takes its place.
    var index = calls.findIndex(function (call) { return call.id === needsShown; });
    if (index < 0) index = Math.min(needsAt, calls.length - 1);
    needsAt = index;
    needsShown = calls[index].id;
    store("flyd-needs-at", String(index));
    var call = calls[index];
    var key = JSON.stringify([call, index, calls.length]);
    needsEl.hidden = false;
    if (key === needsDrawn) return;
    needsDrawn = key;
    needsEl.textContent = "";
    var nav = null;
    if (calls.length > 1) {
      nav = el("span", "needs-nav");
      var back = el("button", "", "‹");
      back.type = "button";
      back.setAttribute("aria-label", "The one before");
      back.disabled = index === 0;
      var forward = el("button", "", "›");
      forward.type = "button";
      forward.setAttribute("aria-label", "The next one");
      forward.disabled = index === calls.length - 1;
      back.addEventListener("click", function () { needsShown = calls[Math.max(0, index - 1)].id; drawNeeds(calls); });
      forward.addEventListener("click", function () { needsShown = calls[Math.min(calls.length - 1, index + 1)].id; drawNeeds(calls); });
      nav.appendChild(back);
      nav.appendChild(el("span", "", (index + 1) + " of " + calls.length));
      nav.appendChild(forward);
    }
    if (nav) needsEl.appendChild(briefTop("", nav));
    var meta = [shortName(call.project), call.at ? ago(call.at) : ""].filter(Boolean).join(" · ");
    if (meta) needsEl.appendChild(el("p", "needs-meta", meta));
    needsEl.appendChild(el("h3", "needs-head", call.headline));
    var question = call.decision && call.decision.question;
    var said = [];
    unsaid(call.headline, said);
    var detail = unsaid(call.detail, said) || unsaid(question, said);
    if (detail) needsEl.appendChild(el("p", "needs-detail", sentence(capital(detail))));
    var advice = call.decision && call.decision.recommended ? "I'd pick " + call.decision.recommended + "." : "";
    if (advice) {
      var rec = el("p", "needs-rec");
      rec.appendChild(el("b", "", "Recommended"));
      rec.appendChild(document.createTextNode(advice));
      needsEl.appendChild(rec);
    }
    (call.links || []).forEach(function (link) {
      if (link.closed) return;
      var a = el("a", "call-link", link.label + " ↗");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      needsEl.appendChild(a);
    });
    if (call.decision && VIEW_TOKEN) needsEl.appendChild(sceneAsk({ title: call.headline, decision: call.decision }, "flyd-decision:" + (call.decision.decisionId || call.decision.task) + ":" + call.decision.question));
  }
  function drawSemanticArtifacts(artifacts) {
    var seen = artifacts.length ? seenDone(artifacts.map(function (artifact) {
      return { id: artifact.id, task: artifact.id, at: artifact.updatedAt || artifact.createdAt || "" };
    })) : null;
    var items = artifacts.filter(function (artifact) { return stillShown({ id: artifact.id }); });
    doneEl.textContent = "";
    doneEl.hidden = !items.length;
    if (!items.length) return;
    doneEl.appendChild(briefTop("Done"));
    var list = el("ul");
    var shown = !doneAll ? items.slice(0, DONE_FEW) : items;
    shown.forEach(function (artifact) {
      var evidence = artifact.evidence || [];
      var open = evidence.find(function (object) { return object.kind === "web" && !object.closed; });
      var image = evidence.find(function (object) { return object.kind === "image"; });
      var visual = {
        id: artifact.id,
        kind: "landed",
        headline: artifact.subject,
        detail: artifact.summary || artifact.detail || "",
        at: artifact.updatedAt || artifact.createdAt || "",
        status: artifact.status || "ready",
        shots: image ? [{ src: image.ref, label: image.label || artifact.subject }] : [],
        open: open ? { url: open.ref, label: open.label || "Open" } : undefined,
      };
      list.appendChild(briefItem(visual, visual.at ? ago(visual.at) : "", isNew({ id: artifact.id, task: artifact.id }, seen)));
    });
    doneEl.appendChild(list);
    if (items.length > DONE_FEW) {
      var more = el("button", "brief-more", doneAll ? "Show fewer" : "Show all " + items.length);
      more.type = "button";
      more.addEventListener("click", function () { doneAll = !doneAll; renderBrief(lastBrief); });
      doneEl.appendChild(more);
    }
  }
  function drawList(section, label, items, meta, few) {
    var seen = label === "Done" && items.length ? seenDone(items) : null;
    items = items.filter(stillShown);
    section.textContent = "";
    section.hidden = !items.length;
    if (!items.length) return;
    section.appendChild(briefTop(label));
    var list = el("ul");
    var shown = few && !doneAll ? items.slice(0, few) : items;
    shown.forEach(function (item) { list.appendChild(briefItem(item, meta(item), isNew(item, seen))); });
    section.appendChild(list);
    if (few && items.length > few) {
      var more = el("button", "brief-more", doneAll ? "Show fewer" : "Show all " + items.length);
      more.type = "button";
      more.addEventListener("click", function () { doneAll = !doneAll; renderBrief(lastBrief); });
      section.appendChild(more);
    }
  }
  function renderBrief(show) {
    lastBrief = show || null;
    var calls = (show && show.calls) || [];
    var decisions = show && show.decisions;
    var done = (show && show.done) || [];
    var artifacts = show && show.artifacts && show.artifacts.filter(function (artifact) { return !(artifact.artifact && artifact.artifact.type === "plan"); });
    if (decisions) drawSemanticDecisions(decisions);
    else drawNeeds(calls);
    setNeeds(((show && show.needs) || decisions || calls).map(function (item) { return item.id; }));
    if (artifacts) drawSemanticArtifacts(artifacts);
    else drawList(doneEl, "Done", done, function (item) { return item.at ? ago(item.at) : ""; }, DONE_FEW);
    drawList(noticesEl, "Notices", notices.slice().reverse().map(function (notice) {
      return { id: "notice:" + notice.id, headline: notice.text, at: notice.at, kind: notice.kind, count: notice.count };
    }), function (item) {
      return [item.kind === "attention" ? "Needs you" : "Done", item.count ? (item.count === 2 ? "twice" : item.count + " times") : "", item.at ? ago(item.at) : ""].filter(Boolean).join(" · ");
    });
    fillBrief();
  }
  function fillBrief() {
    briefEl.hidden = doneEl.hidden && noticesEl.hidden && artefactsEl.hidden;
    briefNewsEl.hidden = newsEl.hidden;
    briefFilled = !briefEl.hidden || !briefNewsEl.hidden;
    showRail();
  }
  // The stories behind a news card: how each was marked, the headline as a link, a line of gist, and where it came from.
  function storiesNode(stories) {
    var list = el("ul", "card-stories");
    stories.forEach(function (story) {
      var li = el("li", "");
      if (story.mark) li.appendChild(el("p", "card-story-mark", story.mark));
      var a = el("a", "card-story-head", story.title);
      a.href = story.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.appendChild(a);
      if (story.gist) li.appendChild(el("p", "card-story-line", story.gist));
      var rate = story.n && SEND_TOKEN ? storyRate(story) : null;
      if (story.source || rate) {
        var src = el("p", "card-story-src", story.source || "");
        if (rate) src.appendChild(rate);
        li.appendChild(src);
      }
      list.appendChild(li);
    });
    return list;
  }
  // "more" or "less" like a story teaches the news what he wants; once told, the story says so instead.
  var storyTold = {};
  function storyRate(story) {
    var wrap = el("span", "story-rate");
    if (storyTold[story.url]) {
      wrap.appendChild(el("span", "story-told", storyTold[story.url] === "more" ? "More like this" : "Less like this"));
      return wrap;
    }
    ["more", "less"].forEach(function (verdict) {
      var button = el("button", "", verdict);
      button.type = "button";
      button.setAttribute("aria-label", (verdict === "more" ? "More" : "Less") + " like " + story.title);
      button.addEventListener("click", function () {
        wrap.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
        tokenFetch("/api/scout-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n: story.n, url: story.url, verdict: verdict }) }, true).then(function (response) {
          if (!response.ok) throw new Error(String(response.status));
          storyTold[story.url] = verdict;
          wrap.textContent = "";
          wrap.appendChild(el("span", "story-told", verdict === "more" ? "More like this" : "Less like this"));
        }).catch(function () {
          wrap.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
        });
      });
      wrap.appendChild(button);
    });
    return wrap;
  }
  // The news: the newest card of each kind that carries its stories, every story a working link.
  function drawNews(recent) {
    var titles = {};
    var cards = (recent || []).filter(function (item) {
      if (item.kind !== "news" || !item.stories || !item.stories.length || titles[item.title]) return false;
      titles[item.title] = true;
      return true;
    });
    newsEl.textContent = "";
    newsEl.hidden = !cards.length;
    cards.forEach(function (item) {
      newsEl.appendChild(briefTop(item.title));
      if (item.line) newsEl.appendChild(el("p", "brief-outcome", item.line));
      newsEl.appendChild(storiesNode(item.stories));
    });
    fillBrief();
  }
  // What Flyd made or was shown: each artefact with its picture when it has one, its title in plain words,
  // a short line, and "open". Redrawn only when it changes, so a framed page never reloads under him.
  var ARTEFACTS_FEW = 6;
  var artefactsAll = false;
  var artefactsDrawn = "";
  var lastArtefacts = [];
  var fitFrames = window.ResizeObserver ? new ResizeObserver(function (entries) {
    entries.forEach(function (entry) { entry.target.style.setProperty("--fit", String(entry.contentRect.width / Number(entry.target.dataset.base || 1280))); });
  }) : null;
  // A same-origin picture or file carries the view's token; a page elsewhere is linked as it is.
  function ownSrc(src) { return /^\\/api\\//.test(src) ? withToken(src) : src; }
  function artefactPicture(card) {
    if (card.image) {
      var src = ownSrc(card.image);
      var shot = el("button", "art-pic");
      shot.type = "button";
      shot.setAttribute("aria-label", "Open image");
      var img = el("img", "");
      img.src = src;
      img.alt = "";
      img.loading = "lazy";
      shot.appendChild(img);
      shot.addEventListener("click", function () { openImage(src); });
      return shot;
    }
    if (!card.preview || card.down || card.checking || card.blocked) return null;
    // A page is laid out at its own width and scaled down whole, like a screenshot of it.
    var base = card.phone ? 390 : 1280;
    var box = el("div", "art-pic art-frame" + (card.phone ? " art-phone" : ""));
    box.dataset.base = String(base);
    box.style.setProperty("--fit", String(card.phone ? 0.4 : 0.3));
    var frame = el("iframe", "");
    frame.src = card.preview;
    frame.loading = "lazy";
    frame.tabIndex = -1;
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", card.title);
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
    frame.style.width = base + "px";
    frame.style.height = (card.phone ? 844 : 800) + "px";
    box.appendChild(frame);
    if (card.url) {
      var full = el("a", "art-frame-open");
      full.href = ownSrc(card.url);
      full.target = "_blank";
      full.rel = "noopener noreferrer";
      full.setAttribute("aria-label", "Open " + card.title);
      box.appendChild(full);
    }
    if (fitFrames) fitFrames.observe(box);
    return box;
  }
  // Whether a card has a picture to lead with: a screenshot, or a page that can be framed.
  function pictured(card) { return !!(card.image || (card.preview && !card.down && !card.checking && !card.blocked)); }
  // One artefact: its picture first, then its title, one line of what it is and when, and "open".
  function artefactItem(card) {
    var li = el("li", "art-card" + (pictured(card) ? " art-pictured" : ""));
    li.dataset.key = card.id;
    var picture = artefactPicture(card);
    if (picture) li.appendChild(picture);
    li.appendChild(el("p", "brief-line art-title", card.title));
    // The line says only what the title does not ("Bearings - fleet board" under "Review board: Bearings - fleet board" goes).
    var said = [];
    unsaid(card.title, said);
    var line = unsaid(card.line, said);
    if (card.down) line = "Not running" + (line ? " · " + line : "");
    if (line || card.at) {
      var meta = el("p", "art-meta");
      // The line gives way before the time does: "how long ago" is never cut.
      if (line) meta.appendChild(el("span", "art-line", line));
      if (card.at) {
        // How long ago moves on with the clock; the card itself is not redrawn, so a framed page never reloads.
        var when = el("span", "art-ago", (line ? " · " : "") + ago(card.at));
        when.dataset.at = card.at;
        meta.appendChild(when);
      }
      li.appendChild(meta);
    }
    // A card with no picture is its words: a reply's steps or a choice's options say what it is.
    var steps = !picture ? card.steps || (card.choice && card.choice.options) || [] : [];
    if (steps.length) {
      var list = el(card.choice ? "ul" : "ol", "art-steps");
      steps.slice(0, 3).forEach(function (step) { list.appendChild(el("li", "", String(step))); });
      if (steps.length > 3) list.appendChild(el("li", "art-steps-more", (steps.length - 3) + " more"));
      li.appendChild(list);
    }
    var foot = el("p", "brief-meta");
    var reply = /^reply:/.test(card.id) ? nodes.get(card.id.slice(6)) : null;
    if (card.url && !card.down) {
      var a = el("a", "brief-open", "open");
      a.href = ownSrc(card.url);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      foot.appendChild(a);
    } else if (reply) {
      // A reply's artefact opens at the reply it came from.
      var go = el("button", "brief-open art-goto", "open");
      go.type = "button";
      go.addEventListener("click", function () {
        var target = nodes.get(card.id.slice(6));
        if (target) target.scrollIntoView({ block: "center" });
      });
      foot.appendChild(go);
    }
    if (foot.firstChild) li.appendChild(foot);
    return li;
  }
  function renderArtefacts(all) {
    lastArtefacts = all;
    // A merged change with no picture is already in Done, with its time: it is not drawn twice.
    var cards = all.filter(function (card) { return !(/^landed:/.test(card.id) && !pictured(card)); });
    // The pictures lead; work with no picture follows as a plain line, in the same order otherwise.
    cards = cards.filter(pictured).concat(cards.filter(function (card) { return !pictured(card); }));
    var key = JSON.stringify([cards, artefactsAll]);
    if (key === artefactsDrawn) { fillBrief(); return; }
    artefactsDrawn = key;
    if (fitFrames) artefactsEl.querySelectorAll(".art-frame").forEach(function (box) { fitFrames.unobserve(box); });
    artefactsEl.textContent = "";
    artefactsEl.hidden = !cards.length;
    if (cards.length) {
      artefactsEl.appendChild(briefTop("Artefacts"));
      var shown = artefactsAll ? cards : cards.slice(0, ARTEFACTS_FEW);
      var grid = el("ul", "art-list art-grid");
      var plain = el("ul", "art-list art-plain");
      shown.forEach(function (card) { (pictured(card) ? grid : plain).appendChild(artefactItem(card)); });
      if (grid.firstChild) artefactsEl.appendChild(grid);
      if (plain.firstChild) artefactsEl.appendChild(plain);
      if (cards.length > ARTEFACTS_FEW) {
        var more = el("button", "brief-more", artefactsAll ? "Show fewer" : "Show all " + cards.length);
        more.type = "button";
        more.addEventListener("click", function () { artefactsAll = !artefactsAll; renderArtefacts(lastArtefacts); });
        artefactsEl.appendChild(more);
      }
    }
    fillBrief();
  }
  // How long ago each piece of work was done moves on with the clock, not only with updates.
  setInterval(function () {
    if (lastBrief) renderBrief(lastBrief);
    artefactsEl.querySelectorAll(".art-ago").forEach(function (span) {
      span.textContent = (span.previousSibling ? " · " : "") + ago(span.dataset.at);
    });
  }, 60000);

  // The right column: what got done.
  var railEl = document.getElementById("rail");
  var railHidden = store("flyd-rail") === "off";
  function railRoot() { return document.documentElement; }
  function railOn() { return !railHidden && railEl && !railEl.hidden; }
  function setRail(on) { railRoot().setAttribute("data-rail", on ? "on" : "off"); }
  // Only what changed is replaced, and nothing kept is moved.
  function keyed(node, key, deep) {
    node.dataset.key = key;
    if (deep) node.dataset.deep = "1";
    return node;
  }
  function keyOf(node) { return node.dataset.key || node.outerHTML; }
  function patch(parent, fresh) {
    var keys = fresh.map(keyOf);
    var children = Array.prototype.slice.call(parent.children);
    var old = new Map(children.map(function (child) { return [keyOf(child), child]; }));
    var kept = children.map(keyOf).filter(function (key) { return keys.indexOf(key) >= 0; });
    var order = keys.filter(function (key) { return old.has(key); });
    if (new Set(keys).size !== keys.length || old.size !== children.length || kept.join("\\n") !== order.join("\\n")) {
      parent.replaceChildren.apply(parent, fresh);
      return;
    }
    children.forEach(function (child) { if (keys.indexOf(keyOf(child)) < 0) child.remove(); });
    var cursor = parent.firstElementChild;
    fresh.forEach(function (node, i) {
      var was = old.get(keys[i]);
      if (!was) { parent.insertBefore(node, cursor); return; }
      if (was.outerHTML !== node.outerHTML) {
        if (node.dataset.deep && was.tagName === node.tagName) {
          was.className = node.className;
          patch(was, Array.prototype.slice.call(node.children));
        } else {
          parent.replaceChild(node, was);
          was = node;
        }
      }
      cursor = was.nextElementSibling;
    });
  }

`;

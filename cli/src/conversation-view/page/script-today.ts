/**
 * The middle of the front page at rest: Today, a feed of what happened today
 * as cards, and News, the stories in two columns with the weather beside them.
 * A conversation still takes the middle once he writes; the Today tab brings
 * the feed back. On News the message box talks about the story in view: his
 * question and Flyd's answer sit under that story, in the story's own article
 * conversation. Runs inside the page script's closure after the front page's
 * own script and borrows its helpers (el, clock, withToken, tokenFetch,
 * frontEsc, frontText, frontGlance, frontProject, frontRoot, frontSelect,
 * renderFront, connect, input, composer, historyList).
 */
export const TODAY_SCRIPT = `
  // Today and News: the middle of the front page when no conversation holds it.
  var centreTabs = document.getElementById("centre-tabs");
  var feedEl = document.getElementById("feed");
  var newsCols = document.getElementById("news-cols");
  var newsWhen = document.getElementById("news-when");
  var newsSide = document.getElementById("news-side");
  var newsSidePhone = document.getElementById("news-side-phone");
  var centre = "";
  var conversationConfirm = null;
  var centreChosen = false;
  var todayUpdate = null;
  var todayDrawn = "";
  var newsDrawn = "";
  var todaySessions = [];
  var inputPlaceholder = input.getAttribute("placeholder") || "";
  function setCentre(name, chosen) {
    if (chosen) centreChosen = true;
    if (name === centre) return;
    centre = name;
    frontRoot.setAttribute("data-centre", name);
    centreTabs.querySelectorAll(".ctab").forEach(function (tab) {
      var on = tab.dataset.centre === (name === "news" ? "news" : "today");
      tab.setAttribute("aria-pressed", String(on));
    });
    if (name === "news") { loadWeather(); newsPlaceholder(newsPicked); newsPickInView(); newsConfirm(); }
    else { newsPlaceholder(null); paintConfirm(conversationConfirm); }
    newsSyncStreams();
    if (name !== "talk") window.scrollTo(0, 0);
  }
  centreTabs.addEventListener("click", function (event) {
    var tab = event.target.closest(".ctab");
    if (!tab) return;
    // Today brings the feed back over the conversation; an open job closes first.
    if (frontActive !== "talk") frontSelect("talk");
    setCentre(tab.dataset.centre, true);
  });

  // The feed: what moved today, in plain words, newest first.
  function todayIs(iso) {
    var d = new Date(iso);
    return !isNaN(d) && d.toDateString() === new Date().toDateString();
  }
  function todaySentence(text) {
    var line = frontText(text);
    if (!line) return "";
    line = frontGlance(line, 150);
    return /[.!?…]$/.test(line) ? line : line + ".";
  }
  function todayShot(item) {
    var shot = (item.shots || []).filter(function (one) { return one && one.src; })[0];
    return shot ? withToken(shot.src) : "";
  }
  function todayEvents(update) {
    var live = update.live || {};
    var events = [];
    var seen = {};
    function add(event) {
      if (!event.text || seen[event.text]) return;
      seen[event.text] = true;
      events.push(event);
    }
    (live.running || []).forEach(function (item) {
      var at = item.at || item.since;
      add({ at: at, text: todaySentence(item.step), moving: true, shot: todayShot(item) });
    });
    (live.landed || []).forEach(function (item) {
      if (!todayIs(item.at)) return;
      add({ at: item.at, text: todaySentence(item.step), shot: todayShot(item) });
    });
    // Where he left off: his latest other conversation today, which opens again from here.
    var left = todaySessions.filter(function (session) { return session.id !== current && session.title && todayIs(session.updatedAt); })[0];
    if (left) add({ at: left.updatedAt, text: "You left off on " + frontText(left.title).replace(/[.!?]+$/, "") + ".", session: left.id });
    events.sort(function (a, b) { return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0); });
    // Moving work leads, then the rest by time.
    return events.filter(function (event) { return event.moving; }).concat(events.filter(function (event) { return !event.moving; }));
  }
  function todayCard(event) {
    var time = '<time>' + frontEsc(event.at ? clock(event.at) : "") + (event.moving ? '<i class="fdot pulse" aria-label="moving"></i>' : "") + '</time>';
    var text = '<p>' + frontEsc(event.text) + '</p>';
    var tag = event.session ? "button" : "div";
    var open = '<' + tag + ' class="ev' + (event.shot ? " pic" : "") + '"' + (event.session ? ' type="button" data-session="' + frontEsc(event.session) + '"' : "") + '>';
    if (event.shot) return open + '<img src="' + frontEsc(event.shot) + '" alt="" loading="lazy"><div>' + time + text + '</div></' + tag + '>';
    return open + time + text + '</' + tag + '>';
  }
  function drawToday() {
    if (!todayUpdate) return;
    var live = todayUpdate.live || {};
    var events = todayEvents(todayUpdate);
    var html = events.length ? events.map(todayCard).join("")
      : '<p class="feed-empty">' + (todayUpdate.live && !live.known ? "Not read yet." : "Nothing has moved yet today.") + '</p>';
    if (html === todayDrawn) return;
    todayDrawn = html;
    feedEl.innerHTML = html;
  }
  feedEl.addEventListener("click", function (event) {
    var card = event.target.closest("[data-session]");
    if (!card) return;
    explicit = card.dataset.session;
    if (window.history && window.history.replaceState) window.history.replaceState(null, "", "?session=" + encodeURIComponent(explicit));
    setCentre("talk", true);
    connect(explicit);
  });
  function loadTodaySessions() {
    fetch("/api/sessions").then(function (r) { return r.json(); }).then(function (data) {
      todaySessions = data.sessions || [];
      drawToday();
    }).catch(function () {});
  }

  // News: the stories of the latest editions in two columns.
  var NEWS_FILLER = /^(giphy|pexels|google trends)$/i;
  var newsStories = [];
  var newsPicked = null;
  var newsPointer = null;
  function newsOf(recent) {
    var stories = [];
    var urls = {};
    var at = "";
    (recent || []).forEach(function (item) {
      if (item.kind !== "news" || !item.stories) return;
      if (!at || item.at > at) at = item.at;
      item.stories.forEach(function (story) {
        if (!story.url || urls[story.url] || NEWS_FILLER.test((story.source || "").trim())) return;
        urls[story.url] = true;
        stories.push(story);
      });
    });
    return { stories: stories, at: at };
  }
  function newsPicture(story) {
    return story.image && story.image.indexOf("/api/story-image?") === 0 ? withToken(story.image) : "";
  }
  function newsStory(story, index, lead) {
    var pic = newsPicture(story);
    var node = el("article", "story" + (lead ? " lead" : "") + (pic ? " pic" : ""));
    node.dataset.story = String(index);
    if (pic) {
      var img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", function () { img.remove(); node.classList.remove("pic"); });
      img.src = pic;
      node.appendChild(img);
    }
    var head = el("h2");
    var link = el("a", "", story.title);
    link.href = story.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    head.appendChild(link);
    node.appendChild(head);
    if (story.media === "stat" && story.figure) node.appendChild(el("p", "", story.figure));
    if (story.media === "quote" && story.quote) node.appendChild(el("p", "", "“" + story.quote + "”"));
    if (story.media === "quote" && story.attribution) node.appendChild(el("p", "", "— " + story.attribution));
    if (story.gist && frontText(story.gist).toLowerCase() !== frontText(story.title).toLowerCase()) node.appendChild(el("p", "", story.gist));
    // Where it came from, quietly after the story: never a label over the headline.
    if (story.source) node.appendChild(el("p", "src", story.source));
    var talk = newsTalks[story.url];
    if (talk) node.appendChild(talk.box);
    return node;
  }
  function drawNews2(recent) {
    var news = newsOf(recent);
    var signature = JSON.stringify([news.at, news.stories]);
    if (signature === newsDrawn) return;
    newsDrawn = signature;
    newsStories = news.stories;
    var when = news.at ? new Date(news.at) : null;
    newsWhen.hidden = !(when && !isNaN(when));
    if (!newsWhen.hidden) newsWhen.textContent = "Last updated " + when.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    newsCols.textContent = "";
    if (!news.stories.length) { newsPick(null); newsCols.appendChild(el("p", "feed-empty", "No news yet today.")); return; }
    var leadAt = news.stories.findIndex(function (story) { return !!newsPicture(story); });
    news.stories.forEach(function (story, index) { newsCols.appendChild(newsStory(story, index, index === leadAt)); });
    var still = newsPicked && newsStories.find(function (story) { return story.url === newsPicked.url; });
    newsPick(still || newsStories[0] || null);
  }
  // The message box follows the story he is on: the one picked, else the one in view.
  function newsPlaceholder(story) {
    var words = story ? "Ask about " + story.title : inputPlaceholder;
    input.setAttribute("placeholder", words);
    input.setAttribute("aria-label", words);
  }
  function newsPick(story) {
    newsPicked = story;
    newsCols.querySelectorAll(".story").forEach(function (node) { node.classList.toggle("on", newsStories[+node.dataset.story] === story); });
    if (centre === "news") { newsPlaceholder(story); newsConfirm(); }
    newsSyncStreams();
  }
  function newsConfirm() {
    var talk = newsPicked && newsTalks[newsPicked.url];
    paintConfirm(talk && talk.confirm);
  }
  function newsPickInView() {
    if (centre !== "news") return;
    var under = newsPointer && document.elementFromPoint && document.elementFromPoint(newsPointer.x, newsPointer.y);
    var pointed = under && under.closest("#news-cols .story");
    if (pointed) { newsPick(newsStories[+pointed.dataset.story]); return; }
    var page = document.getElementById("news-page").getBoundingClientRect();
    var viewport = { top: Math.max(0, page.top), bottom: Math.min(window.innerHeight, page.bottom), left: Math.max(0, page.left), right: Math.min(window.innerWidth, page.right) };
    var composerRect = composer.getBoundingClientRect();
    if (composerRect.top > viewport.top && composerRect.left < viewport.right && composerRect.right > viewport.left) viewport.bottom = Math.min(viewport.bottom, composerRect.top);
    var nodes = Array.prototype.slice.call(newsCols.querySelectorAll(".story"));
    var first = nodes.filter(function (node) {
      var rect = node.getBoundingClientRect();
      return rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left && rect.left < viewport.right;
    }).sort(function (a, b) { return Math.max(a.getBoundingClientRect().top, viewport.top) - Math.max(b.getBoundingClientRect().top, viewport.top); })[0];
    if (first) newsPick(newsStories[+first.dataset.story]);
  }
  window.addEventListener("scroll", function () { if (centre === "news") newsPickInView(); }, { passive: true });
  document.getElementById("news-page").addEventListener("scroll", newsPickInView, { passive: true });
  document.addEventListener("mousemove", function (event) { newsPointer = { x: event.clientX, y: event.clientY }; });
  newsCols.addEventListener("click", function (event) {
    if (event.target.closest("a, .talk")) return;
    var node = event.target.closest(".story");
    if (!node) return;
    newsPick(newsStories[+node.dataset.story]);
    input.focus();
  });
  newsCols.addEventListener("mouseover", function (event) {
    var node = event.target.closest(".story");
    if (node && newsStories[+node.dataset.story] !== newsPicked) newsPick(newsStories[+node.dataset.story]);
  });

  // Talking to a story: the story's own article conversation, drawn under it.
  var newsTalks = {};
  function newsTalkOf(story) {
    var talk = newsTalks[story.url];
    if (talk) return talk;
    talk = { box: el("div", "talk"), nodes: {}, messages: {}, pending: [], source: null, session: "" };
    newsTalks[story.url] = talk;
    var node = newsCols.querySelector('.story[data-story="' + newsStories.indexOf(story) + '"]');
    if (node) node.appendChild(talk.box);
    return talk;
  }
  function newsTalkDraw(talk, update) {
    talk.confirm = update.confirm || null;
    if (centre === "news" && newsPicked && newsTalks[newsPicked.url] === talk) newsConfirm();
    (update.messages || []).forEach(function (message) {
      talk.messages[message.id] = message;
      var line = talk.nodes[message.id];
      if (!line) {
        line = el("div", message.role === "user" ? "q" : "a");
        talk.nodes[message.id] = line;
      }
      line.innerHTML = message.html || "";
      if (message.images && message.images.length) line.appendChild(shots(message.images.map(function (id) {
        return "/api/image?session=" + encodeURIComponent(talk.session) + "&id=" + encodeURIComponent(id);
      })));
      if (message.files && message.files.length) line.appendChild(docs(message.files));
    });
    var keep = {};
    (update.order || []).forEach(function (id) { keep[id] = true; });
    Object.keys(talk.nodes).forEach(function (id) { if (!keep[id]) { talk.nodes[id].remove(); delete talk.nodes[id]; } });
    Object.keys(talk.messages).forEach(function (id) { if (!keep[id]) delete talk.messages[id]; });
    (update.order || []).forEach(function (id) { if (talk.nodes[id]) talk.box.appendChild(talk.nodes[id]); });
    newsReconcile(talk);
    talk.pending.forEach(function (pending) { talk.box.appendChild(pending.asked); talk.box.appendChild(pending.answer); });
  }
  function newsReconcile(talk) {
    talk.pending = talk.pending.filter(function (pending) {
      if (!pending.id || !talk.messages[pending.id] || talk.messages[pending.id].role !== "user") return true;
      pending.matched = true;
      pending.asked.remove();
      if (!pending.warning) pending.answer.remove();
      if (!input.value && !attachments.length) saveDraftNow();
      return false;
    });
  }
  function newsListen(talk) {
    if (talk.source || !talk.session || centre !== "news" || !newsPicked || newsTalks[newsPicked.url] !== talk) return;
    var source = new EventSource("/api/stream?token=" + encodeURIComponent(VIEW_TOKEN) + "&session=" + encodeURIComponent(talk.session));
    talk.source = source;
    source.addEventListener("update", function (event) { if (talk.source === source) newsTalkDraw(talk, JSON.parse(event.data)); });
  }
  function newsSyncStreams() {
    var selected = centre === "news" && newsPicked && newsTalks[newsPicked.url];
    Object.keys(newsTalks).forEach(function (url) {
      var talk = newsTalks[url];
      if (talk !== selected && talk.source) { talk.source.close(); talk.source = null; }
    });
    if (selected) newsListen(selected);
  }
  function newsSubmit(story, text, sending) {
    recall.index = -1;
    sentSinceLoad.push(text);
    sendsInFlight += 1;
    input.value = "";
    attachments = [];
    renderAttachments();
    var talk = newsTalkOf(story);
    var asked = el("div", "q pending", text);
    var images = sending.filter(function (a) { return !a.name; });
    var files = sending.filter(function (a) { return a.name; });
    if (images.length) asked.appendChild(shots(images.map(function (a) { return a.url; })));
    if (files.length) asked.appendChild(docs(files.map(function (a) { return a.name; })));
    talk.box.appendChild(asked);
    var answer = el("div", "a pending", assistant + " is reading the story…");
    talk.box.appendChild(answer);
    var pending = { asked: asked, answer: answer, id: "", matched: false, warning: false };
    talk.pending.push(pending);
    function failed(why) {
      sendsInFlight -= 1;
      talk.pending = talk.pending.filter(function (one) { return one !== pending; });
      answer.textContent = why;
      answer.classList.remove("pending");
      function restore() {
        var original = newsStories.find(function (one) { return one.url === story.url; });
        if (!original || input.value || attachments.length) return false;
        if (frontActive !== "talk") frontSelect("talk");
        setCentre("news", true);
        newsPick(original);
        input.value = text;
        attachments = sending;
        renderAttachments();
        asked.remove();
        answer.remove();
        return true;
      }
      if (!restore()) {
        var restoreButton = el("button", "", "Restore draft");
        restoreButton.type = "button";
        restoreButton.addEventListener("click", restore);
        answer.appendChild(document.createTextNode(" "));
        answer.appendChild(restoreButton);
      }
    }
    var opened = talk.session ? Promise.resolve({ session: talk.session }) : tokenFetch("/api/article-chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: story.url, title: story.title || "", media: story.media || "article", text: story.quote || story.gist || "", description: story.gist || "", figure: story.figure || "", attribution: story.attribution || "" }) }, true)
      .then(function (response) { return response.ok ? response.json() : null; });
    opened.then(function (data) {
      if (!data || !data.session) { failed("That story could not be opened. Try again in a moment."); return; }
      talk.session = data.session;
      var payload = JSON.stringify({ session: talk.session, text: text,
        images: images.map(function (a) { return { mediaType: a.mediaType, data: a.data }; }),
        files: files.map(function (a) { return { name: a.name, data: a.data }; }) });
      newsListen(talk);
      function send() { return deliver(payload).then(function (sent) {
        sendsInFlight -= 1;
        if (sent.unsure) {
          if (!talk.box.contains(answer)) talk.box.appendChild(answer);
          answer.classList.remove("pending");
          answer.textContent = "May not have sent. ";
          var resend = el("button", "", "Tap to resend");
          resend.type = "button";
          resend.addEventListener("click", function () { resend.remove(); sendsInFlight += 1; answer.textContent = assistant + " is reading the story…"; send(); });
          answer.appendChild(resend);
          return;
        }
        pending.id = sent.id || "";
        pending.warning = !!sent.warning;
        newsReconcile(talk);
        if (!input.value && !attachments.length) saveDraftNow();
        if (sent.warning) { if (!talk.box.contains(answer)) talk.box.appendChild(answer); answer.classList.remove("pending"); answer.textContent = "Saved, but not passed on yet."; }
        else if (!pending.matched) answer.classList.add("pending");
      }).catch(function () { failed("Not sent. Try again."); }); }
      return send();
    }).catch(function () { failed("Not sent. Try again."); });
  }
  // On News the box talks about the story; elsewhere a message starts the conversation in the middle.
  document.addEventListener("submit", function (event) {
    if (event.target !== composer) return;
    if (centre !== "talk" && (centre !== "news" || !newsPicked)) setCentre("talk", true);
  }, true);

  // The weather card: where he is, now, the week, and the hours of the day picked.
  var WX_ICONS = {
    sun: '<g stroke="#f0ae2c" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/></g><circle cx="12" cy="12" r="4.8" fill="#f0ae2c"/>',
    few: '<circle cx="15.5" cy="8.5" r="4.6" fill="#f0ae2c"/><path d="M6.8 18.5a4.3 4.3 0 0 1-.6-8.55 5.6 5.6 0 0 1 10.9-.9 4.75 4.75 0 0 1 .1 9.45z" fill="#c3c2bc" transform="translate(-1.5 3) scale(.9)"/>',
    cloud: '<path d="M6.8 18.5a4.3 4.3 0 0 1-.6-8.55 5.6 5.6 0 0 1 10.9-.9 4.75 4.75 0 0 1 .1 9.45z" fill="#b4b3ad" transform="translate(0 -1)"/>',
    rain: '<path d="M6.8 18.5a4.3 4.3 0 0 1-.6-8.55 5.6 5.6 0 0 1 10.9-.9 4.75 4.75 0 0 1 .1 9.45z" fill="#b4b3ad" transform="translate(1.2 -1.4) scale(.9)"/><path d="M8.5 18.2l-1.2 3M12.6 18.2l-1.2 3M16.7 18.2l-1.2 3" stroke="#3f86cf" stroke-width="2" stroke-linecap="round"/>',
    storm: '<path d="M6.8 18.5a4.3 4.3 0 0 1-.6-8.55 5.6 5.6 0 0 1 10.9-.9 4.75 4.75 0 0 1 .1 9.45z" fill="#8f8e88" transform="translate(1.2 -1.4) scale(.9)"/><path d="M13 14.5l-3.4 4.4h2.7l-1.5 3.6 4.3-5h-2.7l1.8-3z" fill="#f0ae2c"/>',
  };
  // WMO weather codes as the five pictures.
  function wxKind(code) {
    if (code === 0) return "sun";
    if (code <= 2) return "few";
    if (code >= 95) return "storm";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    return "cloud";
  }
  function wxIcon(code, big) {
    return '<svg class="wx-ic' + (big ? " big" : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + WX_ICONS[wxKind(code)] + '</svg>';
  }
  function wxDeg(value) { return Math.round(value) + "°"; }
  var weather = null;
  var wxDay = 0;
  var wxSelected = false;
  function wxDayName(date, index, long) {
    if (!index) return "Today";
    var parts = date.split("-");
    return new Date(+parts[0], +parts[1] - 1, +parts[2]).toLocaleDateString([], { weekday: long ? "long" : "short" });
  }
  function wxCard(dayIndex, hourIndex) {
    var days = weather.days || [];
    var day = days[dayIndex];
    var today = !dayIndex;
    var hours = day ? day.hours : (weather.hours || []).filter(function (_, index) { return index % 2 === 1; }).slice(0, 6);
    var hour = hourIndex >= 0 ? hours[hourIndex] : null;
    var current = !day || (today && !wxSelected);
    var nowCode = hour ? (hour.code != null ? hour.code : day ? day.code : weather.code) : current ? weather.code : day.code;
    var nowDeg = hour ? hour.tempC : current ? weather.tempC : day.hiC;
    var hourDate = hour && hour.at.slice(0, 10);
    var todayDate = days[0] ? days[0].date : weather.hours && weather.hours[0] ? weather.hours[0].at.slice(0, 10) : "";
    var label = hour ? wxDayName(hourDate, hourDate === todayDate ? 0 : 1, true) + " " + hour.at.slice(11, 16) : current ? (weather.localTime || clock(weather.read)) : wxDayName(day.date, dayIndex, true);
    var html = '<div class="wx-top"><span class="wx-tag">' + frontEsc(weather.place || "Here") + '</span><time>' + frontEsc(label) + '</time></div>'
      + '<div class="wx-now">' + wxIcon(nowCode, true) + '<div class="wx-deg">' + wxDeg(nowDeg) + '</div></div>';
    if (days.length) {
      html += '<div class="wx-days" role="group" aria-label="The week">' + days.map(function (one, index) {
        return '<button type="button" data-day="' + index + '" class="' + (index === dayIndex ? "on" : "") + '" aria-pressed="' + (index === dayIndex) + '"><time>' + frontEsc(wxDayName(one.date, index)) + '</time>'
          + wxIcon(one.code) + '<b>' + wxDeg(one.hiC) + '</b><span>' + wxDeg(one.loC) + '</span></button>';
      }).join("") + '</div>';
    }
    if (hours.length) {
      html += '<ul class="wx-hours" style="grid-template-columns:repeat(' + hours.length + ',minmax(0,1fr))">' + hours.map(function (one, index) {
        return '<li><button type="button" data-hour="' + index + '" class="' + (index === hourIndex ? "on" : "") + '" aria-pressed="' + (index === hourIndex) + '"><time>' + frontEsc(one.at.slice(11, 16)) + '</time>'
          + wxIcon(one.code != null ? one.code : day ? day.code : weather.code) + '<b>' + wxDeg(one.tempC) + '</b><span>' + Math.round(one.rainChance) + '%</span></button></li>';
      }).join("") + '</ul>';
    }
    return html;
  }
  function drawWeather(dayIndex, hourIndex) {
    [newsSide, newsSidePhone].forEach(function (side) {
      side.textContent = "";
      if (!weather) return;
      var card = el("section", "wxcard");
      card.setAttribute("aria-label", "Weather");
      card.innerHTML = wxCard(dayIndex, hourIndex);
      side.appendChild(card);
    });
  }
  function wxClick(event) {
    var dayButton = event.target.closest("[data-day]");
    var hourButton = event.target.closest("[data-hour]");
    if (dayButton) { wxDay = +dayButton.dataset.day; wxSelected = true; drawWeather(wxDay, -1); }
    else if (hourButton) drawWeather(wxDay, +hourButton.dataset.hour);
  }
  newsSide.addEventListener("click", wxClick);
  newsSidePhone.addEventListener("click", wxClick);
  var weatherAt = 0;
  function loadWeather() {
    if (!VIEW_TOKEN) return;
    if (Date.now() - weatherAt < 10 * 60 * 1000) return;
    weatherAt = Date.now();
    fetch(withToken("/api/weather")).then(function (r) { if (!r.ok) throw new Error("weather unavailable"); return r.json(); }).then(function (data) {
      weather = data && data.weather ? data.weather : null;
      if (!weather) weatherAt = 0;
      if (weather && weather.days && wxDay >= weather.days.length) wxDay = 0;
      drawWeather(wxDay, -1);
    }).catch(function () { weatherAt = 0; });
  }

  // Only the conversation keeps him at its latest message; Today and News open at their top.
  var onConversationBase = onConversation;
  onConversation = function () { return onConversationBase() && (centre === "talk" || !!frontRoot.getAttribute("data-job")); };
  // The front page's redraw carries Today and News along.
  var renderFrontBase = renderFront;
  renderFront = function (update) {
    renderFrontBase(update);
    if (!update) return;
    todayUpdate = update;
    // At rest the middle is Today; a conversation that already has words keeps it.
    if (!centreChosen) setCentre(update.order && update.order.length ? "talk" : "today");
    drawToday();
    if (update.leftColumn) drawNews2(update.leftColumn.recent);
  };
  historyList.addEventListener("click", function (event) { if (event.target.closest(".history-item")) setCentre("talk", true); });
  // A job opened from the column takes the middle as it always has; closing it goes back to what was there.
  setCentre("today");
  loadTodaySessions();
  setInterval(function () { loadTodaySessions(); if (centre === "news") loadWeather(); }, 60000);
`;

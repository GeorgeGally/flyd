/** Usage under the box, the stream connection, sessions and history. */
export const SESSION_SCRIPT = `
  // Under the message box: how full the context is, and the plan's limits.
  var usageEl = document.getElementById("usage");
  var usage = { context: null, plan: null };
  function compact(n) {
    return n >= 1000000 ? (Math.round(n / 100000) / 10) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
  }
  function renderUsage() {
    var parts = [];
    if (usage.context) {
      var c = usage.context;
      parts.push("context " + Math.round((c.tokens / c.window) * 100) + "% · " + compact(c.tokens) + " of " + compact(c.window));
    }
    if (usage.plan) {
      usage.plan.windows.forEach(function (w) {
        parts.push(w.label + " " + Math.round(w.percentRemaining) + "% left" + (w.resetsAt ? ", resets " + dayOf(w.resetsAt) + " " + clock(w.resetsAt) : ""));
      });
    }
    usageEl.textContent = parts.join("   ·   ");
  }
  function loadPlan() {
    fetch("/api/plan").then(function (r) { return r.json(); }).then(function (data) { usage.plan = data.plan; renderUsage(); }).catch(function () {});
  }
  loadPlan();
  setInterval(loadPlan, 60000);

  function reset() {
    nodes.forEach(function (el) { el.remove(); });
    nodes.clear();
    usage.context = null;
    renderUsage();
    // Optimistic copies belong to the session they were sent from.
    main.querySelectorAll(".msg.pending").forEach(function (el) { el.remove(); });
    awaiting.clear();
    carried.clear();
    first = true;
    jump.hidden = true;
  }

  function connect(sessionId) {
    if (!VIEW_TOKEN) return;
    if (typingPredictions) typingPredictions.reset();
    if (source) source.close();
    reset();
    var streamQuery = "?token=" + encodeURIComponent(VIEW_TOKEN) + (sessionId ? "&session=" + encodeURIComponent(sessionId) : "");
    source = new EventSource("/api/stream" + streamQuery);
    source.addEventListener("session", function (event) {
      var session = JSON.parse(event.data);
      if (current && current !== session.id) {
        if (typingPredictions) typingPredictions.reset();
        reset();
      }
      current = session.id;
      assistant = session.assistantLabel;
      answersInSession = session.answersInSession === true;
      showTitle(session);
      loadSessions();
    });
    source.addEventListener("update", function (event) { problem.textContent = ""; apply(JSON.parse(event.data)); });
    source.addEventListener("problem", function (event) { problem.textContent = JSON.parse(event.data).error; });
    source.addEventListener("staff", function (event) { showStaff(JSON.parse(event.data)); });
    source.onerror = function () {
      problem.textContent = "reconnecting…";
      // The browser retries a dropped stream by itself, but gives up for good
      // once the view refuses it: after a restart the old token is no longer
      // the view's. Then a new view is up; load it, its code and its token.
      if (source.readyState === 2 /* CLOSED */) rejoin(sessionId);
    };
    source.onopen = function () { problem.textContent = ""; rejoinDelay = 1000; };
  }
  var rejoinDelay = 1000;
  var rejoining = null;
  function rejoin(sessionId) {
    if (rejoining) return;
    rejoining = setTimeout(function () {
      fetch("/api/token").then(function (r) { return r.json(); }).then(function (data) {
        rejoining = null;
        // The draft is kept on the way out (pagehide), so reloading loses nothing.
        if (data.token && data.token !== VIEW_TOKEN) { location.reload(); return; }
        rejoinDelay = Math.min(rejoinDelay * 2, 15000);
        connect(sessionId);
      }).catch(function () {
        // The view is not up yet: try again, less often each time.
        rejoining = null;
        rejoinDelay = Math.min(rejoinDelay * 2, 15000);
        rejoin(sessionId);
      });
    }, rejoinDelay);
  }

  function loadSessions() {
    return fetch("/api/sessions").then(function (r) { return r.json(); }).then(function (data) {
      var sessions = (data.sessions || []).slice();
      latestSession = sessions.length ? sessions[0].id : null;
      var shown = sessions.find(function (session) { return session.id === current; });
      if (shown) showTitle(shown);
      renderHistory(sessions);
      return sessions;
    });
  }

  var articleStarters = [];
  function showTitle(session) {
    conversationTitle.textContent = session.title || "Conversation";
    document.title = (session.title || "Conversation") + " · " + assistant;
    var back = document.getElementById("article-back");
    if (back) {
      if (session.link && session.link.href) {
        back.href = session.link.href;
        back.textContent = session.link.label || "Article";
        back.hidden = false;
      } else back.hidden = true;
    }
    articleStarters = Array.isArray(session.starters) ? session.starters.slice(0, 3) : [];
    paintStarters(!!main.querySelector(".msg:not(.pending)"));
  }
  function paintStarters(hasMessages) {
    var box = document.getElementById("article-starters");
    if (!box) return;
    if (hasMessages || !articleStarters.length) { box.hidden = true; box.textContent = ""; delete box.dataset.drawn; return; }
    var drawn = articleStarters.join("\\n");
    if (box.dataset.drawn === drawn && !box.hidden) return;
    box.dataset.drawn = drawn;
    box.textContent = "";
    box.hidden = false;
    box.appendChild(el("p", "", "Ask about this article"));
    articleStarters.forEach(function (question) {
      var button = el("button", "", question);
      button.type = "button";
      button.addEventListener("click", function () {
        var field = document.getElementById("input");
        field.value = question;
        field.dispatchEvent(new Event("input"));
        document.getElementById("composer").dispatchEvent(new Event("submit", { cancelable: true }));
      });
      box.appendChild(button);
    });
  }

  var HISTORY_FEW = 5;
  var historyAll = {};
  var lastSessions = [];
  function renderHistory(sessions) {
    lastSessions = sessions;
    var past = sessions.filter(function (session) { return session.id !== current; });
    var drawn = JSON.stringify([current, past.map(function (session) { return [session.id, session.title, session.project, session.link && session.link.href, ago(session.updatedAt)]; })]);
    if (drawn === historyDrawn) return;
    historyDrawn = drawn;
    var expanded = new Map(Array.from(historyList.querySelectorAll("details")).map(function (details) {
      return [details.querySelector("summary").textContent, details.open];
    }));
    var groups = new Map();
    past.forEach(function (session) {
      var name = session.project && String(session.project).trim() || "General";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(session);
    });
    var ordered = Array.from(groups.entries()).map(function (entry) {
      entry[1].sort(function (a, b) { return Date.parse(b.updatedAt) - Date.parse(a.updatedAt); });
      return { name: entry[0], sessions: entry[1], newest: Date.parse(entry[1][0].updatedAt) || 0 };
    }).sort(function (a, b) { return b.newest - a.newest; });
    historyList.textContent = "";
    historyEl.hidden = !current || ordered.length === 0;
    ordered.forEach(function (group, index) {
      var details = document.createElement("details");
      details.className = "history-group";
      var summary = document.createElement("summary");
      summary.textContent = group.name;
      details.open = expanded.has(group.name) ? expanded.get(group.name) : index === 0;
      details.appendChild(summary);
      var list = document.createElement("ul");
      list.className = "history-items";
      // A few conversations each, newest first; the rest wait behind "Show all" so the column's work stays in view.
      var whole = !!historyAll[group.name];
      (whole ? group.sessions : group.sessions.slice(0, HISTORY_FEW)).forEach(function (session) {
        var item = document.createElement("li");
        var button = document.createElement("button");
        button.type = "button";
        button.className = "history-item";
        button.appendChild(el("span", "history-item-title", session.title || "Untitled conversation"));
        button.appendChild(el("span", "history-item-age", ago(session.updatedAt)));
        button.addEventListener("click", function () {
          explicit = session.id;
          window.history.replaceState(null, "", "?session=" + encodeURIComponent(explicit));
          if (!frontLayout && window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
            railMobileDismissed = true;
            showRail();
          }
          connect(explicit);
        });
        item.appendChild(button);
        if (session.link && session.link.href) {
          var back = document.createElement("a");
          back.className = "history-article";
          back.href = session.link.href;
          back.target = "_blank";
          back.rel = "noopener noreferrer";
          back.textContent = session.link.label || "Article";
          item.appendChild(back);
        }
        list.appendChild(item);
      });
      details.appendChild(list);
      if (group.sessions.length > HISTORY_FEW) {
        var more = el("button", "brief-more history-more", whole ? "Show fewer" : "Show all " + group.sessions.length);
        more.type = "button";
        more.addEventListener("click", function () {
          historyAll[group.name] = !whole;
          historyDrawn = "";
          renderHistory(lastSessions);
        });
        details.appendChild(more);
      }
      historyList.appendChild(details);
    });
    showRail();
  }

  // Without an explicit pick, follow whichever session is newest (a /clear
  // in Claude Code starts a new transcript file).
  setInterval(function () {
    loadSessions().then(function (sessions) {
      if (!explicit && sessions.length && current && sessions[0].id !== current) connect(null);
    }).catch(function () {});
  }, 5000);

  window.addEventListener("scroll", function () {
    if (!onConversation()) return;
    pinned = nearBottom();
    if (pinned) jump.hidden = true;
  }, { passive: true });
  // A picture loading or a summary landing grows the page: a pinned reader stays on the latest.
  if (window.ResizeObserver) new ResizeObserver(function () { if (pinned && onConversation()) toBottom(); }).observe(main);
  jump.addEventListener("click", function () { toBottom(); jump.hidden = true; });

`;

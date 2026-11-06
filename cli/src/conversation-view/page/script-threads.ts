/**
 * The Projects tab: each project's latest exchange, with a mark on what he has
 * not read, and its thread in the middle once picked. A thread is a session to
 * the stream ("project:dir"), so the conversation draws it as it draws any other.
 * What he has read is his browser's own. Borrows connect, explicit, current,
 * frontTab, frontSelect, frontEsc, frontWhen and frontRoot from the page's closure.
 */
export const THREADS_SCRIPT = `
  var threadsEl = document.getElementById("threads");
  var threadsDot = document.getElementById("rtab-threads-dot");
  var threadsDrawn = "";
  var THREADS_SEEN = "flyd-threads-seen";
  var threadsSeen = {};
  try { threadsSeen = JSON.parse(localStorage.getItem(THREADS_SEEN) || "{}") || {}; } catch (_) {}
  // From his first look on, not the whole backfill: older replies are history, not news.
  if (!threadsSeen.since) threadsSeen.since = new Date().toISOString();
  function keepThreadsSeen() {
    try { localStorage.setItem(THREADS_SEEN, JSON.stringify(threadsSeen)); } catch (_) {}
  }
  keepThreadsSeen();
  function inThread() { return !!current && current.indexOf("project:") === 0; }
  function threadUnread(thread) {
    if (!thread.replyAt) return false;
    var seen = Math.max(Date.parse(threadsSeen[thread.id] || "") || 0, Date.parse(threadsSeen.since) || 0);
    return Date.parse(thread.replyAt) > seen;
  }
  function threadRow(thread) {
    var open = thread.id === explicit;
    var unread = !open && thread.id !== "project:all" && thread.id !== "project:other" && threadUnread(thread);
    return '<button type="button" class="thread' + (open ? " on" : "") + (unread ? " unread" : "") + '" data-thread="' + frontEsc(thread.id) + '"' + (open ? ' aria-current="true"' : "") + '>'
      + '<span class="thread-top"><span class="thread-name">' + frontEsc(thread.name) + '</span>'
      + (unread ? '<span class="thread-dot" role="img" aria-label="unread"></span>' : "")
      + '<span class="thread-when">' + frontEsc(frontWhen(thread.at)) + '</span></span>'
      + (thread.question ? '<span class="thread-q">' + frontEsc(thread.question) + '</span>' : "")
      + (thread.answer ? '<span class="thread-a">' + frontEsc(thread.answer) + '</span>' : "")
      + '</button>';
  }
  function drawThreads(list) {
    var rows = (list.all ? [list.all] : []).concat(list.projects || [], list.other ? [list.other] : []);
    var open = rows.filter(function (thread) { return thread.id === explicit; })[0];
    if (open && open.replyAt && open.replyAt !== threadsSeen[open.id]) { threadsSeen[open.id] = open.replyAt; keepThreadsSeen(); }
    var html = rows.length ? '<div class="fstrip thread-list">' + rows.map(threadRow).join("") + '</div>'
      : '<p class="fempty">' + (list.ready ? "Nothing said about a project yet." : "Reading your conversations.") + '</p>';
    threadsDot.hidden = !(list.projects || []).some(function (thread) { return thread.id !== explicit && threadUnread(thread); });
    if (html === threadsDrawn) return;
    threadsDrawn = html;
    threadsEl.innerHTML = html;
  }
  function loadThreads() {
    fetch("/api/projects").then(function (r) { return r.json(); }).then(drawThreads).catch(function () {});
  }
  function followThread(id) {
    if (frontActive !== "talk") frontSelect("talk");
    explicit = id;
    window.history.replaceState(null, "", "?session=" + encodeURIComponent(id));
    threadsEl.querySelectorAll(".thread").forEach(function (row) {
      var on = row.dataset.thread === id;
      row.classList.toggle("on", on);
      if (on) { row.classList.remove("unread"); row.setAttribute("aria-current", "true"); } else row.removeAttribute("aria-current");
    });
    connect(id);
    loadThreads();
  }
  threadsEl.addEventListener("click", function (event) {
    var row = event.target.closest(".thread");
    if (row) followThread(row.dataset.thread);
  });
  loadThreads();
  setInterval(loadThreads, 5000);
`;

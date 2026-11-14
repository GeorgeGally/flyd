/**
 * The Week tab: eight days side by side, midnight at the top, each day a strip
 * coloured hour by hour by the project that changed then (Flyd, Logan and
 * DIR in their own inks, everything else one neutral). The day picked
 * (hovered or tapped; at first the latest day with work) is told underneath.
 * Pointing at a block (hover, a tap, or the arrow keys on a focused day) opens
 * a small card beside its strip: the project, the hours, and what changed then.
 * The story keeps the room of the tallest day's at the width shown, so picking
 * another day never moves what sits under its headline. Data from /api/week
 * (week.ts). Runs inside the page script's closure after
 * Today's script and borrows its helpers (frontEsc, withToken, centre).
 */
export const WEEK_SCRIPT = `
  // The week: eight days, hour by hour.
  var weekKey = document.getElementById("wk-key");
  var weekDays = document.getElementById("wk-days");
  var weekTell = document.getElementById("wk-tell");
  var weekCard = document.getElementById("wk-card");
  var weekPage = document.getElementById("week-page");
  var weekSegs = {};
  var weekLit = null;
  var weekPinned = false;
  var weekKeyed = false;
  var week = null;
  var weekAt = 0;
  var weekPicked = "";
  var weekShown = "";
  var WEEK_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var WEEK_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var WEEK_MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function weekDate(day) { var p = day.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function weekInk(project) { var at = week.lead.indexOf(project); return at < 0 ? "k0" : "k" + (at + 1); }
  // An active hour is shared between its projects by how much each changed; touching runs of one project join.
  function weekSegments(day) {
    var out = [];
    for (var h = 0; h < 24; h++) {
      var here = Object.keys(day.hours).map(function (k) { return [k, day.hours[k][h]]; }).filter(function (x) { return x[1]; })
        .sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
      var sum = here.reduce(function (a, x) { return a + x[1]; }, 0);
      var at = h;
      here.forEach(function (x) {
        var w = x[1] / sum, last = out[out.length - 1];
        if (last && last.k === x[0] && Math.abs(last.b - at) < 1e-6) { last.b = at + w; last.h1 = h + 1; }
        else out.push({ k: x[0], a: at, b: at + w, h0: h, h1: h + 1 });
        at += w;
      });
    }
    return out;
  }
  function weekClock(x) { var h = Math.floor(x), m = Math.round((x - h) * 60); if (m === 60) { h += 1; m = 0; } return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"); }
  function weekHour(h) { return String(h % 24).padStart(2, "0") + ":00"; }
  // The card for one block: the project, the whole hours it spans, and the changes made in them.
  function weekCardHtml(day, seg) {
    var done = (day.work || []).filter(function (one) { var h = new Date(one.at).getHours(); return one.project === seg.k && h >= seg.h0 && h < seg.h1; });
    var shown = done.slice(-5);
    var more = done.length - shown.length;
    return '<p class="wk-card-who"><i class="' + weekInk(seg.k) + '"></i>' + frontEsc(seg.k) + '</p>'
      + '<p class="wk-card-when">' + weekHour(seg.h0) + ' to ' + weekHour(seg.h1) + (done.length ? ", " + done.length + (done.length === 1 ? " change" : " changes") : "") + '</p>'
      + (shown.length ? '<ul>' + shown.map(function (one) { return '<li>' + frontEsc(one.title) + (one.ref ? ' <span>' + frontEsc(one.ref) + '</span>' : "") + '</li>'; }).join("") + '</ul>' : "")
      + (more > 0 ? '<p class="wk-card-more">and ' + more + ' earlier</p>' : "");
  }
  // Beside the strip, right or left, so the block stays in view; on a narrow screen above or below it. Always on screen.
  function weekPlace(el) {
    var lane = el.parentNode.getBoundingClientRect(), seg = el.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight, gap = 14, edge = 8;
    // The message box floats over the bottom of the screen: the card stays above it.
    var box = document.getElementById("composer"), boxAt = box ? box.getBoundingClientRect() : null;
    if (boxAt && boxAt.height && boxAt.top > vh / 2) vh = Math.min(vh, boxAt.top);
    weekCard.style.maxWidth = "";
    var w = weekCard.offsetWidth, h = weekCard.offsetHeight, x, y;
    var right = vw - edge - lane.right - gap, left = lane.left - gap - edge;
    if (right >= w || left >= w) {
      x = right >= w ? lane.right + gap : lane.left - gap - w;
      y = Math.min(Math.max(seg.top + Math.min(seg.height, 40) / 2 - 20, edge), vh - h - edge);
    } else {
      x = Math.min(Math.max(seg.left + seg.width / 2 - w / 2, edge), vw - w - edge);
      var below = vh - edge - seg.bottom - gap, above = seg.top - gap - edge;
      if (below >= h || above >= h) y = below >= h ? seg.bottom + gap : seg.top - gap - h;
      else {
        // A block taller than the room around it: beside the strip on the roomier side, narrowed to fit.
        var room = Math.max(right, left);
        weekCard.style.maxWidth = room + "px";
        w = weekCard.offsetWidth; h = weekCard.offsetHeight;
        x = right >= left ? lane.right + gap : lane.left - gap - w;
        y = Math.min(Math.max(seg.top, edge), vh - h - edge);
      }
    }
    weekCard.style.left = Math.round(Math.max(x, edge)) + "px";
    weekCard.style.top = Math.round(Math.max(y, edge)) + "px";
  }
  function weekShow(el) {
    var dayEl = el && el.closest(".wk-day");
    var segs = dayEl && weekSegs[dayEl.dataset.day];
    var day = dayEl && week && week.days.filter(function (one) { return one.day === dayEl.dataset.day; })[0];
    var seg = segs && segs[+el.dataset.s];
    if (!seg || !day) { weekHide(); return; }
    if (weekLit && weekLit !== el) weekLit.classList.remove("lit");
    weekLit = el;
    el.classList.add("lit");
    weekCard.innerHTML = weekCardHtml(day, seg);
    weekCard.hidden = false;
    weekDays.querySelectorAll(".wk-day").forEach(function (one) { if (one === dayEl) one.setAttribute("aria-describedby", "wk-card"); else one.removeAttribute("aria-describedby"); });
    weekPlace(el);
  }
  function weekHide() {
    weekPinned = false;
    if (weekLit) weekLit.classList.remove("lit");
    weekLit = null;
    weekCard.hidden = true;
    weekDays.querySelectorAll(".wk-day[aria-describedby]").forEach(function (one) { one.removeAttribute("aria-describedby"); });
  }
  function drawWeek() {
    weekHide();
    weekSegs = {};
    if (!week) {
      weekKey.innerHTML = "";
      weekDays.innerHTML = "";
      weekTell.innerHTML = '<p class="wk-none">Nothing to show yet.</p>';
      weekShown = "";
      weekFit();
      return;
    }
    weekKey.innerHTML = week.lead.map(function (name, at) { return '<span><i class="k' + (at + 1) + '"></i>' + frontEsc(name) + '</span>'; }).join("")
      + '<span><i class="k0"></i>Everything else</span>';
    var last = week.days.length - 1;
    var now = new Date();
    var nowAt = (now.getHours() + now.getMinutes() / 60) / 24 * 100;
    weekDays.innerHTML = week.days.map(function (day, di) {
      var d = weekDate(day.day);
      var parts = weekSegments(day);
      weekSegs[day.day] = parts;
      var segs = parts.map(function (s, si) {
        return '<i class="' + weekInk(s.k) + '" data-s="' + si + '" aria-label="' + frontEsc(s.k + ", " + weekClock(s.a) + " to " + weekClock(s.b)) + '" style="top:' + (s.a / 24 * 100).toFixed(2) + '%;height:' + ((s.b - s.a) / 24 * 100).toFixed(2) + '%;animation-delay:' + (di * 60 + s.a * 30).toFixed(0) + 'ms"></i>';
      }).join("");
      return '<button type="button" class="wk-day" data-day="' + frontEsc(day.day) + '" aria-pressed="false" aria-label="' + frontEsc(WEEK_LONG[d.getDay()] + " " + d.getDate() + ", " + day.changes + " changes") + '">'
        + '<u>' + WEEK_DAY[d.getDay()] + ' <b>' + d.getDate() + '</b></u>'
        + '<span class="wk-lane">' + segs + (di === last ? '<em style="top:' + nowAt.toFixed(2) + '%"></em>' : "") + '</span></button>';
    }).join("");
    weekShown = "";
    weekFit();
    if (!week.days.some(function (day) { return day.day === weekPicked; })) {
      var busy = week.days.filter(function (day) { return day.changes; });
      weekPicked = (busy[busy.length - 1] || week.days[last]).day;
    }
    weekPick(weekPicked);
  }
  function weekPick(dayKey) {
    if (!week || weekShown === dayKey) return;
    weekShown = weekPicked = dayKey;
    var day = week.days.filter(function (one) { return one.day === dayKey; })[0];
    if (!day) return;
    weekDays.querySelectorAll(".wk-day").forEach(function (one) {
      var on = one.dataset.day === dayKey;
      one.classList.toggle("on", on);
      one.setAttribute("aria-pressed", String(on));
    });
    if (weekWidth() !== weekFitAt) weekFit();
    weekTell.innerHTML = weekTellHtml(day);
  }
  function weekTellHtml(day) {
    var d = weekDate(day.day);
    var when = WEEK_LONG[d.getDay()] + " " + d.getDate() + " " + WEEK_MONTH[d.getMonth()] + ", " + (day.changes ? day.changes + (day.changes === 1 ? " change" : " changes") : "no changes");
    return '<div><h3>' + frontEsc(day.head || "A quiet day") + '</h3><time>' + frontEsc(when) + '</time></div>'
      + day.lines.map(function (line) { return '<p>' + frontEsc(line) + '</p>'; }).join("");
  }
  // A headline wraps to two, three or four lines by day and by width. Each day's story is laid out once,
  // unseen, at the width shown; the headline keeps the tallest one's height and the story the tallest
  // story's, so the date and lines under the headline (and, with the group centred, the strips above) stay put.
  var weekFitAt = -1;
  function weekWidth() { return Math.round(weekTell.getBoundingClientRect().width); }
  function weekFit() {
    weekTell.style.removeProperty("--wk-head-h");
    weekTell.style.minHeight = "";
    weekFitAt = -1;
    var width = weekWidth();
    if (!week || !width) return;
    var probe = weekTell.cloneNode(false);
    probe.removeAttribute("id");
    probe.removeAttribute("aria-live");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;left:0;top:0;margin:0;visibility:hidden;pointer-events:none;width:" + width + "px";
    weekTell.parentNode.appendChild(probe);
    var head = 0, tall = 0;
    week.days.forEach(function (day) {
      probe.innerHTML = weekTellHtml(day);
      head = Math.max(head, probe.querySelector("h3").getBoundingClientRect().height);
    });
    head = Math.ceil(head);
    // Then each story again under a headline of that height.
    probe.style.setProperty("--wk-head-h", head + "px");
    week.days.forEach(function (day) {
      probe.innerHTML = weekTellHtml(day);
      tall = Math.max(tall, probe.getBoundingClientRect().height);
    });
    probe.remove();
    if (head) weekTell.style.setProperty("--wk-head-h", head + "px");
    if (tall) weekTell.style.minHeight = Math.ceil(tall) + "px";
    weekFitAt = width;
  }
  // Shown after being hidden, or narrowed or widened: the room is measured again.
  // (A frame later: resizing what is being observed inside its own callback is a loop the browser complains of.)
  if (window.ResizeObserver) new ResizeObserver(function () {
    requestAnimationFrame(function () { if (week && weekWidth() !== weekFitAt) weekFit(); });
  }).observe(weekTell);
  weekDays.addEventListener("mouseover", function (event) {
    var one = event.target.closest(".wk-day"); if (one) weekPick(one.dataset.day);
    var seg = event.target.closest(".wk-lane i");
    if (seg && seg !== weekLit) { weekPinned = false; weekShow(seg); }
    else if (!seg && !weekPinned && !weekKeyed) weekHide();
  });
  weekDays.addEventListener("mouseleave", function () {
    if (weekKeyed) {
      var focused = document.activeElement;
      var visible = false;
      try { visible = !!focused && weekDays.contains(focused) && focused.matches(":focus-visible"); } catch (error) { visible = false; }
      if (!visible) weekKeyed = false;
    }
    if (!weekPinned && !weekKeyed) weekHide();
  });
  // A tap (or a click) on a block keeps its card until the next tap elsewhere.
  weekDays.addEventListener("click", function (event) {
    var one = event.target.closest(".wk-day"); if (one) weekPick(one.dataset.day);
    var seg = event.target.closest(".wk-lane i");
    if (seg) { weekShow(seg); weekPinned = true; }
    else weekHide();
  });
  document.addEventListener("click", function (event) { if (weekPinned && !weekDays.contains(event.target)) weekHide(); });
  weekDays.addEventListener("focusin", function (event) {
    var one = event.target.closest(".wk-day"); if (!one) return;
    weekPick(one.dataset.day);
    var keyed = false;
    try { keyed = one.matches(":focus-visible"); } catch (error) { keyed = false; }
    if (!keyed) return;
    weekKeyed = true;
    var first = one.querySelector(".wk-lane i");
    if (first) weekShow(first); else weekHide();
  });
  weekDays.addEventListener("focusout", function (event) { if (!weekDays.contains(event.relatedTarget)) { weekKeyed = false; weekHide(); } });
  // On a focused day, up and down walk its blocks (the card follows), left and right step between days.
  weekDays.addEventListener("keydown", function (event) {
    var one = event.target.closest(".wk-day"); if (!one) return;
    if (event.key === "Escape") { weekKeyed = false; weekHide(); return; }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      var next = event.key === "ArrowLeft" ? one.previousElementSibling : one.nextElementSibling;
      if (next) { event.preventDefault(); next.focus(); }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    var blocks = [].slice.call(one.querySelectorAll(".wk-lane i"));
    if (!blocks.length) return;
    event.preventDefault();
    weekKeyed = true;
    var at = blocks.indexOf(weekLit);
    at = at < 0 ? 0 : Math.max(0, Math.min(blocks.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
    weekShow(blocks[at]);
  });
  // The card is fixed to the screen: a scroll (the page's own, or the phone's whole page) moves it with its block.
  function weekScrolled() { if (weekLit) weekPlace(weekLit); }
  weekPage.addEventListener("scroll", weekScrolled, { passive: true });
  window.addEventListener("scroll", weekScrolled, { passive: true });
  window.addEventListener("resize", function () { if (weekLit) weekPlace(weekLit); });
  function loadWeek() {
    if (!VIEW_TOKEN) return;
    if (Date.now() - weekAt < 5 * 60 * 1000) return;
    weekAt = Date.now();
    fetch(withToken("/api/week")).then(function (r) { if (!r.ok) throw new Error("week unavailable"); return r.json(); }).then(function (data) {
      week = data && data.week && data.week.days ? data.week : null;
      if (!week) weekAt = 0;
      drawWeek();
    }).catch(function () { weekAt = 0; if (!week) drawWeek(); });
  }
  setInterval(function () { if (centre === "week") loadWeek(); }, 60000);
`;

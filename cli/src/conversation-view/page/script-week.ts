/**
 * The Week tab: eight days side by side, midnight at the top, each day a strip
 * coloured hour by hour by the project that changed then (the week's three
 * busiest in their own inks, everything else one neutral). The day picked
 * (hovered or tapped; at first the latest day with work) is told underneath.
 * Data from /api/week (week.ts). Runs inside the page script's closure after
 * Today's script and borrows its helpers (frontEsc, withToken, centre).
 */
export const WEEK_SCRIPT = `
  // The week: eight days, hour by hour.
  var weekKey = document.getElementById("wk-key");
  var weekDays = document.getElementById("wk-days");
  var weekTell = document.getElementById("wk-tell");
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
        if (last && last.k === x[0] && Math.abs(last.b - at) < 1e-6) last.b = at + w;
        else out.push({ k: x[0], a: at, b: at + w });
        at += w;
      });
    }
    return out;
  }
  function weekClock(x) { var h = Math.floor(x), m = Math.round((x - h) * 60); if (m === 60) { h += 1; m = 0; } return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"); }
  function drawWeek() {
    if (!week) {
      weekKey.innerHTML = "";
      weekDays.innerHTML = "";
      weekTell.innerHTML = '<p class="wk-none">Nothing to show yet.</p>';
      weekShown = "";
      return;
    }
    weekKey.innerHTML = week.lead.map(function (name, at) { return '<span><i class="k' + (at + 1) + '"></i>' + frontEsc(name) + '</span>'; }).join("")
      + '<span><i class="k0"></i>Everything else</span>';
    var last = week.days.length - 1;
    var now = new Date();
    var nowAt = (now.getHours() + now.getMinutes() / 60) / 24 * 100;
    weekDays.innerHTML = week.days.map(function (day, di) {
      var d = weekDate(day.day);
      var segs = weekSegments(day).map(function (s) {
        return '<i class="' + weekInk(s.k) + '" title="' + frontEsc(s.k + ", " + weekClock(s.a) + " to " + weekClock(s.b)) + '" style="top:' + (s.a / 24 * 100).toFixed(2) + '%;height:' + ((s.b - s.a) / 24 * 100).toFixed(2) + '%;animation-delay:' + (di * 60 + s.a * 30).toFixed(0) + 'ms"></i>';
      }).join("");
      return '<button type="button" class="wk-day" data-day="' + frontEsc(day.day) + '" aria-pressed="false" aria-label="' + frontEsc(WEEK_LONG[d.getDay()] + " " + d.getDate() + ", " + day.changes + " changes") + '">'
        + '<u>' + WEEK_DAY[d.getDay()] + ' <b>' + d.getDate() + '</b></u>'
        + '<span class="wk-lane">' + segs + (di === last ? '<em style="top:' + nowAt.toFixed(2) + '%"></em>' : "") + '</span></button>';
    }).join("");
    weekShown = "";
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
    var d = weekDate(day.day);
    var when = WEEK_LONG[d.getDay()] + " " + d.getDate() + " " + WEEK_MONTH[d.getMonth()] + ", " + (day.changes ? day.changes + (day.changes === 1 ? " change" : " changes") : "no changes");
    weekTell.innerHTML = '<div><h3>' + frontEsc(day.head || "A quiet day") + '</h3><time>' + frontEsc(when) + '</time></div>'
      + day.lines.map(function (line) { return '<p>' + frontEsc(line) + '</p>'; }).join("");
  }
  weekDays.addEventListener("mouseover", function (event) { var one = event.target.closest(".wk-day"); if (one) weekPick(one.dataset.day); });
  weekDays.addEventListener("click", function (event) { var one = event.target.closest(".wk-day"); if (one) weekPick(one.dataset.day); });
  weekDays.addEventListener("focusin", function (event) { var one = event.target.closest(".wk-day"); if (one) weekPick(one.dataset.day); });
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

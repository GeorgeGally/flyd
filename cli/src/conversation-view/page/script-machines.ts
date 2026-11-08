/**
 * The Machines tab: each machine's load, memory, swap, disk and what is running,
 * or a plain offline row. The list is read only while the tab is on screen, soon
 * again while a machine is still being checked; applyScreen reads again on the way back from the artefact screen. Borrows VIEW_TOKEN, ago, frontEsc,
 * frontRoot and rtabs from the page's closure.
 */
export const MACHINES_SCRIPT = `
  var machinesList = document.getElementById("machines-list");
  var machineOpen = document.getElementById("machine-open");
  var machineForm = document.getElementById("machine-form");
  var machineError = document.getElementById("machine-error");
  var machinesDrawn = "";
  var machinesTimer = null;
  var MACHINES_EVERY = 30000;
  var MACHINES_SOON = 2000;
  var machinesPhone = window.matchMedia ? window.matchMedia("(max-width: 760px)") : null;
  function machinesOnScreen() {
    if (document.hidden || frontRoot.dataset.screen === "show") return false;
    return frontRoot.dataset.rtab === "machines" || !!(machinesPhone && machinesPhone.matches);
  }
  function machineNumber(value) { return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10); }
  function machineSize(usage) {
    var GB = 1073741824;
    var unit = usage.total >= 1024 * GB ? 1024 * GB : GB;
    return machineNumber(usage.used / unit) + " of " + machineNumber(usage.total / unit) + (unit === GB ? " GB" : " TB");
  }
  function machineStat(label, value, share) {
    var percent = Math.round(Math.min(1, Math.max(0, share)) * 100);
    return '<dt>' + label + '</dt><dd class="machine-bar" aria-hidden="true"><i style="width:' + percent + '%"></i></dd>'
      + '<dd class="machine-value">' + frontEsc(value) + '</dd>';
  }
  function machineUsage(label, usage) { return usage && usage.total ? machineStat(label, machineSize(usage), usage.used / usage.total) : ""; }
  function machineStats(reading) {
    var load = reading.load;
    var html = load ? machineStat("Load", machineNumber(load[0]) + (reading.cores ? " on " + reading.cores + " cores" : ""), reading.cores ? load[0] / reading.cores : 0) : "";
    html += machineUsage("Memory", reading.memory);
    html += reading.swap && !reading.swap.total ? machineStat("Swap", "None", 0) : machineUsage("Swap", reading.swap);
    html += machineUsage("Disk", reading.disk);
    var running = (reading.running || []).map(function (process) {
      var cpu = Math.round(process.cpu);
      return process.name + (cpu ? " " + cpu + "%" : "");
    }).join(", ");
    if (running) html += '<dt>Running</dt><dd class="machine-running">' + frontEsc(running) + '</dd>';
    return '<dl class="machine-stats">' + html + '</dl>';
  }
  function machineRow(machine) {
    var offline = machine.state === "offline";
    var body = offline
      ? '<p class="machine-why">' + frontEsc(machine.reason) + '</p>' + (machine.seenAt ? '<p class="machine-seen">Last seen ' + frontEsc(ago(machine.seenAt)) + '</p>' : "")
      : machine.reading ? machineStats(machine.reading) : "";
    return '<article class="machine ' + frontEsc(machine.state) + '"><div class="machine-top"><h2 class="machine-name">' + frontEsc(machine.name) + '</h2>'
      + '<span class="machine-state">' + (offline ? "Offline" : machine.reading ? "Online" : "Checking") + '</span></div>' + body
      + '</article>';
  }
  function machineWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 86400000);
    var day = days === 0 ? "today" : days === 1 ? "tomorrow" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    return day + " at " + clock(iso);
  }
  function machineSetup(setup) {
    if (!setup) return "";
    var html = "";
    if ((setup.models && setup.models.length) || setup.spend) {
      html += '<section aria-label="Models"><h2>Models</h2>' + (setup.models && setup.models.length ? '<dl class="setup-models">' + setup.models.map(function (one) {
        return '<dt>' + frontEsc(one.role) + '</dt><dd>' + frontEsc(one.model) + '</dd>';
      }).join("") + '</dl>' : "")
        + (setup.spend ? '<p class="setup-spend">Claude this month: $' + frontEsc(setup.spend.usd.toFixed(2)) + ' of $' + frontEsc(String(setup.spend.cap)) + ', ' + frontEsc(String(setup.spend.calls)) + ' calls' + (setup.spend.capped ? '. Cap reached, so Flyd is on its fallbacks until the 1st.' : '.') + '</p>' : "")
        + '</section>';
    }
    if (setup.usage && setup.usage.length) {
      html += '<section aria-label="Usage left"><h2>Usage left</h2><ul class="setup-usage">' + setup.usage.map(function (one) {
        var used = one.left <= 0;
        var when = one.runsOutAt ? '<span class="u-when out">Runs out ' + frontEsc(machineWhen(one.runsOutAt)) + '</span>'
          : one.resetsAt ? '<span class="u-when">' + (used ? "Back " : "Resets ") + frontEsc(machineWhen(one.resetsAt)) + '</span>' : "";
        return '<li><div class="u-top">' + frontEsc(one.provider) + '<span' + (used ? ' class="out"' : "") + '>' + (used ? "Used up" : one.left + "% left") + '</span></div>'
          + '<div class="u-bar" aria-hidden="true"><i style="width:' + Math.max(0, Math.min(100, one.left)) + '%"></i></div>' + when + '</li>';
      }).join("") + '</ul></section>';
    }
    return html ? '<div class="machine-setup">' + html + '</div>' : "";
  }
  function drawMachines(view) {
    var machines = view.machines || [];
    var html = (machines.length ? '<div class="fstrip machine-list">' + machines.map(machineRow).join("") + '</div>' : '<p class="fempty">No machines yet.</p>')
      + machineSetup(view.setup);
    machineOpen.hidden = !VIEW_TOKEN || !machineForm.hidden;
    if (html !== machinesDrawn) {
      machinesDrawn = html;
      machinesList.innerHTML = html;
    }
    return machines.some(function (machine) { return machine.state === "checking"; });
  }
  function machinesAgain(soon) {
    clearTimeout(machinesTimer);
    machinesTimer = machinesOnScreen() ? setTimeout(loadMachines, soon ? MACHINES_SOON : MACHINES_EVERY) : null;
  }
  function loadMachines() {
    if (!machinesOnScreen()) { machinesAgain(false); return; }
    fetch(withToken("/api/machines")).then(function (r) { return r.json(); }).then(drawMachines).then(machinesAgain).catch(function () { machinesAgain(false); });
  }
  function machineAdd(name, alias) {
    return fetch("/api/machines", { method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": VIEW_TOKEN }, body: JSON.stringify({ name: name, alias: alias }) })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); });
  }
  function machineFormShown(shown) {
    machineForm.hidden = !shown;
    machineOpen.hidden = shown || !VIEW_TOKEN;
    machineError.textContent = "";
    if (shown) machineForm.elements.name.focus();
    else machineForm.reset();
  }
  machineOpen.addEventListener("click", function () { machineFormShown(true); });
  document.getElementById("machine-cancel").addEventListener("click", function () { machineFormShown(false); machineOpen.focus(); });
  machineForm.addEventListener("submit", function (event) {
    event.preventDefault();
    machineAdd(machineForm.elements.name.value, machineForm.elements.alias.value).then(function (result) {
      if (!result.ok) { machineError.textContent = result.data.error || "That did not save."; return; }
      machineFormShown(false);
      machinesAgain(drawMachines(result.data));
    }).catch(function () { machineError.textContent = "That did not save."; });
  });
  rtabs.addEventListener("click", loadMachines);
  document.addEventListener("visibilitychange", loadMachines);
  if (machinesPhone && machinesPhone.addEventListener) machinesPhone.addEventListener("change", loadMachines);
  loadMachines();
`;

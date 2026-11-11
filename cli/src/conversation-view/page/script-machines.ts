/**
 * The Machines screen, the header tab after Today, News and Week: one row per
 * machine, its name as a headline over Core's one sentence about what matters
 * there and at most one button; and, in the right column, the tool versions in
 * one sentence with one button, which model does which job in one sentence,
 * Claude's spend and the usage left.
 * A button asks Flyd in the conversation, in Core's words. One that would change
 * something asks him first, in place. The list is read only while the screen is
 * up, soon again while a machine is still being checked; applyScreen reads
 * again on the way back from the artefact screen. Borrows VIEW_TOKEN, ago,
 * clock, frontEsc, frontRoot, current, deliver, noteRefusal, centre and
 * setCentre from the page's closure.
 */
export const MACHINES_SCRIPT = `
  var machinesList = document.getElementById("machines-list");
  var machinesSetupEl = document.getElementById("machines-setup");
  var machinesTools = document.getElementById("machines-tools");
  var machinesSide = document.getElementById("machines-side");
  var machineOpen = document.getElementById("machine-open");
  var machineForm = document.getElementById("machine-form");
  var machineError = document.getElementById("machine-error");
  var machinesDrawn = { list: "", setup: "", tools: "" };
  var machinesSetup = null;
  var machinesToolsWords = null;
  var machinesTimer = null;
  var machineAsking = "";
  var machineActions = {};
  var MACHINES_EVERY = 30000;
  var MACHINES_SOON = 2000;
  function machinesOnScreen() {
    if (document.hidden || frontRoot.dataset.screen === "show" || frontRoot.getAttribute("data-job")) return false;
    return centre === "machines";
  }
  // One button, or, once pressed on an action that changes something, the question and its two answers.
  function machineButton(key, action) {
    if (!action) return "";
    machineActions[key] = action;
    if (machineAsking === key && action.confirm) {
      return '<div class="mach-confirm" role="group" aria-label="' + frontEsc(action.label) + '"><p>' + frontEsc(action.confirm) + '</p>'
        + '<div class="mach-acts"><button type="button" class="mach-btn" data-mach-yes="' + frontEsc(key) + '">Yes, go ahead</button>'
        + '<button type="button" class="mach-btn quiet" data-mach-no="' + frontEsc(key) + '">Not now</button></div></div>';
    }
    return '<button type="button" class="mach-btn" data-mach-act="' + frontEsc(key) + '">' + frontEsc(action.label) + '</button>';
  }
  function machineRow(machine) {
    return '<article class="machine ' + frontEsc(machine.state) + '"><h2 class="machine-name">' + frontEsc(machine.name) + '</h2>'
      + '<div class="machine-body"><p class="machine-say">' + frontEsc(machine.say || "") + '</p>'
      + (machine.state === "offline" && machine.seenAt ? '<p class="machine-seen">Last seen ' + frontEsc(ago(machine.seenAt)) + '</p>' : "")
      + machineButton("m:" + machine.id, machine.action) + '</div></article>';
  }
  function machineWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 86400000);
    var day = days === 0 ? "today" : days === 1 ? "tomorrow" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    return day + " at " + clock(iso);
  }
  // "Chat runs on A, quick jobs on B, and LIVE voice on C."; "Coding crews run on A". A role in capitals keeps them.
  function machineModels(models) {
    var parts = models.map(function (one, i) {
      var role = i === 0 || /^.[A-Z]/.test(one.role) ? one.role : one.role.charAt(0).toLowerCase() + one.role.slice(1);
      return role + (i > 0 ? " on " : /s$/.test(one.role) ? " run on " : " runs on ") + one.model;
    });
    if (parts.length < 2) return parts.join("") + ".";
    var last = parts.pop();
    return parts.join(", ") + (parts.length > 1 ? ", and " : " and ") + last + ".";
  }
  function machineSetup(setup) {
    if (!setup) return "";
    var html = "";
    if (setup.models && setup.models.length) html += '<p class="mach-models">' + frontEsc(machineModels(setup.models)) + '</p>';
    if (setup.spend) {
      var cap = "$" + setup.spend.cap.toLocaleString("en");
      html += '<p class="setup-spend">' + (setup.spend.capped
        ? "Claude has reached your " + frontEsc(cap) + " this month, so Flyd is on its fallbacks until the 1st."
        : "Claude has cost $" + frontEsc(setup.spend.usd.toFixed(2)) + " of your " + frontEsc(cap) + " this month, across " + frontEsc(setup.spend.calls.toLocaleString("en")) + " calls.") + '</p>';
    }
    if (setup.usage && setup.usage.length) {
      var readAgo = setup.usageAt && ago(setup.usageAt);
      html += '<section aria-label="Usage left"><ul class="setup-usage">' + setup.usage.map(function (one) {
        var used = one.left <= 0;
        var when = one.runsOutAt ? '<span class="u-when out">Runs out ' + frontEsc(machineWhen(one.runsOutAt)) + '</span>'
          : one.resetsAt ? '<span class="u-when">' + (used ? "Back " : "Resets ") + frontEsc(machineWhen(one.resetsAt)) + '</span>' : "";
        return '<li><div class="u-top">' + frontEsc(one.provider) + '<span' + (used ? ' class="out"' : "") + '>' + (used ? "Used up" : one.left + "% left") + '</span></div>'
          + '<div class="u-bar" aria-hidden="true"><i style="width:' + Math.max(0, Math.min(100, one.left)) + '%"></i></div>' + when + '</li>';
      }).join("") + '</ul><p class="setup-usage-read">' + (readAgo ? "Usage read " + frontEsc(readAgo) : "Read time unavailable") + '</p></section>';
    }
    return html ? '<div class="machine-setup">' + html + '</div>' : "";
  }
  function machineToolsHtml(tools) {
    return tools ? '<p class="mach-tools-say">' + frontEsc(tools.say) + '</p>' + machineButton("tools", tools.action) : "";
  }
  function drawMachines(view) {
    var machines = view.machines || [];
    machineActions = {};
    var list = machines.length ? '<div class="machine-list">' + machines.map(machineRow).join("") + '</div>' : '<p class="fempty">No machines yet.</p>';
    var setup = machineSetup(view.setup);
    var tools = machineToolsHtml(view.tools);
    machineOpen.hidden = !VIEW_TOKEN || !machineForm.hidden;
    if (list !== machinesDrawn.list) { machinesDrawn.list = list; machinesList.innerHTML = list; }
    if (setup !== machinesDrawn.setup) { machinesDrawn.setup = setup; machinesSetupEl.innerHTML = setup; }
    if (tools !== machinesDrawn.tools) { machinesDrawn.tools = tools; machinesTools.innerHTML = tools; }
    machinesSide.hidden = !tools && !setup;
    return machines.some(function (machine) { return machine.state === "checking"; });
  }
  var machinesView = { machines: [] };
  function machinesRedraw() { drawMachines(machinesView); }
  function machinesAgain(soon) {
    clearTimeout(machinesTimer);
    machinesTimer = machinesOnScreen() ? setTimeout(loadMachines, soon ? MACHINES_SOON : MACHINES_EVERY) : null;
  }
  // One read at a time: the tab and the screen change can both ask at once.
  var machinesLoading = false;
  function loadMachines() {
    if (!machinesOnScreen()) { machinesAgain(false); return; }
    if (!VIEW_TOKEN || machinesLoading) return;
    machinesLoading = true;
    fetch(withToken("/api/machines")).then(function (r) { if (!r.ok) throw new Error("machines unavailable"); return r.json(); })
      .then(function (view) { machinesLoading = false; machinesView = view; machinesSetup = view.setup; machinesToolsWords = view.tools; return drawMachines(view); })
      .then(machinesAgain).catch(function () { machinesLoading = false; machinesAgain(false); });
  }
  // A button sends its own words to Flyd in the conversation; the message box is left as it is.
  function machineAsk(text) {
    machineAsking = "";
    setCentre("talk", true);
    var tries = 0;
    (function sendWhenReady() {
      if (current) {
        deliver(JSON.stringify({ session: current, text: text, images: [], files: [] })).then(function (sent) {
          if (sent.unsure) noteRefusal("Flyd may not have got that. Check the conversation before asking again.");
        }, function () { noteRefusal("Flyd could not ask that. Try the button again in a moment."); });
        return;
      }
      if (tries++ < 100) setTimeout(sendWhenReady, 200);
      else noteRefusal("Flyd could not ask that: the conversation is not open yet. Try the button again in a moment.");
    })();
  }
  document.getElementById("machines").addEventListener("click", function (event) {
    var act = event.target.closest("[data-mach-act]");
    var yes = event.target.closest("[data-mach-yes]");
    var no = event.target.closest("[data-mach-no]");
    if (act) {
      var action = machineActions[act.dataset.machAct];
      if (!action) return;
      if (!action.confirm) { machineAsk(action.ask); return; }
      machineAsking = act.dataset.machAct;
      machinesRedraw();
      var first = document.querySelector("[data-mach-yes]");
      if (first) first.focus();
    } else if (yes) {
      var sure = machineActions[yes.dataset.machYes];
      if (sure) machineAsk(sure.ask);
    } else if (no) {
      var back = no.dataset.machNo;
      machineAsking = "";
      machinesRedraw();
      var again = document.querySelector('[data-mach-act="' + back.replace(/["\\\\]/g, "") + '"]');
      if (again) again.focus();
    }
  });
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
      machinesView = { machines: result.data.machines, setup: machinesSetup, tools: machinesToolsWords };
      machinesAgain(drawMachines(machinesView));
    }).catch(function () { machineError.textContent = "That did not save."; });
  });
  document.addEventListener("visibilitychange", loadMachines);
  loadMachines();
`;

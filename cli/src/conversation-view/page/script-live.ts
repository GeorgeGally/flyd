/**
 * The notch on the front page: the island always says what is running and what
 * needs him, and opens one black sheet over whatever he is in. Everything it
 * says comes from update.live (live-activity.ts). An open call answers where it
 * stands through sceneAsk, the page's one way to answer; anything else opens as
 * a job in the middle. Runs inside the page script's closure, beside the front
 * script, and borrows its helpers (el, frontEsc, frontHeading, frontWhen,
 * frontProject, frontShots, frontSelect, withToken, sceneAsk).
 */
export const LIVE_SCRIPT = `
  // The notch: an island that counts, and the sheet it opens.
  var islandEl = document.getElementById("island");
  var notchEl = document.getElementById("notch");
  var notchSheet = document.getElementById("notch-sheet");
  var notch = { live: null, picked: "", olderOpen: false, drawn: "", ask: null };

  function liveCount(number, one, none) { return number ? number + " " + one : none; }
  function liveIslandHtml(live) {
    if (!live.known) return '<span class="l">Not read yet</span>';
    var dot = live.counts.running ? '<span class="idot" aria-hidden="true"></span>' : "";
    return '<span class="l">' + dot + liveCount(live.counts.running, "running", "Nothing running") + '</span><span class="gap" aria-hidden="true"></span>'
      + '<span class="r' + (live.counts.needs ? " on" : "") + '">' + liveCount(live.counts.needs, "need you", "Nothing needs you") + '</span>';
  }
  function liveElapsed(iso) {
    var ms = frontAge(iso);
    if (!isFinite(ms) || ms < 0) return "";
    var mins = Math.floor(ms / 60000);
    if (mins < 60) return Math.max(1, mins) + " min";
    var hours = Math.floor(mins / 60);
    return hours < 48 ? hours + " hr" : Math.floor(hours / 24) + " days";
  }
  // The source may already be cut: one ellipsis, however many cuts it has been through.
  function liveName(item) { return frontHeading(item.title, frontProject(item.project)).replace(/(?:…|\\.{2,})+$/, "…"); }
  function livePicture(item) {
    var preview = item.previews && item.previews[0];
    var src = preview ? preview.image : item.shots[0] && item.shots[0].src;
    return src ? '<span class="pic"><img src="' + frontEsc(withToken(src)) + '" alt="" loading="lazy"></span>' : "";
  }
  // Every row in the sheet can open as a job in the middle: its pictures, its words, a box to answer.
  function liveJob(item) {
    return {
      id: "notch:" + item.id, group: "notch", state: item.state === "running" ? "Working" : item.state === "paused" ? "Paused" : item.state === "landed" ? "Landed" : item.status || "Needs you",
      title: liveName(item), project: frontProject(item.project), at: item.at || item.since || "", next: "", owner: "", ask: "", because: "", digest: null,
      shots: frontShots(item.shots), previews: frontPreviews(item.previews), links: item.links || [], files: [], threads: [],
      detail: frontText(item.step), decision: item.decision || null, task: item.task || "",
    };
  }
  function liveEvery(live) { return live.needs.concat(live.older, live.running, live.paused, live.landed); }
  function liveJobs(live) { return liveEvery(live).map(liveJob); }

  function liveOpenItem(live) {
    var all = live.needs.concat(live.older);
    return all.filter(function (item) { return item.id === notch.picked; })[0] || all.filter(function (item) { return item.state === "call"; })[0] || all[0] || null;
  }
  function liveQueueRow(item, open) {
    var when = frontWhen(item.at);
    var word = item.state === "ready" ? '<em>' + frontEsc(item.status) + '</em> ' : "";
    var where = frontProject(item.project);
    return '<li><button type="button" class="q-row' + (open ? " on" : "") + '" data-pick="' + frontEsc(item.id) + '"' + (open ? ' aria-current="true"' : "") + '>'
      + '<b>' + frontEsc(liveName(item)) + (where ? ' <span>· ' + frontEsc(where) + '</span>' : "") + '</b><i>' + word + frontEsc(when) + '</i></button></li>';
  }
  function liveQueue(live, open) {
    var rest = function (item) { return !open || item.id !== open.id; };
    var recent = live.needs.filter(rest);
    var older = live.older.filter(rest);
    var html = recent.length ? '<ol class="queue">' + recent.map(function (item) { return liveQueueRow(item, false); }).join("") + '</ol>' : "";
    if (older.length) {
      var last = older[older.length - 1];
      html += '<button type="button" class="older" data-older aria-expanded="' + notch.olderOpen + '">'
        + (notch.olderOpen ? "Fewer" : older.length + " older" + (last.at ? ", back to " + frontEsc(frontDay(last.at).toLocaleDateString([], { day: "numeric", month: "long" })) : "") + " ›") + '</button>';
      if (notch.olderOpen) html += '<ol class="queue">' + older.map(function (item) { return liveQueueRow(item, false); }).join("") + '</ol>';
    }
    return html ? '<h3 class="ph">Also waiting on you</h3>' + html : "";
  }
  function liveRunRow(item) {
    var when = item.state === "paused" ? "Paused" : liveElapsed(item.since);
    var step = frontNext({ detail: item.step });
    return '<li><button type="button" class="run-row' + (livePicture(item) ? "" : " bare") + '" data-open="' + frontEsc(item.id) + '">' + livePicture(item)
      + '<span class="words"><span class="n"><b>' + frontEsc(liveName(item)) + '</b><span>' + frontEsc(when) + '</span></span>'
      + (step ? '<span class="s" data-step="' + frontEsc(item.id) + '">' + frontEsc(step) + '</span>' : "") + '</span></button></li>';
  }
  function liveLandedHead(live) {
    var today = live.landed.every(function (item) { return frontWhen(item.at).indexOf(":") > 0 || frontWhen(item.at) === "Today"; });
    return today ? "Landed today" : "Landed lately";
  }
  function liveLandedTile(item) {
    return '<button type="button" class="tile" data-open="' + frontEsc(item.id) + '">' + livePicture(item)
      + '<span class="t">' + frontEsc(liveName(item)) + '</span><span class="w">' + frontEsc(frontWhen(item.at)) + '</span></button>';
  }
  function liveSheetHtml(live, open) {
    var call = open ? '<div class="callblock" data-call="' + frontEsc(open.id) + '">' + livePicture(open) + '<p class="q">' + frontEsc(liveName(open)) + '</p>'
      + '<p class="qm">' + frontEsc(liveCallLine(open)) + '</p><div class="keys" id="notch-keys"></div></div>'
      : '<div class="callblock quiet"><p class="q">' + (live.known ? "Nothing needs you." : "Not read yet.") + '</p></div>';
    var running = live.running.concat(live.paused);
    var run = running.length ? '<h3 class="ph">Running</h3><ol class="run">' + running.map(liveRunRow).join("") + '</ol>'
      : '<p class="none">' + (live.known ? "Nothing is running right now." : "") + '</p>';
    var landed = live.landed.length ? '<h3>' + liveLandedHead(live) + '</h3><div class="done">' + live.landed.map(liveLandedTile).join("") + '</div>' : "";
    return '<button type="button" class="sheet-island" id="notch-close-island" aria-label="Close">' + liveIslandHtml(live) + '</button>'
      + '<button type="button" class="sheet-x" id="notch-close" aria-label="Close">✕</button>'
      + '<div class="cols"><div class="a">' + call + '<div class="qblock">' + liveQueue(live, open) + '</div></div>'
      + '<div class="b"><div class="runblock">' + run + '</div><div class="landblock">' + landed + '</div></div></div>';
  }
  // Under the question: what it is about, and how long it has waited. Never the question again.
  function liveCallLine(item) {
    var tail = frontTail(item.step, item.title);
    var line = tail === frontText(item.title) ? "" : tail;
    var when = frontWhen(item.at);
    var asked = item.state === "ready" ? item.status : when ? "Asked " + when : "";
    if (line.length > 180) line = line.slice(0, 178).replace(/\\s+\\S*$/, "") + "…";
    return [line, asked].filter(Boolean).join(line && !/[.!?…]$/.test(line) ? ". " : " ");
  }
  function liveKeys(open) {
    var keys = document.getElementById("notch-keys");
    if (!keys) return;
    var signature = JSON.stringify([open.id, open.decision, open.links, open.title]);
    if (notch.ask && notch.ask.signature === signature) { if (notch.ask.node.parentNode !== keys) keys.appendChild(notch.ask.node); return; }
    var oldInput = notch.ask && notch.ask.id === open.id && notch.ask.node.querySelector(".art-chat-input");
    var draft = oldInput ? oldInput.value : "";
    var hadFocus = oldInput && document.activeElement === oldInput;
    var start = hadFocus ? oldInput.selectionStart : null;
    var end = hadFocus ? oldInput.selectionEnd : null;
    var parts = el("div", "acts");
    var links = (open.links || []).filter(function (link) { return link && link.url; }).slice(0, 2);
    links.forEach(function (link) {
      var a = el("a", "k", link.label || "Open");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      parts.appendChild(a);
    });
    var more = el("button", "k", "Open it");
    more.type = "button";
    more.dataset.open = open.id;
    parts.appendChild(more);
    var box = el("div", "ask");
    if (open.decision && VIEW_TOKEN) box.appendChild(sceneAsk({ title: liveName(open), decision: open.decision }, "flyd-decision:" + (open.decision.decisionId || open.decision.task)));
    box.appendChild(parts);
    notch.ask = { id: open.id, signature: signature, node: box };
    keys.replaceChildren(box);
    var input = box.querySelector(".art-chat-input");
    if (input && draft) { input.value = draft; input.dispatchEvent(new Event("input", { bubbles: true })); }
    if (input && hadFocus) { input.focus(); if (start !== null && end !== null) input.setSelectionRange(start, end); }
  }
  function liveDraw(live) {
    notch.live = live;
    var island = liveIslandHtml(live);
    if (islandEl.innerHTML !== island) islandEl.innerHTML = island;
    islandEl.hidden = false;
    islandEl.setAttribute("aria-label", islandEl.textContent + ". Open the sheet");
    if (notchEl.open) liveDrawSheet(live);
  }
  // A refresh never takes the box from under his hands; his own click always moves the sheet.
  function liveDrawSheet(live, moved) {
    var open = liveOpenItem(live);
    var html = liveSheetHtml(live, open);
    var signature = open ? JSON.stringify([open.id, open.decision, open.links, open.title]) : "";
    if (html === notch.drawn && (!open || (notch.ask && notch.ask.signature === signature))) return;
    var focused = document.activeElement && notchSheet.contains(document.activeElement)
      ? document.activeElement.dataset.pick || document.activeElement.dataset.open || document.activeElement.id : "";
    var scroll = notchEl.scrollTop;
    var template = document.createElement("div");
    template.innerHTML = html;
    var oldCall = notchSheet.querySelector(".callblock");
    var newCall = template.querySelector(".callblock");
    var keepCall = oldCall && newCall && open && oldCall.dataset.call === open.id;
    if (keepCall) {
      [".pic", ".q", ".qm"].forEach(function (selector) {
        var before = oldCall.querySelector(selector), after = newCall.querySelector(selector);
        if (before && after) { if (before.outerHTML !== after.outerHTML) before.replaceWith(after); }
        else if (before) before.remove();
        else if (after) oldCall.insertBefore(after, oldCall.firstChild);
      });
      [".sheet-island", ".qblock", ".runblock", ".landblock"].forEach(function (selector) {
        var before = notchSheet.querySelector(selector), after = template.querySelector(selector);
        if (before && after && before.innerHTML !== after.innerHTML) before.innerHTML = after.innerHTML;
      });
    } else {
      notchSheet.innerHTML = html;
    }
    notch.drawn = html;
    notchEl.scrollTop = scroll;
    if (open) liveKeys(open);
    if (focused && !(document.activeElement && document.activeElement.closest("#notch-keys"))) {
      var again = notchSheet.querySelector('[data-pick="' + CSS.escape(focused) + '"], [data-open="' + CSS.escape(focused) + '"], #' + CSS.escape(focused));
      if (again) again.focus();
    }
  }

  function liveShow() {
    if (!notch.live || notchEl.open) return;
    notch.drawn = "";
    liveDrawSheet(notch.live);
    if (notchEl.showModal) notchEl.showModal(); else notchEl.setAttribute("open", "");
    islandEl.setAttribute("aria-expanded", "true");
    notchSheet.focus();
    notchEl.scrollTop = 0;
  }
  function liveHide() {
    if (notchEl.close) notchEl.close(); else notchEl.removeAttribute("open");
  }
  islandEl.addEventListener("click", liveShow);
  notchEl.addEventListener("close", function () {
    notchEl.removeAttribute("open");
    islandEl.setAttribute("aria-expanded", "false");
    islandEl.focus();
  });
  notchEl.addEventListener("click", function (event) {
    if (event.target === notchEl) { liveHide(); return; }
    if (event.target.closest("#notch-close, #notch-close-island")) { liveHide(); return; }
    if (event.target.closest("[data-older]")) { notch.olderOpen = !notch.olderOpen; liveDrawSheet(notch.live, true); return; }
    var pick = event.target.closest("[data-pick]");
    if (pick) { notch.picked = pick.dataset.pick; liveDrawSheet(notch.live, true); notchEl.scrollTop = 0; return; }
    var open = event.target.closest("[data-open]");
    if (open) {
      var id = "notch:" + open.dataset.open;
      liveHide();
      frontSelect(id);
    }
  });
`;

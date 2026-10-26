// Draws the page around the column (header, conversation) and wires the column's tabs.
(function () {
  var D = window.FLYD;
  var top = document.createElement("header");
  top.className = "top";
  top.innerHTML = '<b>Flyd</b><span class="date">' + D.date + '</span><span class="links"><span>people</span><span>preferences</span></span>';
  var mid = document.createElement("main");
  mid.className = "mid";
  mid.innerHTML = '<h1>New conversation</h1>' +
    '<section class="call"><p class="k">Your call</p><h2>Link WhatsApp so Flyd can message people for you</h2><p>In WhatsApp: Linked devices, then Link a device, then scan the code.</p></section>' +
    '<div class="box"><span>Message Flyd</span><button>Send</button></div>';
  document.body.prepend(mid);
  // On a phone the column is the page; the message box stays at the bottom, one tap from the conversation.
  var pbox = document.createElement("div");
  pbox.className = "pbox";
  pbox.innerHTML = '<span>Message Flyd</span><button>Send</button>';
  document.body.append(pbox);
  document.body.prepend(top);
  window.esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  // Tabs: any [data-tab] button shows the [data-pane] of the same name.
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-tab]");
    if (!b) return;
    var name = b.getAttribute("data-tab");
    document.querySelectorAll("[data-tab]").forEach(function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-tab") === name)); });
    document.querySelectorAll("[data-pane]").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== name; if (!p.hidden) p.classList.add("fade"); });
  });
})();

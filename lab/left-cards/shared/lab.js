// One behaviour for all ten designs. A design sets window.design with
// column(data, state, lab) and, when its details open beside the column,
// pane(data, state, lab); both return HTML. Anything with data-open="<id>"
// opens that card (again closes it), data-close closes it, data-more shows the
// rest, and a form with data-talk="<id>" and an input named "m" talks to the
// card: the message stays in its history and Flyd answers under it.
(function () {
  var D = window.FLYD;
  var S = { open: D.defaultOpen, more: false, typing: null, threads: {} };
  [D.now].concat(D.items).forEach(function (item) { S.threads[item.id] = (item.thread || []).slice(); });

  var FEW = (window.design && window.design.few) || 5;
  var lab = {
    esc: function (text) {
      return String(text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
    },
    item: function (id) { return id === "now" ? D.now : D.items.filter(function (i) { return i.id === id; })[0]; },
    earlier: function () { return S.more ? D.items : D.items.slice(0, FEW); },
    hiddenCount: function () { return D.items.length - FEW; },
    moreLabel: function () { return S.more ? "Show fewer" : "Show " + (D.items.length - FEW) + " more"; },
    isOpen: function (id) { return S.open === id; },
    thread: function (id) { return S.threads[id] || []; },
    typing: function (id) { return S.typing === id; },
    weekMax: function () { return Math.max.apply(null, D.week.map(function (d) { return d.count; })); },
    // The talk field. Designs restyle it through their own class names.
    talk: function (id, opts) {
      opts = opts || {};
      return '<form class="' + (opts.cls || "talk") + '" data-talk="' + id + '" autocomplete="off">' +
        '<input name="m" placeholder="' + lab.esc(opts.placeholder || "Talk about this…") + '" aria-label="Talk about this card">' +
        (opts.button === false ? "" : '<button type="submit">' + (opts.button || "Send") + "</button>") + "</form>";
    },
  };
  window.lab = lab;

  var column = document.querySelector("[data-column]");
  var pane = document.querySelector("[data-pane]");
  // The conversation beside the column: the same few real lines in every design.
  var chat = document.querySelector("[data-chat]");
  if (chat) {
    chat.innerHTML =
      '<p class="me">these still no clickable</p>' +
      '<p class="flyd">Those cards aren\'t clickable yet because the fix isn\'t live.<small>It\'s built and tested: every left card opens its details.</small></p>' +
      '<p class="me">why can\'t i see news?</p>' +
      '<p class="flyd">Today\'s news card only shows a count, two stories.<small>The stories themselves aren\'t shown anywhere you can open.</small></p>' +
      '<p class="box">Message Flyd</p>';
  }

  function draw(focusId) {
    column.innerHTML = window.design.column(D, S, lab);
    if (pane && window.design.pane) pane.innerHTML = window.design.pane(D, S, lab);
    document.documentElement.setAttribute("data-opened", S.open || "");
    if (focusId) {
      var input = document.querySelector('[data-talk="' + focusId + '"] input');
      if (input) input.focus();
    }
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (target.closest("form")) return;
    if (target.closest("[data-close]")) { S.open = null; draw(); return; }
    if (target.closest("[data-more]")) { S.more = !S.more; draw(); return; }
    var card = target.closest("[data-open]");
    if (!card) return;
    // Clicks inside an open card's details stay there; a card inside the details still opens.
    var stay = target.closest("[data-stay]");
    if (stay && card.contains(stay)) return;
    var id = card.getAttribute("data-open");
    S.open = S.open === id ? null : id;
    draw();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && S.open) { S.open = null; draw(); return; }
    var card = event.target.closest && event.target.closest("[data-open]");
    if (card && (event.key === "Enter" || event.key === " ") && event.target === card) {
      event.preventDefault();
      card.click();
    }
  });

  document.addEventListener("submit", function (event) {
    var form = event.target.closest("[data-talk]");
    if (!form) return;
    event.preventDefault();
    var input = form.querySelector('[name="m"]');
    var text = input.value.trim();
    if (!text) return;
    var id = form.getAttribute("data-talk");
    var item = lab.item(id);
    function asked(thread) { return thread.filter(function (m) { return m.who === "george"; }).length; }
    var first = asked(S.threads[id]) === asked(item.thread || []);
    S.threads[id].push({ who: "george", text: text });
    S.typing = id;
    draw(id);
    setTimeout(function () {
      S.typing = null;
      S.threads[id].push({ who: "flyd", text: first ? item.answer : "Noted. I'll come back to you here." });
      draw(id);
    }, 900);
  });

  draw();
})();

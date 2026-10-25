import { PASSAGE_CHARS } from "../replies.js";

/** Replying in place: reply boxes, slash commands, passage comments, choices and steppers. */
export const REPLIES_SCRIPT = `
  // His reply to one answer, in a box under it. The box is drawn from its
  // state alone, so a redraw of the column leaves an open box, and what he
  // is typing in it, where they are.
  var replies = new Map();
  function replyState(key) {
    if (!replies.has(key)) replies.set(key, { open: false, note: "", draft: "", sending: false });
    return replies.get(key);
  }
  var commandList = null;
  function loadCommands() {
    if (commandList) return Promise.resolve(commandList);
    return fetch("/api/commands").then(function (r) { return r.json(); }).then(function (data) {
      commandList = data.commands || [];
      return commandList;
    }).catch(function () { return []; });
  }
  function commandMenu(input, menu, chosen) {
    var matches = [];
    var index = 0;
    var revision = 0;
    function close() {
      revision += 1;
      menu.hidden = true;
      matches = [];
    }
    function render() {
      menu.textContent = "";
      if (!matches.length) {
        var none = document.createElement("li");
        none.className = "none";
        none.textContent = "No skill or command matches " + input.value;
        menu.appendChild(none);
        return;
      }
      matches.forEach(function (command, at) {
        var item = document.createElement("li");
        item.setAttribute("role", "option");
        item.className = at === index ? "selected" : "";
        var name = document.createElement("span");
        name.className = "name";
        name.textContent = "/" + command.name;
        var about = document.createElement("span");
        about.className = "about";
        about.textContent = command.description;
        item.appendChild(name);
        item.appendChild(about);
        item.addEventListener("mousedown", function (event) { event.preventDefault(); choose(at); });
        menu.appendChild(item);
      });
      var selected = menu.children[index];
      if (selected && selected.scrollIntoView) selected.scrollIntoView({ block: "nearest" });
    }
    function update() {
      var typed = /^\\/([\\w:.-]*)$/.exec(input.value);
      if (!typed) { close(); return; }
      var request = ++revision;
      var query = typed[1].toLowerCase();
      loadCommands().then(function (list) {
        if (request !== revision || !input.isConnected) return;
        if (!/^\\/([\\w:.-]*)$/.test(input.value)) return;
        var starts = list.filter(function (c) { return c.name.toLowerCase().indexOf(query) === 0; });
        var contains = list.filter(function (c) { return c.name.toLowerCase().indexOf(query) > 0; });
        matches = starts.concat(contains).slice(0, 50);
        index = 0;
        menu.hidden = false;
        render();
      });
    }
    function choose(at) {
      var command = matches[at];
      if (!command) return;
      input.value = "/" + command.name + " ";
      close();
      if (chosen) chosen();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    input.addEventListener("input", update);
    input.addEventListener("blur", close);
    input.addEventListener("keydown", function (event) {
      if (event.isComposing || menu.hidden) return;
      var taken = true;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (matches.length) {
          index = (index + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
          render();
        }
      } else if ((event.key === "Enter" || event.key === "Tab") && matches.length) {
        choose(index);
      } else if (event.key === "Escape") {
        close();
      } else {
        taken = false;
      }
      if (!taken) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    });
  }
  function boxCommands(input, chosen) {
    var menu = el("ul", "commands in-box");
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "Skills and commands");
    menu.hidden = true;
    commandMenu(input, menu, chosen);
    return menu;
  }
  // The column and the window each keep their own box for the same answer.
  function replyBox(id, place) {
    var state = replyState(place + ":" + id);
    var from = drawnFrom;
    var box = keyed(el("div", "reply"), "reply:" + id);
    // Reply opens the box and steps aside; open, the box is a card like a
    // learned memory, its label and Close over his words and Send.
    var opener = el("button", "reply-open", "Reply");
    opener.type = "button";
    opener.setAttribute("aria-expanded", state.open ? "true" : "false");
    opener.hidden = state.open;
    box.appendChild(opener);
    var form = el("form");
    form.hidden = !state.open;
    var input = el("textarea", "reply-input");
    input.rows = 1;
    input.placeholder = "Reply to this…";
    input.value = state.draft;
    input.setAttribute("aria-label", "Reply to this answer");
    var commands = boxCommands(input, function () { state.draft = input.value; });
    var head = el("div", "reply-head");
    head.appendChild(el("span", "reply-kicker", "Reply"));
    var close = el("button", "reply-close", "Close");
    close.type = "button";
    head.appendChild(close);
    var send = el("button", "reply-send", "Send");
    send.type = "submit";
    var row = el("div", "reply-row");
    row.appendChild(input);
    row.appendChild(send);
    form.appendChild(head);
    form.appendChild(row);
    form.appendChild(commands);
    box.appendChild(form);
    var note = el("span", "reply-note", state.note);
    note.setAttribute("role", "status");
    note.hidden = !state.note;
    box.appendChild(note);
    function show(open) {
      state.open = open;
      form.hidden = !open;
      opener.hidden = open;
      opener.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) input.focus(); else opener.focus();
    }
    function say(text) { state.note = text; note.textContent = text; note.hidden = !text; }
    opener.addEventListener("click", function () { say(""); show(true); });
    close.addEventListener("click", function () { say(""); show(false); });
    input.addEventListener("input", function () { state.draft = input.value; });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); show(false); return; }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text || !from || state.sending) return;
      state.sending = true;
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: from, text: text, replyTo: id }) }, true)
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "not sent"); return data; }); })
        .then(function () { input.value = ""; state.draft = ""; say(""); show(false); })
        .catch(function (error) { say("Not sent: " + (error.message || "try again")); })
        .then(function () { state.sending = false; });
    });
    return box;
  }
  // Words he selects in a message take a comment: a small Comment button by
  // the selection, then a card that quotes them, his words and Send. It goes
  // to whoever is doing the work, naming the conversation the words came from.
  var PASSAGE_CHARS = ${PASSAGE_CHARS};
  function passageComments() {
    var pop = el("div", "passage");
    pop.hidden = true;
    var opener = el("button", "passage-open", "Comment");
    opener.type = "button";
    var form = el("form", "passage-card");
    form.hidden = true;
    var head = el("div", "reply-head");
    head.appendChild(el("span", "reply-kicker", "Comment"));
    var close = el("button", "reply-close", "Close");
    close.type = "button";
    head.appendChild(close);
    var quote = el("blockquote", "passage-quote");
    var input = el("textarea", "reply-input passage-input");
    input.rows = 1;
    input.maxLength = 4000;
    input.placeholder = "What about it?";
    input.setAttribute("aria-label", "Your comment on the selected words");
    var commands = boxCommands(input, function () { place(); });
    var send = el("button", "reply-send", "Send");
    send.type = "submit";
    var row = el("div", "reply-row");
    row.appendChild(input);
    row.appendChild(send);
    var note = el("span", "reply-note");
    note.setAttribute("role", "status");
    note.hidden = true;
    form.appendChild(head);
    form.appendChild(quote);
    form.appendChild(row);
    form.appendChild(commands);
    form.appendChild(note);
    pop.appendChild(opener);
    pop.appendChild(form);
    document.body.appendChild(pop);
    // What he selected: the words, whose they were, and where they sit on screen.
    var picked = null;
    var sending = false;
    var selecting = false;
    var marks = window.CSS && CSS.highlights && typeof Highlight === "function" ? CSS.highlights : null;
    function messageOf(node) {
      var at = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!at || at.closest("textarea, input, form, button")) return null;
      var msg = at.closest(".msg");
      return msg && main.contains(msg) ? msg : null;
    }
    function selected() {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
      var range = selection.getRangeAt(0);
      var msg = messageOf(range.commonAncestorContainer);
      var text = selection.toString().replace(/[ \\t]+\\n/g, "\\n").trim();
      if (!msg || !text || !current) return null;
      return { session: current, range: range.cloneRange(), text: text.slice(0, PASSAGE_CHARS), from: msg.classList.contains("user") ? "user" : "assistant" };
    }
    function place() {
      if (!picked) return;
      // A redraw of the message drops the selection; an open card stays where it was.
      if (!picked.range.startContainer.isConnected) { if (form.hidden) hide(); return; }
      // Comment sits over the first line he selected, the card under the last,
      // each starting where his selection starts and kept in the conversation's column.
      var lines = picked.range.getClientRects();
      var first = lines.length ? lines[0] : picked.range.getBoundingClientRect();
      var whole = picked.range.getBoundingClientRect();
      var width = pop.offsetWidth;
      var height = pop.offsetHeight;
      var edge = Math.min(window.innerWidth - 16, main.getBoundingClientRect().right || window.innerWidth);
      var left = Math.max(16, Math.min(first.left, edge - width));
      var top = form.hidden ? first.top - height - 8 : whole.bottom + 12;
      if (form.hidden && top < 64) top = whole.bottom + 8;
      if (!form.hidden && top + height > window.innerHeight - 16) top = first.top - height - 12;
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(Math.max(16, Math.min(top, window.innerHeight - height - 16))) + "px";
    }
    function mark(on) {
      if (!marks) return;
      if (on && picked) marks.set("passage", new Highlight(picked.range)); else marks.delete("passage");
    }
    function say(text) { note.textContent = text; note.hidden = !text; }
    function hide() {
      pop.hidden = true;
      pop.classList.remove("shown", "open");
      form.hidden = true;
      opener.hidden = false;
      picked = null;
      say("");
      mark(false);
    }
    function offer(pick) {
      picked = pick;
      opener.hidden = false;
      form.hidden = true;
      pop.hidden = false;
      place();
      requestAnimationFrame(function () { pop.classList.add("shown"); });
    }
    function check() {
      if (!form.hidden || sending || selecting) return;
      var pick = selected();
      if (pick) offer(pick); else hide();
    }
    var pending = 0;
    document.addEventListener("selectionchange", function () {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(check);
    });
    document.addEventListener("pointerdown", function (event) { selecting = !!messageOf(event.target); });
    document.addEventListener("pointerup", function () {
      selecting = false;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(check);
    });
    // Pressing Comment keeps the selection it is about.
    opener.addEventListener("mousedown", function (event) { event.preventDefault(); });
    opener.addEventListener("click", function () {
      if (!picked) return;
      quote.textContent = picked.text;
      input.value = "";
      say("");
      send.disabled = false;
      opener.hidden = true;
      form.hidden = false;
      pop.classList.add("open");
      mark(true);
      place();
      input.focus();
    });
    close.addEventListener("click", hide);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); hide(); return; }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !pop.hidden && form.hidden) { event.preventDefault(); hide(); }
    });
    // A click elsewhere puts the card away unless he has started writing.
    document.addEventListener("mousedown", function (event) {
      if (pop.hidden || pop.contains(event.target) || sending) return;
      if (form.hidden || !input.value.trim()) hide();
    });
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text || !picked || sending) return;
      sending = true;
      send.disabled = true;
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: picked.session, passage: { quote: picked.text, from: picked.from }, text: text }) }, true)
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "not sent"); return data; }); })
        .then(function () {
          input.value = "";
          say("Sent to Flyd");
          var selection = window.getSelection();
          if (selection) selection.removeAllRanges();
          setTimeout(function () { if (!input.value.trim()) hide(); }, 1600);
        })
        .catch(function (error) { send.disabled = false; say("Not sent: " + (error.message || "try again")); })
        .then(function () { sending = false; });
    });
  }
  if (SEND_TOKEN) passageComments();
  // An answer Flyd gave for him by one of his standing rules says so in one
  // line, with the rule; Undo tells the session to hold off until he answers.
  function wireAuto(target, message, said) {
    var auto = message.answeredFor !== undefined;
    target.classList.toggle("auto", auto);
    var old = target.querySelector(":scope > .auto-line");
    if (old) old.remove();
    if (!auto) return;
    var line = el("p", "auto-line");
    line.appendChild(el("span", "auto-what", (message.undone ? "You took back “" : "Answered for you: “") + said + "”"));
    if (message.answeredFor) line.appendChild(document.createTextNode(" · your rule: " + sentence(message.answeredFor)));
    if (SEND_TOKEN && !message.undone) {
      var undo = el("button", "auto-undo", "Undo");
      undo.type = "button";
      undo.setAttribute("aria-label", "Undo the answer Flyd gave for you");
      undo.addEventListener("click", function () {
        if (undo.disabled || !current) return;
        undo.disabled = true;
        undo.textContent = "Taking back…";
        authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: current, undo: message.id }) }, true)
          .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "not sent"); }); })
          .then(function () { undo.textContent = "Taken back"; })
          .catch(function (error) { undo.disabled = false; undo.textContent = "Undo (" + (error.message || "try again") + ")"; });
      });
      line.appendChild(undo);
    }
    target.insertBefore(line, target.querySelector(":scope > .body"));
  }
  // In the window: an answer, or the outcome under his note, takes a reply the same way.
  function replyTarget(message) {
    if (message.role === "assistant") return message.answers || null;
    return message.settled && message.waiting ? message.id : null;
  }
  function wireReply(el, message) {
    // A reply that asks him something is answered in its own card instead.
    var target = SEND_TOKEN && !message.choice ? replyTarget(message) : null;
    var old = el.querySelector(":scope > .reply");
    if (old && (!target || old.dataset.key !== "reply:" + target)) { old.remove(); old = null; }
    if (!target) return;
    if (!old) old = replyBox(target, "window");
    if (el.lastElementChild !== old) el.appendChild(old);
  }
  // A reply that asks him something carries its question under it: one tap per
  // option, or his own words. The answer goes back where the question came from,
  // the way a reply to an answer does. Drawn from its state alone, so a redraw
  // keeps what he typed and what was sent.
  var choiceStates = new Map();
  function choiceKey(choice) {
    return "choice:" + choice.replyTo + ":" + choice.question + ":" + choice.options.join("|") + (choice.multiple ? ":multi" : "") + (choice.steps ? ":" + JSON.stringify(choice.steps) : "");
  }
  function wireChoice(target, message) {
    var choice = SEND_TOKEN ? message.choice : null;
    var key = choice ? choiceKey(choice) : "";
    var old = target.querySelector(":scope > .choice");
    target.classList.toggle("asks", !!choice);
    if (old && old.dataset.key !== key) { old.remove(); old = null; }
    if (!choice) return;
    if (!old) old = choiceCard(choice, key);
    if (target.lastElementChild !== old) target.appendChild(old);
  }
  function choiceCard(choice, key) {
    if (!choiceStates.has(key)) choiceStates.set(key, { draft: "", note: "", sent: false, sending: false, picked: [], steps: { at: 0, answers: [] } });
    var state = choiceStates.get(key);
    var card = el("div", "choice");
    card.dataset.key = key;
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", choice.question);
    card.appendChild(el("p", "choice-q", choice.question));
    if (choice.steps && choice.steps.length) { card.firstChild.classList.add("choice-lead"); return stepsCard(card, choice, state); }
    var buttons = [];
    var multiple = choice.multiple === true;
    var picked = state.picked;
    var pickSend = null;
    if (choice.options.length) {
      var options = el("div", "choice-options");
      choice.options.forEach(function (option, index) {
        var button = el("button", "choice-option", option);
        button.type = "button";
        if (multiple) {
          var on = picked.indexOf(index) >= 0;
          button.setAttribute("aria-pressed", on ? "true" : "false");
          button.addEventListener("click", function () {
            if (state.sent || state.sending) return;
            var at = picked.indexOf(index);
            if (at >= 0) picked.splice(at, 1); else picked.push(index);
            button.setAttribute("aria-pressed", at >= 0 ? "false" : "true");
            if (pickSend) pickSend.disabled = picked.length === 0;
          });
        } else {
          button.addEventListener("click", function () { deliver(option); });
        }
        buttons.push(button);
        options.appendChild(button);
      });
      card.appendChild(options);
    }
    if (multiple) {
      pickSend = el("button", "choice-send reply-send", "Send the ones you picked");
      pickSend.type = "button";
      pickSend.disabled = picked.length === 0;
      pickSend.addEventListener("click", function () { deliver(picked.map(function (index) { return choice.options[index]; }).join(", ")); });
      card.appendChild(pickSend);
    }
    var form = el("form", "choice-free");
    var input = el("textarea", "reply-input choice-input");
    input.rows = 1;
    input.placeholder = choice.options.length ? "Or say something else…" : "Your answer…";
    input.value = state.draft;
    input.setAttribute("aria-label", "Answer: " + choice.question);
    var send = el("button", "reply-send", "Send");
    send.type = "submit";
    form.appendChild(input);
    form.appendChild(send);
    card.appendChild(form);
    var note = el("span", "reply-note", state.note);
    note.setAttribute("role", "status");
    note.hidden = !state.note;
    card.appendChild(note);
    function say(text) { state.note = text; note.textContent = text; note.hidden = !text; }
    function settle() {
      buttons.forEach(function (button) { button.disabled = state.sent || state.sending; });
      input.disabled = send.disabled = state.sent || state.sending;
      if (pickSend) pickSend.disabled = state.sent || state.sending || picked.length === 0;
      form.hidden = state.sent;
    }
    function deliver(text) {
      text = String(text || "").trim();
      if (!text || !choice.session || state.sending || state.sent) return;
      state.sending = true;
      settle();
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: choice.session, text: text, replyTo: choice.replyTo, questionText: choice.question }) }, true)
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "not sent"); return data; }); })
        .then(function () { state.sent = true; state.draft = ""; input.value = ""; say("Sent: “" + text + "”"); })
        .catch(function (error) { say("Not sent: " + (error.message || "try again")); })
        .then(function () { state.sending = false; settle(); });
    }
    input.addEventListener("input", function () { state.draft = input.value; });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", function (event) { event.preventDefault(); deliver(input.value); });
    settle();
    return card;
  }
  // Several questions in one reply: the card asks them one after another, and his
  // answers go back together, only when he sends them.
  function stepsCard(card, choice, state) {
    var note = el("span", "reply-note", state.note);
    note.setAttribute("role", "status");
    note.hidden = !state.note;
    function say(text) { state.note = text; note.textContent = text; note.hidden = !text; }
    var steps = stepper(choice.steps, state.steps, { option: "choice-option", input: "reply-input", next: "reply-send" }, function () {}, function (text) {
      if (!choice.session || state.steps.sending || state.steps.sent) return;
      state.steps.sending = true;
      steps.sync();
      say("Sending…");
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: choice.session, text: text, replyTo: choice.replyTo, questionText: choice.question }) }, true)
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "not sent"); return data; }); })
        .then(function () { state.steps.sent = true; say("Sent your answers"); })
        .catch(function (error) { say("Not sent: " + (error.message || "try again")); })
        .then(function () { state.steps.sending = false; steps.draw(); });
    });
    card.appendChild(steps.el);
    card.appendChild(note);
    return card;
  }
  // One question at a time: a tap or his own words answers it and moves to the
  // next, Back goes to the one before, and nothing is sent until the last step,
  // where he sees every answer and sends them as one reply. \`state\` is
  // { at, answers, sent, sending }; \`look\` names the surface's option, input
  // and button classes; \`save\` keeps the state, \`send\` delivers the reply.
  function stepper(steps, state, look, save, send) {
    var wrap = el("div", "stepper");
    var controls = [];
    function answerFor(index) { return state.answers[index] || ""; }
    function reply() {
      return steps.map(function (step, index) { return (index + 1) + ". " + step.question + " " + answerFor(index); }).join("\\n");
    }
    function go(at) { state.at = Math.max(0, Math.min(steps.length, at)); save(); draw(); }
    function answer(index, text) {
      text = String(text || "").trim();
      if (!text || state.sent || state.sending) return;
      state.answers[index] = text;
      go(index + 1);
    }
    function backButton() {
      var back = el("button", "step-back", "Back");
      back.type = "button";
      back.addEventListener("click", function () { go(state.at - 1); });
      controls.push(back);
      return back;
    }
    function draw() {
      wrap.textContent = "";
      controls = [];
      var at = Math.min(state.at || 0, steps.length);
      if (at === steps.length) {
        wrap.appendChild(el("p", "step-count", state.sent ? "Your answers" : "Your answers, ready to send"));
        var list = el("ol", "step-review");
        steps.forEach(function (step, index) {
          var item = el("li");
          item.appendChild(el("span", "step-review-q", step.question));
          item.appendChild(el("span", "step-review-a", answerFor(index)));
          list.appendChild(item);
        });
        wrap.appendChild(list);
        if (!state.sent) {
          var nav = el("div", "step-nav");
          nav.appendChild(backButton());
          var go2 = el("button", "step-send", "Send answers");
          go2.type = "button";
          go2.addEventListener("click", function () { if (!state.sending && !state.sent) send(reply()); });
          controls.push(go2);
          nav.appendChild(go2);
          wrap.appendChild(nav);
        }
        sync();
        return;
      }
      var step = steps[at];
      wrap.appendChild(el("p", "step-count", "Question " + (at + 1) + " of " + steps.length));
      wrap.appendChild(el("p", "step-q", step.question));
      var given = answerFor(at);
      if (step.options.length) {
        var options = el("div", "step-options");
        options.setAttribute("role", "group");
        options.setAttribute("aria-label", "Options");
        step.options.forEach(function (option) {
          var button = el("button", look.option, option);
          button.type = "button";
          button.setAttribute("aria-pressed", String(given === option));
          button.addEventListener("click", function () { answer(at, option); });
          controls.push(button);
          options.appendChild(button);
        });
        wrap.appendChild(options);
      }
      var form = el("form", "step-free");
      var input = el("textarea", look.input + " step-input");
      input.rows = 1;
      input.placeholder = step.options.length ? "Or say something else…" : "Your answer…";
      input.setAttribute("aria-label", "Answer: " + step.question);
      if (given && step.options.indexOf(given) === -1) input.value = given;
      var next = el("button", look.next, "Next");
      next.type = "submit";
      form.appendChild(input);
      form.appendChild(next);
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
      });
      form.addEventListener("submit", function (event) { event.preventDefault(); answer(at, input.value); });
      controls.push(input, next);
      wrap.appendChild(form);
      if (at > 0) {
        var row = el("div", "step-nav");
        row.appendChild(backButton());
        wrap.appendChild(row);
      }
      sync();
    }
    function sync() { controls.forEach(function (control) { control.disabled = !!state.sending || !!state.sent; }); }
    if (!state.answers) state.answers = [];
    draw();
    return { el: wrap, draw: draw, sync: sync };
  }
`;

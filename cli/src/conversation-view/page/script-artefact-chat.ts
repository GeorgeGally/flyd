import { MAX_IMAGE_BYTES } from "../attachment-limits.js";

/** The chat box under every artefact, scene questions and answerable "needs you" lines. */
export const ARTEFACT_CHAT_SCRIPT = `
  // A sidebar item's chat sits behind one small icon until he opens it.
  function sidebarChat(key, target) {
    var chat = artefactChat(key, target, "Say something about this…");
    var form = chat.form;
    form.hidden = !chat.state.open;
    var opener = el("button", "art-chat-open");
    opener.type = "button";
    opener.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
    opener.setAttribute("aria-label", "Chat about this item");
    opener.setAttribute("aria-expanded", String(!form.hidden));
    opener.addEventListener("click", function () {
      form.hidden = !form.hidden;
      chat.state.open = !form.hidden;
      chat.save();
      opener.setAttribute("aria-expanded", String(!form.hidden));
      if (!form.hidden) form.querySelector("textarea").focus();
    });
    return { opener: opener, form: form };
  }

  // The chat box at the foot of every artefact: his words about that one thing go
  // to firstmate naming it, and the line under the box says where they are in
  // plain words: sent, then "Flyd has it" once firstmate has read the note.
  // \`target\` is what the words answer: a fleet decision, a reply's question, or
  // the artefact itself ({ about: { title, task, url } }).
  function artefactChat(key, target, label, earlierKey) {
    var state = {};
    try { state = JSON.parse(sessionStorage.getItem(key) || (earlierKey && sessionStorage.getItem(earlierKey)) || "{}") || {}; } catch (_) {}
    if (state.receipt === "sending") state.receipt = "";
    try { state.thread = JSON.parse(store(key) || (earlierKey && store(earlierKey)) || "[]"); } catch (_) {}
    if (!Array.isArray(state.thread)) state.thread = [];
    var form = el("form", "art-chat");
    form.setAttribute("aria-label", label);
    var input = el("textarea", "art-chat-input");
    input.rows = 1;
    input.maxLength = 4000;
    input.placeholder = label;
    input.setAttribute("aria-label", label);
    input.value = state.text || "";
    var commands = boxCommands(input, function () { state.text = input.value; state.error = ""; save(); paint(); });
    var send = el("button", "art-chat-send", "Send");
    send.type = "submit";
    // Pressing Send leaves the caret in the box, so nothing in the row moves under the click.
    send.addEventListener("mousedown", function (event) { event.preventDefault(); });
    // Screenshots he pastes into the box go with his words about this artefact;
    // a reply to an answer has no room for them, so it takes words only.
    var takesImages = !!(target.about || target.decision);
    var images = [];
    var thumbs = el("div", "art-chat-images");
    thumbs.hidden = true;
    var receipt = el("p", "art-chat-receipt");
    receipt.setAttribute("role", "status");
    receipt.setAttribute("aria-live", "polite");
    var watching = null;
    // His messages about this card and the replies that came back, oldest first,
    // kept with the card so they survive a reload and the box is never blank again.
    var thread = el("div", "art-thread");
    // Only the thread outlives the session; a choice he picked, the steps and his draft stay with this session.
    // The same card can be open in more than one place at once, so what another copy stored is
    // folded in by note id, never written over: no message, note id or answer is lost, and
    // nothing one copy has finished with comes back. Only notes that went are kept.
    function save() {
      try { sessionStorage.setItem(key, JSON.stringify(Object.assign({}, state, { thread: undefined }))); } catch (_) {}
      var stored = [];
      try { stored = JSON.parse(store(key) || "[]"); } catch (_) {}
      var mine = state.thread || [];
      var after = -1;
      (Array.isArray(stored) ? stored : []).forEach(function (other) {
        if (!other || !other.id) return;
        var at = -1;
        mine.forEach(function (entry, index) { if (entry.id === other.id) at = index; });
        if (at === -1) { mine.splice(after + 1, 0, Object.assign({}, other)); after += 1; return; }
        var entry = mine[at];
        if (!entry.answer && other.answer) entry.answer = other.answer;
        if (other.done) entry.done = true;
        after = Math.max(after, at);
      });
      state.thread = mine.slice(-50);
      store(key, JSON.stringify(state.thread.filter(function (entry) { return entry.id; })));
      paintThread();
    }
    // The newest message of his still waiting on an answer: the one line that says what
    // Flyd is doing about it stands under it, and is replaced in place as the work moves.
    function openEntry() {
      var list = state.thread || [];
      for (var i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].done) continue;
        return list[i].answer ? null : list[i];
      }
      return null;
    }
    // What is happening to his newest message, in Flyd's plain words: the step being taken,
    // else that it is queued, else that a worker has it. Never who has it or where it went.
    function workingWords(entry) {
      var step = (entry.doing || "").replace(/[.…]+$/, "");
      if (step) return step;
      if (!entry.id) return "Sending";
      return entry.handoff === "taken" ? "Working on it" : "Queued";
    }
    // Every message can be answered back where it stands, his own or Flyd's: the reply joins this
    // card's own thread. One reply box per message, kept across redraws so a half-typed reply stays.
    var replies = {};
    function replyOpener(entry) {
      var wrap = replies[entry.id];
      if (!wrap) {
        wrap = el("div", "art-reply-wrap");
        replies[entry.id] = wrap;
        wrap.appendChild(replyButton(wrap));
      }
      wrap.entry = entry;
      wrap.firstChild.setAttribute("aria-label", entry.answer ? "Reply to this answer" : "Reply to this message");
      return wrap;
    }
    function replyButton(wrap) {
      var button = el("button", "art-reply", "Reply");
      button.type = "button";
      var nested = null;
      button.addEventListener("click", function () {
        var entry = wrap.entry;
        if (!nested) {
          var to = { session: current, replyTo: entry.id };
          if (entry.answer) to.questionText = entry.answer;
          nested = artefactChat(key + ":reply:" + entry.id, to, "Reply").form;
          nested.classList.add("art-chat--nested");
          wrap.appendChild(nested);
          button.hidden = true;
          var box = nested.querySelector("textarea");
          if (box) box.focus();
          return;
        }
        nested.hidden = !nested.hidden;
      });
      return button;
    }
    // Redrawn only when one of his messages or the line under it changes: a keystroke in
    // the box must never rebuild what he is typing in.
    var drawn = "";
    function paintThread() {
      var open = openEntry();
      var next = JSON.stringify([state.thread, open ? [open.doing, open.handoff, open.id] : null, state.receipt]);
      if (next === drawn) return;
      drawn = next;
      var focused = thread.contains(document.activeElement) ? document.activeElement : null;
      thread.textContent = "";
      (state.thread || []).forEach(function (entry) {
        var box = el("div", "art-entry");
        box.appendChild(el("p", "art-msg art-msg--you", entry.text));
        if (entry.answer) {
          box.appendChild(el("p", "art-msg art-msg--them", entry.answer));
        } else if (entry === open) {
          var line = el("p", "art-msg art-working");
          line.setAttribute("role", "status");
          line.setAttribute("aria-live", "polite");
          line.appendChild(el("span", "art-pulse"));
          line.appendChild(el("span", "", workingWords(entry)));
          box.appendChild(line);
        }
        if (entry.id && entry.id.indexOf("decision:") !== 0) box.appendChild(replyOpener(entry));
        thread.appendChild(box);
      });
      if (focused && focused.isConnected && document.activeElement !== focused) focused.focus();
      var ids = (state.thread || []).map(function (entry) { return entry.id; });
      Object.keys(replies).forEach(function (id) { if (ids.indexOf(id) === -1) delete replies[id]; });
      thread.hidden = !(state.thread || []).length;
    }
    function paint() {
      receipt.textContent = state.error || (state.receipt === "read" ? "Flyd has it" : state.receipt === "sent" ? "Sent to Flyd" : state.receipt === "sending" ? "Sending…" : "");
      receipt.classList.toggle("problem", !!state.error);
      receipt.classList.toggle("sent", !state.error && (state.receipt === "sent" || state.receipt === "read"));
      // A picture alone says enough about an artefact; an answer still needs words.
      send.disabled = state.receipt === "sending" || !(input.value.trim() || (target.about && images.length));
      if (chat.onPaint) chat.onPaint();
    }
    function paintImages() {
      thumbs.textContent = "";
      images.forEach(function (image, index) {
        var item = el("div", "attachment");
        var img = el("img");
        img.src = image.url;
        img.alt = "Pasted image " + (index + 1);
        img.addEventListener("click", function () { openImage(image.url); });
        item.appendChild(img);
        var remove = el("button", "", "×");
        remove.type = "button";
        remove.setAttribute("aria-label", "Remove image");
        remove.addEventListener("mousedown", function (event) { event.preventDefault(); });
        remove.addEventListener("click", function () { images.splice(index, 1); paintImages(); paint(); });
        item.appendChild(remove);
        thumbs.appendChild(item);
      });
      thumbs.hidden = images.length === 0;
    }
    if (takesImages) input.addEventListener("paste", function (event) {
      var files = Array.prototype.map.call((event.clipboardData && event.clipboardData.items) || [], function (item) {
        return item.kind === "file" && ["image/png", "image/jpeg", "image/gif", "image/webp"].indexOf(item.type) !== -1 ? item.getAsFile() : null;
      }).filter(Boolean);
      if (!files.length) return;
      if (!Array.prototype.some.call(event.clipboardData.items, function (item) { return item.kind === "string" && item.type === "text/plain"; })) event.preventDefault();
      files.forEach(function (file) {
        if (images.length >= 4) { state.error = "4 images at most"; paint(); return; }
        if (file.size > ${MAX_IMAGE_BYTES}) { state.error = "Images must be under " + Math.round(${MAX_IMAGE_BYTES} / 1048576) + "MB"; paint(); return; }
        var reader = new FileReader();
        reader.onload = function () {
          if (images.length >= 4) return;
          var url = String(reader.result);
          images.push({ url: url, mediaType: file.type, data: url.slice(url.indexOf(",") + 1) });
          state.error = "";
          paintImages();
          paint();
        };
        reader.readAsDataURL(file);
      });
    });
    // Every note in the card without an answer is watched, so a reply lands here
    // rather than only in the conversation; the newest also says whether it was read.
    function unanswered() {
      return (state.thread || []).filter(function (entry) { return entry.id && !entry.answer && !entry.done; });
    }
    function watch() {
      if (watching) return;
      if (!unanswered().length) return;
      var asking = false;
      watching = setInterval(function () {
        if (!form.isConnected) { clearInterval(watching); watching = null; return; }
        if (asking) return;
        var waiting = unanswered();
        // Nothing left to hear back about: the card stops asking.
        if (!waiting.length) { clearInterval(watching); watching = null; return; }
        asking = true;
        Promise.all(waiting.map(function (entry) {
          return fetch("/api/note?id=" + encodeURIComponent(entry.id) + "&token=" + encodeURIComponent(VIEW_TOKEN))
            .then(function (response) { return response.ok ? response.json() : null; })
            .catch(function () { return null; });
        })).then(function (results) {
          asking = false;
          var changed = false;
          results.forEach(function (data, index) {
            if (!data) return;
            var entry = waiting[index];
            // Gone from firstmate's inbox poll after poll (one miss is only firstmate moving
            // it to handled/): nothing more will come for it. A note firstmate has taken but
            // not answered is not finished with — it can still gain a reply — so the card
            // keeps asking, as the window keeps showing it.
            var missed = data.receipt === null ? (entry.missed || 0) + 1 : 0;
            if (missed !== (entry.missed || 0)) { entry.missed = missed; changed = true; }
            if (missed >= 3) { entry.done = true; changed = true; }
            if (data.answer && data.answer.text && !entry.answer) {
              entry.answer = data.answer.text;
              delete entry.doing;
              if (state.receipt === "sent") state.receipt = "read";
              changed = true;
            }
            if (data.receipt === "read" && state.receipt === "sent") { state.receipt = "read"; changed = true; }
            // What Flyd is doing about it right now: replaced in place, never a growing log.
            if (!entry.answer) {
              var step = (data.doing || "").trim();
              if (step && step !== entry.doing) { entry.doing = step; changed = true; }
              else if (!step && entry.doing) { delete entry.doing; changed = true; }
            }
            if (data.handoff && data.handoff !== entry.handoff) { entry.handoff = data.handoff; changed = true; }
          });
          if (changed) { save(); paint(); }
        });
      }, 3000);
    }
    function deliver(text, done) {
      state.receipt = "sending";
      state.error = "";
      // His words stand in the card's own thread the moment he sends them, not when a reply comes.
      // Only the newest few dozen are kept: old ones have long scrolled off the card anyway.
      var entry = { text: text };
      state.thread = (state.thread || []).concat([entry]).slice(-50);
      // The box empties as he sends, and so does the saved draft: a redraw while it is on its way
      // must not bring his words back into the box. They come back only if nothing went.
      // (A choice button sends its own words: a draft in the box is left alone.)
      var draft = input.value.trim() === text ? input.value : "";
      if (draft) { input.value = ""; state.text = ""; save(); }
      paintThread();
      paint();
      var sending = takesImages ? images.slice() : [];
      var body = Object.assign({ text: text, session: current }, target);
      if (sending.length) body.images = sending.map(function (image) { return { mediaType: image.mediaType, data: image.data }; });
      authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, true)
        .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) throw new Error(result.data.error || "Not delivered; try again.");
          state.receipt = "sent";
          entry.id = result.data.id;
          // Only what went is cleared: one pasted while it was on its way stays for the next.
          images = images.filter(function (image) { return sending.indexOf(image) === -1; });
          paintImages();
          if (done) done();
          save();
          paint();
          watch();
        })
        .catch(function (error) {
          state.receipt = "";
          state.error = error.message || "Not delivered; try again.";
          // Nothing went, so it is not in the thread: his words go back in the box to try again.
          state.thread = (state.thread || []).filter(function (one) { return one !== entry; });
          if (draft && !input.value) { input.value = draft; state.text = draft; save(); }
          paintThread();
          paint();
        });
    }
    input.addEventListener("input", function () { state.text = input.value; state.error = ""; save(); paint(); });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (send.disabled) return;
      // The box already emptied as it went; something typed since stays.
      deliver(text);
    });
    // One field: his pasted images over his words, Send inside it on the same row.
    var field = el("div", "art-chat-field");
    var row = el("div", "art-chat-row");
    row.appendChild(input);
    row.appendChild(send);
    field.appendChild(thumbs);
    field.appendChild(row);
    field.appendChild(commands);
    form.appendChild(thread);
    form.appendChild(field);
    form.appendChild(receipt);
    var chat = { form: form, state: state, deliver: deliver, save: save, onPaint: null };
    paintThread();
    paint();
    watch();
    return chat;
  }
  // A scene's foot: a question's options, one tap each, then the chat box.
  function sceneAsk(box, key) {
    var wrap = el("div", "scene-ask");
    wrap.dataset.key = key;
    var decision = box.decision;
    var link = box.open || (box.links || []).find(function (one) { return !one.closed; });
    var about = { title: box.title };
    if (box.task) about.task = box.task;
    if (link) about.url = link.url;
    var target = !decision ? { about: about } : decision.replyTo ? { session: drawnFrom, replyTo: decision.replyTo, questionText: decision.question } : { decision: decision.decisionId || decision.task };
    var chat = artefactChat(key, target, decision && (decision.choices.length || decision.steps) ? "Or say something else…" : decision ? "Your answer…" : "Say something about this…", decision && decision.question ? key + ":" + decision.question : "");
    // A hold that puts two (or three) decisions to him says each one in its own plain line, with what
    // he can pick and what the work recommends, and what a landed change has already answered.
    if (decision && decision.decisions && decision.decisions.length > 1) {
      var askList = el("ol", "art-decisions");
      decision.decisions.forEach(function (one) {
        var item = el("li", "art-decision");
        item.appendChild(el("p", "art-decision-q", one.question));
        if (one.done) {
          item.appendChild(el("p", "art-decision-a art-decision-done", one.done));
          item.classList.add("art-decision--done");
        } else if (one.options && one.options.length) {
          item.appendChild(el("p", "art-decision-a", one.options.join("  ·  ")));
          if (one.recommended) item.appendChild(el("p", "art-decision-rec", [one.note, "recommended: " + one.recommended].filter(Boolean).join(" · ")));
        }
        askList.appendChild(item);
      });
      wrap.appendChild(askList);
    }
    if (decision && decision.steps && decision.steps.length) {
      // Several questions: one at a time, a tap moves on, and the answers go together from the last step.
      if (!chat.state.steps) chat.state.steps = { at: 0, answers: [] };
      chat.state.steps.sending = false;
      var steps = stepper(decision.steps, chat.state.steps, { option: "choice-pick", input: "art-chat-input", next: "art-chat-send" }, chat.save, function (text) {
        chat.deliver(text, function () { chat.state.steps.sent = true; });
      });
      // Redrawn only when sending starts or ends, so a half-typed answer stays put.
      chat.onPaint = function () {
        var sending = chat.state.receipt === "sending";
        if (sending === !!chat.state.steps.sending && !(chat.state.steps.sent && steps.el.querySelector(".step-send"))) return;
        chat.state.steps.sending = sending;
        steps.draw();
      };
      wrap.appendChild(steps.el);
      // Each question takes his own words; the box below only says where the answers are.
      chat.form.classList.add("art-chat--receipt");
    } else if (decision && decision.choices.length) {
      var choices = el("div", "choices");
      choices.setAttribute("role", "group");
      choices.setAttribute("aria-label", "Options");
      var buttons = decision.choices.map(function (choice) {
        var button = el("button", "choice-pick");
        button.type = "button";
        button.appendChild(el("span", "", choice));
        if (choice === decision.recommended) button.appendChild(el("small", "", "recommended"));
        button.addEventListener("click", function () {
          if (chat.state.picked || chat.state.receipt === "sending") return;
          chat.deliver(choice, function () { chat.state.picked = choice; });
        });
        choices.appendChild(button);
        return button;
      });
      // The one he picked stays lit; the others step back once it is sent.
      chat.onPaint = function () {
        buttons.forEach(function (button, index) {
          var picked = chat.state.picked === decision.choices[index];
          button.setAttribute("aria-pressed", String(picked));
          button.disabled = !!chat.state.picked && !picked;
        });
      };
      chat.onPaint();
      wrap.appendChild(choices);
    }
    wrap.appendChild(chat.form);
    return wrap;
  }

  // A "needs you" line in a reply is answerable where it stands: the answer goes
  // to firstmate as a note, like the answers to an artefact question.
  function wireAsks(root) {
    root.querySelectorAll(".status-card .sc-row[data-ask]").forEach(function (row) {
      var what = row.querySelector(".sc-what");
      if (!what || what.querySelector(".sc-ask")) return;
      var ask = row.dataset.ask || "";
      var key = "flyd-ask:" + ask;
      var form = el("form", "sc-ask");
      var input = el("textarea", "sc-ask-input");
      input.rows = 1;
      input.placeholder = "Answer…";
      input.setAttribute("aria-label", "Answer: " + ask);
      var send = el("button", "sc-ask-send", "Send");
      send.type = "submit";
      var receipt = el("span", "sc-ask-receipt");
      receipt.setAttribute("role", "status");
      receipt.setAttribute("aria-live", "polite");
      var settled = "";
      try { settled = sessionStorage.getItem(key) || ""; } catch (_) {}
      if (settled && settled.indexOf("Sent to firstmate") === 0) { receipt.textContent = settled; input.disabled = true; }
      function refresh() { send.disabled = input.disabled || !!receipt.textContent || !input.value.trim(); }
      refresh();
      input.addEventListener("input", refresh);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (send.disabled || !input.value.trim()) return;
        send.disabled = true;
        receipt.textContent = "Sending…";
        authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: current, text: 'On "' + ask + '": ' + input.value.trim() }) }, true)
          .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
          .then(function (result) {
            if (!result.ok) throw new Error(result.data.error || "not delivered");
            receipt.textContent = "Sent to firstmate.";
            input.disabled = true;
            try { sessionStorage.setItem(key, receipt.textContent); } catch (_) {}
          })
          .catch(function (error) { receipt.textContent = error.message || "Not delivered; try again."; refresh(); });
      });
      form.appendChild(input);
      form.appendChild(send);
      form.appendChild(receipt);
      what.appendChild(form);
    });
  }

`;

import { installComposerPredictions } from "../composer-predictions-client.js";
import { DOCUMENT_EXTENSIONS, MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "../attachment-limits.js";
import { RECEIVED } from "../living.js";

/** The message box: drafts, attachments, history recall, sending, voice and "about" cards. */
export const COMPOSER_SCRIPT = `
  // Composer: shown only when the server can deliver the captain's words.
  var composer = document.getElementById("composer");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  if (SEND_TOKEN) {
    composer.hidden = false;
    document.body.classList.add("can-send");
  }
  var attachmentsEl = document.getElementById("attachments");
  var attachments = [];
  var MAX_ATTACHMENTS = 4;
  function grow() {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
    sendBtn.disabled = !input.value.trim() && attachments.length === 0;
    saveDraft();
  }
  // The box is never lost: its words, caret and attachments are kept on every
  // change, in this page's storage and in Core, and come back when the window
  // does (an update, a reinstall, a restarted view). Only sending it or
  // emptying the box clears it.
  var DRAFT_KEY = new URLSearchParams(location.search).get("session") || "latest";
  var DRAFT_STORE = "flyd-view-draft:" + DRAFT_KEY;
  var draftTimer = null;
  var restoring = false;
  var sendsInFlight = 0;
  // What has gone out since the window opened: a stored draft still on its way
  // back never refills the box with it, and clearing it is not held by the read.
  var sentSinceLoad = [];
  function draftState() {
    // Paging through earlier messages shows them in the box; the draft is what he had typed.
    var recalling = recall.index !== -1;
    var text = recalling ? recall.draft : input.value;
    return {
      text: text,
      selectionStart: recalling ? text.length : input.selectionStart,
      selectionEnd: recalling ? text.length : input.selectionEnd,
      attachments: attachments.filter(function (a) { return a.draftId; }).map(function (a) {
        return a.name ? { id: a.draftId, name: a.name } : { id: a.draftId, mediaType: a.mediaType, scrawlPointer: a.scrawlPointer };
      }),
      savedAt: Date.now(),
    };
  }
  function saveDraftNow(keepalive) {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!SEND_TOKEN) return;
    // Never overwrite the draft Core holds before it has been read back; a
    // message that has already gone out clearing the box is not an overwrite.
    if (restoring && !sentSinceLoad.length) return;
    // A message on its way keeps its draft until it has landed.
    if (sendsInFlight > 0 && !input.value && !attachments.length) return;
    var state = draftState();
    store(DRAFT_STORE, JSON.stringify(state));
    authed("/api/draft", { method: "POST", keepalive: !!keepalive, headers: { "content-type": "application/json" }, body: JSON.stringify({ key: DRAFT_KEY, draft: state }) }, true)
      .catch(function () { /* the page's own copy holds it until the next change */ });
  }
  function saveDraft() {
    if (!SEND_TOKEN || draftTimer) return;
    draftTimer = setTimeout(saveDraftNow, 300);
  }
  document.addEventListener("selectionchange", function () { if (document.activeElement === input) saveDraft(); });
  window.addEventListener("pagehide", function () { if (draftTimer) saveDraftNow(true); });
  // A token from before the view restarted is swapped for the current one, once.
  function authed(path, init, retry) {
    if (path !== "/api/send") return tokenFetch(path, init, retry);
    notesOut += 1;
    return tokenFetch(path, init, retry).then(function (response) {
      return response.clone().json().catch(function () { return null; }).then(function (data) {
        notesOut -= 1;
        if (response.ok && data && data.id) delivered.add(data.id);
        clearLanded();
        return response;
      });
    }, function (error) {
      notesOut -= 1;
      throw error;
    });
  }
  function paintConfirm(confirm) {
    var box = document.getElementById("article-confirm");
    if (!box) return;
    if (!confirm || !confirm.id) { box.hidden = true; delete box.dataset.id; return; }
    box.hidden = false;
    box.dataset.id = confirm.id;
    var q = document.getElementById("article-confirm-q");
    if (q.textContent !== (confirm.prompt || "")) q.textContent = confirm.prompt || "";
  }
  function answerConfirm(allow) {
    var box = document.getElementById("article-confirm");
    var id = box && box.dataset.id;
    if (!id) return;
    box.hidden = true;
    tokenFetch("/api/article-confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: id, allow: allow }) }, true).catch(function () { box.hidden = false; });
  }
  var confirmYes = document.getElementById("article-confirm-yes");
  var confirmNo = document.getElementById("article-confirm-no");
  if (confirmYes) confirmYes.addEventListener("click", function () { answerConfirm(true); });
  if (confirmNo) confirmNo.addEventListener("click", function () { answerConfirm(false); });
  function tokenFetch(path, init, retry) {
    var headers = Object.assign({}, init.headers || {}, { "x-flyd-view-token": SEND_TOKEN });
    return fetch(path, Object.assign({}, init, { headers: headers })).then(function (response) {
      if (response.status !== 403 || !retry) return response;
      return fetch("/api/token").then(function (r) { return r.json(); }).then(function (data) {
        if (!data.token) return response;
        SEND_TOKEN = data.token;
        return tokenFetch(path, init, false);
      });
    });
  }
  // Each attachment's bytes go to Core once, as it is added; the draft names it.
  function keepAttachment(attachment) {
    var body = attachment.name ? { name: attachment.name, data: attachment.data } : { mediaType: attachment.mediaType, data: attachment.data };
    authed("/api/draft/attachment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, true)
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (stored) {
        if (!stored || !stored.id || attachments.indexOf(attachment) === -1) return;
        attachment.draftId = stored.id;
        saveDraft();
      })
      .catch(function () { /* kept in the box; only a restart would lose it */ });
  }
  function draftNote(text) {
    var hint = document.getElementById("usage");
    function clear() { hint.removeAttribute("data-note"); input.removeEventListener("input", clear); }
    hint.setAttribute("data-note", text);
    input.addEventListener("input", clear);
    setTimeout(clear, 15000);
  }
  function restoreDraft() {
    if (!SEND_TOKEN) return;
    var local = null;
    try { local = JSON.parse(store(DRAFT_STORE) || "null"); } catch (e) { local = null; }
    restoring = true;
    authed("/api/draft?key=" + encodeURIComponent(DRAFT_KEY), { method: "GET" }, true)
      .then(function (response) { return response.ok ? response.json() : {}; })
      .catch(function () { return {}; })
      .then(function (data) {
        restoring = false;
        // Whatever he has started since the window opened wins.
        if (input.value || attachments.length || voiceBase !== null) {
          if (input.value || attachments.length) saveDraftNow();
          return;
        }
        var kept = data && data.draft && typeof data.draft.text === "string" ? data.draft : null;
        var newer = local && typeof local.text === "string" && (!kept || local.savedAt > kept.savedAt) ? local : kept;
        if (!newer) return;
        var ids = (newer.attachments || []).map(function (a) { return a.id; });
        var restored = (kept ? kept.attachments : []).filter(function (a) { return ids.indexOf(a.id) !== -1; }).map(function (a) {
          return a.name
            ? { name: a.name, data: a.data, draftId: a.id }
            : { url: "data:" + a.mediaType + ";base64," + a.data, mediaType: a.mediaType, data: a.data, draftId: a.id, scrawlPointer: a.scrawlPointer };
        }).slice(0, MAX_ATTACHMENTS);
        // A draft with no words in it (a stray " -") is not his: the box opens empty.
        if (!/[a-z0-9]/i.test(newer.text || "") && !restored.length) return;
        // The words that just went never come back; an older, different draft does.
        if (newer.text.trim() && sentSinceLoad.indexOf(newer.text.trim()) !== -1) return;
        input.value = newer.text;
        attachments = restored;
        renderAttachments();
        try { input.setSelectionRange(newer.selectionStart, newer.selectionEnd); } catch (e) { /* caret at the end */ }
        if (sentSinceLoad.length) saveDraftNow();
        draftNote("your draft is safe");
      });
  }
  var typingPredictions = (${installComposerPredictions.toString()})({
    input: input, composer: composer, layer: document.getElementById("prediction-layer"),
    prefix: document.getElementById("prediction-prefix"), suffix: document.getElementById("prediction-suffix"), toggle: document.getElementById("prediction-toggle"),
    session: function () { return current; }, token: function () { return SEND_TOKEN; }, grow: grow,
    attached: function () { return attachments.length > 0 || composer.classList.contains("listening") || composer.classList.contains("transcribing"); }
  });
  function renderAttachments() {
    if (typingPredictions) typingPredictions.reset();
    attachmentsEl.textContent = "";
    attachments.forEach(function (attachment, index) {
      var item = document.createElement("div");
      item.className = attachment.name ? "attachment file" : "attachment";
      if (attachment.name) {
        item.title = attachment.name;
        var kind = document.createElement("span");
        kind.className = "kind";
        kind.textContent = fileKind(attachment.name);
        var label = document.createElement("span");
        label.className = "name";
        label.textContent = attachment.name;
        item.appendChild(kind);
        item.appendChild(label);
      } else {
        var img = document.createElement("img");
        img.src = attachment.url;
        img.alt = "";
        item.appendChild(img);
      }
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", attachment.name ? "Remove " + attachment.name : "Remove image");
      remove.addEventListener("click", function () {
        if (attachment.scrawlPointer) input.value = input.value.replace(attachment.scrawlPointer, "").trimEnd();
        attachments.splice(index, 1); renderAttachments();
      });
      item.appendChild(remove);
      attachmentsEl.appendChild(item);
    });
    attachmentsEl.hidden = attachments.length === 0;
    grow();
  }
  // The native recorder prepares a draft. Only the existing Send action files it.
  window.flydScrawl = function (path, data) {
    var pointer = "[scrawl: " + path + "]";
    if (input.value.indexOf(pointer) !== -1) return true;
    if (attachments.length >= MAX_ATTACHMENTS || attachments.some(function (a) { return a.scrawlPointer; })) {
      problem.textContent = "Send or remove an attachment to add the recording. Saved at " + path;
      return false;
    }
    input.value += (input.value.trim() ? "\\n\\n" : "") + pointer;
    var attachment = { url: "data:image/png;base64," + data, mediaType: "image/png", data: data, scrawlPointer: pointer };
    attachments.push(attachment);
    renderAttachments();
    keepAttachment(attachment);
    return true;
  };
  // Screenshots go as images; documents (a PDF, a Word file, notes) as files under their own names.
  var DOCUMENTS = ${JSON.stringify(DOCUMENT_EXTENSIONS)};
  var MAX_IMAGE_BYTES = ${MAX_IMAGE_BYTES};
  var MAX_FILE_BYTES = ${MAX_FILE_BYTES};
  var IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  // A refusal has to outlive the next stream update: say it in the box, not in
  // the corner line the view clears whenever Core sends something.
  var noticeEl = document.getElementById("notice");
  function noteRefusal(text) {
    noticeEl.textContent = text;
    noticeEl.hidden = !text;
  }
  function megabytes(bytes) {
    return Math.round(bytes / 1048576);
  }
  function refuse(refused, text) {
    if (refused.indexOf(text) === -1) refused.push(text);
  }
  function addFiles(files) {
    var refused = [];
    var taken = 0;
    Array.prototype.forEach.call(files, function (file) {
      if (!file) return;
      var image = IMAGE_TYPES.indexOf(file.type) !== -1;
      var limit = image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      var ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
      if (!image && (file.name.indexOf(".") === -1 || DOCUMENTS.indexOf(ext) === -1)) {
        refuse(refused, (file.name || "That file") + " can't be attached; Flyd takes PDFs, Office and text documents, or images");
        return;
      }
      if (file.size > limit) {
        refuse(refused, (file.name || "That file") + " is " + megabytes(file.size) + "MB; " + (image ? "images" : "documents") + " can be up to " + megabytes(limit) + "MB");
        return;
      }
      if (attachments.length >= MAX_ATTACHMENTS) {
        refuse(refused, "At most " + MAX_ATTACHMENTS + " attachments per message");
        return;
      }
      taken += 1;
      var reader = new FileReader();
      reader.onload = function () {
        var url = String(reader.result);
        if (attachments.length >= MAX_ATTACHMENTS) {
          noteRefusal("At most " + MAX_ATTACHMENTS + " attachments per message");
          return;
        }
        var data = url.slice(url.indexOf(",") + 1);
        var attachment = image ? { url: url, mediaType: file.type, data: data } : { name: file.name, data: data };
        attachments.push(attachment);
        renderAttachments();
        keepAttachment(attachment);
      };
      reader.readAsDataURL(file);
    });
    if (taken) noteRefusal("");
    if (refused.length) noteRefusal(refused.join(" · "));
  }
  // A dropped file is going into the message box, so the box comes back with it
  // instead of the file landing unseen behind the artefact screen.
  function revealComposer() {
    if (composer.hidden || showEl.hidden) return;
    applyScreen("terminal", false);
    store("flyd-view-screen", "terminal");
  }
  input.addEventListener("paste", function (event) {
    var files = Array.prototype.map.call((event.clipboardData && event.clipboardData.items) || [], function (item) {
      return item.kind === "file" ? item.getAsFile() : null;
    }).filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  });
  // Images and documents can be dropped anywhere on the page; a stray drop never navigates away.
  document.addEventListener("dragover", function (event) {
    if (composer.hidden) return;
    event.preventDefault();
    composer.classList.add("dropping");
  });
  document.addEventListener("dragleave", function (event) {
    if (!event.relatedTarget) composer.classList.remove("dropping");
  });
  document.addEventListener("drop", function (event) {
    if (composer.hidden) return;
    event.preventDefault();
    composer.classList.remove("dropping");
    var files = event.dataTransfer ? event.dataTransfer.files : null;
    if (!files || !files.length) return;
    revealComposer();
    addFiles(files);
  });
  input.addEventListener("input", grow);
  input.addEventListener("input", function () { noteRefusal(""); });
  // Terminal-style history: Up on the first line recalls earlier messages,
  // newest first; Down walks back and finally restores the draft.
  var recall = { list: [], index: -1, draft: "" };
  function captainHistory() {
    var list = [];
    main.querySelectorAll(".msg.user .body").forEach(function (body) {
      var text = (body.innerText || body.textContent || "").trim();
      if (text && text !== list[list.length - 1]) list.push(text);
    });
    return list;
  }
  function setRecalled(text) {
    typingPredictions.reset();
    input.value = text;
    grow();
    input.setSelectionRange(text.length, text.length);
  }
  commandMenu(input, document.getElementById("commands"), function () { typingPredictions.reset(); grow(); });

  input.addEventListener("keydown", function (event) {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); return; }
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    var value = input.value;
    if (event.key === "ArrowUp") {
      var onFirstLine = value.lastIndexOf("\\n", input.selectionStart - 1) === -1;
      if (!onFirstLine) return;
      if (recall.index === -1) {
        recall.list = captainHistory();
        if (!recall.list.length) return;
        recall.draft = value;
        recall.index = recall.list.length;
      }
      if (recall.index === 0) { event.preventDefault(); return; }
      event.preventDefault();
      recall.index -= 1;
      setRecalled(recall.list[recall.index]);
    } else if (event.key === "ArrowDown") {
      if (recall.index === -1) return;
      var onLastLine = value.indexOf("\\n", input.selectionEnd) === -1;
      if (!onLastLine) return;
      event.preventDefault();
      recall.index += 1;
      if (recall.index >= recall.list.length) {
        recall.index = -1;
        setRecalled(recall.draft);
      } else {
        setRecalled(recall.list[recall.index]);
      }
    }
  });
  // Editing a recalled message makes it the draft.
  input.addEventListener("input", function () { recall.index = -1; });

  function pendingMessage(text, sending) {
    var el = document.createElement("article");
    el.className = "msg user pending fresh";
    var time = document.createElement("span");
    time.className = "time";
    el.appendChild(time);
    var body = document.createElement("div");
    body.className = "body";
    var hl = document.createElement("span");
    hl.className = "hl";
    hl.textContent = text;
    if (text) body.appendChild(hl);
    el.appendChild(body);
    var images = sending.filter(function (attachment) { return !attachment.name; });
    var names = sending.filter(function (attachment) { return attachment.name; }).map(function (attachment) { return attachment.name; });
    if (images.length) el.appendChild(shots(images.map(function (image) { return image.url; })));
    if (names.length) el.appendChild(docs(names));
    // Said the moment he sends: Flyd has it, before anything else is known.
    var state = document.createElement("span");
    state.className = "queued state";
    state.setAttribute("role", "status");
    setLine(state, ${JSON.stringify(RECEIVED)});
    el.appendChild(state);
    main.insertBefore(el, working);
    document.getElementById("empty").hidden = true;
    return el;
  }

  // A tiny electronic blip when a message goes out: synthesized, no file.
  var audio = null;
  function wakeAudio() {
    try {
      var Context = window.AudioContext || window.webkitAudioContext;
      if (!audio && Context) audio = new Context();
      if (audio && audio.state === "suspended") audio.resume();
    } catch (e) { audio = null; }
  }
  function blip() {
    if (!audio) return;
    try {
      var t = audio.currentTime;
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1500, t);
      osc.frequency.exponentialRampToValueAtTime(950, t + 0.07);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    } catch (e) { /* sound is a nicety */ }
  }

  // A send whose answer never came may still have landed: when the view answers
  // straight after, he is told it may not have sent and resends it himself;
  // when it does not, it was not sent.
  function deliver(payload) {
    return authed("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: payload }, true).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || "not sent");
        if (data.routineSuggestion) {
          document.querySelector("#routines-link .prefs-about").textContent = "A repeated request is ready to keep";
          document.getElementById("routine-suggestion").hidden = false;
        }
        return data;
      });
    }, function (error) {
      return fetch("/api/token").then(function () { return { unsure: true }; }, function () { throw error; });
    });
  }

  // Push-to-talk from Flyd.app: the words appear in the box as they are
  // heard and go out on release like a typed message. Whatever was typed
  // before stays in front of them.
  var voiceBase = null;
  // Speaking while a reply box is open fills that box, and sends it, instead of the message box.
  var voiceInput = null;
  function voiceField() { return voiceInput || input; }
  function joinVoice(text) {
    return voiceBase && voiceBase.trim() ? voiceBase.trimEnd() + " " + text : text;
  }
  function voiceShow() {
    var field = voiceField();
    if (field === input) grow(); else field.dispatchEvent(new Event("input"));
  }
  function endVoice() {
    composer.classList.remove("listening", "transcribing");
    voiceBase = null;
    voiceInput = null;
  }
  window.flydVoice = {
    start: function () {
      typingPredictions.reset();
      var active = document.activeElement;
      voiceInput = active && active.classList && active.classList.contains("reply-input") ? active : null;
      // Speaking is conversation: the terminal comes back for it, this once.
      if (!voiceInput && onShow()) applyScreen("terminal", false);
      if (!voiceInput && composer.hidden) return;
      voiceBase = voiceField().value;
      if (voiceInput) return;
      composer.classList.add("listening");
      composer.classList.remove("transcribing");
    },
    draft: function (text) {
      typingPredictions.reset();
      if (voiceBase === null) return;
      voiceField().value = joinVoice(text);
      voiceShow();
    },
    transcribing: function () {
      typingPredictions.reset();
      if (voiceInput) return;
      composer.classList.remove("listening");
      composer.classList.add("transcribing");
    },
    send: function (text) {
      var field = voiceField();
      if (voiceBase === null) voiceBase = field.value;
      field.value = joinVoice(text).trim();
      endVoice();
      if (field !== input) {
        field.dispatchEvent(new Event("input"));
        if (field.value && field.form) field.form.requestSubmit();
        return;
      }
      grow();
      if (!input.value) return;
      // A window that was never shown may still be connecting: wait for the
      // session before sending, rather than dropping the message.
      var tries = 0;
      (function submitWhenReady() {
        if (current) { composer.requestSubmit(); return; }
        if (tries++ < 100) setTimeout(submitWhenReady, 200);
        else problem.textContent = "Not sent: the conversation did not load";
      })();
    },
    cancel: function (message) {
      var field = voiceField();
      if (voiceBase !== null) { field.value = voiceBase; voiceShow(); }
      endVoice();
      if (message) problem.textContent = message;
    },
  };

  // A card from the activity column he is talking about: named over the message box and in front of what he sends.
  var aboutInfo = null;
  var aboutCleared = null;
  function chatAbout(info, onClear) {
    var was = aboutCleared;
    aboutInfo = info || null;
    aboutCleared = info ? onClear || null : null;
    var box = document.getElementById("about");
    var head = document.getElementById("about-head");
    var body = document.getElementById("about-body");
    head.textContent = "";
    body.textContent = "";
    document.getElementById("about-title").textContent = info ? info.title || "" : "";
    box.hidden = !info;
    if (info) {
      var v = kindOf(info.kind);
      box.className = "about tone-" + v.tone;
      head.appendChild(cardIcon(info.kind));
      if (v.word) head.appendChild(el("span", "about-chip", v.word));
      if (info.when) head.appendChild(el("span", "about-when", info.when));
      if (info.body) body.appendChild(info.body);
      box.scrollTop = 0;
    }
    if (info) input.focus();
    else if (was) was();
  }
  document.getElementById("about-clear").addEventListener("click", function () { chatAbout(null); input.focus(); });

  composer.addEventListener("submit", function (event) {
    event.preventDefault();
    noteRefusal("");
    var text = input.value.trim();
    var sending = attachments.slice();
    if ((!text && !sending.length) || !current) return;
    if (aboutInfo && text) {
      text = "About “" + aboutInfo.title + "”" + (aboutInfo.detail && aboutInfo.detail !== aboutInfo.title ? " (" + aboutInfo.detail + ")" : "") + ":\\n\\n" + text;
      chatAbout(null);
    }
    recall.index = -1;
    sentSinceLoad.push(text);
    // Created inside the key press, as browsers require for audio.
    wakeAudio();
    var el = pendingMessage(text, sending);
    refreshWorking();
    sendsInFlight += 1;
    input.value = "";
    attachments = [];
    renderAttachments();
    toBottom();
    var payload = JSON.stringify({
      session: current,
      text: text,
      images: sending.filter(function (a) { return !a.name; }).map(function (image) { return { mediaType: image.mediaType, data: image.data }; }),
      files: sending.filter(function (a) { return a.name; }).map(function (file) { return { name: file.name, data: file.data }; }),
    });
    el.typed = letters(text);
    el.attached = sending.length;
    function send() {
      el.knownIds = new Set(nodes.keys());
      el.sentAt = Date.now();
      deliver(payload).then(function (sent) {
        sendsInFlight -= 1;
        if (sent.unsure) {
          if (arrived(el)) {
            if (!input.value && !attachments.length) saveDraftNow();
            el.remove();
            return;
          }
          var line = el.querySelector(".state");
          el.classList.add("unsure");
          line.classList.add("still");
          living(line, "may not have sent -");
          var resend = document.createElement("button");
          resend.type = "button";
          resend.className = "resend";
          resend.textContent = "tap to resend";
          resend.addEventListener("click", function () {
            resend.remove();
            el.classList.remove("unsure");
            line.classList.remove("still");
            living(line, ${JSON.stringify(RECEIVED)});
            sendsInFlight += 1;
            send();
          });
          line.after(resend);
          return;
        }
        // Landed: the draft it came from goes, unless he has started another.
        if (!input.value && !attachments.length) saveDraftNow();
        blip();
        // Inside Flyd.app the notch island says "sent".
        try { window.webkit.messageHandlers.flyd.postMessage({ sent: true }); } catch (e) { /* in a browser */ }
        // Kept until the message shows up in the conversation itself.
        if (nodes.has(sent.id)) {
          el.remove();
          if (sent.warning) {
            warnings.set(sent.id, "saved, but not passed on yet");
            showWarning(nodes.get(sent.id), warnings.get(sent.id));
          }
          return;
        }
        var state = el.querySelector(".state");
        if (!answersInSession && latestSession && current !== latestSession) {
          // Firstmate answers in its live session; the note is shown there.
          state.classList.add("still");
          living(state, "Sent. It shows in the latest session");
          return;
        }
        el.dataset.wait = sent.id;
        awaiting.add(sent.id);
        if (sent.warning) warnings.set(sent.id, "saved, but not passed on yet");
        living(state, warnings.get(sent.id) || sent.waiting || "Sent");
        carried.set(sent.id, state.dataset.line || state.textContent);
      }).catch(function (error) {
        sendsInFlight -= 1;
        el.classList.add("failed");
        el.querySelector(".state").textContent = "not sent: " + error.message + " (click to dismiss)";
        el.addEventListener("click", function () { el.remove(); });
        if (!input.value && !attachments.length) { input.value = text; attachments = sending; renderAttachments(); }
      });
    }
    send();
  });
  restoreDraft();


`;

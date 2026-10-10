/** Self-contained: rendered into the local page; no provider credentials in JS. */
export function installComposerPredictions(options: {
  input: HTMLTextAreaElement; composer: HTMLFormElement; layer: HTMLElement; prefix: HTMLElement; suffix: HTMLElement; toggle: HTMLButtonElement;
  session: () => string | null; token: () => string; grow: () => void; attached: () => boolean;
}) {
  const { input, composer, layer, prefix, suffix, toggle } = options;
  let enabled = true;
  try { enabled = localStorage.getItem("flyd.predictions") !== "off"; } catch { /* storage unavailable */ }
  let composing = false;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let offer: { id: string; suffix: string; draft: string; session: string } | undefined;
  let accepted: Array<{ id: string; session: string; text: string }> = [];
  function feedback(id: string, session: string, event: string, characters?: number) {
    void fetch("/api/prediction-feedback", { method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": options.token() }, body: JSON.stringify({ id, session, event, characters }) }).catch(() => {});
  }
  function syncToggle() {
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.title = enabled ? "Typing suggestions on · Tab accepts · Escape dismisses" : "Typing suggestions off";
  }
  function clear() {
    revision++; clearTimeout(timer); controller?.abort(); controller = undefined; offer = undefined;
    layer.hidden = true; suffix.textContent = ""; input.removeAttribute("aria-description"); options.grow();
  }
  function eligible() {
    return enabled && !composing && !composer.hidden && document.activeElement === input && !!options.session() && !options.attached()
      && input.selectionStart === input.value.length && input.selectionEnd === input.value.length
      && input.value.trim().length >= 4 && input.value.length <= 2000 && !/^\s*\//.test(input.value) && !/[\n`{}]/.test(input.value);
  }
  function paint() {
    if (!offer || !eligible() || offer.session !== options.session() || offer.draft !== input.value) { clear(); return; }
    prefix.textContent = input.value; suffix.textContent = offer.suffix; layer.hidden = false;
    input.setAttribute("aria-description", "Suggestion: " + offer.suffix + ". Press Tab to accept.");
    options.grow();
    // Reserve space when the suffix wraps onto the next line; CSS retains the
    // textarea's existing viewport-height cap.
    input.style.height = Math.max(input.scrollHeight, layer.scrollHeight) + "px";
    layer.scrollTop = input.scrollTop;
  }
  function schedule() {
    const previous = offer;
    clear();
    if (!eligible()) return;
    // If George types the suggested prefix himself, retain the remaining tail.
    if (previous && previous.session === options.session() && input.value.startsWith(previous.draft) && (previous.draft + previous.suffix).startsWith(input.value)) {
      const remaining = (previous.draft + previous.suffix).slice(input.value.length);
      if (remaining) { offer = { ...previous, draft: input.value, suffix: remaining }; paint(); return; }
    }
    const requestRevision = revision;
    const draft = input.value;
    const session = options.session()!;
    timer = setTimeout(() => {
      if (requestRevision !== revision || !eligible() || draft !== input.value || session !== options.session()) return;
      const request = new AbortController(); controller = request;
      void fetch("/api/predict", { method: "POST", signal: request.signal, headers: { "content-type": "application/json", "x-flyd-view-token": options.token() }, body: JSON.stringify({ session, draft }) })
        .then(r => r.ok ? r.json() : null).then(data => {
          if (request.signal.aborted || requestRevision !== revision || !eligible() || input.value !== draft || options.session() !== session) return;
          const prediction = data?.prediction;
          if (!prediction || typeof prediction.id !== "string" || typeof prediction.suffix !== "string" || !prediction.suffix || prediction.suffix.length > 160 || /[\r\n]/.test(prediction.suffix)) return;
          offer = { id: prediction.id, suffix: prediction.suffix, draft, session }; paint(); feedback(offer.id, session, "shown");
        }).catch(() => {});
    }, 220);
  }
  input.addEventListener("input", () => {
    accepted = accepted.filter(a => {
      if (a.session !== options.session()) return false;
      if (input.value.startsWith(a.text)) return true;
      feedback(a.id, a.session, "edited"); return false;
    });
    schedule();
  });
  input.addEventListener("keydown", event => {
    if (event.isComposing || composing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === "Escape") {
      if (offer) { event.preventDefault(); event.stopImmediatePropagation(); feedback(offer.id, offer.session, "dismissed"); }
      clear(); return;
    }
    if (event.key === "Tab" && offer && eligible() && offer.draft === input.value && offer.session === options.session()) {
      event.preventDefault(); event.stopImmediatePropagation();
      const chosen = offer;
      input.setRangeText(chosen.suffix, input.value.length, input.value.length, "end");
      clear(); feedback(chosen.id, chosen.session, "accepted", chosen.suffix.length);
      accepted.push({ id: chosen.id, session: chosen.session, text: input.value }); accepted = accepted.slice(-20);
      // Normal composer listeners resize/update send; acceptance never submits.
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter"].includes(event.key)) clear();
  }, true);
  input.addEventListener("compositionstart", () => { composing = true; clear(); });
  input.addEventListener("compositionend", () => { composing = false; schedule(); });
  input.addEventListener("blur", clear);
  input.addEventListener("click", clear);
  input.addEventListener("scroll", () => { layer.scrollTop = input.scrollTop; });
  document.addEventListener("selectionchange", () => { if (offer && !eligible()) clear(); });
  composer.addEventListener("submit", () => { clear(); accepted = []; }, true);
  toggle.addEventListener("click", () => { enabled = !enabled; clear(); syncToggle(); try { localStorage.setItem("flyd.predictions", enabled ? "on" : "off"); } catch { /* storage unavailable */ } if (enabled) input.focus(); });
  window.addEventListener("pagehide", clear);
  syncToggle();
  return { reset: () => { clear(); accepted = []; } };
}

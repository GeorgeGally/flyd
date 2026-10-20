// The visual card system: one look for every artefact Flyd shows. An icon tile
// for what kind of thing it is, a status chip, one line for the title, a line
// under it, and a picture where the artefact has one. Shared by the left
// Activity column and the right Artefacts panel so the two never drift. The
// class names are the card vocabulary the conversation cards already use.

export type CardTone = "call" | "live" | "done" | "held" | "ready" | "memory" | "quiet";

export interface KindVisual {
  /** A word or two for the chip: "Done", "Under way", "Your call". */
  word: string;
  /** Which colour family the icon tile and chip take. */
  tone: CardTone;
  /** The icon, as one or more path commands in a 24×24 box, drawn in currentColor. */
  icon: string;
}

// Every kind the left column, the artefact brief and the rail cards send. A kind
// with no entry of its own reads as quiet: a plain dot, no chip, no colour.
const ICON = {
  bell: "M12 3.5a5 5 0 0 0-5 5v3l-1.6 2.9A.6.6 0 0 0 5.9 15h12.2a.6.6 0 0 0 .5-.9L17 11.5v-3a5 5 0 0 0-5-5Z M10 18a2 2 0 0 0 4 0",
  pulse: "M3 12h3.5l2-6 3.5 12 2.2-6H21",
  eye: "M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z",
  check: "M5 12.8l4.2 4.2L19 7.2",
  ready: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z M12 7.5v5l3.2 2",
  pause: "M9.5 6v12M14.5 6v12",
  list: "M8 6.5h11M8 12h11M8 17.5h11 M4.4 6.5h.01M4.4 12h.01M4.4 17.5h.01",
  layers: "M12 3.5l8.5 4.6L12 12.7 3.5 8.1 12 3.5Z M3.7 12.4l8.3 4.5 8.3-4.5 M3.7 16.4l8.3 4.5 8.3-4.5",
  tick: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z M8.4 12.4l2.3 2.3 4.9-5",
  clock: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z M12 7.6V12l3 1.9",
  note: "M6 3.5h8.4L19 8.1v12.4H6z M14.2 3.6v4.6h4.6",
  frame: "M4 5.5h16v13H4z M4 15l3.8-3.8 3.2 3.2 3-3L20 17",
  spark: "M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9L12 3.5Z",
  dot: "M12 12h.01",
} as const;

const V = (word: string, tone: CardTone, icon: keyof typeof ICON): KindVisual => ({ word, tone, icon: ICON[icon] });

export const KIND_VISUALS: Record<string, KindVisual> = {
  // Needs him.
  call: V("Your call", "call", "bell"),
  decided: V("Decided", "call", "bell"),
  waiting: V("Held up", "held", "pause"),
  blocked: V("Held up", "held", "pause"),
  held: V("Held up", "held", "pause"),
  // Moving now.
  live: V("Under way", "live", "pulse"),
  work: V("Under way", "live", "pulse"),
  watching: V("Watching", "live", "eye"),
  ready: V("Ready to land", "ready", "ready"),
  // Finished.
  landed: V("Done", "done", "check"),
  done: V("Done", "done", "check"),
  reviewed: V("Reviewed", "done", "tick"),
  // Waiting its turn.
  next: V("Queued", "quiet", "list"),
  routine: V("Routine", "quiet", "clock"),
  // Notes from the world and from memory.
  news: V("News", "memory", "spark"),
  memory: V("Memory", "memory", "layers"),
  noted: V("Noted", "quiet", "note"),
  // Artefacts themselves.
  preview: V("Preview", "quiet", "frame"),
  image: V("Screenshot", "quiet", "frame"),
  file: V("File", "quiet", "note"),
  clear: { word: "", tone: "quiet", icon: ICON.dot },
};

const QUIET: KindVisual = { word: "", tone: "quiet", icon: ICON.dot };

/** What a kind looks like: its chip word, its colour and its icon. Pure. */
export function kindVisual(kind: string | undefined): KindVisual {
  return (kind && KIND_VISUALS[kind]) || QUIET;
}

// One card look for the whole product. The chip is the only uppercase in the
// interface: a small status label, at the letter-spacing ceiling. Everything
// else stays sentence case, generously spaced, and fades in place (nothing
// moves). Charts and bars sit straight on the column, never in a box of their own.
export const CARD_STYLE = `
/* A card: an icon tile, its words, a quiet cross to put it away. */
.card { position: relative; display: flex; gap: 14px; align-items: flex-start; min-width: 0; padding: 15px 17px 16px; border-radius: 12px; background: var(--tint); animation: card-in 260ms ease both; }
.card-icon { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--faint); color: var(--muted); }
.card-icon svg { display: block; width: 18px; height: 18px; }
.card.tone-call .card-icon { color: var(--k-call); }
.card.tone-live .card-icon { color: var(--k-live); }
.card.tone-done .card-icon { color: var(--k-landed); }
.card.tone-held .card-icon { color: var(--k-waiting); }
.card.tone-ready .card-icon { color: var(--k-ready); }
.card.tone-memory .card-icon { color: var(--accent); }
.card-text { flex: 1; min-width: 0; }
/* The chip: a dot and a word for what kind of thing this is, the one small-caps label in the interface. */
.card-meta { display: flex; align-items: center; gap: 8px; font: 500 12px/1.4 var(--sans); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.card-meta::before { content: ""; flex: none; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.card.tone-call .card-meta { color: var(--k-call); }
.card.tone-live .card-meta { color: var(--k-live); }
.card.tone-done .card-meta { color: var(--k-landed); }
.card.tone-held .card-meta { color: var(--k-waiting); }
.card.tone-ready .card-meta { color: var(--k-ready); }
.card.tone-memory .card-meta { color: var(--accent); }
.card.tone-quiet .card-meta::before { background: var(--muted); }
.card-when { margin-left: auto; font: 500 12px/1.4 var(--sans); letter-spacing: 0.02em; color: var(--muted); text-transform: none; font-variant-numeric: tabular-nums; }
.card-line { margin: 8px 0 0; font: 500 16px/1.4 var(--sans); color: var(--strong); text-wrap: pretty; overflow-wrap: anywhere; }
.card-meta + .card-line { margin-top: 7px; }
.card-sub { margin: 6px 0 0; font: 400 15px/1.45 var(--sans); color: var(--fg); text-wrap: pretty; overflow-wrap: anywhere; }
.card-link { display: inline-block; margin-top: 10px; font: 500 15px/1.4 var(--sans); color: var(--link); text-decoration: none; transition: color 140ms ease; }
.card-link:hover { color: var(--strong); }
.card-thumb { flex: none; margin: 0; padding: 0; border: 0; background: none; cursor: zoom-in; line-height: 0; border-radius: 8px; }
.card-thumb img { display: block; width: 108px; height: 72px; object-fit: cover; border-radius: 8px; }
.card-thumb:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
/* A card he can open: the pointer says so, and a quiet wash of its own colour answers the hover. */
.card.is-expandable { cursor: pointer; transition: background 140ms ease; }
.card.is-expandable:hover { background: color-mix(in srgb, var(--tint) 52%, var(--faint)); }
.card.is-expandable:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.card-detail { margin: 12px 0 0; padding-top: 11px; border-top: 1px solid var(--faint); }
.card-detail[hidden] { display: none; }
.card-detail-when { margin: 0; font: 500 12px/1.4 var(--sans); letter-spacing: 0.02em; color: var(--muted); font-variant-numeric: tabular-nums; }
.card-detail-text { margin: 6px 0 0; font: 400 14px/1.5 var(--sans); color: var(--fg); text-wrap: pretty; overflow-wrap: anywhere; }
/* The actual stories behind a news card, each with its gist and where it came from. */
.card-stories { margin: 8px 0 0; padding: 0; list-style: none; }
.card-stories li + li { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--faint); }
.card-story-head { margin: 0; font: 500 15px/1.4 var(--sans); color: var(--link); text-decoration: none; text-wrap: pretty; }
.card-story-head:hover { color: var(--strong); }
.card-story-line { margin: 5px 0 0; font: 400 14px/1.5 var(--sans); color: var(--fg); text-wrap: pretty; }
.card-story-src { margin: 5px 0 0; font: 500 12px/1.4 var(--sans); letter-spacing: 0.02em; color: var(--muted); }
/* Putting a card away: a quiet cross that shows on hover, a colour tween, nothing moves. */
.card-dismiss { position: absolute; top: 11px; right: 11px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 7px; background: none; cursor: pointer; font: 400 16px/24px var(--sans); color: var(--muted); opacity: 0; transition: opacity 140ms ease, color 140ms ease; }
.card .card-dismiss { right: 11px; }
.card:hover .card-dismiss, .card-dismiss:focus-visible { opacity: 1; }
.card-dismiss:hover { color: var(--strong); }
.card-dismiss:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.card.leaving { opacity: 0; transition: opacity 200ms ease; }
@keyframes card-in { from { opacity: 0; } to { opacity: 1; } }
/* A little bar chart of the week: the bars sit on the column itself, no panel. */
.mini-bars { display: flex; align-items: flex-end; gap: 6px; height: 36px; margin: 0; padding: 0; }
.mini-bars i { flex: 1; min-width: 0; height: 4px; border-radius: 3px; background: var(--faint); }
.mini-bars i.on { background: var(--accent); }
.mini-bars i.today { background: var(--k-live); }
`;

// The script half: it runs inside the page's closure and borrows its el() and
// store(). It builds one card from a plain item and remembers what he has put
// away. Kept tiny on purpose: the pages own their layout, this owns the look.
export const CARD_SCRIPT = `
  var KIND_ICONS = ${JSON.stringify(Object.fromEntries(Object.entries(KIND_VISUALS).map(([kind, visual]) => [kind, { word: visual.word, tone: visual.tone, icon: visual.icon }])))};
  function kindOf(kind) { return KIND_ICONS[kind] || { word: "", tone: "quiet", icon: "M12 12h.01" }; }
  function cardIcon(kind) {
    var v = kindOf(kind);
    var tile = el("span", "card-icon");
    tile.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + v.icon + '"/></svg>';
    return tile;
  }
  // What he has put away, by card key, kept across reloads. Shared with the brief cards.
  function cardRead(key) { try { return JSON.parse(store(key) || "{}") || {}; } catch (e) { return {}; } }
  function cardGone(key) { return !!cardRead("flyd-dismissed")[key]; }
  function cardDismiss(key) {
    var gone = cardRead("flyd-dismissed");
    gone[key] = Date.now();
    var keys = Object.keys(gone).sort(function (a, b) { return gone[b] - gone[a]; }).slice(0, 300);
    var kept = {};
    keys.forEach(function (k) { kept[k] = gone[k]; });
    store("flyd-dismissed", JSON.stringify(kept));
  }
  // A card: an icon tile, a status chip with the time on its right, one line, a line under it, a picture, a link, and — where it has more to say — a detail that unfolds in place.
  function visualCard(item, opts) {
    opts = opts || {};
    var kind = item.kind || opts.kind || "clear";
    var v = kindOf(kind);
    var unfold = opts.detail !== undefined || opts.detailWhen || opts.extra;
    var card = el("li", "card card-" + kind + " tone-" + v.tone + (opts.className ? " " + opts.className : "") + (unfold ? " is-expandable" : "") + (unfold && opts.open ? " is-open" : ""));
    card.dataset.key = opts.key;
    card.appendChild(cardIcon(kind));
    var text = el("div", "card-text");
    var chip = el("span", "card-meta", v.word || opts.chip || "");
    var when = opts.when !== undefined ? opts.when : item.at || "";
    if (when) chip.appendChild(el("span", "card-when" + (opts.whenClass ? " " + opts.whenClass : ""), when));
    if (v.word || opts.chip || when) text.appendChild(chip);
    var title = el("p", "card-line", item.title || item.headline || "");
    if (opts.titleClass) title.className += " " + opts.titleClass;
    text.appendChild(title);
    var sub = opts.line !== undefined ? opts.line : item.line;
    if (sub) {
      var p = el("p", "card-sub", sub);
      if (opts.lineClass) p.className += " " + opts.lineClass;
      text.appendChild(p);
    }
    if (item.url) {
      var a = el("a", "card-link", (opts.linkLabel || "Open") + " ↗");
      a.href = item.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      text.appendChild(a);
    }
    if (unfold) {
      var detail = el("div", "card-detail");
      if (opts.detailWhen) detail.appendChild(el("p", "card-detail-when", opts.detailWhen));
      if (opts.detail) detail.appendChild(el("p", "card-detail-text", opts.detail));
      if (opts.extra) detail.appendChild(opts.extra);
      // A card that opens somewhere else (the activity pane) never unfolds in place.
      detail.hidden = opts.onOpen ? true : !opts.open;
      text.appendChild(detail);
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-expanded", String(!!opts.open));
      // It unfolds here and now, so the card never blinks; the caller only
      // remembers which cards are open, so that survives the next re-render.
      function setOpen(open) {
        card.classList.toggle("is-open", open);
        detail.hidden = !open;
        card.setAttribute("aria-expanded", String(open));
        if (opts.onToggle) opts.onToggle(open);
      }
      card.addEventListener("click", function (event) {
        var hit = event.target;
        if (hit && hit.closest && (hit.closest(".card-dismiss") || hit.closest("a") || hit.closest("button, input, textarea, select, form"))) return;
        // Reading the card's own words by dragging over them is not a click to open it.
        var sel = window.getSelection && window.getSelection();
        if (sel && !sel.isCollapsed && sel.anchorNode && card.contains(sel.anchorNode)) return;
        if (opts.onOpen) opts.onOpen(); else setOpen(detail.hidden);
      });
      card.addEventListener("keydown", function (event) {
        if (event.target !== card) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (opts.onOpen) opts.onOpen(); else setOpen(detail.hidden);
      });
    }
    card.appendChild(text);
    if (opts.dismiss) {
      var close = el("button", "card-dismiss", "✕");
      close.type = "button";
      close.setAttribute("aria-label", "Hide this");
      close.addEventListener("click", function () {
        cardDismiss(opts.key);
        card.classList.add("leaving");
        setTimeout(function () { if (opts.onHide) opts.onHide(); else card.remove(); }, 220);
      });
      card.appendChild(close);
    }
    if (opts.chat && SEND_TOKEN) {
      var context = { title: item.title || item.headline || opts.kind || "Sidebar item" };
      var line = opts.line || item.line;
      var aboutDetail = opts.detail || item.detail;
      if (line) context.line = line;
      if (aboutDetail) context.detail = aboutDetail;
      if (item.url) context.url = item.url;
      var chat = sidebarChat("flyd-card:" + opts.key, { about: context });
      text.appendChild(chat.opener);
      text.appendChild(chat.form);
    }
    return card;
  }
`;

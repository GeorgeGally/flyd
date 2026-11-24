/* Rendering and interaction shared by the three briefing takes.
   Every take shows the same four things: outcomes, experiments under way,
   decisions made with a one-line why, and creative reviews. */

window.BRIEFUI = (() => {
  const B = window.BRIEF;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const byId = (list, id) => list.find((x) => x.id === id);

  // Small drawn stand-ins for proof thumbnails.
  const thumbs = {
    pixel: '<rect class="a" x="10" y="10" width="34" height="6" rx="1.5"/><rect class="a" x="10" y="21" width="56" height="3" rx="1.5"/><rect class="a" x="10" y="28" width="48" height="3" rx="1.5"/><rect class="a" x="10" y="35" width="52" height="3" rx="1.5"/>' +
      [[38, 0], [45.6, 0], [53.2, 0], [60.8, 0], [68.4, 0], [45.6, 9.3], [53.2, 9.3], [60.8, 9.3], [68.4, 9.3], [53.2, 18.6], [60.8, 18.6], [68.4, 18.6], [60.8, 27.9], [68.4, 27.9], [68.4, 37.2], [60.8, 46.5], [68.4, 46.5]]
        .map(([x, y]) => `<rect class="k" x="${x}" y="${y}" width="7.6" height="9.3"/>`).join(""),
    phone: '<rect class="s" x="26" y="5" width="24" height="46" rx="4"/><circle class="b" cx="38" cy="20" r="6"/><rect class="a" x="31" y="30" width="14" height="3" rx="1.5"/><rect class="a" x="30" y="36" width="16" height="2.5" rx="1.25"/><rect class="a" x="30" y="41" width="12" height="2.5" rx="1.25"/>',
    list: [10, 22, 34].map((y) => `<rect class="b" x="10" y="${y}" width="10" height="8" rx="1.5"/><rect class="a" x="25" y="${y}" width="40" height="3" rx="1.5"/><rect class="a" x="25" y="${y + 5}" width="28" height="2.5" rx="1.25"/>`).join(""),
    page: '<rect class="b" x="10" y="10" width="44" height="7" rx="1.5"/>' + [23, 29, 35, 41].map((y, i) => `<rect class="a" x="10" y="${y}" width="${[56, 50, 54, 32][i]}" height="3" rx="1.5"/>`).join(""),
    chart: '<polyline class="s" points="8,42 18,38 26,40 34,30 42,33 50,22 58,25 68,14"/><rect class="a" x="8" y="47" width="60" height="1.5"/>',
  };
  const thumb = (kind) => `<div class="thumb"><svg viewBox="0 0 76 56" aria-hidden="true">${thumbs[kind] || ""}</svg></div>`;

  // Pixel transition: a 10x6 grid whose per-block delay shapes the move.
  const seeded = (i) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };
  const delay = {
    rise: (r, c, i) => (5 - r) * 0.09 + seeded(i) * 0.06,
    scatter: (r, c, i) => seeded(i) * 0.7,
    sweep: (r, c) => (r + c) * 0.045,
  };
  function pixelArt(opt) {
    let cells = "";
    for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) {
      const i = r * 10 + c;
      cells += `<b style="--d:${delay[opt].call(null, r, c, i).toFixed(3)}"></b>`;
    }
    return `<div class="px" data-px><div class="pg"><i></i><i></i><i></i><i></i></div><div class="grid">${cells}</div></div>`;
  }
  const heroArt = (o) => `<div class="hero"><b>${esc(o.line)}</b><i></i></div>`;
  const art = (r, o) => (r.kind === "pixel" ? pixelArt(o.id) : heroArt(o));

  // ---- sections ----
  function outcomes(list, { project = true } = {}) {
    return `<div class="outcomes">${list.map((o) => `
      <div class="outcome rv" data-outcome="${o.id}">
        ${thumb(o.thumb)}
        <p class="point">${esc(o.point)}</p>
        <p class="detail">${project ? `<span class="proj">${esc(o.project)}</span> · ` : ""}${esc(o.detail)}</p>
        ${o.wait ? `<p class="wait">${esc(o.wait)}</p>` : ""}
        ${o.action || o.proof ? `<div class="row">
          ${o.action ? `<button class="btn solid" data-act="live" data-id="${o.id}">${esc(o.action.label)}</button>` : ""}
          ${o.proof ? `<a class="link" href="${o.proof}">See the proof</a>` : ""}
        </div>` : ""}
      </div>`).join("")}</div>`;
  }

  function experiments(list, progress = {}, { project = true } = {}) {
    return `<div class="exps">${list.map((e) => {
      const done = progress[e.id] ?? e.done;
      return `<div class="exp rv">
        <div class="head"><span class="name">${esc(e.name)}</span>${project ? `<span class="proj">${esc(e.project)}</span>` : ""}</div>
        <p class="test">${esc(e.test)}</p>
        <div class="bar" role="img" aria-label="${done} of ${e.of} ${e.unit}"><i style="width:${Math.max(3, (done / e.of) * 100)}%"></i></div>
        <div class="meta"><span><b>${done} of ${e.of}</b> ${esc(e.unit)}. ${esc(e.so)}</span><span>${esc(e.reports)}</span></div>
      </div>`;
    }).join("")}</div>`;
  }

  function decisions(list, { project = true } = {}) {
    return `<ul class="decs">${list.map((d) => `
      <li class="dec rv" data-dec="${d.id}">
        <p class="what">${esc(d.what)}</p>
        <button class="link" data-act="reverse" data-id="${d.id}">Reverse</button>
        <p class="why">${esc(d.why)}${project ? ` <span class="proj">· ${esc(d.project)}</span>` : ""}</p>
      </li>`).join("")}</ul>`;
  }

  const picks = {};
  function verdict(r) {
    const cur = byId(r.options, picks[r.id] || r.pick);
    const flyd = byId(r.options, r.pick);
    if (cur.id === flyd.id) {
      return `<p class="pick">Going with ${esc(cur.name)}. ${esc(r.why)}</p>
        <p class="mv">${esc(r.moving)} Work keeps moving; overrule any time by picking another.</p>`;
    }
    return `<p class="pick">Switched to ${esc(cur.name)}. Flyd had picked ${esc(flyd.name)}.</p>
      <p class="mv">Work now moves on ${esc(cur.name)}. ${esc(flyd.name)} is kept.</p>
      <button class="link" data-act="pick" data-review="${r.id}" data-opt="${flyd.id}">Back to ${esc(flyd.name)}</button>`;
  }
  function review(r, { question = true } = {}) {
    const cur = picks[r.id] || r.pick;
    return `<div class="review rv" data-review="${r.id}">
      ${question ? `<p class="q">${esc(r.question)}</p><p class="proj">${esc(r.project)}</p>` : ""}
      <div class="opts${r.kind === "hero" ? " hero-kind" : ""}">${r.options.map((o) => `
        <button class="opt${o.id === cur ? " on" : ""}" data-act="pick" data-review="${r.id}" data-opt="${o.id}" aria-pressed="${o.id === cur}">
          <div class="art">${art(r, o)}</div>
          <span class="nm">${esc(o.name)}${o.id === r.pick ? '<span class="tag">Flyd’s pick</span>' : ""}</span>
          <span class="ln">${esc(o.line)}</span>
        </button>`).join("")}</div>
      <div class="verdict">${verdict(r)}</div>
    </div>`;
  }

  // ---- interaction ----
  function play(px, ms = 3600) {
    if (!px) return;
    px.classList.add("play");
    clearTimeout(px._t);
    px._t = setTimeout(() => px.classList.remove("play"), ms);
  }

  // Delegated handlers. `on(type, data)` lets a take answer in its own way.
  function bind(root, on = () => {}) {
    root.addEventListener("click", (ev) => {
      const el = ev.target.closest("[data-act]");
      if (!el || !root.contains(el)) return;
      const act = el.dataset.act;
      if (act === "pick") {
        const r = byId(B.reviews, el.dataset.review);
        const prev = picks[r.id] || r.pick;
        picks[r.id] = el.dataset.opt;
        document.querySelectorAll(`.review[data-review="${r.id}"]`).forEach((box) => {
          box.querySelectorAll(".opt").forEach((o) => {
            const on = o.dataset.opt === picks[r.id];
            o.classList.toggle("on", on); o.setAttribute("aria-pressed", on);
          });
          box.querySelector(".verdict").innerHTML = verdict(r);
          play(box.querySelector(`.opt[data-opt="${picks[r.id]}"] [data-px]`));
        });
        if (prev !== picks[r.id]) on("pick", { review: r, option: byId(r.options, picks[r.id]), back: picks[r.id] === r.pick });
      } else if (act === "reverse") {
        const li = el.closest(".dec");
        const d = byId(B.decisions, el.dataset.id);
        const rev = !li.classList.contains("reversed");
        document.querySelectorAll(`.dec[data-dec="${d.id}"]`).forEach((x) => {
          x.classList.toggle("reversed", rev);
          x.querySelector("[data-act]").textContent = rev ? "Restore" : "Reverse";
        });
        on("reverse", { decision: d, reversed: rev });
      } else if (act === "live") {
        const o = byId(B.outcomes, el.dataset.id);
        el.disabled = true; el.textContent = o.action.done;
        on("live", { outcome: o });
      }
    });
    root.addEventListener("pointerover", (ev) => {
      const opt = ev.target.closest(".opt");
      if (opt && ev.pointerType === "mouse") play(opt.querySelector("[data-px]"), 2400);
    });
  }

  // Blocks slide on first, then their contents follow one at a time.
  function reveal(root, step = 90, start = 0) {
    const items = [...root.querySelectorAll(".rv:not(.in)")];
    items.forEach((el, i) => setTimeout(() => el.classList.add("in"), start + i * step));
    return start + items.length * step;
  }

  const forProject = (list, p) => list.filter((x) => x.project === p);

  return { B, esc, byId, thumb, art, pixelArt, outcomes, experiments, decisions, review, bind, reveal, play, forProject, picks };
})();

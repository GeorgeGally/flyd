// Shared rendering for the proof prototypes.
(function () {
  const params = new URLSearchParams(location.search);
  const exKey = params.get('ex') === 'liesel' ? 'liesel' : 'capfive';
  const set = window.PROOF_SETS[exKey];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (v, of) => (v / of) * 100 + '%';

  function marksSvg(item, marks, showCols) {
    const { w, h } = item;
    let s = `<svg class="marks" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">`;
    if (showCols && item.cols) {
      for (const [a, b] of item.cols) s += `<rect x="${a}" y="0" width="${b - a}" height="${h}" fill="var(--mark)" opacity=".1"/>`;
    }
    for (const m of marks) {
      const dash = m.quiet ? 'stroke-dasharray="6 5"' : '';
      const sw = m.quiet ? 1.5 : 2.5;
      const common = `stroke="var(--mark)" stroke-width="${sw}" vector-effect="non-scaling-stroke" fill="none" ${dash}`;
      if (m.t === 'box') {
        const p = Math.max(4, w / 90);
        s += `<rect x="${m.x - p}" y="${m.y - p}" width="${m.w + p * 2}" height="${m.h + p * 2}" rx="${p * 1.6}" ${common}/>`;
      } else if (m.t === 'vline') {
        s += `<line x1="${m.x}" x2="${m.x}" y1="0" y2="${h}" ${common}/>`;
      } else if (m.t === 'hline') {
        s += `<line x1="${m.x1}" x2="${m.x2}" y1="${m.y}" y2="${m.y}" ${common}/>`;
      } else if (m.t === 'span') {
        const tk = h * 0.012;
        s += `<path d="M${m.x1} ${m.y - tk} V${m.y + tk} M${m.x1} ${m.y} H${m.x2} M${m.x2} ${m.y - tk} V${m.y + tk}" ${common}/>`;
      }
    }
    return s + '</svg>';
  }

  function labelsHtml(item, marks) {
    const { w, h } = item;
    let s = '<div class="labels">';
    for (const m of marks) {
      if (!m.label) continue;
      let left, top, tf = '';
      const q = m.quiet ? ' quiet' : '';
      if (m.t === 'box') {
        left = pct(m.x, w);
        if (m.at === 'above') { top = pct(m.y, h); tf = 'translateY(calc(-100% - 10px))'; }
        else if (m.at === 'inside-right') { left = pct(m.x + m.w, w); top = pct(m.y + m.h / 2, h); tf = 'translate(calc(-100% - 10px), -50%)'; }
        else if (m.at === 'inside-top-right') { left = pct(m.x + m.w, w); top = pct(m.y, h); tf = 'translate(calc(-100% - 12px), 12px)'; }
        else if (m.at === 'inside-bottom') { left = `calc(${pct(m.x, w)} + 12px)`; top = pct(m.y + m.h, h); tf = 'translateY(calc(-100% - 12px))'; }
        else { top = pct(m.y + m.h, h); tf = 'translateY(10px)'; }
      } else if (m.t === 'vline') {
        left = `calc(${pct(m.x, w)} + 8px)`;
        if (m.at === 'top') { top = '12px'; } else { top = 'calc(100% - 12px)'; tf = 'translateY(-100%)'; }
      } else if (m.t === 'hline') {
        left = pct(m.x1, w);
        if (m.at === 'below') { top = pct(m.y, h); tf = 'translateY(8px)'; }
        else { top = pct(m.y, h); tf = 'translateY(calc(-100% - 8px))'; }
      } else if (m.t === 'span') {
        left = pct((m.x1 + m.x2) / 2, w); top = pct(m.y, h); tf = 'translate(-50%, calc(-100% - 10px))';
      }
      s += `<span class="chip${q}" style="left:${left};top:${top};transform:${tf}">${esc(m.label)}</span>`;
    }
    return s + '</div>';
  }

  // One cropped image with its marks. side: 'before' | 'after'
  function figure(item, side, opts = {}) {
    const marks = side === 'before' ? item.marksBefore : item.marksAfter;
    const cap = opts.caption === false ? '' : `<figcaption>${side === 'before' ? 'Before' : 'After'}</figcaption>`;
    return `<figure class="shot ${item.device} ${opts.small ? 'small' : ''}" style="${opts.style || ''}">
      <div class="frame"><img class="base" src="${item[side]}" alt="${side} — ${esc(item.headline)}" loading="lazy" width="${item.w}" height="${item.h}">
      ${opts.marks === false ? '' : marksSvg(item, marks, side === 'before' || side === 'after') + labelsHtml(item, marks)}</div>${cap}</figure>`;
  }

  function locator(item, size = 56) {
    const ratio = item.ctxH / item.ctxW;
    const H = ratio > 1 ? 72 : Math.round(size * 1.6 * ratio);
    const W = ratio > 1 ? Math.round(72 / ratio) : Math.round(size * 1.6);
    const [x, y, bw, bh] = item.ctxBox;
    return `<a class="locator" href="${item.live}" target="_blank" rel="noopener">
      <span class="mini" style="width:${W}px;height:${H}px"><img src="${item.ctx}" alt=""><i style="left:${x}%;top:${y}%;width:${bw}%;height:${bh}%"></i></span>
      <span>${esc(item.page)} <span aria-hidden="true">↗</span></span></a>`;
  }

  function said(item) {
    return item.note ? `<p class="said">Your note ${esc(item.note)}: <q>${esc(item.said)}</q></p>` : '';
  }

  function protoBar(take) {
    const takes = [['slides', 'A · Slides'], ['wipe', 'B · Wipe'], ['sheet', 'C · One page']];
    const other = exKey === 'capfive' ? 'liesel' : 'capfive';
    const bar = document.createElement('nav');
    bar.className = 'proto-bar';
    bar.innerHTML = `<a href="index.html">Index</a>` +
      takes.map(([k, l]) => `<a class="${k === take ? 'on' : ''}" href="${k}.html?ex=${exKey}">${l}</a>`).join('') +
      `<a href="${take}.html?ex=${other}">${other === 'liesel' ? 'Liesel review →' : 'CapFive phone →'}</a>`;
    document.body.appendChild(bar);
  }

  window.Proof = { set, exKey, esc, figure, locator, said, protoBar };
})();

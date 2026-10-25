/**
 * Five looks for the front page at the weight of George's Elasti reference
 * (lab 7): one quiet light behind everything, glass where the open job sits,
 * small mono words at the edges, nothing louder than the job. Each look is
 * the same working page; only its light, ink and arrangement change.
 * Chosen in Preferences (or ?skin=1…5) and kept in localStorage; with none
 * chosen the page keeps front-style.ts as it is. Comes after FRONT_STYLE so
 * equal selectors here win.
 */
const S = ':root[data-layout="front"][data-skin]';
const K = (n: number) => `:root[data-layout="front"][data-skin="${n}"]`;

export const SKINS_STYLE = `
/* Shared: the light, the type, glass instead of paper. */
${S} {
  --gut: 24px; --jobs-w: 250px; --arts-w: 268px; --head-h: 64px;
  --sk-mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace;
  background: var(--sk-base);
}
${S} body { background: transparent; }
${S} body::before { content: ""; position: fixed; inset: -12%; z-index: -2; pointer-events: none; background: var(--sk-light); filter: blur(42px); }
${S} header { background: transparent; }
${S} header .who { font-weight: 400; font-size: 16px; color: var(--ink); }
${S} .front-date, ${S} header .controls, ${S} header .controls > * { font: 400 11px/1.4 var(--sk-mono) !important; letter-spacing: .04em; text-transform: uppercase; color: var(--mute) !important; }

/* Jobs: a list of words, not a stack of cards. */
${S} .fhead { padding: 4px 0 8px; font: 400 11px/1.4 var(--sk-mono); letter-spacing: .04em; text-transform: uppercase; color: var(--mute); }
${S} .fgroup { margin-bottom: 26px; }
${S} .job { position: relative; margin: 0; padding: 5px 0; border-radius: 0; background: none !important; box-shadow: none !important; }
${S} .job .frame, ${S} .job .m { display: none; }
${S} .job .t { font-weight: 400; font-size: 13.5px; line-height: 1.38; color: var(--ink2); transition: color .2s ease; }
${S} .job:hover .t, ${S} .job.on .t { color: var(--ink); }
${S} .job.on::before { content: ""; position: absolute; left: -12px; top: 8px; width: 4px; height: 4px; border-radius: 50%; background: var(--ink); }
${S} .job.needs .t::after { content: ""; display: inline-block; width: 5px; height: 5px; margin-left: 7px; border-radius: 50%; background: var(--hot); vertical-align: 2px; }
${S} .fmore, ${S} .fempty { padding-left: 0; font: 400 11px/1.4 var(--sk-mono); letter-spacing: .04em; text-transform: uppercase; color: var(--mute); }
${S} .jobs .history-group summary, ${S} .jobs .history-item { padding-left: 0; font-size: 13px; }

/* The open job: one pane of glass. */
${S} .sheet { background: var(--sk-glass); border-radius: 12px; box-shadow: inset 0 0 0 1px var(--sk-edge);
  backdrop-filter: blur(20px) saturate(1.05); -webkit-backdrop-filter: blur(20px) saturate(1.05); }
${S} .sheet-foot { display: none !important; }
${S} .stage-head, ${S} .composer { background: transparent; }
${S} .stage-head { padding: 30px 34px 14px; }
${S} .crumb { font: 400 11px/1.4 var(--sk-mono); letter-spacing: .04em; text-transform: uppercase; color: var(--mute); }
${S} .crumb .s { color: var(--ink2); }
${S} .stage-head h1 { font-weight: 400; font-size: 19px; line-height: 1.3; letter-spacing: -.005em; }
${S} main, ${S}[data-job] .job-view { font-size: 15px; }
${S} main { padding-left: 34px !important; padding-right: 34px !important; }
${S} .composer { padding: 12px 34px 22px; }
${S} .composer .field { background: var(--sk-field); border-radius: 8px; }
${S} .composer .field:focus-within { background: var(--sk-field-on); }
${S} .composer #send, ${S} .job-view .art-chat-send { height: 28px; padding: 0 11px; border-radius: 4px; font: 400 11px/1 var(--sk-mono); letter-spacing: .04em; text-transform: uppercase; background: var(--sk-btn); color: var(--sk-btn-ink); }
${S} .inline-card, ${S} .jv-plain, ${S} .job-view .art-chat-field { background: var(--sk-field); }
${S} .jv-view { background: var(--sk-field); }
${S} .jv-lead, ${S} .jv-msg p { color: var(--ink2); }
${S} .fbtn, ${S} .job-view .choice-pick { height: 28px; min-height: 28px; padding: 0 11px; border-radius: 4px; box-shadow: inset 0 0 0 1px var(--sk-edge); font: 400 11px/1 var(--sk-mono); letter-spacing: .04em; text-transform: uppercase; color: var(--ink); }
${S} .jv-acts .fbtn:first-child { background: var(--sk-btn); color: var(--sk-btn-ink); box-shadow: none; }
${S} .ver:hover, ${S} .ver.on { background: var(--sk-field); }

/* Artefacts: glass tiles, small type. */
${S} .rail .brief-label, ${S} .rail .brief-more { font: 400 11px/1.4 var(--sk-mono); letter-spacing: .04em; text-transform: uppercase; color: var(--mute); }
${S} .rail .brief-top { padding: 4px 0 8px; }
${S} .rail .art-card, ${S} .rail .brief-list li:not(.art-card), ${S} .rail .news .card-stories > li { background: var(--sk-glass); box-shadow: inset 0 0 0 1px var(--sk-edge); border-radius: 10px; }
${S} .rail .art-card:hover { background: var(--sk-field-on); }
${S} .rail .art-pic { background: transparent; padding: 6px 6px 0; }
${S} .rail .art-card .art-title, ${S} .rail .brief-line, ${S} .rail .card-story-head { font-weight: 400; font-size: 13px; }
${S} .rail .art-grid > .art-card:first-child .art-title { font-size: 13.5px; }
${S} .rail .brief-meta, ${S} .rail .art-meta { font: 400 10.5px/1.4 var(--sk-mono); letter-spacing: .04em; text-transform: uppercase; }

/* 1 · Dusk: the reference's warm light, a dark shape low right. */
${K(1)}, ${K(4)} {
  --sk-base: #a9583a; --ink: #fff6f0; --ink2: rgba(255,246,240,.82); --mute: rgba(255,246,240,.6); --hot: #ffd2b0;
  --line: rgba(255,240,230,.16); --mat: rgba(255,240,230,.1); --well: rgba(255,240,230,.1); --well-on: rgba(255,240,230,.15);
  --sk-glass: rgba(255,255,255,.1); --sk-edge: rgba(255,255,255,.14); --sk-field: rgba(255,255,255,.1); --sk-field-on: rgba(255,255,255,.15);
  --sk-btn: #fff; --sk-btn-ink: #1d120c;
  --fg: #fff3ea; --strong: #fff; --muted: rgba(255,246,240,.6); --faint: rgba(255,240,230,.16); --tint: rgba(255,255,255,.08); --bg: #8f4a30; --link: #ffe2cc; --sel-bg: rgba(255,255,255,.25); --sel-fg: #fff;
  --sk-light:
    radial-gradient(28% 34% at 74% 80%, rgba(8,8,8,.95), rgba(8,8,8,.7) 40%, transparent 100%),
    radial-gradient(22% 30% at 58% 98%, rgba(10,10,10,.75), transparent 100%),
    radial-gradient(60% 50% at 85% 30%, rgba(196,110,72,.9), transparent 70%),
    radial-gradient(70% 60% at 10% 55%, rgba(178,82,40,.95), transparent 70%),
    linear-gradient(180deg, #ad6448 0%, #b0603e 35%, #a24e2c 62%, #6a2e1a 88%, #4a2214 100%);
}

/* 2 · Night: deep blue, one cold light high left, a dark mass low right. */
${K(2)} {
  --sk-base: #0c1424; --ink: #eef3fb; --ink2: rgba(238,243,251,.8); --mute: rgba(238,243,251,.52); --hot: #8fb8ff;
  --line: rgba(200,215,240,.14); --mat: rgba(200,215,240,.08); --well: rgba(200,215,240,.08); --well-on: rgba(200,215,240,.13);
  --sk-glass: rgba(160,185,230,.08); --sk-edge: rgba(200,215,240,.14); --sk-field: rgba(200,215,240,.08); --sk-field-on: rgba(200,215,240,.13);
  --sk-btn: #eef3fb; --sk-btn-ink: #0b1426;
  --fg: #e3e9f3; --strong: #fff; --muted: rgba(238,243,251,.52); --faint: rgba(200,215,240,.14); --tint: rgba(200,215,240,.07); --bg: #0f1828; --link: #a9c8f5; --sel-bg: rgba(143,184,255,.3); --sel-fg: #fff;
  --sk-light:
    radial-gradient(40% 40% at 18% 12%, rgba(70,110,190,.55), transparent 70%),
    radial-gradient(30% 36% at 78% 82%, rgba(2,4,10,.95), transparent 100%),
    linear-gradient(180deg, #16233f 0%, #101a30 50%, #070b16 100%);
}

/* 3 · Fog: the light one. Pale mist, a grey shape behind the glass, dark ink. */
${K(3)} {
  --sk-base: #e6e4de; --ink: #1a1a17; --ink2: rgba(26,26,23,.78); --mute: rgba(26,26,23,.52); --hot: #d0521f;
  --line: rgba(26,26,23,.1); --mat: rgba(26,26,23,.05); --well: rgba(255,255,255,.55); --well-on: rgba(255,255,255,.75);
  --sk-glass: rgba(255,255,255,.42); --sk-edge: rgba(255,255,255,.8); --sk-field: rgba(255,255,255,.6); --sk-field-on: rgba(255,255,255,.85);
  --sk-btn: #1a1a17; --sk-btn-ink: #f4f3ee;
  --fg: #2b2a27; --strong: #111; --muted: rgba(26,26,23,.52); --faint: rgba(26,26,23,.1); --tint: rgba(255,255,255,.5); --bg: #efeee9; --link: #1f5f99; --sel-bg: #dcd6c8; --sel-fg: #111;
  --sk-light:
    radial-gradient(32% 38% at 72% 78%, rgba(110,112,104,.6), transparent 100%),
    radial-gradient(50% 45% at 15% 20%, rgba(255,255,255,.9), transparent 70%),
    linear-gradient(180deg, #ecebe6 0%, #e2e1da 60%, #d6d5ce 100%);
}

/* 4 · Focus: Dusk's light, one job at a time. The sheet narrows to the middle,
   the jobs list keeps only what needs him, artefacts wait behind the toggle. */
${K(4)} { --c-left: calc(50vw - 300px); --c-right: calc(50vw - 300px); }
${K(4)} .rail { display: none !important; }
${K(4)} .jobs .fgroup:nth-child(n+3), ${K(4)} .jobs .fhistory { display: none; }
${K(4)} .sheet { bottom: 64px; }
${K(4)} .composer { bottom: 64px; }

/* 5 · Ink: near black, one warm light at the top, the dot the only colour;
   artefacts as a contact sheet of pictures without captions. */
${K(5)} {
  --sk-base: #0d0c0b; --ink: #f2efe9; --ink2: rgba(242,239,233,.76); --mute: rgba(242,239,233,.48); --hot: #ff5a2a;
  --line: rgba(242,239,233,.1); --mat: rgba(242,239,233,.05); --well: rgba(242,239,233,.06); --well-on: rgba(242,239,233,.1);
  --sk-glass: rgba(242,239,233,.04); --sk-edge: rgba(242,239,233,.1); --sk-field: rgba(242,239,233,.06); --sk-field-on: rgba(242,239,233,.1);
  --sk-btn: #f2efe9; --sk-btn-ink: #0d0c0b;
  --fg: #e6e2db; --strong: #fff; --muted: rgba(242,239,233,.48); --faint: rgba(242,239,233,.1); --tint: rgba(242,239,233,.05); --bg: #151413; --link: #f0c7a8; --sel-bg: rgba(255,90,42,.3); --sel-fg: #fff;
  --sk-light: radial-gradient(50% 40% at 50% -6%, rgba(150,80,40,.38), transparent 70%), linear-gradient(180deg, #141210, #0b0a09);
}
${K(5)} .rail .art-card > :not(.art-pic) { display: none; }
${K(5)} .rail .art-card { padding: 0; }
${K(5)} .rail .art-pic { margin: 0; padding: 0; }
${K(5)} .rail .art-pic img { filter: grayscale(.85) brightness(.85); transition: filter .2s ease; }
${K(5)} .rail .art-card:hover .art-pic img { filter: none; }

/* The look picker in Preferences. */
.skins { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px 12px; }
.skins-name { flex-basis: 100%; margin-bottom: 2px; font-size: 13px; color: var(--muted); }
.skins button { min-width: 30px; height: 28px; padding: 0 9px; border: 0; border-radius: 6px; background: var(--tint); color: var(--fg); font: 400 12px/1 var(--mono, monospace); cursor: pointer; }
.skins button[aria-pressed="true"] { background: var(--strong); color: var(--bg); }

@media (max-width: 760px) {
  ${S} body::before { inset: 0; }
  ${S} .job.on::before { left: -8px; }
  ${K(4)} { --c-left: 0px; --c-right: 0px; }
}
`;

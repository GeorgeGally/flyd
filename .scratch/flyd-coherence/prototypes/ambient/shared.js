/* Shared fixtures and the live-line engine for the three ambient prototypes.
   Fixture content is drawn from George's real work on 2026-11-24; the job
   steps are scripted so each line visibly changes while you watch. */

window.FLYD = (() => {
  // Each job walks through its steps; `hold` is seconds on that step.
  // tone: "moving" (work under way), "look" (a creative review is ready),
  // "done" (finished, stays quiet), "alert" (one of the four interruptions).
  const jobs = [
    {
      id: "capfive",
      project: "CapFive",
      steps: [
        { text: "Fixing board note 58: the phone portrait", tone: "moving", hold: 5 },
        { text: "Portrait now 216px wide on phone, centred", tone: "moving", hold: 4 },
        { text: "Deploying notes 53–58 to Kinsta", tone: "moving", hold: 5 },
        { text: "Checking six pages live on phone and desktop", tone: "moving", hold: 4 },
        { text: "Live on Kinsta. Six notes closed", tone: "done", hold: 8 },
      ],
    },
    {
      id: "news",
      project: "Flyd news",
      steps: [
        { text: "Finding why news sources keep pausing", tone: "moving", hold: 4 },
        { text: "Offline runs were pausing healthy feeds", tone: "moving", hold: 5 },
        { text: "Fix in. Oversized feeds no longer pause", tone: "moving", hold: 4 },
        { text: "Fixed. Tomorrow's edition runs at 7am", tone: "done", hold: 9 },
      ],
    },
    {
      id: "polybot",
      project: "polybot",
      steps: [
        { text: "Recording BTC windows. 37 resolved today", tone: "moving", hold: 6 },
        { text: "Backtesting the late-window strategy", tone: "moving", hold: 5 },
        { text: "Last 180s taker: +9.75 over 6 trades", tone: "moving", hold: 5 },
        { text: "Too few trades to trust yet. Recording on", tone: "moving", hold: 7 },
      ],
    },
    {
      id: "gg",
      project: "georgegalanakis",
      steps: [
        { text: "Building the pixel transition demo", tone: "moving", hold: 5 },
        { text: "Black blocks now rise from the bottom", tone: "moving", hold: 5 },
        { text: "Ready for your eye: two transition takes", tone: "look", hold: 10 },
      ],
    },
    {
      id: "aat",
      project: "ArtAndTech",
      steps: [
        { text: "Drafting homepage copy from the charter", tone: "moving", hold: 6 },
        { text: "Hero: “We make things that don’t exist yet.”", tone: "moving", hold: 6 },
        { text: "Checking portfolio facts before they go in", tone: "moving", hold: 6 },
      ],
    },
  ];

  // The live-line engine. Subscribers get (job, step, index) on every change.
  function startLive(onChange, { speed = 1, only } = {}) {
    const list = only ? jobs.filter((j) => only.includes(j.id)) : jobs;
    const timers = [];
    list.forEach((job, n) => {
      let i = 0;
      const tick = () => {
        onChange(job, job.steps[i], i);
        const hold = job.steps[i].hold * 1000 / speed;
        i = (i + 1) % job.steps.length;
        timers.push(setTimeout(tick, hold));
      };
      // Stagger starts so lines don't all change at once.
      timers.push(setTimeout(tick, n * 700));
    });
    return () => timers.forEach(clearTimeout);
  }

  // Swap a line's text with a short rise-and-fade, the way mobile assistant
  // status lines change. Keeps the old text in place until the new one lands.
  function swapText(el, text) {
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    if (!el.firstElementChild) {
      el.innerHTML = `<span class="swap-in">${text}</span>`;
      return;
    }
    const old = el.firstElementChild;
    old.classList.remove("swap-in");
    old.classList.add("swap-out");
    const next = document.createElement("span");
    next.className = "swap-in";
    next.textContent = text;
    el.appendChild(next);
    setTimeout(() => old.remove(), 320);
  }

  // Projects for the /flyd overview.
  const projects = [
    {
      id: "capfive",
      name: "CapFive",
      line: "Live on Kinsta. Six notes closed",
      tone: "done",
      items: [
        { kind: "work", title: "Deploy notes 53–58", sub: "To Kinsta, checked on phone and desktop" },
        { kind: "note", title: "Note 58", sub: "My profile phone: portrait 2½ columns, centred" },
        { kind: "note", title: "Note 57", sub: "Sort sits before Year on Deals" },
        { kind: "note", title: "Note 56", sub: "Info icon centred on the empty-list card" },
        { kind: "note", title: "Note 55", sub: "Connect People headline uses shared title" },
        { kind: "artefact", title: "Before / after: My profile", sub: "163px → 216px portrait at 390", shot: "profile" },
        { kind: "artefact", title: "Phone grid", sub: "4 columns, 16 gutter, 24 margin", shot: "grid" },
        { kind: "work", title: "Deal tombstones", sub: "Adviser logos sized by trimmed shape" },
      ],
    },
    {
      id: "polybot",
      name: "polybot",
      line: "Too few trades to trust yet. Recording on",
      tone: "moving",
      items: [
        { kind: "work", title: "Recorder", sub: "37 windows resolved today" },
        { kind: "artefact", title: "Backtest table", sub: "Late-window taker leads, n=6", shot: "chart" },
        { kind: "note", title: "Aug 7 rule change", sub: "5m now resolves on a 30s Chainlink TWAP" },
        { kind: "note", title: "Fees", sub: "Taker only, max 1.75¢ a share at p=0.5" },
        { kind: "work", title: "Calibrate p_up_twap", sub: "Next: Brier per time-left bucket" },
      ],
    },
    {
      id: "gg",
      name: "georgegalanakis",
      line: "Ready for your eye: two transition takes",
      tone: "look",
      items: [
        { kind: "artefact", title: "Pixel transition", sub: "Images pixelate between sections", shot: "pixel" },
        { kind: "artefact", title: "Black blocks rise", sub: "Take two, 14:00", shot: "blocks" },
        { kind: "note", title: "Positioning", sub: "Artist, inventor, founder" },
        { kind: "note", title: "Now section", sub: "DIR, cleanX, Roger" },
      ],
    },
    {
      id: "aat",
      name: "ArtAndTech",
      line: "Checking portfolio facts before they go in",
      tone: "moving",
      items: [
        { kind: "note", title: "North star", sub: "An independent research and invention studio" },
        { kind: "artefact", title: "Homepage copy v1", sub: "“We make things that don’t exist yet.”", shot: "type" },
        { kind: "note", title: "Three models", sub: "Intelligence, Advisory, Experimentation" },
        { kind: "work", title: "Portfolio inventory", sub: "Verifying claims before publication" },
        { kind: "note", title: "Open question", sub: "Crisp Group equity terms not agreed" },
      ],
    },
    {
      id: "flyd",
      name: "Flyd",
      line: "Fixed. Tomorrow's edition runs at 7am",
      tone: "done",
      items: [
        { kind: "work", title: "News sources pausing", sub: "Fixed: offline runs no longer pause feeds" },
        { kind: "work", title: "Chat jumping", sub: "Fixed: append-only, 150-exchange window" },
        { kind: "note", title: "Ambient surface", sub: "This prototype" },
        { kind: "artefact", title: "Token audit", sub: "Relays to firstmate are the biggest cost", shot: "chart" },
      ],
    },
  ];

  // Small drawn stand-ins for screenshots and images, so the prototypes work
  // offline. Each returns an inline SVG sized to fill its box.
  function thumb(kind) {
    const svg = (body, bg = "#ecebe6") =>
      `<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="160" height="100" fill="${bg}"/>${body}</svg>`;
    switch (kind) {
      case "profile":
        return svg(`<rect x="30" y="10" width="40" height="80" rx="6" fill="#fff"/><circle cx="50" cy="38" r="10" fill="#d7d3c8"/><rect x="40" y="56" width="20" height="4" rx="2" fill="#c8c4b8"/>
                    <rect x="90" y="10" width="40" height="80" rx="6" fill="#fff"/><circle cx="110" cy="38" r="15" fill="#c9b98f"/><rect x="98" y="62" width="24" height="4" rx="2" fill="#c8c4b8"/>`);
      case "grid":
        return svg([0, 1, 2, 3].map((i) => `<rect x="${24 + i * 30}" y="12" width="22" height="76" fill="#cfd8dc" opacity=".7"/>`).join(""), "#f3f2ee");
      case "chart":
        return svg([28, 44, 20, 60, 52, 70, 38].map((h, i) => `<rect x="${20 + i * 18}" y="${86 - h}" width="10" height="${h}" rx="2" fill="${i === 5 ? "#3a8f5c" : "#bfc6c1"}"/>`).join(""), "#f3f2ee");
      case "pixel": {
        let s = "";
        for (let x = 0; x < 16; x++) for (let y = 0; y < 10; y++) {
          const v = (Math.sin(x * 1.7 + y * 0.9) + Math.cos(y * 1.3 - x * 0.4)) * 0.25 + 0.5;
          const g = Math.round(90 + v * 140);
          s += `<rect x="${x * 10}" y="${y * 10}" width="10" height="10" fill="rgb(${g},${g - 14},${g - 30})"/>`;
        }
        return svg(s);
      }
      case "blocks": {
        let s = "";
        for (let x = 0; x < 16; x++) {
          const h = Math.round(3 + 6 * Math.abs(Math.sin(x * 0.7)));
          s += `<rect x="${x * 10}" y="${100 - h * 10}" width="10" height="${h * 10}" fill="#111"/>`;
        }
        return svg(s, "#d9cdb4");
      }
      case "type":
        return svg(`<text x="14" y="46" font-family="Georgia, serif" font-size="17" fill="#1c1c1e">We make things</text><text x="14" y="68" font-family="Georgia, serif" font-size="17" fill="#1c1c1e">that don’t exist yet.</text>`, "#f6f3ea");
      case "studio":
        return svg(`<rect x="0" y="62" width="160" height="38" fill="#cbbf9f"/><rect x="18" y="20" width="44" height="42" fill="#efe9dc"/><rect x="74" y="30" width="30" height="32" fill="#3d3a35"/><circle cx="128" cy="40" r="14" fill="#e3b04b"/>`, "#e6e1d6");
      case "video":
        return svg(`<rect x="0" y="0" width="160" height="100" fill="#2b2a28"/><rect x="0" y="70" width="160" height="30" fill="#3a3834"/><circle cx="80" cy="44" r="16" fill="rgba(255,255,255,.9)"/><path d="M75 36 L89 44 L75 52 Z" fill="#2b2a28"/>`);
      case "candles":
        return svg([[20, 40, 60], [36, 30, 55], [52, 44, 66], [68, 26, 50], [84, 34, 58], [100, 20, 44], [116, 28, 48], [132, 16, 38]]
          .map(([x, a, b], i) => `<line x1="${x + 4}" x2="${x + 4}" y1="${a - 8}" y2="${b + 8}" stroke="#8a8a8e"/><rect x="${x}" y="${a}" width="8" height="${b - a}" fill="${i % 3 ? "#3a8f5c" : "#c4473a"}"/>`).join(""), "#f3f2ee");
      default:
        return svg("");
    }
  }

  return { jobs, startLive, swapText, projects, thumb };
})();

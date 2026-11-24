/* Shared placeholder content for the three briefing takes.
   Projects are the kinds named in map.md and the tickets; numbers and wording
   are illustrative, not pulled from live records. */

window.BRIEF = {
  day: "Tuesday",

  // Finished work. `thumb` picks a drawn stand-in; `wait` marks the one thing
  // policy holds for George (client-facing), stated rather than asked.
  outcomes: [
    {
      id: "gg-demo", project: "georgegalanakis", thumb: "pixel",
      point: "The site now moves between projects in one pixel transition",
      detail: "Built on all six case studies. Runs at 60fps on phone.",
    },
    {
      id: "capfive", project: "CapFive", thumb: "phone",
      point: "Board notes 53 to 58 are fixed on staging",
      detail: "Six pages checked on phone and desktop.",
      wait: "Going live waits for you because it is client-facing.",
      action: { label: "Go live", done: "Going live" },
      proof: "../proof/sheet.html?ex=capfive",
    },
    {
      id: "news", project: "Flyd news", thumb: "list",
      point: "All 14 news sources are back for tomorrow's edition",
      detail: "Offline runs were pausing healthy feeds. Fixed and merged.",
    },
    {
      id: "aat-copy", project: "ArtAndTech", thumb: "page",
      point: "Homepage copy is drafted from the founding charter",
      detail: "Every portfolio fact checked against the studio repo.",
    },
  ],

  // Experiments under way: what is being tested, how far along, when it reports.
  experiments: [
    {
      id: "poly", project: "polybot", name: "Late-window taker",
      test: "Does buying in the last 180 seconds beat holding the window?",
      done: 6, of: 30, unit: "trades",
      so: "+9.75 so far. Too few trades to trust.", reports: "Reports at 30 trades, about Friday",
    },
    {
      id: "rank", project: "Flyd news", name: "Ranked by your taste",
      test: "Half of each edition ranked by what you read and kept, half as now.",
      done: 2, of: 5, unit: "editions",
      so: "You opened 4 of 6 taste-ranked stories, 1 of 6 of the others.", reports: "Reports after Saturday's edition",
    },
    {
      id: "gem", project: "Creative review", name: "Gemini beside Opus",
      test: "Both judge the same takes. Whichever agrees with your picks more often stays.",
      done: 4, of: 10, unit: "reviews",
      so: "Agreeing with you 3 of 4 and 2 of 4.", reports: "Reports after 10 reviews",
    },
    {
      id: "gg-time", project: "georgegalanakis", name: "Transition timing",
      test: "600ms against 900ms on the same transition.",
      done: 1, of: 2, unit: "builds",
      so: "600ms is built. 900ms builds tonight.", reports: "Both side by side tomorrow morning",
    },
    {
      id: "aat-order", project: "ArtAndTech", name: "Portfolio order",
      test: "The same work section ordered by year, and by kind of work.",
      done: 1, of: 2, unit: "drafts",
      so: "By year is drafted.", reports: "Both drafts tomorrow",
    },
  ],

  // Decisions made for George: what and one plain why. Each is reversible.
  decisions: [
    { id: "d1", project: "georgegalanakis", what: "Blocks rise from the bottom", why: "A downward fall read as a loading glitch." },
    { id: "d2", project: "ArtAndTech", what: "The homepage leads with the work, not the charter", why: "People judge a studio by what it made. The charter moves to About." },
    { id: "d3", project: "Flyd news", what: "Sources pause after 3 failed days, not 1", why: "One bad day was enough to pause a healthy feed." },
    { id: "d4", project: "CapFive", what: "The phone portrait is capped at 216px", why: "Any wider covered the member's name on small phones." },
    { id: "d5", project: "polybot", what: "polybot stays on paper trading", why: "Six trades is noise. Real money waits for you anyway." },
  ],

  // Creative reviews: options, Flyd's pick and why, and what is already moving on it.
  reviews: [
    {
      id: "pixel", project: "georgegalanakis", kind: "pixel",
      question: "Which transition carries the site",
      options: [
        { id: "rise", name: "Rise", line: "Blocks rise from the bottom, then clear upward" },
        { id: "scatter", name: "Scatter", line: "Pixels land at random and dissolve" },
        { id: "sweep", name: "Sweep", line: "A diagonal sweep, corner to corner" },
      ],
      pick: "rise",
      why: "It reads as one deliberate move and follows the scroll.",
      moving: "The case-study pages are being built on it now.",
    },
    {
      id: "hero", project: "ArtAndTech", kind: "hero",
      question: "The homepage's first line",
      options: [
        { id: "exist", name: "A", line: "We make things that don't exist yet." },
        { id: "room", name: "B", line: "Art and technology, in the same room." },
        { id: "next", name: "C", line: "A studio for what comes next." },
      ],
      pick: "exist",
      why: "Concrete and confident. B describes, C could be any studio.",
      moving: "The work section is being written in that voice.",
    },
  ],

  // What Flyd does next, stated rather than asked.
  next: [
    "Build 900ms and put both timings side by side",
    "Write the ArtAndTech work section",
    "Stand up the Research desk with its first brief",
  ],

  // The morning edition of the digest (take C) uses its own short set.
  morning: {
    summary: "Three things finished overnight, three experiments running and one look moving on my pick. Nothing needs you today.",
    outcomes: [
      { id: "m1", project: "Flyd news", thumb: "list", point: "This morning's edition ran at 7:00 with 12 stories", detail: "Two sources paused overnight. Both are being looked at." },
      { id: "m2", project: "polybot", thumb: "chart", point: "41 more BTC windows recorded", detail: "The backtest now has 180 windows to work from." },
      { id: "m3", project: "Research desk", thumb: "page", point: "The desk's first brief is written", detail: "What studios like ArtAndTech charge for R&D work." },
    ],
    progress: { poly: 4, rank: 1, gem: 3, "gg-time": 0, "aat-order": 0 },
    decisions: ["d3", "d5"],
    reviews: ["hero"],
    planTitle: "Today",
    plan: [
      "Finish the pixel transition demo across all six case studies",
      "Clear CapFive board notes 53 to 58 on staging",
      "Draft the ArtAndTech homepage from the charter",
    ],
  },
};

// Real content: jobs from ~/.flyd/view/artefacts.json + command runs, news from scout edition 2026-10-24,
// imagery from firstmate's design labs. Threads are condensed from those jobs.
window.FLYD = {
  jobs: [
    {
      id: "capfive-lab", group: "needs", kind: "design", title: "CapFive dashboard: five versions to pick from",
      project: "CapFive", state: "Needs your pick", when: "09:26",
      thumb: "assets/capfive-v3.jpg",
      shots: ["assets/capfive-v1.jpg", "assets/capfive-v2.jpg", "assets/capfive-v3.jpg", "assets/capfive-v4.jpg", "assets/capfive-v5.jpg"],
      shotLabels: [
        "V1 \u00b7 Trading floor. The numbers lead: 2,680 deals, 39 firms, a sector tape.",
        "V2 \u00b7 Page one. The closed-deal tombstone is the lead story, in CapFive's own editorial style.",
        "V3 \u00b7 Wall labels. Almost no chrome; the tombstone hangs like the first work in a gallery.",
        "V4 \u00b7 Title card. The industrial photograph is the frame, with the tombstone as a lower third.",
        "V5 \u00b7 The spine. Every section hangs off one navy rule, with a chart of every deal since 1992."
      ],
      pick: 1,
      thread: [
        { who: "you", at: "Thu 14:20", text: "Do a lab for the CapFive member dashboard. Lead with the latest deals and new members, not counts." },
        { who: "flyd", at: "09:26", text: "Five versions are ready. I'd build V2, Page one: it brings back the closed-deal tombstone as the lead story in CapFive's own style, and it reuses the site's existing parts. V1, Trading floor, is the strongest alternative if you want the numbers first." }
      ],
      actions: ["Build V2", "Open the lab"]
    },
    {
      id: "dir-ident", group: "needs", kind: "design", title: "DIR station ident with tighter type",
      project: "Dead Internet Radio", state: "Needs a look", when: "Fri",
      thumb: "assets/dir-ident.jpg",
      shots: ["assets/dir-ident.jpg"],
      thread: [
        { who: "you", at: "Thu 18:02", text: "Letterspacing could be tighter. The station ID shouldn't need the back block, or the tune-in label." },
        { who: "flyd", at: "Fri 08:40", text: "Tracking is tighter, and the back block and tune-in label are gone. The number field now runs edge to edge under 88.8 MHz. Six takes are in the lab." }
      ],
      actions: ["Approve", "Open the takes"]
    },
    {
      id: "apps-popping", group: "needs", kind: "code", title: "Flyd keeps opening Calendar and Notes",
      project: "Flyd", state: "Ready to land", when: "08:12", link: "PR ready",
      thread: [
        { who: "you", at: "Wed 21:44", text: "Why does Flyd keep opening Calendar and Notes?" },
        { who: "flyd", at: "08:12", text: "The calendar and reminder lookups were launching the apps instead of reading in the background. They now read silently. Checks pass, and it's ready to land." }
      ],
      actions: ["Land it", "See the change"]
    },
    {
      id: "backstage-guard", group: "working", kind: "code", title: "One check that keeps backstage names out of what I say",
      project: "Flyd", state: "Working", when: "40 min",
      thread: [
        { who: "you", at: "08:30", text: "Stop leaking crew names into chat." },
        { who: "flyd", at: "08:31", text: "Building one detector that every reply and notice passes through, instead of fixing each leak by hand. I'll show you the before and after when it's done." }
      ],
      actions: ["Ask how it's going"]
    },
    {
      id: "internal-calls", group: "working", kind: "code", title: "Stop asking you to make my internal calls",
      project: "Flyd", state: "Queued", when: "07:26",
      thread: [
        { who: "flyd", at: "07:26", text: "This week I asked you ten times whether to retry or drop a failed run. Those are my calls. I'm adding a check that stops questions like that before they reach you." }
      ],
      actions: ["Ask how it's going"]
    },
    {
      id: "fleet-read", group: "working", kind: "code", title: "Never show you a failed fleet read",
      project: "Flyd", state: "Checks passing", when: "Fri",
      thread: [
        { who: "flyd", at: "Fri 17:10", text: "When the job list couldn't be read, the page showed you the error. It now keeps the last good list and tries again quietly. Checks pass; I'm watching it for a day before landing." }
      ],
      actions: ["Land it now"]
    },
    {
      id: "gnm-form", group: "done", kind: "design", title: "GNM vendor form: website optional, thank-you page live",
      project: "Good Neighbours", state: "Live", when: "Fri",
            thread: [
        { who: "you", at: "Thu 11:05", text: "Make the website field optional and show a proper thank-you after they apply." },
        { who: "flyd", at: "Fri 10:20", text: "Live. The website is optional, sending shows a full-page loader, and applicants land on “Thanks for your application”." }
      ],
      actions: ["Open the site"]
    },
    {
      id: "stale-card", group: "done", kind: "code", title: "Yes/No cards in chat answer again", project: "Flyd", state: "Landed", when: "Thu",
      thread: [{ who: "flyd", at: "Thu 16:02", text: "Old Yes/No cards were refusing your answer. They now take it, and the decision goes straight to the job." }],
      actions: ["See the change"]
    },
    {
      id: "scrawl", group: "done", kind: "code", title: "Flyd accepts Scrawl recordings", project: "Flyd", state: "Landed", when: "Wed",
      thread: [{ who: "flyd", at: "Wed 12:40", text: "Drop a Scrawl recording on the message box and I'll watch it with you: what you drew, what you said, and what to do next." }],
      actions: ["See the change"]
    },
    {
      id: "deal-dates", group: "done", kind: "design", title: "CapFive deal tiles show their dates", project: "CapFive", state: "Live", when: "Tue",
      thumb: "assets/capfive-deal-tile.jpg", shots: ["assets/capfive-deal-tile.jpg"],
      thread: [{ who: "flyd", at: "Tue 15:10", text: "Every deal tile and deal page now shows when it closed or was announced, on phone, iPad and desktop." }],
      actions: ["Open the site"]
    }
  ],
  artefacts: [
    { kind: "design", title: "GNM Block42 plan: the numbers", meta: "Good Neighbours \u00b7 version 18", img: "assets/gnm-venue.jpg" },
    { kind: "design", title: "CapFive deal tile with dates", meta: "CapFive \u00b7 live Tuesday", img: "assets/capfive-deal-tile.jpg" },
    { kind: "design", title: "CapFive closed-deal tombstone", meta: "CapFive \u00b7 in the dashboard lab", img: "assets/capfive-tombstone.jpg" },
    { kind: "info", title: "Today's news is 9 picks", meta: "From Hackaday, Simon Willison and Waxy", text: "Your crypto-art and creative-coding subreddits have been paused since the 22nd, so they're missing today." },
    { kind: "news", title: "Introducing Kimi K3.1 Pro", meta: "Simon Willison", text: "Moonshot's new flagship ships with open weights promised by 4 Nov, and a faster tier at double the input price.", img: "assets/news-kimi.jpg" },
    { kind: "news", title: "DOOM ported to a $30 clamp meter", meta: "Hackaday", text: "Any microcontroller with a screen becomes a games console if you're stubborn enough.", img: "assets/news-doom.jpg" },
    { kind: "news", title: "Local Wikipedia", meta: "Waxy.org", text: "Wikipedia narrowed to whatever sits within a half-hour walk of you.", img: "assets/news-localwiki.jpg" },
    { kind: "news", title: "Apple Music's iPod easter egg", meta: "Waxy.org", text: "A properly made iPod-era easter egg hidden on Apple Music's 404 page.", img: "assets/news-ipod.jpg" },
    { kind: "news", title: "A new sound cartridge for the 40-year-old MSX", meta: "Hackaday", text: "A one-person hardware love letter to a dead platform.", img: "assets/news-msx.jpg" },
    { kind: "news", title: "Reconstructing the Storm of Crows crossbow", meta: "Hackaday", text: "The Chinese siege crossbow that fired a whole volley from one frame.", img: "assets/news-crossbow.jpg" },
    { kind: "news", title: "A buggy with electric and jet power", meta: "Hackaday", text: "A sand rail running a surplus turbine alongside electric drive, documented over 53 pages.", img: "assets/news-turbine.jpg" }
  ]
};

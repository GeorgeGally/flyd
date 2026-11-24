// Two real proofs of finished work. Every image is a real render of the page before and
// after the change (Liesel's own stored builds of the CapFive site), cropped by the crop rule
// in README.md. Coordinates are in the crop's CSS pixels (w x h).
window.PROOF_SETS = {
  capfive: {
    title: 'Three phone fixes are live on CapFive Connect.',
    when: 'Today, 07:59 to 08:37',
    where: 'CapFive Connect, phone (390 wide)',
    live: 'http://localhost:8080/connect/',
    liveLabel: 'Open Connect',
    next: 'Next I’ll run the same three at 360 and 430 wide, then the iPad.',
    items: [
      {
        id: 'badge',
        headline: 'The badge no longer covers the portrait.',
        why: 'Designated member and Master admin now sit in the card’s text, so the portrait stays clear and the badge reads on navy and white.',
        device: 'phone',
        w: 187, h: 380,
        before: 'img/badge-before.jpg', after: 'img/badge-after.jpg',
        marksBefore: [{ t: 'box', x: 22, y: 30, w: 138, h: 30, label: 'Over the eyes', at: 'below' }],
        marksAfter: [
          { t: 'box', x: 24, y: 212, w: 133, h: 22 },
          { t: 'box', x: 8, y: 16, w: 171, h: 136, label: 'Face clear', at: 'inside-bottom', quiet: true }
        ],
        ctx: 'img/ctx-badge-phone.jpg', ctxBox: [50, 25.6, 47.9, 45], ctxW: 390, ctxH: 844,
        live: 'http://localhost:8080/connect/people/',
        page: 'People'
      },
      {
        id: 'notices',
        headline: 'Each notice gets its own tinted card.',
        why: 'News, Information and Alert were one white panel split by rules. Now each is a card tinted from its type, so you see what kind of notice it is before you read it.',
        device: 'phone',
        w: 390, h: 420,
        before: 'img/notices-before.jpg', after: 'img/notices-after.jpg',
        marksBefore: [{ t: 'hline', x1: 16, x2: 374, y: 272, label: 'One panel, split by a rule', at: 'below' }],
        marksAfter: [{ t: 'box', x: 16, y: 16, w: 358, h: 288, label: 'Own card, tinted', at: 'inside-top-right' }],
        ctx: 'img/ctx-dash-phone.jpg', ctxBox: [0, 0, 100, 49.8], ctxW: 390, ctxH: 844,
        live: 'http://localhost:8080/connect/',
        page: 'Dashboard'
      },
      {
        id: 'search',
        headline: 'Search comes first on People.',
        why: 'The search field moves above the headline, as on Network activity, so the thing you came to do is the first thing you see. Region and Country stay under the headline.',
        device: 'phone',
        w: 390, h: 440,
        before: 'img/search-before.jpg', after: 'img/search-after.jpg',
        marksBefore: [{ t: 'box', x: 24, y: 294, w: 342, h: 52, label: 'Under the headline', at: 'inside-right' }],
        marksAfter: [{ t: 'box', x: 24, y: 96, w: 342, h: 52, label: 'Above it', at: 'inside-right' }],
        ctx: 'img/ctx-people-phone.jpg', ctxBox: [0, 0, 100, 52], ctxW: 390, ctxH: 844,
        live: 'http://localhost:8080/connect/people/',
        page: 'People'
      }
    ]
  },

  liesel: {
    title: 'Your four ultrawide notes are done.',
    when: 'Board notes 35 to 38, reviewed today',
    where: 'CapFive public site, ultrawide (3440 wide)',
    live: 'http://127.0.0.1:4747/board/cad8439905d093c0',
    liveLabel: 'Open the board',
    next: 'Next I’ll check the same openings at 2560 and refresh the board’s ultrawide frames.',
    items: [
      {
        id: 'col3',
        note: 35, said: 'all the content should align with the start of the 3rd column on ultrawide',
        headline: 'Everything now starts on column 3.',
        why: 'The content sat 16px right of the column. It now starts exactly on it, on every page.',
        device: 'ultrawide',
        w: 500, h: 850,
        before: 'img/uw-col3-before.jpg', after: 'img/uw-col3-after.jpg',
        cols: [[-41.5, 65], [89, 195.5], [219.5, 326], [350, 456.5]],
        marksBefore: [
          { t: 'vline', x: 89, quiet: true },
          { t: 'vline', x: 105, label: '16px right of column 3', at: 'bottom' }
        ],
        marksAfter: [{ t: 'vline', x: 89, label: 'On column 3', at: 'bottom' }],
        ctx: 'img/ctx-about-uw.jpg', ctxBox: [25, 19.4, 14.5, 59], ctxW: 3440, ctxH: 1440,
        live: 'http://localhost:8080/about/',
        page: 'About'
      },
      {
        id: 'cta',
        note: 36, said: 'why is this content not centered',
        headline: 'Find an adviser is centred again.',
        why: 'Its large-screen zoom was scaling the column margin too, which pushed the box off to the right. It now spans columns 3 to 14.',
        device: 'ultrawide',
        w: 2320, h: 1260,
        before: 'img/uw-cta-before.jpg', after: 'img/uw-cta-after.jpg',
        marksBefore: [{ t: 'box', x: 1005, y: 40, w: 1256, h: 1181, label: 'Pushed right, cut off', at: 'inside-bottom' }],
        marksAfter: [{ t: 'span', x1: 389, x2: 1931, y: 1236, label: 'Columns 3 to 14' }],
        ctx: 'img/ctx-cta-uw.jpg', ctxBox: [16.3, 6.25, 67.4, 87.5], ctxW: 3440, ctxH: 1440,
        live: 'http://localhost:8080/about/#main',
        page: 'About, closing call to action'
      },
      {
        id: 'open',
        note: '37 + 38', said: 'type size is slightly too big … this whole content block is too high. on desktop it is more in the middle of the screen',
        headline: 'The openings sit lower and quieter.',
        why: 'Headline 99 to 86px, opening paragraph 31 to 27px, and the words start 36% down the screen, where desktop puts them. Every page with a photo opening.',
        device: 'ultrawide',
        w: 1481, h: 1440,
        before: 'img/uw-open-before.jpg', after: 'img/uw-open-after.jpg',
        marksBefore: [
          { t: 'hline', x1: 300, x2: 1481, y: 389, label: 'Starts 27% down', at: 'above' },
          { t: 'box', x: 330, y: 480, w: 1090, h: 291, label: 'Headline 99px', at: 'inside-right', quiet: true }
        ],
        marksAfter: [
          { t: 'hline', x1: 300, x2: 1481, y: 499, label: 'Starts 36% down, as desktop', at: 'above' },
          { t: 'box', x: 330, y: 589, w: 946, h: 253, label: 'Headline 86px', at: 'inside-right', quiet: true }
        ],
        ctx: 'img/ctx-contact-uw.jpg', ctxBox: [18, 0, 43, 100], ctxW: 3440, ctxH: 1440,
        live: 'http://localhost:8080/contact/',
        page: 'Contact (and every photo opening)'
      }
    ]
  }
};

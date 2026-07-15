# Living Discovery Stage Design

## Outcome

Flyd opens as a changing, fixed-viewport composition of the user's real recent work, one personal daily signal, and several current discoveries. It must not resemble a dashboard, feed, card grid, or static article page.

## Evidence and judgment

Flyd persists three background evidence streams:

- local project activity from configured local roots;
- the user's current daily horoscope;
- current stories from Hacker News, publisher RSS feeds, and direct subreddit RSS feeds.

Providers supply observations only. Flyd decides whether they deserve the screen. Network and filesystem refreshes never run in `GET /`.

## Composition

Discovery may use up to three semantic objects. The default living composition is:

1. the most recent local work, when fresh;
2. the user's current horoscope, when their sign is known;
3. a discovery edition containing several grounded stories.

The objects share one viewport. One object owns focus while the others remain visibly present. Arrow keys, pointer selection, and swipe-compatible controls move focus with directional transforms and palette changes. Reduced-motion preferences disable nonessential transitions.

News appears as an asymmetric poster spread built from real source imagery and typography. It is not a stack of equal cards. Missing images produce a deliberate typographic poster rather than a broken or empty rectangle.

## Interface language

The stage presents meaning and actions, not internal bookkeeping.

- Remove `Evidence`, points, comment counts, provider labels, confidence, and generic relevance explanations from the primary plane.
- A poster opens its original source directly.
- Keep provenance in persisted records and the existing source inspector, available only outside the primary stage.
- Use direct commands such as `Continue`, `Open`, and `Discuss` only when they advance the scene.

## Sources

Publisher feeds:

- Daring Fireball
- Ars Technica
- Hackaday
- TechCrunch
- TechRadar
- The Next Web
- Fast Company
- Slashdot
- Smashing Magazine

Reddit feeds use direct `https://www.reddit.com/r/<subreddit>/.rss` URLs for the supplied creative coding, hardware, AI art, internet, startup, Bitcoin, and deep-cut categories. Each feed fails independently. A broken or rate-limited source cannot erase the last usable snapshot.

## Personal context

Local activity is observed from configured project roots and records project name, path, latest activity time, branch, and latest commit summary where available. The current checkout should therefore identify Flyd as the most recent work, followed by other genuinely recent projects.

The horoscope source is enabled only when the user's sign is explicitly configured through `FLYD_ZODIAC_SIGN`. Flyd must not treat the supplied horoscope project's demo default as personal data.

## Validation

- Feed parsing supports RSS and Atom.
- Unsafe redirects and unapproved hosts are rejected.
- Story identifiers remain stable across refreshes.
- Thin stories do not earn the screen.
- The primary stage contains no `Evidence` link or engagement statistics.
- Desktop and mobile remain within one viewport without document scrolling.
- Three objects can be focused without layout overlap or clipped controls.

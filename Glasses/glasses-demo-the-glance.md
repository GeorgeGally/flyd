# The demo: "The Glance"

One behaviour. Done well. Filmed on a face.

**You look at something you like, and it becomes yours.**

No talking to it. No assistant reading the news at you. You glance at a jacket, a chair, a pair of sneakers, a bottle of wine — a small mark appears in the corner of the lens, and by the time you've walked on, the piece is in your phone: identified, priced, where to buy it, and why you stopped.

## Why this one

- It is the only behaviour that shows off the two things you already own: recognition of an object in a messy real scene, and an overlay that doesn't look like a HUD from 2013. That is Looking Glass, ported from jewellery to the world.
- It plays to the market gap. Meta captures the world and sells it. Even Realities removed the camera to be safe. This keeps the camera and keeps it private — what the glasses see never leaves your taste graph.
- It is filmable in 20 seconds with no actor, no script and no voice. That matters more than elegance: it is the shot that travels.
- It compounds. Every glance is a taste signal, and you already have the machine that reads taste — Tastemaker. The glasses become the physical sensor for a product that otherwise only sees a browser.
- It has an obvious revenue line without advertising: affiliate on the things people glance at. You've run TikTok Shop affiliate. You know the economics.

## The 20-second film

1. Shot on a face, mid-market, Bali or Tokyo, morning. He walks.
2. His eyes land on a woman's oversized jacket — the glass does nothing but hesitate for a beat, then a single fine arc in the lower right of the lens, no text.
3. Cut to the phone in his hand, walking: today's page is open. The jacket is there, first entry. Price, three places to buy, and the reason it caught him — the cut of the collar reads 1980s.
4. Push in on the jacket entry, one gesture, it's in a folder called "orange".
5. Final beat: he looks up, and the arc appears again on something behind the camera.

Sound: market noise only. No music, no voiceover. Captions do the explaining.

## What has to be true on the device

- Recognition is fast enough that the mark lands within about a second of the glance, not after the moment has passed.
- Nothing is stored from the camera — only the matched item. That's the privacy story and it must be literally true, not a policy.
- The overlay is one small element. No boxes, no labels. If it looks like a head-up display it is dead.
- Works offline for the visible match, and refines price/availability when the phone is on network.

## Build path (six weeks to the film)

- **Weeks 1–2:** on the Brilliant Frame dev kit — camera frames over BLE to the phone, on the phone a vision model for object match, return a single result. Prove latency.
- **Weeks 3–4:** the lens side. Get the arc to feel like glass and not pixels. Shoot tests on a face with the real frames.
- **Weeks 5–6:** the phone page. Reuse Tastemaker's capture and scoring so every glance is already an entry with a quality score, not a photo roll.
- **Then:** the film. One location, one morning, one person.

## What this is not

Not translation. Not navigation. Not an assistant answering questions. Everything else in the category is one of those three, and all three are already being done by companies with more capital than you will raise.

## Open question to settle before building

Does edition one run this on-device? The PrismML demonstration runs on Qualcomm's Snapdragon AR1 Gen 1 — the Brilliant Frame dev host is a low-power board that cannot carry it. So: prototype the behaviour on Frame, plan edition one around an AR1-class chip. The deck needs that line, otherwise a sharp investor finds it first.

# Proof of finished work (ticket 10)

Rough, clickable prototypes of how Flyd shows that work is done, built like a presentation to an ECD or a client instead of a whole-page screenshot.

Serve: `python3 -m http.server 8093` in this folder, then open `index.html`. (8092 was already taken by a long-running atomise server, so these were checked on 8093.) The bar at the bottom of each page switches take and example. It is prototype chrome, not part of the design.

## The two real examples

Every image is a real render of the page before and after the change. They come from Liesel's stored builds of the CapFive site (`~/Documents/cap5/.liesel/pages-2026-11-23/.liesel-builds/`), the snapshot taken just before and just after each commit. They were rendered with chrome-devtools-axi and then cropped. Nothing is mocked.

1. **CapFive Connect, phone (390 wide), shipped today.**
   - The member badge moves off the portrait (`d49aead8b`).
   - Dashboard notices go on tinted cards (`bd95a9183`, note 39).
   - People search moves above the headline (`d75f715f6`, note 53).
2. **Liesel board review, CapFive ultrawide grid (3440 wide), notes 35 to 38.**
   - Content starts on column 3 (`7319d93b4`).
   - Find an adviser is centred (`4ffcd8af1`).
   - The openings sit lower and quieter (`89f279ccc`, notes 37 and 38 shown as one proof).

   Measurements were taken from the builds: the left edge moves from 965 to 949px, the CTA box from 1565–3423 to 949–2491, and the headline from 99 to 86px.

## What a proof contains

1. **The point.** One sentence about what is now different for the person using it, not what the code did. This is the headline.
2. **Before and after.** The same crop of the real page at the same scale, with one drawn mark per change. Marks are an outline, a reference line or a span, each with a short chip.
3. **Why.** One line. When the proof answers George's own board note, his words come first ("Your note 36: *why is this content not centered*").
4. **Where.** A tiny whole-page locator with the crop boxed. It links to the live thing.
5. **Next.** What Flyd will do next, stated rather than asked, with "Change the plan" as the way to redirect it. This follows ticket 03: never ask him to OK anything.

## The crop rule

1. Crop to the changed element plus one neighbour, so you know where you are (the card beside it, the heading above it).
2. Use the same rectangle before and after, so the only thing that moves is the change.
3. If the change is about position, include what it is measured against and draw it. For example: the grid column (note 35), the frame and columns 3–14 (note 36), or how far down the screen (notes 37/38).
4. If the change is about where something sits on the screen, keep the full height and crop only the sides.
5. Show it at the device's own shape. Phone stays tall and ultrawide stays wide. The whole page only ever appears as the small locator.

## The takes

- **A · Slides** (`slides.html`): a short deck. A cover gives the round in one line with a thumbnail of each change. Then comes one slide per change (headline, note, why, locator, then before and after side by side, or stacked when very wide). It ends on the Next slide. Arrow keys or swipe.
- **B · Wipe** (`wipe.html`): one scroll. Each crop sweeps from before to after as you reach it, and you can drag the handle or tap Before/After to compare. It is best for subtle moves like the 16px onto column 3.
- **C · One page** (`sheet.html`): the whole round on one sheet. Each tile shows the after state with marks and a short headline under it. Hold a tile to see before, tap it for the full proof (the A slide in a dialog). Next and the live link sit at the bottom.

Checked at 1440×900 and 390×844 (chrome-devtools-axi). No horizontal overflow at phone width.

## Recommendation

Make **C** the default proof Flyd drops into chat after a round of work. George gets the whole round at a glance, each change already cropped and marked, and the point is written under each tile. Tapping a tile opens the **A** slide for that change, which is the presentation moment. Use **B** inside a slide only for single subtle changes where the movement itself is the proof.

For Flyd to produce this automatically, a finished job needs to record:
- the element selector it changed
- the before and after builds (Liesel already keeps these)
- the reference the change was measured against

From those, the crop and marks follow mechanically from the rule above.

## Rough edges

- Live links point at the local site (`localhost:8080`) and the local Liesel board. The production URL wasn't to hand.
- The Next lines and "Change the plan" are illustrative copy. "Change the plan" does nothing yet.
- Chips can sit over page text on small crops. A real version would place them against free space automatically.

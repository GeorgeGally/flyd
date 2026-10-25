---
name: design-lab
description: George asks for a design lab ("make a lab for X"), N versions or redesigns, or design options for a page, section, screen or component. Runs discover → define → deliver (seed strings, ambitious directions, a fresh-context critic loop scored out of 10, real imagery, then cutting) so the versions are distinct and studio-quality instead of safe defaults, and hands the finished lab back for his review.
---

# Design lab

Models drift to the safest, most average design; this process pushes past that and then refines. Apply it to every lab.

## 0. Before designing

- Read the project's style rules first (e.g. `STYLE-GUIDE.md`, the page's existing tokens) and his taste: run `flyd taste for <repo>`. His standing taste: TV-style clean type, framed imagery with padding, no wide letter-spacing (≤ .04em), generous space above buttons, buttons never oversized, readable body copy, copy that says what a thing is (never opens with "Not…", no slogan filler), claims literally true.
- One lab = one HTML file with every version stacked, each with a short tag (`V3 · Name.` + one plain sentence on the idea). Keep the real content; never lorem ipsum.

## 1. Discover: make the versions genuinely different

1. Seed strings for variety. For each version, generate a random string with a shell command (e.g. `openssl rand -hex 24`) and derive that version's palette, layout grid and type scale from its digits and patterns. The string never appears in the design. Asking a model to "be random" doesn't work; an external seed does.
2. Ambitious directions. Give each version a bold, named inspiration and say how it shapes the layout (a TV broadcast title card, an editorial magazine spread, a museum wall label, a trading terminal, radical asymmetry, an isometric scene…). At least two versions must be directions that sound risky.
3. If he reacted to earlier rounds, keep what he liked, drop what he called out, and write a one-line build brief per version before coding.

## 2. Define: critic loop until it's world-class

For each version (or the lab as a whole when versions are small):

1. Screenshot it at desktop width; add phone width when layout matters.
2. Send only the image to a fresh-context critic (strongest model). Use this prompt verbatim every round, with no target score in it:

   > You are a senior design director at a top studio. Look only at this screenshot. 1) Name the aesthetic it is going for and describe how the best studio in the world would execute it. 2) List the biggest gaps, structural first, then fine detail (type, spacing, alignment, colour, imagery). Penalise overdone or obviously AI-generated patterns (generic gradients, glows, pill clutter, icon-in-circle grids, centred-everything hero, emoji, wide letter-spacing). Be specific, tight and opinionated. 3) Score it out of 10.

3. Fix the gaps, re-screenshot, re-critique. Stop at 9/10 or above, or after 2–3 rounds if scores stop rising. Rank against concrete references (the project's best page, studios he admires) rather than "is it beautiful"; use references as a moodboard, never a copy.
4. Keep the critic expensive and the implementer cheap; the critic only reads images and writes short notes.

## 3. Imagery, not just shapes

- Each version uses real imagery: the project's own photos or paintings, or generated images when the project allows it. Generated assets are dev-only unless he approves them; keep any API keys gitignored and never ship them.
- Motion: TV-style fades only (no pop, no movement on text, no button lift on hover).

## 4. Deliver: cut, then hand it back for review

- A final pass on every version that only removes: extra glows, gradients, redundant labels, duplicate lines, decorative chrome, custom controls a native one does better. Prefer image-centric, restrained layouts.
- Check phone and tablet widths. Commit the lab locally; never push unless asked.
- Report it ready for his review: the lab URL (or file path) and one screenshot per version in artifacts, plus 1–3 plain lines per version. Picking a direction is his call.

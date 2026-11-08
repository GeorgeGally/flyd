---
name: ux-psychology
description: Six behavioural-psychology principles for product UI (smart defaults, goal gradient, give-before-ask, IKEA/endowment effect, loss framing, price contrast) with before/after patterns and honest limits. Use when designing or reviewing forms, onboarding, sign-up walls, upgrade/upsell screens, pricing, checkout, or any screen that asks a user to decide or act.
---

# UX psychology

People don't decide logically. They follow defaults, chase visible progress, return favours, value what they made, fear loss more than they want gain, and judge every number against the last one they saw. Design each screen that asks for a decision with that in mind.

Apply these to remove effort and earn trust, never to trick. Every pattern below has an honest form and a dark-pattern form; ship only the honest one (see Guardrails).

## 1. Smart defaults (decision fatigue)

**Problem:** blank fields. Each empty field is a decision; stacked decisions make people do nothing and leave. (Choice overload: Iyengar & Lepper's jam study, 24 flavours → ~3% bought, 6 flavours → ~30%.)

**Do:**
- Pre-fill every field with the most common or most likely value (today's date, nearest location, 2 adults, last-used choice).
- Turn the task from "fill this in" into "scan and adjust what's wrong".
- Make the action button state the outcome when you know it ("Show 12 rooms", not "Search").
- Cut options to the few that matter; hide the long tail behind "More".

**Why it works:** most users never change defaults; a default reads as a recommendation ("this is what most people pick").

**Check:** every form field — is there a value I already know or can safely guess?

## 2. Goal gradient (never start at zero)

**Problem:** progress at 0% and a row of empty steps feels like a long road, even when the work is small.

**Do:**
- Count what the user already did (signed up, picked a plan, imported data) as step 1, done and ticked.
- Show progress from the first screen; start above 0% when real work is already behind them.
- Show how close the finish is ("2 of 5 done", a filling bar), not just how much remains.

**Why it works:** people speed up as a goal gets closer (Nunes & Drèze car-wash cards: 10 stamps with 2 pre-filled beat 8 empty stamps, same 8 washes needed). LinkedIn's profile-strength meter never starts at zero.

**Check:** does any progress indicator show 0%? Find something they've done and count it — but only something real.

## 3. Give before you ask (reciprocity)

**Problem:** walls before value — "Create an account to see your results", blurred reports, email gates. It reads as holding the result hostage; people leave.

**Do:**
- Deliver real value first: the score, the top issues, a working first use.
- Ask for the account/email after, framed as keeping or extending what they already have ("Save your report", "Get the full step-by-step breakdown").
- Free tier, trial, or full product use before payment where the business allows (Notion, Spotify trial, Costco samples).

**Why it works:** receiving something creates a pull to give back (Cialdini).

**Check:** what does the user get before the first ask? If nothing, move the ask later.

## 4. Let them build it (IKEA / endowment effect)

**Problem:** a bare email + password sign-up. Nothing on the screen is theirs, so closing the tab costs nothing.

**Do:**
- Let users make choices and create something before the account step: name, preferences, a palette, a first lesson, a first project.
- Show their creation live as they build it.
- Label the step "Continue", not "Sign up", once they're invested — the account saves their work.

**Why it works:** people value what they made or feel they own (Duolingo: language, goal and first lesson before sign-up).

**Check:** before the sign-up wall, has the user made anything? If not, add a short build step.

## 5. Show what's at stake (loss aversion)

**Problem:** gain-framed asks ("Upgrade now" + a feature list + "Maybe later") carry no weight; ignoring them changes nothing.

**Do:**
- Frame around what the user already has and could lose: their actual files, their streak, their saved work — named, specific, real.
- Show a real deadline only if one exists.
- Keep the decline option neutral and honest ("Not now", "Keep free plan").

**Why it works:** losses weigh roughly twice as much as equal gains (Kahneman & Tversky); people protect the status quo.

**Check:** is the consequence true and specific? If the loss isn't real, don't claim it.

## 6. Control the comparison (contrast / anchoring)

**Problem:** a price shown alone gets judged in absolute terms ($50/month → "$600 a year, no").

**Do:**
- Show an add-on next to the larger purchase it belongs to (protection plan under the $1,900 laptop, "just 2.6%").
- Order plans so the reference point comes first; the first number becomes the ruler.
- Show per-unit or per-day cost where it's the honest comparison.

**Why it works:** the brain judges relative to the last number it saw (the $90 steak that makes the $40 salmon look reasonable).

**Check:** what does the user see right before each price? Decide that on purpose.

## Guardrails (non-negotiable)

- **No confirmshaming.** Decline buttons stay neutral. Never "I'll risk it", "No, I don't care about my data". The video's example does this; don't copy it.
- **No fake progress, fake scarcity, fake timers or fake counts.** Pre-filled progress must reflect real completed work; "12 results" must be the real count.
- **Defaults must serve the user.** Never pre-tick paid add-ons, marketing consent, data sharing or cookies (GDPR requires opt-in for consent).
- **Plain copy.** State what it is; no slogan filler, no "Not X — it's Y" openings.
- **Treat cited numbers as directional.** Several famous figures (e.g. "free samples raise sales 2,000%") are marketing folklore; don't put them in copy or decks as fact.

## Review checklist

For any screen that asks the user to decide or act:
1. Empty fields that could have a smart default?
2. Progress shown, and not starting at zero when real work is done?
3. Value delivered before the first ask?
4. Something the user built or chose before the sign-up?
5. Stakes framed honestly, decline option neutral?
6. Every price shown against a deliberate reference point?
7. Any guardrail broken?

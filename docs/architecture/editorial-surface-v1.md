# Editorial Surface V1

## Status

Technical specification for the first visual manifestation system on top of Flyd's directed intelligence surface.

## Goal

Replace the current page-like directed renderers and hard-coded 68/31/28 placement with a restrained editorial surface that can express three deterministic compositions:

- `editorial_focus` — one dominant object with quiet space;
- `comparison_wall` — a recommendation or thesis beside two to four comparable options;
- `working_scene` — a dominant work object with evidence, conversation, or controls remaining visible around it.

The first complete vertical slice is the decision scene rendered as a poster-like comparison wall.

## Product constraints

- Flyd chooses semantics, focus, and relationships.
- The browser chooses geometry from registered compositions.
- The model never emits coordinates, CSS, HTML, or animation code.
- D3 is reserved for real data visualisation inside a data renderer.
- The surface defaults to one dominant object and no more than two supporting objects.
- The visual result must avoid equal dashboard grids and generic SaaS cards.

## Composition resolution

V1 derives the composition deterministically from the surface mode:

| Mode | Composition |
| --- | --- |
| quiet | editorial_focus |
| decision | comparison_wall |
| investigation | working_scene |
| action | working_scene |
| monitoring | editorial_focus |
| conversation | working_scene |

This avoids expanding the model contract before the visual language is proven. A later version may allow Flyd to select among registered compositions when more than one is valid.

## Surface object contract

Every visible surface item is wrapped in a stable `surface-object` container with:

- `data-host="surface"`;
- `data-role="focus|support"`;
- `data-renderer`;
- stable semantic DOM identity;
- CSS containment so its renderer can adapt to actual available width;
- existing semantic state and relationship attributes.

Renderers own internal content. The composition layer owns placement and prominence.

## Decision comparison wall

A decision scene is rendered as:

- a thesis column containing the recommendation, summary, and secondary actions;
- an option field containing two to four poster-like option objects;
- when Flyd recommends an option it must place that option first in `metadata.options`;
- the first option receives the recommendation label and stronger editorial emphasis;
- every option retains its executable `choose` action;
- narrow containers collapse into a vertical sequence without changing semantics.

The option object is content-agnostic. V1 uses title and consequence copy; later media or artifact previews can fill the poster body.

## Investigation working scene

The investigation scene keeps the question dominant and arranges known evidence, unknown evidence, and the next question as editorial columns within one surface object. Starting investigation opens conversation while preserving the scene.

## Action working scene

The action scene keeps proposed work dominant and treats impact and readiness as secondary editorial panels. Confirmation remains a strict boundary.

## CSS architecture

`app/assets/tailwind/application.css` defines:

- the surface composition grid;
- focus and support object roles;
- poster object containment;
- decision comparison wall internals;
- investigation/action working-scene internals;
- reduced-motion behaviour.

Container queries control renderer adaptation. Viewport breakpoints only control broad surface geometry.

## Motion

Existing semantic behaviours remain authoritative:

- join;
- yield;
- recede;
- leave;
- replace;
- collapse;
- return.

Motion is applied to the stable surface object. It must be reversible where semantics allow and disabled under `prefers-reduced-motion`.

## Accessibility

- Composition order must match DOM reading order.
- Option objects remain real forms/buttons.
- Focus states must be visible.
- Colour cannot be the only indication of recommendation or state.
- The interface must remain usable in a single-column layout.

## Validation

The current semantic validator remains unchanged in V1. Composition is derived from validated `surface_mode`, so unsupported composition values cannot enter persistence. Recommendation emphasis is governed by the explicit first-option ordering instruction in the intelligence contract.

## Acceptance criteria

1. Decision mode renders with `comparison_wall` rather than a full-width page section.
2. Two to four option objects are visible and independently actionable.
3. Investigation and action render as contained working scenes rather than page templates.
4. The surface no longer contains fixed `md:w-[68%]`, `md:w-[31%]`, or `md:w-[28%]` placement rules.
5. Every surface item has an explicit `focus` or `support` role.
6. Renderer internals adapt using container queries.
7. Existing decision, investigation, and action journeys continue to work.
8. Reduced-motion users receive no spatial transition animation.

## Out of scope

- arbitrary generative layouts;
- model-selected coordinates;
- inline scene cards inside conversation;
- artifact editing;
- D3-driven surface composition;
- more than three simultaneous top-level surface objects.

Inline conversation manifestations are the next vertical slice after this surface system is visually proven.

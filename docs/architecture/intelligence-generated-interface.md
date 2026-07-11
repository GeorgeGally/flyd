# Intelligence-Generated Interface

## Status
Accepted.

## Principle

**Flyd is the intelligence. The interface is the intelligence expressed.**

Projects, conversations, messages, decisions, beliefs, behaviours, events, goals, and reports are evidence and persistence structures. They inform Flyd. They do not determine the interface directly.

## Core boundary

The root surface must be composed through `Flyd::Intelligence`.

Flyd receives a snapshot of the current world, including active interaction, memory, project context, recent decisions, beliefs, messages, and available capabilities. Flyd synthesizes that state and returns:

- its concise understanding of what is happening
- its current intention toward the user
- a semantic surface composition
- relationships to supporting contexts and evidence
- available actions

Rules, retrieval, scoring, and validation may support this operation. They must not replace Flyd's judgment by turning stored records directly into UI.

## Constraints

- The root experience renders a Flyd-composed `Surface` when the generated-surface feature is enabled.
- A project, decision, belief, message, or other record never becomes a visible object merely because it exists.
- It is valid for Flyd to synthesize several records into one scene, create no scene, or choose a different representation entirely.
- Projects are context references. They appear only for provenance, correction, or explicit system navigation.
- Conversation is one renderer within the surface. It is not the application shell.
- Conversation grows beneath the universal input, with the newest exchange closest to the input anchor.
- The universal intent entry point is modality-agnostic. Text ships first; audio, files, images, clipboard, and screen input can be added later.
- Flyd decides what appears, why it appears, its prominence, relationships, and available actions.
- Renderers present a semantic plan. They do not determine relevance or intention.
- The surface may contain one dominant scene, several related objects, a conversation, or only the intent entry point.
- Motion communicates semantic changes through expansion, compression, recession, and return. It must be reversible.
- Invalid or unavailable intelligence output falls back to a calm universal input, never to a ranked database feed.

## Current implementation boundary

`Flyd::Intelligence` currently composes a surface synchronously using the configured LLM over a bounded Rails state snapshot. Its output is validated against a constrained semantic schema before rendering. `Surface::Planner` remains only as a compatibility delegate and contains no ranking or decision logic.

The proactive TypeScript intelligence is not yet included in the state snapshot. Surface persistence, lifecycle, caching, multimodal input, artifact renderers, and richer relationships remain future work.

Legacy project and conversation routes remain available as fallback and diagnostic views. Production rollout is controlled by `FLYD_GENERATED_SURFACE`.

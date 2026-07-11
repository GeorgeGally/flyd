# Intelligence-Generated Interface

## Status
Accepted.

## Principle

**The interface is the intelligence expressed.**

Flyd's primary interface is generated from attention and context. Projects, conversations, messages, decisions, beliefs, and behaviours are persistence and reasoning structures. They must not become primary navigation merely because they exist in the database.

## Constraints

- The root experience renders a semantic `Surface` when the generated-surface feature is enabled.
- Projects are inferred context. They appear only for correction, provenance, or explicit system navigation.
- Conversation is a renderer within the surface. It is not the application shell.
- Conversation grows beneath the universal input, with the newest exchange closest to the input anchor.
- The universal intent entry point is modality-agnostic. Text ships first; audio, files, images, clipboard, and screen input can be added later.
- Intelligence decides what appears, why it appears, its prominence, and available actions.
- Renderers present semantic objects. They do not rank relevance.
- The surface may contain one dominant scene, several supporting objects, or only the intent entry point.
- Motion communicates relevance through expansion, compression, recession, and return. It must be reversible.
- Low-confidence context guesses must not be written into project memory. Ambiguous input is held in a neutral Inbox context.

## Initial boundary

The first Rails implementation uses deterministic planning over semantic decision and belief candidates. It establishes a stable provider boundary so the proactive TypeScript intelligence can later contribute events, attention, tension, curiosity, goals, and nudges without making the interface dependent on the CLI's storage format.

Legacy project and conversation routes remain available as fallback and diagnostic views. Production rollout is controlled by `FLYD_GENERATED_SURFACE`.

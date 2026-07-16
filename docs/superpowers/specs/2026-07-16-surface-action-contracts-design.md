# Surface Action Contracts Design

## Goal

Make the intelligence-generated surface truthful from composition through execution. A user action must execute the exact decision, question, or build instructions Flyd persisted and displayed.

## Authority Boundary

`SurfaceItem#actions` is the execution authority. The browser may identify which persisted option was selected, but it may not supply executable labels, questions, or instructions.

- A decision request supplies an `option_id` selector. The controller resolves the matching persisted `choose` action and uses its persisted payload.
- Investigation and build requests resolve their single persisted action by action id and ignore submitted payload content.
- Missing, ambiguous, or unavailable persisted actions fail closed.

## Validation

The surface-plan validator enforces renderer-specific action contracts after sanitization:

- Decision option IDs are unique. Every option has exactly one `choose` action, no action points outside the options, and each action label payload matches the displayed option label.
- An investigation has exactly one `investigate` action whose question equals `metadata.next_question`.
- A `ready` action scene has exactly one `build` action whose instructions equal `metadata.proposed_action`.
- `blocked` and `running` action scenes have no build action because there is nothing new to confirm.

## Rendering

A decision is recommended only when `metadata.recommendation` is present. Without it, every option is presented neutrally with a `Choose` control.

Action scenes derive their heading, controls, and confirmation copy from readiness:

- `ready`: ready for review, with the persisted build action.
- `blocked`: blocked, with no review control.
- `running`: in progress, with no review control and no claim that work remains a proposal.

## Testing

Controller tests tamper with submitted payloads and assert that persisted action content wins. Validator tests cover duplicate and mismatched decision mappings, exact investigation questions, and readiness-dependent build actions. System tests click both recommended and neutral decision paths and assert truthful action-state rendering.

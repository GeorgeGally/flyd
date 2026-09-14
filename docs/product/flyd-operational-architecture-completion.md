# Flyd Operational Architecture — Completion Record

**Status:** Implemented  
**Completed:** 14 September 2026  
**Authority:** Completion record for `flyd-operational-architecture-prd.md`

The Operational Architecture PRD is implemented. The architecture is now governed by one canonical owner per kind of truth rather than by a goal of one physical database.

## Completed

- Repository Intelligence owns high-level repository observation and distinct observation fingerprints.
- `AgentTask` / `TaskAssignment` / `TaskGrant` / `WorkerSession` are the canonical executable-work vocabulary.
- Legacy manifest magic-phrase delegation can no longer launch the compatibility envelope.
- Operational decisions are durable first-class runtime facts.
- Restart recovery preserves positively identified surviving workers.
- A deterministic reconciler and continuous supervisor compare runtime state with observed reality.
- Worker completion is not task completion; verification and integration remain independent stages.
- Detached worker completions can be independently re-verified and safely integrated after Core restart.
- Detached multi-repository recovery requires every source repository to remain clean on `main` at its recorded base HEAD.
- Present composes explicit facts, observations and inference, including runtime decisions/tasks/workers.
- CLI and work-intelligence status paths consume runtime-aware Present before legacy fallback paths.
- Git observation does not mutate `PROJECT.md`.
- Work-index tasks are explicitly planning-only `ProjectTodo`s rather than execution tasks.
- Durable project-native knowledge has a bounded AGENTS.md promotion mechanism.
- CI typechecks/builds Core and explicitly runs the operational supervision, recovery, decision and delegation invariant tests.

## Intentional compatibility surfaces

These do not represent incomplete architecture:

- The historical SQLite table is still named `tasks`; its semantic type is `ProjectTodo`.
- `PROJECT.md` can still be imported explicitly into planning todos. It is not live runtime truth.
- Legacy delegation completion endpoints/types remain compatibility-only and cannot promote canonical runtime state.
- Continuous supervision is currently started through the Core import lifecycle rather than a dedicated `startServer` hook. The supervisor itself is singleton-owned and independently stoppable.
- Runtime PostgreSQL, intelligence SQLite and work-index SQLite remain separate because they own different semantic domains. Consolidation is optional cleanup, not a correctness requirement.

## Ongoing product work

Future Mac/Voice UX, new worker adapters, richer CI observers, deployment verification and broader personal delegation are product evolution on top of this architecture. They are not blockers to completion of this PRD.

For canonical ownership rules and storage disposition, see `docs/architecture/operational-truth-ownership.md`.

# Flyd Personal Agent Platform PRD

## Status

Authoritative product PRD as of 17 July 2026.

This document supersedes `docs/product/flyd-v1-prd.md` as the product definition. The earlier PRD remains the specification for directed Rails surfaces where it does not conflict with this document.

The first release is deliberately narrower than the eventual product: Flyd must first become George's daily coding agent harness. That wedge proves the personal intelligence, continuity, orchestration, autonomy, and interface contracts required by the wider personal portal.

## Product thesis

**Flyd is a personal agent platform. The interface is the agent expressed.**

To the user, Flyd is one continuous intelligence and one place to work. Internally, it can use many models, specialist agents, tools, stores, and interfaces. Those implementation choices are replaceable. The durable product is the user's agent: its understanding, judgment, permissions, history, and ability to turn intent into work.

Flyd is intended to become a personal portal for anyone. Its first customer is George. The first proof is not that the architecture is general or the interface looks novel. The first proof is that George chooses Flyd to begin and continue real work.

## Founder decisions

This PRD incorporates the following explicit decisions:

1. Flyd is a platform for personal agents, first proven as George's own agent.
2. The product experience is one Flyd, while the architecture may coordinate many agents and models.
3. Flyd should own the user experience of the work. Specialist products are workers behind it, not destinations the user must continually manage.
4. The first wedge is an agent-native coding harness that is better than opening Codex or OpenCode directly because it has durable memory and understanding.
5. Rails, CLI, and a later desktop application are capable surfaces over the same runtime. Rails must not be a watered-down viewer.
6. The first unmistakable signs of intelligence are:
   - generating the right working interface and agent workflow from a loose outcome; and
   - taking useful, reversible initiative.
7. Autonomy is graduated. Flyd acts freely inside safe, reversible boundaries and asks before consequential external or destructive actions.
8. Observation is scoped and explicit. Coding activity is the first observed domain; browser, communication, calendar, and other sources come later.
9. Memory alone is not intelligence. Flyd must use memory to make better decisions and perform better work.

## The problem

George currently assembles a personal agent manually:

- Claude and GPT for writing;
- Codex and OpenCode for coding;
- Canva and GPT for design;
- Hermes for curated news;
- browser tabs, files, and memory to preserve unfinished context.

The practical result is a fragmented working environment with many open tabs, repeated context transfer, lost decisions, and no intelligence responsible for the whole situation.

Flyd has not yet displaced that stack. There has been no concrete moment when Flyd created enough value to be chosen over the existing tools. Its strongest behavior has been passive listening in the coding CLI and occasional vague personal recall. That is evidence that presence and memory matter, but not evidence that Flyd has demonstrated judgment.

The Rails interface has often rendered composed abstractions without being grounded in current work. A stale or generic surface can look designed while proving nothing. Random news, horoscope copy, invented investigations, and empty quiet-state language do not make the product intelligent.

## Product promise

Flyd turns a loose outcome into a continuous, personally informed work session.

It should know enough to answer four questions before asking the user to reconstruct everything:

1. What is the user trying to accomplish?
2. What relevant work, decisions, constraints, and preferences already exist?
3. Which agent or combination of agents should act next?
4. What interface does the user need to understand, direct, or approve that work?

The user should experience this loop:

```text
Arrive
  -> Flyd reconstructs the live situation
  -> user states or confirms an outcome
  -> Flyd compiles grounded context
  -> Flyd chooses agents, tools, and an interface
  -> Flyd and its workers act
  -> Flyd asks only at real judgment or permission boundaries
  -> verified outcomes update the shared understanding
  -> the next session resumes from the changed reality
```

## The ten-star experience

George enters a project directory and starts `flyd` instead of starting Codex or OpenCode directly.

Flyd recognizes the project, the current branch and working state, the last meaningful session, unresolved tasks, prior decisions, known preferences, and any relevant changes since the last session. It does not dump this information. It uses it to present a concise interpretation of the situation and a recommended next move, with provenance available when needed.

George can provide an imprecise outcome such as:

> Make the agent interface finally useful as my daily driver.

Flyd turns that into a live work object. It retrieves the relevant product decisions, identifies uncertainty, proposes an approach, selects one or more coding agents, gives each worker the context and constraints it needs, and presents the work through the interface suited to the moment: a focused conversation, task map, code plan, diff review, decision comparison, running-agent view, artifact, or generated Rails surface.

Flyd monitors the work rather than merely launching it. It notices a stalled worker, conflicting implementation, failed test, stale assumption, or missing decision. It can retry, gather evidence, create a focused follow-up, or perform another reversible action without interrupting George. It asks before destructive changes, external publication, purchases, credential exposure, or other consequential acts.

When the work ends, Flyd records what changed, why, what was verified, and what remains unresolved. The next session begins from that outcome. George does not have to explain the project again.

## First product: Flyd coding harness

### Definition

The first product is a local, interactive agent harness that becomes the normal entry point for coding work. It coordinates Codex and OpenCode initially and is designed to add other workers without changing the user-facing product model.

The harness is not a memory CLI with more commands. It is a persistent work session with an agent loop, task state, worker state, generated interface state, and a permission model.

### Required first-release capabilities

#### 1. Start with understanding

On startup, Flyd must:

- identify the current project and repository state;
- load the last relevant work session and unresolved work;
- retrieve decisions, constraints, preferences, and prior outcomes relevant to the present project;
- distinguish current evidence from stale or uncertain memory;
- state its interpretation and recommended next move concisely;
- let the user correct the interpretation before it becomes durable truth.

It must not present a generic dashboard, a list of everything stored, or fabricated urgency.

#### 2. Accept outcomes, not tool instructions

The primary input is an intended outcome. Flyd may ask a focused question when ambiguity changes the work materially, but it should not require the user to choose a model, agent, project record, context bundle, or workflow before starting.

Flyd converts the outcome into:

- a durable task;
- success and verification criteria;
- a grounded context package;
- a proposed agent strategy;
- a semantic interface plan;
- explicit permission boundaries.

#### 3. Coordinate specialist agents

Flyd must provide adapters for Codex and OpenCode in the first release.

It must be able to:

- select a worker based on capability and availability rather than branding;
- start one or more workers with bounded assignments;
- preserve the user's latest instructions as the authority;
- inspect progress and outputs;
- detect failure, conflict, inactivity, and completion;
- send a focused follow-up without rebuilding the entire context;
- stop or replace a worker;
- merge verified results into the Flyd task state.

Workers do not write directly into Flyd's beliefs or user profile. Their outputs remain claims until verified by tools, tests, repository state, or user confirmation.

The Release 1 worker adapter contract is:

- `capabilities`: executable, version, supported operations, and health;
- `start`: task grant, isolated working directory, context package, and assignment;
- `observe`: stable worker ID, process/session ID, status, transcript events, and resource use;
- `instruct`: focused follow-up tied to the current assignment revision;
- `stop`: graceful stop followed by bounded forced termination;
- `resume`: reconnect when the underlying worker supports it, otherwise start a replacement from the durable task state;
- `complete`: process termination plus Flyd verification, never a worker's textual claim alone.

Release 1 adapters supervise pinned local CLI executables through structured process arguments and PTY or machine-readable output where supported. The adapter records the executable and version used and fails closed when the installed version is outside its tested range. Each worker receives only the task grant available to Flyd. Parallel edits occur in Flyd-managed isolated worktrees; Flyd integrates verified work onto `main`, which remains the user's source-of-truth branch.

#### 4. Generate the working interface

The interface must change with the work. The semantic interface plan is shared across surfaces and rendered according to each surface's strengths.

Initial coding interface modes include:

- **orientation**: current situation, interpretation, and next move;
- **conversation**: focused clarification or collaborative thinking;
- **plan**: tasks, dependencies, risks, and verification criteria;
- **workers**: active agents, assignments, progress, blocks, and controls;
- **decision**: real alternatives, consequences, recommendation, and choice;
- **review**: diffs, test results, artifacts, and approval controls;
- **monitoring**: a running process and the threshold requiring intervention;
- **completion**: verified outcome, changed reality, and unresolved follow-up.

The terminal renderer may use a TUI, inline output, or a browser sidecar, but it must render the semantic mode rather than force every moment into chat. The Rails renderer must be able to open the same task and expose the same actions and state.

These labels are coding task phases and renderer variants, not new top-level surface modes. The canonical Flyd modes remain `quiet`, `conversation`, `decision`, `investigation`, `action`, and `monitoring`:

| Coding view | Canonical surface expression |
| --- | --- |
| Orientation | Conversation when input is needed, investigation when context is uncertain, action when a next move is ready, otherwise quiet |
| Plan | An action proposal, or a decision when alternatives require choice |
| Workers | Monitoring with worker-state objects |
| Review | Decision when choosing between outcomes, otherwise action approval |
| Completion | A resolved artifact in quiet, or action when follow-up remains |

CLI and Rails consume the same semantic plan and canonical mode. Surface validators remain authoritative; new renderer variants require registry entries and parity tests rather than new unconstrained modes.

#### 5. Take graduated initiative

Without asking, Flyd may:

- read connected local sources;
- retrieve and synthesize relevant memory;
- inspect repository and worker state;
- create and update its own tasks, plans, context packages, and surfaces;
- run read-only analysis and configured test commands;
- start or redirect a worker inside an approved task budget;
- retry a failed, reversible operation within a bounded policy;
- prepare drafts, proposals, diffs, and external actions for review.

Flyd must ask before:

- destructive file or data operations outside an already approved edit scope;
- publishing, sending messages, or creating public artifacts;
- purchases or paid resource increases outside an approved budget;
- deploying to production unless a standing policy explicitly permits it;
- exposing private data to a new service or recipient;
- changing credentials, permissions, or security policy;
- any action the applicable policy marks as consequential or irreversible.

Permissions are granted per capability, scope, destination, and duration. Trust may expand through explicit standing policies; it never silently becomes global autonomy.

The first worker execution for a task requires an explicit **task grant**, unless an existing standing policy covers the exact scope. A task grant contains:

- repository roots and permitted worktrees;
- allowed worker adapters and maximum concurrency;
- permitted file operations and command classes;
- test and verification commands that may run automatically;
- cost or usage budget;
- expiry at task completion, cancellation, time limit, or budget exhaustion;
- actions that always require renewed approval.

Confirming the task grant satisfies the existing requirement that OpenCode execution be approved before it starts. Within that grant, Flyd may start, stop, retry, or redirect workers without repeated confirmation. Scope expansion, writes outside approved roots, destructive operations, deployment, publication, purchases, secret disclosure, and permission changes always require a new approval unless a narrower standing policy explicitly permits them.

#### 6. Learn from verified outcomes

At task completion, Flyd must record:

- the intended outcome;
- the interpretation and plan used;
- significant decisions and their rationale;
- worker assignments and important outputs;
- files, artifacts, or external state changed;
- verification performed and its result;
- user corrections and feedback;
- unresolved work and the recommended re-entry point.

Only durable, reusable knowledge should update long-term memory. Session transcripts and raw worker output remain source evidence, not automatically promoted truth.

Release 1 uses this promotion policy:

- **Verified task facts** may be promoted automatically when tied to repository state, a commit, a command result, a passing test, or another registered verifier. Live repository facts are revalidated when a later task depends on them.
- **User decisions, corrections, and stated preferences** become durable when explicitly confirmed. They remain historical even when later superseded.
- **Inferred preferences and workflow patterns** remain labeled hypotheses. Flyd may use them to make a low-risk suggestion, but not as confirmed facts. They become learned preferences only after explicit confirmation or three independently accepted outcomes, and are reconsidered after 90 days without supporting use.
- **Worker claims and model synthesis** never promote themselves. They retain sources and require verification or confirmation.
- **Conflicts** preserve both claims and their provenance. Confirmed evidence outranks inference; a conflict that would change an action becomes a decision or focused question rather than a silent overwrite.

Promotion, supersession, expiry, and correction events are visible in provenance and produce deterministic derived-state rebuilds.

## One runtime, multiple surfaces

### Product contract

Flyd has one canonical agent runtime. CLI, Rails, and a later desktop application are clients of that runtime.

All surfaces must share:

- identity and personal profile;
- activity and task history;
- retrieval and world-state compilation;
- decisions, permissions, corrections, and outcomes;
- agent and tool capability registry;
- active worker state;
- semantic interface plans;
- artifacts and evidence references;
- feedback and learned preferences.

No surface may implement a smaller substitute intelligence. A capability can be unavailable because a device lacks the required permission or renderer, but the surface must expose the same task state and explain the limitation truthfully.

### Runtime boundary

The current CLI archive and retrieval machinery become services inside the runtime, not the owner of product behavior. Rails should not need to reconstruct intelligence from periodic exports indefinitely. The target runtime provides versioned local APIs for:

- appending observed events;
- querying grounded memory;
- creating and resuming tasks;
- submitting intents and corrections;
- planning and controlling workers;
- reading semantic interface plans;
- executing approved actions;
- subscribing to state changes.

The runtime is local-first and can run as a daemon. Interfaces communicate with it through a versioned, authenticated local protocol. Rails request paths continue to render persisted state immediately; model calls, retrieval refreshes, worker execution, and composition remain asynchronous.

### Release 1 authority and topology

Release 1 is single-user and local. The runtime daemon, PostgreSQL, Rails web process, and CLI run on the same trusted machine or private local network. Remote Rails-to-local-runtime connectivity and cloud synchronization are later work.

Authority is divided by durable domain, not duplicated:

- PostgreSQL is canonical for live operational state: tasks, task grants, workers, commands, decisions, corrections, artifacts, interface plans, idempotency keys, and delivery state.
- `~/.flyd` is canonical for raw personal and project memory evidence, CLI conversation transcripts, curated knowledge, and retrieval indexes.
- Repository and tool state remain canonical in their native systems and are observed into Flyd with references.

The runtime is the only command authority for changing operational state. A PostgreSQL transaction stores an operational change and its outbox event together. Background delivery exports eligible durable outcomes to `~/.flyd` idempotently and broadcasts state to Rails and CLI clients. Archive export may lag; task and permission state may not.

When the runtime is unavailable, CLI and Rails may show their last persisted state as explicitly stale and read-only. They may not launch workers or accept consequential actions. Runtime restart reconstructs active tasks and worker status from PostgreSQL before accepting commands.

### Conversation continuity and hot memory

Every completed CLI conversation turn is persisted immediately, not only when the process exits. Flyd stores:

- a canonical structured session record for deterministic restart;
- a verbatim raw transcript as source evidence;
- a lightweight wiki conversation index containing the user's statements and topic terms.

Conversation indexes are explicitly unpromoted source evidence. Their location in the wiki does not make assistant output or inferred claims user-confirmed truth. Decisions, corrections, preferences, and beliefs follow the promotion policy above.

A new CLI process can retrieve the most recent prior session directly without waiting for embedding, indexing, consolidation, or an LLM call. Ordinary `ask`, search, and conversational recall use immediate lexical and structured memory by default. Slower semantic expansion and reranking are explicit deep-retrieval operations.

CLI conversation memory combines the same durable domains available to Rails: recent conversations, decisions, active beliefs, learned behaviours, personal-context snapshots, discovery snapshots, runtime state, the raw archive, and curated wiki knowledge. Repository state is supplied only when the request concerns coding or current work; it is not Flyd's default identity or substitute for personal memory.

### Canonical state

Flyd has one authority per domain and a transactional handoff between operational state and memory evidence.

```text
native source evidence --------------------> ~/.flyd memory archive
                                                   |
                                                   v
intent + observed evidence -> PostgreSQL operational state
  -> durable tasks, workers, decisions, permissions, and artifacts
  -> transactional outbox -> durable memory outcomes
  -> agent execution state
  -> semantic interface plan
  -> CLI / Rails / desktop renderers
```

Every derived claim retains provenance. Every surface can resolve the evidence used to make a recommendation. Corrections repair affected derived state without deleting unrelated history.

## Scoped observation

The first observation domain is coding work:

- Flyd harness sessions;
- Codex and OpenCode worker prompts, outputs, and status;
- repository state, diffs, commits, tests, and local commands relevant to a task;
- task decisions, corrections, approvals, and outcomes.

Observation requirements:

- each source is explicitly connected;
- the user can inspect, pause, exclude, and remove a source;
- secrets and configured paths are redacted before model use;
- retention differs for raw activity, working state, and durable knowledge;
- stale activity cannot be represented as current reality;
- observation must produce a user-visible benefit or it should not be collected.

Disconnecting a source stops future collection but retains previously accepted evidence. Deleting a source performs a content purge from the raw archive, derived indexes, provider snapshots, and operational projections, then recomputes affected state. A minimal audit tombstone may retain source ID, deletion time, and content hash, but no deleted content. Encrypted backups are not rewritten in place; deleted content ages out within the configured backup-retention window, which must be visible before deletion. The activity journal is append-only for ordinary corrections and outcomes, with explicit privacy erasure as the only destructive exception.

Later observation domains may include browser activity, Claude/GPT history, files, calendar, communication, design tools, and feeds. These are not required to prove the first product.

## Rails and portal experience

The Rails application remains a first-class Flyd interface. During the coding-harness release it must provide, for the same active task:

- live task and worker state;
- generated decision, plan, monitoring, review, and completion surfaces;
- real artifacts such as diffs, images, documents, logs, and test results;
- the same actions and permission boundaries available in the harness;
- conversation when conversation is the right renderer;
- provenance and correction controls without making evidence visual noise.

The Rails root must not fill an empty stage with arbitrary content. News, discoveries, personal facts, and other proactive material may earn the surface only when Flyd's taste and timing judgment supports them. They are not fallback content for an idle product.

A later desktop application can provide operating-system observation, notifications, local permissions, terminal integration, and persistent presence. It must use the same runtime and semantic interface contract rather than creating a third intelligence implementation.

## Success criteria

### Primary product test

For two consecutive weeks, George starts Flyd before Codex or OpenCode on at least five working days per week and completes real coding work through it.

### First-release measures

- At least 70% of resumed sessions begin without George manually restating the prior task, decisions, or current blocker.
- At least 80% of Flyd's startup interpretations are accepted or corrected with one focused edit rather than replaced entirely.
- At least half of Flyd's recommended next actions are accepted or directly adapted.
- Flyd produces at least one accepted proactive, reversible intervention per working week.
- Every completed task records a verified outcome and a useful re-entry point.
- The same active task, workers, artifacts, and actions are visible in CLI and Rails within normal propagation latency.
- No stale or unsupported memory is presented as a confirmed current fact in acceptance testing.
- The user can identify why a recommendation was made without raw evidence dominating the interface.

These measures are diagnostic, not targets to game. The release fails if usage is achieved through reminders or if apparent intelligence comes from generic wording.

### Measurement definitions

- A **real coding session** is a Flyd task linked to a repository in which a worker runs and produces at least one repository, test, or review artifact. Sessions created only for demos or tests are excluded.
- A **resumed session** reopens the same unresolved task at least 30 minutes after its previous interactive session ended.
- A startup interpretation is **accepted** when the user proceeds without correction. It is **focused-corrected** when the user changes one stated fact, scope, or next action before proceeding. Replacing the interpretation or restating the task is a failure.
- A recommended action is **accepted** when executed as proposed. It is **directly adapted** when the user changes its scope once and then executes it in the same session.
- A proactive intervention is **accepted** when it is not rejected or undone and its claimed verification passes. Generic reminders and presentation-only changes do not count.
- The **correct re-entry point** is the startup recommendation the user accepts or focused-corrects. Weekly review samples the underlying task evidence to detect accidental acceptance.
- **Propagation latency** is measured from committed runtime event to visible client state. Release 1 requires p95 below two seconds on the local machine.

Technical release-candidate measurement requires at least ten real coding sessions, including five resumed sessions. Command idempotency, permission enforcement, and prevention of duplicate consequential effects must pass every automated acceptance run. Usage measurement begins with Release 1A, but the qualifying two-week primary product window restarts after Release 1C is available so every first-release measure can be evaluated consistently.

## Required acceptance journeys

### Journey 1: Resume interrupted work

1. George stops midway through a real task.
2. Repository and worker state change before the next session.
3. `flyd` reconstructs the task, distinguishes prior state from current state, and recommends the correct re-entry point.
4. George continues without a manual context dump.
5. The resumed work and verified outcome survive a runtime restart and another CLI session.

### Journey 2: Loose outcome to coordinated execution

1. George gives Flyd an outcome without choosing an agent or workflow.
2. Flyd retrieves relevant personal and project context.
3. Flyd creates success criteria, a plan, worker assignments, and the appropriate interface.
4. Codex and/or OpenCode perform bounded work.
5. Flyd monitors, redirects when justified, and presents a grounded review.
6. Verified completion updates the task and durable understanding.

### Journey 3: Useful initiative

1. A worker stalls, a test fails, or new repository evidence invalidates the current plan.
2. Flyd notices without a user prompt.
3. Flyd takes a safe, reversible action or prepares a consequential action for approval.
4. The intervention is specific, inspectable, and relevant to the intended outcome.
5. Feedback changes future behavior.

### Journey 4: Graduated permission

1. Flyd reaches an action requiring approval.
2. It explains the action, scope, destination, consequence, and evidence.
3. George approves once, rejects, edits, or creates a bounded standing permission.
4. Retries cannot execute the action twice.
5. The permission and outcome are available to every Flyd surface.

### Journey 5: Memory correction

1. Flyd recalls a stale, incomplete, or wrong fact.
2. George corrects it in either CLI or Rails.
3. The correction retains provenance and repairs affected world state.
4. A later task uses the corrected fact and does not repeat the original claim.

### Journey 6: Outcome-based learning

1. A real task produces a verified decision, repository outcome, and workflow preference signal.
2. Flyd promotes only the knowledge classes allowed by the promotion policy.
3. A later task retrieves the durable outcome and uses it to improve its plan or worker instructions.
4. Flyd revalidates live repository facts and keeps inferred preferences labeled.
5. Conflicting later evidence creates a visible correction or decision rather than silently replacing history.

### Journey 7: Cross-surface parity

1. A CLI task has active workers, a task grant, artifacts, and a pending action.
2. Rails displays the same committed task revision within the propagation budget.
3. George performs the pending action or correction in Rails.
4. CLI receives the same authoritative result without polling a separate brain.
5. Runtime interruption leaves both surfaces stale and read-only, then restores the same state after recovery.

## Scope sequence

### Release 1A: Continuity harness

- canonical local agent runtime and event journal;
- interactive Flyd coding harness;
- one OpenCode worker adapter using the existing execution path;
- project and personal context compilation;
- durable task, worker, decision, task-grant, and outcome state;
- orientation, action, monitoring, review, and completion terminal renderers;
- interruption and exact task resumption;
- correction, provenance, diagnostics, and usage instrumentation.

Dogfooding begins when Journey 1 passes. Release 1A is successful when Flyd is a better way to resume one real task than opening OpenCode directly.

Release 1A has a five-working-day continuity trial. Its measures are resume rate, interpretation acceptance, verified completion, and manual tool escape. Proactive-intervention and Rails-parity measures do not apply yet.

### Release 1B: Agent control and initiative

- Codex worker adapter;
- capability-based worker selection;
- bounded parallel assignments and isolated worktrees;
- worker monitoring, stop, retry, redirect, and replacement;
- safe proactive intervention inside an approved task grant;
- verification and conflict handling.

Release 1B is successful when Journeys 2, 3, and 4 pass without manual context transfer between workers.

Release 1B has a five-working-day control trial covering worker routing, initiative, task grants, and safe recovery.

### Release 1C: Rails parity

- synchronized Rails task and worker surfaces;
- identical task actions and permission decisions in CLI and Rails;
- live code, diff, test, log, image, document, and artifact bindings;
- bidirectional correction and completion state;
- cross-surface latency and recovery guarantees.

Release 1C is successful when Journeys 5, 6, and 7 pass. The qualifying two-week primary product window begins after this gate. Release 1 as a whole completes only when that window passes.

Implementation status (2026-07-20): the shared command authority, persisted permission proposals, Rails task scenes and controls, verified artifact delivery, committed event listener, structured corrections, verified outcome promotion, browser-visible latency receipts, and fail-closed Release 1 acceptance report are implemented on `main`. Automated contract and cross-surface tests pass. The real-session evidence and qualifying two-week primary-product window remain a dogfood trial, not missing interface functionality.

### Release 2: Multi-agent workbench

- richer parallel and specialist agent coordination;
- reusable workflows and learned routing preferences;
- generated visual workspaces for design, writing, research, and planning;
- stronger artifact creation and editing;
- task-level budgets and performance comparisons;
- proactive personal briefing grounded in live activity and taste.

### Release 3: Desktop personal portal

- native persistent application;
- explicit operating-system observation connectors;
- notifications and background presence;
- browser, communication, calendar, file, and design-tool context;
- cross-domain personal world model;
- richer reversible automation.

### Release 4: Personal agent platform

- onboarding and isolation for multiple users;
- portable agent identity, history, preferences, and permissions;
- user-controlled cloud synchronization;
- third-party agent, tool, and renderer SDKs;
- agent-to-agent interoperability;
- policy-governed interactions with store and service agents.

Each release must preserve the same runtime and product identity. Later surfaces expand presence; they do not fork the brain.

## Explicit non-goals for Release 1

- replacing every writing, design, browsing, and communication tool;
- broad ambient observation outside coding work;
- multi-user accounts or a public platform launch;
- a production desktop application;
- unrestricted model-generated HTML, CSS, or executable interface code;
- fully autonomous destructive, public, financial, or security-sensitive actions;
- using news, horoscopes, feeds, or stored records to make an empty interface appear active;
- another standalone redesign of the Rails homepage without live task intelligence;
- improving model benchmark performance for its own sake.

## System audit

### Reusable foundations

- the `~/.flyd` archive, retrieval, graph, attention, interest, and maintenance machinery;
- the versioned CLI brain capability and retrieval contracts;
- Rails `Surface`, `SurfaceItem`, `Scene`, `Intent`, and `Artifact` domains;
- background world-state composition, validation, persistence, activation, and broadcast;
- evidence provenance and reference validation;
- OpenCode proposal, confirmation, execution, and outcome flow;
- Rails-to-archive event export;
- controlled semantic renderer and action registries.

### Missing product foundations

- an interactive Flyd agent harness;
- a canonical live activity journal shared by all surfaces;
- durable agent-task and worker-session models;
- worker adapters and a capability-based router;
- context packages designed for execution rather than retrieval display;
- monitoring and intervention loops for running agents;
- a per-action autonomy and permission policy;
- semantic coding-work interfaces shared by CLI and Rails;
- outcome-based learning and daily-use instrumentation;
- a runtime API that replaces long-term CLI/Rails split-brain behavior.

## Delivery epics

### Epic 0: Truth and baseline

- instrument current Flyd, Codex, and OpenCode usage without collecting unrelated activity;
- define the intelligence-event rubric and daily-driver measures;
- create real acceptance fixtures from active Flyd development work;
- establish cost, latency, privacy, and reliability budgets.

Exit gate: the team can measure whether Flyd reduced context reconstruction and whether a proactive action was accepted.

### Epic 1: Canonical agent runtime

- define the event, task, worker, permission, artifact, and interface-plan contracts;
- extract CLI brain functions behind a versioned local runtime API;
- establish authenticated subscriptions and idempotent commands;
- migrate existing CLI and Rails evidence without losing provenance.

Exit gate: PostgreSQL operational authority, archive evidence authority, transactional outbox, runtime recovery, and read-only failure behavior pass contract tests.

### Epic 2: Coding harness

- implement the interactive `flyd` session;
- implement the OpenCode adapter over the existing proposal and execution path;
- compile startup orientation from memory and live repository evidence;
- accept outcomes and corrections;
- render orientation, plan, worker, decision, review, monitoring, and completion modes;
- support interruption and exact resumption.

Exit gate: Journey 1 passes on a real interrupted Flyd repository task.

The five-day Release 1A continuity trial starts here. Later epics continue while Release 1A is used for real work.

### Epic 3: Agent orchestration

- implement the Codex adapter and extend the OpenCode adapter to the full worker lifecycle;
- add capability discovery, assignment, progress, stop, retry, redirect, and completion contracts;
- verify worker claims against repository and test evidence;
- handle concurrent and conflicting work safely.

Exit gate: Journeys 2 and 3 pass with at least one multi-worker task and no manual context transfer between workers.

### Epic 4: Autonomy and learning

- implement graduated permission policies;
- add bounded monitoring and reversible interventions;
- write verified outcomes and user corrections into durable understanding;
- prevent unverified worker output from becoming personal truth.

Exit gate: Journeys 3, 4, 5, and 6 pass, including idempotency, promotion policy, later-session learning, and correction propagation.

### Epic 5: Rails parity

- render live task and worker plans through the Rails surface contract;
- expose the same actions and permission decisions;
- bind real diffs, files, images, logs, tests, and artifacts;
- prove bidirectional correction and action state.

Exit gate: Journey 7 passes and every Release 1 task state can be understood and advanced from either CLI or Rails, subject only to an explicit device capability limitation.

### Epic 6: Daily-driver trial

- run the harness on Flyd development for two consecutive weeks;
- review failed interpretations, ignored recommendations, repeated corrections, and manual tool escapes;
- fix the highest-frequency causes rather than adding decorative portal content;
- decide whether the evidence supports desktop expansion.

Exit gate: the primary product test and first-release measures are met without reminders or staged demonstrations.

## Failure modes and required responses

| Failure mode | What it looks like | Required response |
| --- | --- | --- |
| Memory theatre | Flyd repeats personal facts but does not improve work | Measure decisions and outcomes enabled by memory, not recall volume |
| Context dumping | Flyd sends every stored fact to every worker | Build task-specific context packages with budgets and provenance |
| Split brain | CLI and Rails disagree about tasks, permissions, or memory | One runtime contract and parity tests across every state-changing capability |
| Model wrapper | Flyd is a branded prompt in front of one provider | Capability-based worker adapters and replaceable providers |
| Fake initiative | Flyd generates busywork or generic reminders | Require a live trigger, expected value, bounded action, and feedback |
| Permission fatigue | Every agent step asks for approval | Graduated policies with clear standing scopes and idempotent execution |
| Runaway autonomy | Workers expand scope or act externally | Task budgets, capability allowlists, stop controls, and consequential-action gates |
| Stale confidence | Old activity is presented as current fact | Freshness, live-state verification, and explicit uncertainty |
| Interface theatre | The surface looks dynamic but shows invented or irrelevant content | Every work object resolves to live task evidence or a real artifact |
| Dashboard regression | The portal becomes a grid of stored records | Compose around the active outcome; records remain evidence |
| Worker conflict | Parallel agents overwrite or contradict each other | Isolated assignments, repository-state checks, merge ownership, and conflict escalation |
| Endless work | Flyd keeps agents active without a finish condition | Explicit success criteria, budgets, inactivity thresholds, and terminal outcomes |
| Cost opacity | Multi-agent work becomes unexpectedly expensive | Per-task budgets, provider usage records, warnings, and stop policies |
| Privacy leakage | Personal context reaches an unnecessary provider | Source scopes, redaction, provider disclosure, and least-context routing |

## Security and trust requirements

- Local runtime endpoints are authenticated and unavailable to unrelated origins or users.
- Worker commands use structured argument arrays and capability allowlists.
- A selected coding worker is trusted to read the repository roots named in its task grant. Release 1 does not claim per-file confidentiality inside an approved root.
- Workers run from Flyd-managed worktrees with a sanitized environment and no Flyd-granted access to unrelated repositories, home-directory data, credentials, or personal memory.
- Secrets are detected and redacted from Flyd-built context and environment variables before context leaves the local trust boundary. Detected tracked secrets trigger a warning before a cloud-backed worker starts.
- Every external provider receives the minimum personal and cross-project context required for its assignment. Repository access and provider identity are disclosed in the task grant.
- Consequential actions use persisted, server-authoritative payloads and idempotency keys.
- Task, worker, permission, and action logs are auditable without storing private chain-of-thought.
- Imported worker text is untrusted evidence and cannot directly authorize tools or alter policy.
- The user can stop all workers and revoke standing permissions immediately.
- Backups cover the canonical journal, durable state, and encryption keys according to the existing local-first policy.

## Product standard

Release 1 is not complete because Flyd can launch a coding agent, recall a note, render a polished surface, or pass a scripted demo.

It is complete only when Flyd becomes the preferred way to start and resume real coding work because it understands the user and the situation better than opening the underlying agents directly.

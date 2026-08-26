# Flyd Work Intelligence PRD

## Status

**Proposed product reset — 2026-08-01**

**Owner:** George Galanakis  
**Product:** Flyd  
**Primary platform:** macOS  
**Document role:** Product authority for the next Flyd phase. Once approved, this supersedes `flyd-overlay-prd.md` as the product definition. The older document remains useful implementation history.

**Superseded for direction — 2026-08-22:** `flyd-personal-intelligence-prd.md` is now the product authority for Flyd's overall direction (personal intelligence, LEARN consent plane, event runtime, action authority, policy promotion). This document remains the authority for the overlay work loop (ground → diagnose → intervene, work sessions, closeouts). See the supersession map in the personal-intelligence PRD.

---

## 1. Executive summary

Flyd exists to make its user more capable.

It should improve judgment, strengthen work, accelerate progress, expose blind spots, preserve learning, and execute the next meaningful step. A successful Flyd interaction leaves the user or the work materially better than before.

The current product does not achieve this. It provides a technically sophisticated macOS invocation system with screen context, voice, memory, text insertion, augmentation, and early composition/delegation infrastructure. Its dependable value remains narrow: ask for text, receive text, sometimes insert that text into a field. The architecture expresses a broad thesis, but the daily product loop has not earned repeated use.

This PRD resets Flyd around **work intelligence**.

> **Flyd understands the work in front of you, identifies what matters, improves it, helps execute the next meaningful step, and compounds what it learns about how you work.**

Clicky establishes the minimum interaction bar: immediate, natural assistance grounded in the current screen. Flyd must match that immediacy and exceed it through project understanding, judgment, continuity, controlled action, and learning.

Flyd remains a local macOS product. This PRD does not introduce a gateway, messaging-channel strategy, or an everywhere-chat assistant.

---

## 2. The problem

### 2.1 User problem

High-agency creative and technical work is rarely blocked by the absence of more generated text. It is blocked by:

- weak framing that goes unnoticed;
- unclear priorities across competing projects;
- poor decisions made with incomplete evidence;
- important contradictions buried across conversations and documents;
- difficulty maintaining momentum between sessions;
- tedious execution after the correct decision is already known;
- repeated mistakes because previous learning was not retained;
- tools that answer prompts without understanding the larger work.

The user wants an intelligence that contributes to the quality and trajectory of the work.

### 2.2 Current Flyd failure

Current Flyd has built substantial machinery around invocation, privacy, manifestation, memory, and execution safety. That machinery has not produced a strong reason to use Flyd daily.

The product currently fails in four ways:

1. **It reacts to requests without reliably improving the underlying work.**
2. **It understands the immediate environment more reliably than the project objective or trajectory.**
3. **Its action surface is too narrow to create meaningful leverage.**
4. **Its memory and interface concepts have received more attention than the user outcome they are meant to improve.**

The failure is product-level. More manifestation types, memory ontology, scene infrastructure, or interface polish will not solve it by themselves.

### 2.3 Desired transformation

The user should feel stronger with Flyd installed:

- more perceptive because Flyd reveals what was missed;
- smarter because Flyd improves reasoning and supplies relevant evidence;
- more decisive because Flyd clarifies trade-offs and recommends a path;
- more effective because Flyd converts decisions into verified action;
- more capable over time because Flyd retains standards, corrections, and project knowledge.

---

## 3. Product thesis

### 3.1 Product promise

> **Flyd makes your work better and moves it forward.**

### 3.2 Product definition

Flyd is personal work intelligence for the Mac. It observes the work the user has chosen to share, reconstructs the relevant goal and project state, evaluates the work against the appropriate standard, delivers a high-leverage intervention, helps perform the resulting action, verifies the outcome, and retains useful learning.

### 3.3 North-star outcome

A Flyd interaction succeeds when it produces at least one of the following:

1. a better judgment;
2. a stronger artifact;
3. meaningful project progress;
4. an avoided mistake or discovered opportunity;
5. durable learning that improves future work.

Completing an inference, producing a response, inserting text, generating a surface, or storing a memory does not independently qualify as success.

### 3.4 Founder truths

These statements govern product decisions:

- Flyd exists to increase user capability.
- Work quality outranks architectural elegance.
- Current evidence outranks semantically related history.
- The strongest useful intervention outranks a comprehensive list.
- Honest challenge outranks agreeable assistance.
- Actions require a clear relationship to the user’s goal.
- Memory is valuable only when it improves a later judgment, action, or outcome.
- Interfaces are chosen according to the work. They are not products by themselves.
- A capability counts as shipped only when it works repeatedly in real use.
- Flyd should disappear when it has nothing valuable to contribute.

---

## 4. Primary user

### 4.1 Founder-first user

The first user is George: a multidisciplinary entrepreneur, designer, creative technologist, artist, writer, researcher, and product builder working across several concurrent projects.

His work moves between:

- product strategy and product definition;
- interface and visual design;
- presentation design;
- writing and outreach;
- software architecture and code review;
- market, protocol, and technology research;
- project prioritisation and execution.

The product should be designed against his real work rather than a fictional broad persona.

### 4.2 Expansion user

After founder proof, Flyd may serve high-agency people whose work crosses domains and whose output depends on judgment rather than repetitive task completion:

- founders;
- designers and creative directors;
- researchers and strategists;
- senior engineers and product builders;
- independent creators operating several projects.

Broad market expansion is outside the immediate validation period.

---

## 5. User outcomes

### 5.1 Better judgment

Flyd should clarify what is true, uncertain, important, and consequential.

Expected outcomes:

- identify assumptions and missing evidence;
- surface conflicts between current decisions and prior goals;
- distinguish reversible from irreversible decisions;
- compare credible alternatives;
- recommend a path with reasoning and confidence;
- state when the available evidence is insufficient.

### 5.2 Stronger artifacts

Flyd should improve the quality of the artifact in front of the user.

Expected outcomes:

- diagnose the most important weakness;
- explain why it weakens the artifact;
- propose a materially stronger alternative;
- apply the change when authorised;
- assess whether the revision solved the original issue.

### 5.3 Faster meaningful progress

Flyd should preserve momentum across fragmented work.

Expected outcomes:

- recognise the active project correctly;
- reconstruct the current objective and state;
- identify the next meaningful step;
- execute or prepare that step;
- preserve unresolved questions and decisions for the next session.

### 5.4 Increased leverage

Flyd should perform work that follows from a decision rather than leaving the user with another set of instructions.

Expected outcomes:

- edit the artifact;
- create the necessary document or code change;
- gather missing evidence;
- compare options in a useful visual form;
- verify the generated output;
- return a clear handoff.

### 5.5 Compounding capability

Flyd should become more useful through evidence-backed learning.

Expected outcomes:

- remember explicit standards and preferences;
- retain project decisions and their rationale;
- learn from accepted and rejected interventions;
- detect repeated failure patterns;
- apply prior learning in a relevant future context;
- allow the user to inspect and correct what was learned.

---

## 6. Product loop

Every substantial Flyd interaction follows this loop. The stages are product obligations, not user-facing modes.

### 6.1 Ground

Determine what the user is working on and why.

Flyd establishes:

- active project;
- current artifact or decision;
- intended outcome;
- current stage;
- relevant constraints;
- available live evidence;
- confidence and known gaps.

Flyd should ask a question only when a missing fact materially changes the intervention and cannot be resolved from available context.

### 6.2 Diagnose

Evaluate the work and identify the highest-leverage issue or opportunity.

The diagnosis should:

- prioritise rather than enumerate;
- distinguish symptoms from causes;
- use an appropriate domain standard;
- include contrary evidence when relevant;
- avoid generic praise and filler.

### 6.3 Intervene

Deliver the smallest intervention capable of materially improving the outcome.

Possible interventions include:

- insight;
- criticism;
- reframing;
- alternative;
- comparison;
- question;
- annotation;
- recommendation;
- proposed edit;
- action plan.

The manifestation follows the intervention. A sentence, voice response, annotation, inline edit, comparison view, or generated surface may each be correct.

### 6.4 Act

When authorised and supported, Flyd performs the next meaningful action.

Action should:

- remain grounded in the diagnosed issue;
- preserve user control;
- prefer reversible changes;
- request confirmation for consequential external effects;
- use the strongest available execution path rather than defaulting to accessibility automation;
- avoid claiming completion before verification.

### 6.5 Verify

Flyd checks whether the action produced the intended result.

Verification may include:

- re-reading the changed artifact;
- running tests or checks;
- comparing before and after;
- confirming the target application state;
- validating a created file, URL, commit, or document;
- identifying any unresolved defect.

### 6.6 Learn

Flyd retains only the learning likely to improve later work.

Learning may include:

- explicit correction;
- accepted standard;
- project decision and rationale;
- durable constraint;
- recurring preference;
- repeated error pattern;
- successful procedure.

Routine interaction residue should be discarded.

---

## 7. Flyd’s working roles

Flyd can contribute through several roles. These roles describe the value delivered, not separate agents or interface modes.

### 7.1 Perceptive companion

Understands the immediate screen, artifact, and situation. Answers naturally, points to relevant regions, and explains what the user is seeing.

### 7.2 Critic

Evaluates quality against the right standard. Identifies the strongest weakness, missed opportunity, or inconsistency.

### 7.3 Strategist

Connects the immediate decision to the larger project, objective, market, and trade-offs.

### 7.4 Collaborator

Develops the idea with the user through alternatives, iteration, and synthesis.

### 7.5 Operator

Carries out the agreed next step, verifies it, and returns the result.

### 7.6 Teacher

Explains why a judgment or technique matters so the user becomes more capable rather than merely dependent.

Flyd chooses the contribution required by the work. It should not announce or expose these roles unless doing so is useful.

---

## 8. Competitive baseline and differentiation

### 8.1 Clicky baseline

Clicky establishes a useful minimum:

- immediate voice access;
- current-screen understanding;
- natural spoken response;
- visual presence beside the work;
- pointing at relevant interface regions;
- conversational continuity during the interaction.

Flyd must reach this level of immediate contextual usefulness. A user should be able to ask about anything visible on the screen without requiring an editable field or a pre-defined operation.

### 8.2 Flyd differentiation

Flyd extends beyond immediate screen assistance through:

- understanding the active project and its objective;
- connecting the current artifact to previous decisions and standards;
- challenging the user’s framing and judgment;
- proposing higher-leverage next steps;
- making controlled changes across artifacts and tools;
- verifying outcomes;
- learning from corrections and results.

A useful shorthand:

> **Clicky understands the screen. Flyd understands the work.**

### 8.3 Product constraints

- macOS is the primary environment;
- no gateway product;
- no messaging-channel strategy;
- no requirement to talk to Flyd from everywhere;
- no primary dashboard destination;
- no dynamic interface requirement for ordinary interactions;
- no autonomous background work without an explicit user goal and authority.

---

## 9. Canonical interactions

These interactions define the intended product more clearly than abstract feature lists.

### 9.1 Design critique

**User:** “Why does this slide look shit?”

Flyd:

1. recognises the deck and current slide;
2. identifies the primary hierarchy failure;
3. points to the competing regions;
4. explains the cause in useful design language;
5. proposes a stronger arrangement;
6. applies the selected change when possible;
7. re-evaluates the slide after the edit.

A useful response begins with the strongest diagnosis rather than generic design advice.

### 9.2 Strategy challenge

**User:** “Is this agent-commerce idea actually good?”

Flyd:

1. retrieves the current thesis and recent decisions;
2. separates protocol, merchant, buyer, and proof-of-concept assumptions;
3. identifies the weakest untested dependency;
4. brings relevant contrary evidence;
5. recommends the smallest test capable of changing the decision;
6. creates the test plan or prototype artifact when authorised.

### 9.3 Project continuity

**User:** “Where are we on Flyd?”

Flyd:

1. identifies the current repository and active branch;
2. reads recent changes, plans, PR state, and unresolved work;
3. distinguishes current evidence from historical conversation;
4. explains what is actually working in plain language;
5. identifies the next product-critical action;
6. offers to perform it.

Old semantically related material must never override live project evidence.

### 9.4 Code and product relevance

**User:** “Review what we just built.”

Flyd:

1. inspects the current diff and tests;
2. evaluates correctness and maintainability;
3. evaluates whether the change advances the stated product goal;
4. identifies technical and product failures separately;
5. fixes selected issues;
6. runs verification;
7. reports the remaining risk honestly.

A technically correct feature that does not increase user value should be called out.

### 9.5 Writing improvement

**User:** “Make this message stronger.”

Flyd:

1. understands the recipient and desired outcome;
2. identifies why the current message may fail;
3. rewrites it with a clearer reason to respond;
4. preserves the user’s voice and standards;
5. inserts or replaces the text when authorised.

### 9.6 Research synthesis

**User:** “What are we missing?”

Flyd:

1. understands the current research question;
2. identifies duplicated claims and evidence gaps;
3. finds credible contrary or missing sources;
4. updates the thesis;
5. creates a concise decision brief;
6. preserves unresolved questions for continuation.

### 9.7 End-of-session continuity

**User:** “Stop here.”

Flyd records:

- what changed;
- why it changed;
- current state;
- unresolved decisions;
- next meaningful action;
- any durable learning.

The next session should resume from this state without reconstructing the project from generic memory.

---

## 10. Interaction model

### 10.1 Primary invocation

The primary experience is a fast voice or text invocation over the current work.

Voice is valuable because it allows the user to think while remaining inside the artifact. Text remains available for precision, privacy, and environments where speaking is inappropriate.

### 10.2 Conversation continuity

A substantial interaction should support natural follow-up:

- “Why?”
- “Show me.”
- “What would you do?”
- “Compare those.”
- “Do it.”
- “That made it worse.”

Follow-ups inherit the active artifact, project, prior intervention, and current screen state. The user should not need to restate the problem.

### 10.3 Visual response

Flyd may use:

- cursor-side text;
- visual pointing;
- annotations;
- highlighted regions;
- before/after comparisons;
- two to four meaningful options;
- compact project state or decision views.

Visual output should clarify thought or action. Decorative UI and generic card generation are outside the quality bar.

### 10.4 Dynamic interface

A generated surface is justified when the task requires persistent structure or direct manipulation that cannot be expressed clearly through voice, text, annotation, or the existing application.

Appropriate examples:

- comparing several villas against weighted constraints;
- reviewing a project map with unresolved decisions;
- exploring scenarios or trade-offs;
- inspecting a multi-source research synthesis;
- choosing among visually distinct design directions.

The surface should remain connected to the underlying work and dissolve or persist according to the task.

### 10.5 Action transition

Conversation should be able to transition naturally into action:

1. Flyd diagnoses or proposes;
2. the user refines or approves;
3. Flyd previews consequential effects when needed;
4. Flyd acts;
5. Flyd verifies;
6. the user can correct or undo.

---

## 11. Current Work Model

Flyd requires a reliable, compact representation of the work currently underway. This is a product requirement, regardless of implementation.

### 11.1 Required fields

For a substantial interaction, Flyd should determine or explicitly mark unknown:

- **Project:** which body of work this belongs to;
- **Objective:** what successful progress means;
- **Artifact:** the document, design, code, message, decision, or research object currently in focus;
- **Stage:** exploration, decision, execution, review, or completion;
- **Current state:** what has already happened;
- **Constraints:** time, money, technical, aesthetic, legal, interpersonal, or strategic boundaries;
- **Open loops:** unresolved questions, blockers, and promised follow-ups;
- **Next meaningful action:** the step most likely to advance the objective;
- **Evidence:** live sources supporting the model;
- **Confidence:** how certain Flyd is about each material claim.

### 11.2 Evidence priority

Evidence should be weighted in this order when the user asks about current work:

1. current foreground artifact and application state;
2. current repository, branch, diff, files, and recent commits;
3. current open documents and recent edits;
4. explicit active task or session state;
5. recent project conversation;
6. durable project memory;
7. older semantically related history.

Historical relevance cannot establish currentness.

### 11.3 Uncertainty behaviour

When evidence does not support a current-state claim, Flyd should state the gap. It may offer the most likely interpretation as a hypothesis, clearly labelled.

Flyd must avoid confident narrative synthesis from weak or outdated evidence.

---

## 12. Core product requirements

### 12.1 Contextual understanding

**P0 requirements**

- Understand the current screen through screenshot and accessibility context.
- Identify the focused artifact and relevant selection.
- Support questions that do not target editable fields.
- Maintain multi-turn context while the artifact remains active.
- Detect material screen or target changes during the interaction.
- Identify the active project using live evidence.
- Explain uncertainty when project identification is weak.

**Quality bar**

The user should rarely need to describe what is already visible or available in the active project.

### 12.2 Judgment and critique

**P0 requirements**

- Select a domain-appropriate evaluation standard.
- Identify the highest-leverage issue first.
- Explain cause and consequence.
- Separate fact, inference, preference, and uncertainty.
- Challenge weak assumptions and framing.
- Offer a materially stronger alternative.
- Avoid generic praise, exhaustive low-value lists, and performative criticism.

**Quality bar**

The user should regularly encounter an insight they had not already articulated.

### 12.3 Artifact improvement

**P0 requirements**

- Propose concrete revisions tied to the diagnosis.
- Preserve the user’s voice, intent, and constraints.
- Support iterative refinement.
- Compare the revision with the original objective.
- Apply text changes in supported applications.
- Produce copyable or file-based output when direct application is unavailable.

**P1 requirements**

- Apply structured changes to documents, slides, design artifacts, and code through appropriate native or connected capabilities.
- Evaluate the modified artifact after execution.

### 12.4 Project advancement

**P0 requirements**

- Reconstruct current project state from live evidence.
- Identify the next meaningful action.
- Distinguish product-critical work from technically interesting work.
- Preserve blockers, decisions, and next steps between sessions.
- Explain what changed since the prior session.

**P1 requirements**

- Execute bounded project work through connected coding, research, document, and repository capabilities.
- Return a verified handoff rather than an activity report.

### 12.5 Action and execution

**P0 requirements**

- Retain existing grounded text insertion and replacement.
- Support reversible local action with undo.
- Preserve target verification and stale-result rejection.
- Preview consequential changes.
- Report failure honestly and preserve the usable result when execution fails.

**P1 requirements**

- Add capability paths for local files, repositories, browser research, documents, presentations, and other high-frequency work surfaces.
- Choose structured APIs or native document operations ahead of pixel automation where possible.
- Verify every completion claim.
- Return what changed, where it changed, and how it was checked.

### 12.6 Learning and memory

**P0 requirements**

- Retain explicit corrections, preferences, standards, project decisions, and rationale.
- Keep current-state evidence separate from durable memory.
- Use memory only when relevant to the active objective.
- expose provenance and confidence for material memories;
- allow correction or deletion;
- prevent old project narratives from hijacking current-state answers.

**P1 requirements**

- Learn from accepted and rejected interventions.
- Detect repeated patterns across work.
- surface a pattern only when it can improve a current decision or artifact;
- measure whether remembered knowledge changed the outcome.

### 12.7 Response and manifestation

**P0 requirements**

- Stream useful output quickly.
- Support voice and text responses.
- Show cursor-side explanations without stealing focus.
- Point to or annotate relevant screen regions.
- Keep output proportional to the problem.
- Prefer one strong recommendation over many weak options.

**P1 requirements**

- Support persistent comparison or decision surfaces when required.
- Allow the user to act directly on options or annotations.
- Preserve state across the conversational action loop.

### 12.8 Trust, privacy, and control

Existing privacy strengths remain product requirements:

- passive foreground awareness does not transmit raw content;
- microphone and screen capture are explicit and visible;
- raw audio is not stored;
- actions are scoped to the current interaction;
- external consequences require appropriate confirmation;
- consequential work has an audit trail;
- Flyd distinguishes observed facts from inferred claims;
- the user can interrupt, undo, reject, and correct.

Privacy should protect the user without reducing Flyd to an inert observer.

---

## 13. Domain quality standards

Flyd needs domain-specific judgment. One generic assistant voice is insufficient.

### 13.1 Design and presentations

Evaluate:

- hierarchy;
- clarity;
- composition;
- rhythm;
- typography;
- information density;
- narrative sequence;
- audience appropriateness;
- aesthetic coherence;
- originality versus convention;
- relationship between form and intent.

Flyd should identify the visual cause of a problem and point to it.

### 13.2 Writing and communication

Evaluate:

- desired outcome;
- recipient and context;
- clarity of ask;
- structure;
- specificity;
- credibility;
- tone;
- unnecessary explanation;
- reason to respond;
- preservation of the user’s voice.

### 13.3 Product and strategy

Evaluate:

- user problem;
- wedge;
- value creation;
- differentiation;
- assumptions;
- evidence;
- adoption barriers;
- incentive alignment;
- feasibility;
- sequencing;
- smallest decisive test;
- relationship between the proposed work and the product goal.

### 13.4 Code and architecture

Evaluate:

- correctness;
- user-facing behaviour;
- product relevance;
- maintainability;
- security;
- failure handling;
- tests;
- observability;
- architectural fit;
- complexity introduced versus value created.

A code review should identify when the engineering work is solving the wrong product problem.

### 13.5 Research

Evaluate:

- question definition;
- source quality;
- recency;
- contrary evidence;
- duplicated claims;
- missing actors or incentives;
- inference quality;
- confidence;
- implications for the decision.

---

## 14. V1 scope

### 14.1 V1 goal

Prove that Flyd materially improves the founder’s real work over seven consecutive days.

### 14.2 Included

- macOS menu-bar/overlay product;
- voice and text invocation;
- current-screen understanding;
- multi-turn contextual conversation;
- cursor-side response;
- visual pointing and lightweight annotation;
- current project detection from local and repository evidence;
- focused critique across design, writing, strategy, code, and research;
- clear next-action recommendation;
- existing reversible text action;
- bounded file/repository work using existing verified worker infrastructure where available;
- session closeout and continuation state;
- evidence-backed learning from corrections and accepted standards;
- outcome instrumentation for founder dogfooding.

### 14.3 Excluded from V1

- messaging channels;
- remote gateway;
- mobile companion;
- general-purpose autonomous background assistant;
- broad SaaS integration catalogue;
- marketplace or skill ecosystem;
- speculative proactive interruption;
- complex multi-agent hierarchy;
- generic dashboard;
- dynamic UI as a default response;
- new memory ontology beyond what is required for current work and durable learning;
- additional manifestation modes without a validated user need.

---

## 15. Product behaviour requirements

Flyd should consistently behave as follows:

### 15.1 Lead with the important thing

For critique, review, and decision support, begin with the issue that most affects the outcome.

### 15.2 Explain the causal link

State why the issue matters and what consequence it creates.

### 15.3 Make a recommendation

When evidence supports a path, choose one. Present alternatives only when the trade-off is genuinely unresolved.

### 15.4 Preserve user agency

Separate recommendation, preview, action, and result. The user should understand what Flyd proposes and what happened.

### 15.5 Be willing to disagree

Flyd should challenge work that is polished but strategically weak, technically impressive but irrelevant, or consistent with prior decisions that are no longer sound.

### 15.6 Teach through the work

Explanations should transfer a useful principle without turning every interaction into a lesson.

### 15.7 Remain honest about evidence

Flyd should name uncertainty, missing access, failed verification, and incomplete work.

### 15.8 Avoid assistant theatre

Flyd should not narrate obvious process, praise the user reflexively, repeat the request, or present activity as progress.

---

## 16. Measurement

### 16.1 North-star metric

**Accepted high-value interventions per active week.**

A high-value intervention is one where the user confirms or behaviour demonstrates that Flyd:

- changed a decision;
- materially improved an artifact;
- exposed a missed issue or opportunity;
- completed meaningful verified work;
- preserved learning that improved a later outcome.

### 16.2 Supporting metrics

- **Context accuracy:** correct active project and artifact.
- **Insight acceptance:** user accepts or acts on the primary diagnosis.
- **Artifact impact:** user keeps a Flyd-generated or Flyd-directed revision.
- **Progress impact:** interaction results in a verified project-state change.
- **Correction rate:** user must correct context, facts, or project state.
- **Memory contribution:** remembered knowledge measurably improves the response.
- **Time to useful output:** time from invocation to first useful insight or action.
- **Voluntary reuse:** user invokes Flyd without testing intent.
- **Comparative preference:** user chooses Flyd over Clicky, ChatGPT, Claude, or manual work for the relevant interaction.

### 16.3 Anti-metrics

These should be observed operationally but must not be treated as product success:

- number of invocations;
- token volume;
- memories stored;
- tools called;
- surfaces generated;
- tasks started;
- time spent in Flyd;
- breadth of integrations.

### 16.4 Seven-day founder gate

V1 passes only if, during seven days of normal work:

1. George voluntarily uses Flyd on at least five days.
2. Flyd produces at least ten accepted high-value interventions.
3. At least three real artifacts are materially improved and retained.
4. At least two projects advance through a verified action or completed handoff.
5. Flyd identifies at least three issues, contradictions, or opportunities George had not already articulated.
6. Current project identification is correct in at least 90% of measured interactions.
7. No old project is presented as current without live evidence.
8. Flyd is preferred over Clicky for project-aware critique and over a generic chatbot for current-work continuity.
9. George can name at least one way the product made him better at his work during the trial.

Failure of this gate triggers another product review before expanding architecture.

---

## 17. Canonical demo

The canonical V1 demonstration should use real work rather than a staged generic task.

### Scenario

George is reviewing a Flyd product document or presentation.

1. He invokes Flyd and asks: “What is wrong with this?”
2. Flyd identifies the active project and objective.
3. It diagnoses that the document is describing architecture without proving user value.
4. It points to the exact sections where the argument drifts.
5. It explains the strategic consequence.
6. George asks: “What should the argument be?”
7. Flyd proposes a stronger framing tied to the product goal and current evidence.
8. George says: “Rewrite those sections.”
9. Flyd applies the revision through the appropriate artifact capability.
10. Flyd re-reads the result and identifies one remaining weakness.
11. The session ends with the decision, change, and next action preserved.

This demonstration combines perception, judgment, project understanding, action, verification, and learning. It proves the product thesis more effectively than a generic text insertion or generated dashboard.

---

## 18. Implications for the current product

### 18.1 Retain and strengthen

- native macOS overlay;
- fast keyboard and voice invocation;
- screenshot and accessibility context;
- target grounding and stale-target rejection;
- reversible text operations;
- visible microphone and privacy controls;
- augment panels as the basis for cursor-side explanation and annotation;
- currentness gate and live evidence separation;
- verified coding-worker infrastructure where it can perform bounded project work;
- outcome reporting and memory receipts.

### 18.2 Reframe

- **PRESENT:** context readiness for invoked work; no product value claim by itself.
- **INVOKED:** entry into the full work-intelligence loop, not a text-resolution request.
- **LIVE:** natural conversational continuity over the current work, not a separate consciousness tier.
- **AUGMENT:** the primary way Flyd explains, points, compares, and teaches beside the work.
- **COMPOSE:** a selective response for tasks requiring persistent structure.
- **MEMORY:** evidence-backed support for better work, not a feature destination.
- **DELEGATION:** one execution technique for bounded work, introduced only after the intervention and authority are clear.

### 18.3 Freeze or remove from the immediate path

- additional consciousness hierarchy work;
- generic manifestation grammar expansion;
- designer companion as a separate product mode;
- speculative proactive PRESENT cognition;
- generic scene infrastructure;
- broad integration-layer work;
- remote gateway or messaging-channel architecture;
- memory sophistication without a measured product benefit;
- composition surfaces that do not support a validated task.

### 18.4 Replace in the current resolution model

The current route vocabulary is centred on dictation, drafting, and answering. It should evolve toward interventions grounded in work outcomes:

- understand;
- critique;
- decide;
- improve;
- advance;
- act;
- verify;
- learn.

These may remain internal labels or be implemented through a different model. The user should experience a coherent conversation and action loop rather than a routing taxonomy.

---

## 19. Delivery sequence

This is product sequencing. A technical specification should follow approval of this PRD.

### Phase 0 — Establish the truth

Goal: measure current Flyd against real work.

- instrument context correctness, intervention acceptance, retained changes, and verified progress;
- create a seven-day founder interaction log;
- define the active project and artifact evidence contract;
- remove product claims unsupported by current capability;
- freeze unrelated architecture expansion.

Exit: baseline evidence identifies exactly where current Flyd loses to Clicky, generic chat, or manual work.

### Phase 1 — See and think

Goal: become immediately useful over anything on screen.

- natural voice/text conversation;
- screen-grounded answers;
- visual pointing and annotation;
- current project reconstruction;
- domain-aware critique;
- one high-leverage recommendation;
- session continuity.

Exit: Flyd is voluntarily useful for understanding and improving real work, even before action.

### Phase 2 — Improve and advance

Goal: convert judgment into verified project progress.

- direct artifact revisions;
- bounded file and repository work;
- research and document creation;
- action preview and confirmation;
- verification and handoff;
- next-step preservation.

Exit: Flyd materially improves artifacts and advances projects without requiring manual transfer of context.

### Phase 3 — Compound

Goal: become more useful through use.

- learn standards and recurring corrections;
- apply project decisions and rationale;
- detect repeated work patterns;
- selectively surface patterns during relevant work;
- evaluate whether memory improved the outcome;
- explore trusted proactive interventions only after repeated evidence.

Exit: the user can identify concrete ways Flyd has adapted and improved their work over time.

---

## 20. Risks

### 20.1 Generic intelligence disguised as personal intelligence

**Risk:** Flyd produces competent generic criticism without understanding the project.

**Mitigation:** require current project grounding, evidence, and objective reconstruction before substantial intervention.

### 20.2 Excessive criticism

**Risk:** a product optimised to challenge becomes noisy, adversarial, or performatively negative.

**Mitigation:** prioritise consequence and leverage. Criticism must connect to a better outcome and offer a stronger path.

### 20.3 Incorrect project context

**Risk:** stale memory or semantically strong history overrides current work.

**Mitigation:** live evidence priority, currentness gating, explicit uncertainty, and measured context accuracy.

### 20.4 Slow interaction

**Risk:** project reconstruction and deep reasoning make immediate assistance feel heavy.

**Mitigation:** stream the first useful observation quickly; deepen context in parallel; use cached verified project state; reserve deeper analysis for substantial work.

### 20.5 Over-expansion of capabilities

**Risk:** broad action support recreates the architecture-first failure.

**Mitigation:** add capabilities only for repeated founder workflows and measure retained outcomes.

### 20.6 Dependency without learning

**Risk:** Flyd performs work while the user’s capability stagnates.

**Mitigation:** explain the key causal principle when useful, preserve standards, and support review of why a change worked.

### 20.7 Intrusive proactivity

**Risk:** continuous intelligence interrupts focus or creates surveillance concerns.

**Mitigation:** V1 remains invoked. Proactive interventions require trust, strong relevance, explicit controls, and evidence from repeated use.

---

## 21. Acceptance criteria for the PRD

This PRD is accepted when the team agrees that:

1. Flyd’s purpose is increasing user capability and work quality.
2. The primary platform remains the Mac and the current work environment.
3. Immediate screen usefulness must meet the Clicky baseline.
4. Project understanding, judgment, action, verification, and learning define Flyd’s differentiation.
5. A gateway, messaging-channel strategy, and broad autonomous assistant are outside scope.
6. Dynamic UI, memory, voice, and agents are supporting capabilities rather than product goals.
7. The seven-day founder gate determines whether the next implementation phase succeeds.
8. A technical specification will be derived from the Phase 0 and Phase 1 requirements before implementation.

---

## 22. Final product test

At any point, Flyd should be judged by one question:

> **After using Flyd, did the user think better, produce stronger work, make meaningful progress, avoid a mistake, discover an opportunity, or retain learning that improves the future?**

When the answer is no, the interaction and the feature that produced it require reconsideration.

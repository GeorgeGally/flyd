# 02 Team shape: what makes firstmate a team, and what it takes to stand up four more

Read-only scout. Read: firstmate `AGENTS.md` (§1–§7), `docs/architecture.md`, `bin/fm-brief.sh`/`fm-spawn.sh`/`fm-inbox.sh` headers, `data/secondmates.md`. Flyd at `6917d74b`: `cli/src/command/`, `runtime/acceptance.ts`, live `~/.flyd/command/runs/` (473 runs), PC token audit `data/remote-secondmates/pc-secondmate/data/flyd-token-audit/report.md`. Nothing changed except this report and its copy.

## 1. Firstmate anatomy

| Part | What it is | Generic or engineering |
|---|---|---|
| Lead | One session that is the captain's only contact and never does project work itself (`AGENTS.md` §1 rule 1). | **Generic.** "Software work" is the only coding word in the contract. |
| Workers (crewmates) | Autonomous agents launched from a written brief into an isolated worktree, reporting only to the lead (`fm-brief.sh`, `fm-spawn.sh`). | Shape generic; worktree + branch + PR is **engineering**. |
| Two task shapes | **Ship** (project change through no-mistakes / direct-PR / local-only, `AGENTS.md` §7) and **scout** (report at `data/<id>/report.md`, no push). | Ship is **engineering**. Scout is **generic**: it is already a research-desk task. |
| Brief | `fm-brief.sh` scaffolds Setup/Rules/Definition of done with `## Captain's intent` (verbatim words) separate from `## Firstmate spec` (build instructions). | **Generic** idea; the delivery-contract lines are engineering. |
| Backlog | `tasks-axi` items moved Queued → In flight by `fm-spawn.sh` (spawn refuses work with no item). | **Generic.** |
| Supervision | Event-driven: workers append one line to `state/<id>.status`; states `working|needs-decision|blocked|paused|done|failed`; a line is a wake, not truth; `fm-crew-state.sh` reconciles (`AGENTS.md` §2, `architecture.md` "Event-driven supervision"). | **Generic.** The best part. |
| Steering | `fm-send.sh` writes a durable file into `state/<id>.inbox/`; worker acknowledges by moving it to `handled/`; terminal gets only a doorbell. Lifecycle goes through `fm-control.sh`, never chat. | **Generic.** |
| Reporting | Status line + `data/<id>/report.md`; a secondmate answers marked requests through status or a doc pointer, never chat; parent tracks missing replies (`fm-pending-reply-lib.sh`). | **Generic.** |
| Secondmate | A crewmate with its own isolated `FM_HOME` (state, backlog, projects, lock), a charter and a natural-language scope in `data/secondmates.md`; idle by default; the lead routes by scope (`architecture.md` "Optional secondmates"; `fm-home-seed.sh`; `fm-spawn.sh --secondmate`). Today's only one: `pc-secondmate`. | **Generic.** A secondmate is "a crewmate with a charter, not a second architecture." |
| Landing | `fm-pr-merge.sh`, `fm-merge-local.sh`, `fm-teardown.sh` (refuses unlanded work), "always end up in ~/Documents". | **Engineering.** |

**Core insight:** the team is not the agents. It is five durable records: brief file, backlog item, status file, steering inbox, report file. The lead only reads and writes them. All of them are plain files with correlation ids.

## 2. Reusable vs missing per new team

All four fit "secondmate home with a charter and a scope line". Reusable as-is: home seeding, registry line, `fm-send` routing, status/inbox/report protocol, backlog, session-start recovery, dispatch profiles. Missing is always the same four things: a **charter** (what its lead does), a **brief template** (replacing the ship `Setup/Rules`), a **done-definition** (replacing "PR landed"), and an **output place** (replacing project clones).

| Team | Maps to | Missing |
|---|---|---|
| Design studio | Secondmate with `--no-projects`-style home. Scout-shaped tasks write labs/screens. | Done = "every page and shot on disk" and judged from screenshots (today in `command/design-mate.ts`, 1,462 lines, Flyd-native, not firstmate-shaped). A lab-design brief template. Picked-version build is a ship into George's project and needs the engineering team's landing. |
| Research & news desk | Closest to scout as shipped (`report.md`, no PR). | Report schema (claims, sources, confidence), freshness/recurrence (news is scheduled, not tasked), evidence handling. Overlaps Flyd's own Scout/Librarian (`command/librarian.ts`, `council/scout.ts`). |
| Writing | Scout-shaped (draft = report). | Voice source (SOUL.md, taste), draft/revision lifecycle, "accepted" state, where drafts live (Docs/Drive drafts only per AGENTS.md connector rules). |
| Operations | Secondmate (heavy jobs, email/Drive/calendar). | The riskiest: outward actions. Needs the action-authority rules from the PRD (reviewed immutable drafts, never retry uncertain sends) as a charter, not as chat. Landing = "action reviewed and claimed once". |

Not reusable: worktrees and branch landing for any non-code team (use a plain output folder per task); `tasks-axi` ship-specific states; `no-mistakes`.


## 3. How work is handed to firstmate today, and how results come back

Hand-off (Flyd → firstmate): `dispatchCodingDomain` → `FirstmateDomainTransport.note` runs `bin/fm-inbox.sh note --request-id` with the body on stdin (`command/firstmate.ts:193-202`, 20 s timeout). The body is built by `firstmateRequestBody` (`firstmate.ts:711-740`): George's words, Flyd's interpretation, DONE WHEN, decisions, and a RETURN CONTRACT. The CoS path reaches it via `cos/dispatch.ts:32-60`.

Result (firstmate → Flyd): firstmate replies with `fm-inbox.sh reply`; Flyd polls receipts every sync (`syncFirstmateDomainRuns`, `firstmate.ts:799+`), parses with `parseDomainResult` (`result.ts`), then checks against the brief/report/evidence contract (`runtime/acceptance.ts:199-244`) and a prose judge (`result.ts:233`).


## 4. Why relays fail (evidence)

Live data: of 473 runs in `~/.flyd/command/runs`, 84 coding runs `failed` and only 202 `completed`. The audit counts 15 of 38 `domain-*` runs failed in 17–23 Nov. Failure reasons in the live run records, by count:

| Count | Reason | Where it comes from |
|---|---|---|
| 12 + 2 | "handoff contract unmet after one structured re-request: missing brief…report…evidence" | `acceptance.ts:263-264`; held as terminal at `firstmate.ts:792-796` |
| 6 | "I stopped starting the work: 3 identical launch attempts failed the same way" | launch repeat guard, `firstmate.ts:308-310, 524-530` |
| 6 | "no firstmate worker or task exists for this run; stale Flyd-side handoff" | Flyd run record with no matching firstmate state |
| 35 | leaked test fixtures marked failed, plus 4 provider-billing failures | not relay faults |

Real causes, in order of weight:

1. **A format contract on free-text replies.** The worker is asked to reply in prose "plain prose is fine" (`firstmate.ts:130`) and in JSON "when practical" (`firstmate.ts:735`); Flyd then rejects the prose because it lacks a JSON `brief`, a regex-verb `report` (`acceptance.ts:127-135` `readsAsReport`) and an `evidence` item, and sends **one** re-request (`firstmate.ts:772-781`). Two examples from live runs: `domain-05ec8ca2…` got a complete answer ("Yes, 1200x1600 is exactly 3:4…") with `status: completed. brief: …` flattened into one string, flagged missing brief/report/evidence, re-asked once, and failed. `domain-3c7764b4…` reported "PR …/pull/298 merged, Flyd rebuilt and restarted" and was flagged missing only the report. Finished work is thrown away on layout. Questions ("answer George's question, change nothing") have no PR/commit to cite, so evidence-required fails them by construction. That is why failures cluster at "1–2 messages".
2. **Chat as the control channel.** The re-request, the "no word since…" nudge, and the unread-reply check-in (`firstmate.ts:762-781`) are all more `question` messages into a live agent, each a full firstmate turn. Replies are one per note (`firstmate.ts:880`), so a second message creates a second thing to answer.
3. **Flyd launches firstmate when it is not running.** `startFirstmateSession` (`firstmate.ts:502-690`) spawns a `claude` helper with a one-shot prompt (`firstmate.ts:304`), idles it out after 15 min (`:317`), treats a note unread after 3 min as a signal (`:316`), and gives up after 3 identical failures (usage limit, rate limit, crash). Delegated work therefore depends on a process Flyd cannot supervise.
4. **Flyd's record can drift from firstmate's.** Two stores (Flyd run JSON, firstmate status/inbox) are reconciled by polling; the "no firstmate worker or task exists" failures are that drift.
5. **Every layer re-judges.** An LLM prose judge (`result.ts:233`), scheduler judge, interpretation and card rewording run per relay (audit: ≈200 judge calls + ≈2,930 card-word calls/week) on top of 48 firstmate runs. The audit also notes duplicate asks after a failure (GNM backbill twice, HFTW carousel 3–4 times).


## 5. Minimal shared-record contract (CoS ⇄ team, no relayed chat)

Reuse firstmate's own file protocol and make Flyd a reader/writer of it, per team home. Four files per task, all JSON/markdown, keyed by one `task-id` (= CoS objective run key, `<objective>-<key>-<attempt>`):

1. `brief.md` (CoS writes once, immutable). Fields: `id`, `team`, `outcome`, `done_when[]`, `george_words` (verbatim), `inputs[]` (paths/refs), `decisions: {comes_back[], settled_by_policy[]}`, `budget`, `created_at`. This is today's `RunBrief` + `BriefDecisions` (`cos/types.ts`, `types.ts:24-30`).
2. `status` (team appends one line each: `state [at=epoch]: line`, states as firstmate's, plus `needs-decision [key=…]` and `resolved`). Unchanged firstmate semantics. Decisions stay open until `resolved`.
3. `result.json` (team writes **once**, atomically, final): `{status: done|needs_decision|failed, outcome_line, report_path, artifacts[{path,kind}], decisions_made[], open_questions[], evidence[] (optional)}`. Flyd validates only that it parses and that `status` is present. Everything else is advisory; **no regex on prose, no re-request loop.** A missing artifact is detected by file existence, not by asking.
4. `inbox/NNN.msg` (CoS → team steering) with `handled/` acknowledgement. Already exists.

Rules: the CoS never sends a message to learn status (it reads `status` and `result.json`); a steer is a file; a result is a file; the team home owns the truth, Flyd keeps only a pointer and a cache; request ids make dispatch idempotent (already true for `fm-inbox note --request-id` and `runRequestId`).


## 6. Recommendation

1. **Fix the relay before adding teams.** Change the return path to the `result.json` + `status` contract above and delete the strict brief/report/evidence regex gate and the structured re-request for firstmate replies (`acceptance.ts:199-289`, `firstmate.ts:762-796`). Keep a lenient parse: take the reply verbatim as the report. That removes the dominant failure class (14 of the non-fixture failures) and the extra firstmate runs it triggers. Do not add a retry; a failed worker gets one deliberate CoS re-brief (already designed: "adapted", `PlannedRun.attempt`).
2. **Stop launching firstmate from Flyd.** Treat "firstmate not running" as `queued` with a visible reason; do not spawn a helper per note. Or run one persistent firstmate (it is built for that) and have the CoS only write notes.
3. **Do not use firstmate for small tasks** (project tagging every 15 min failed 6 times in a row). Route tagging, questions and rewording to a local model call (audit W3/W4). Questions with no change are scout-shaped, one report file.
4. **Stand teams up as secondmate homes in this order:** Research desk (scout-shaped, `report.md` already works; absorbs Librarian/Scout), then Writing (draft files + voice source), then Design (move `design-mate` behind the same four files and keep its judge-from-screenshots rule), then Operations last (needs the action-authority charter and reviewed-draft claim before it touches the outside world).
5. **Engineering stays firstmate unchanged.** Landing, worktrees and delivery modes are the part not to generalise.
6. **One reconciler.** One owner of "what is the state of task X" = the team home's status + `result.json`; Flyd reads, never infers from chat. The `FLYD_COS=1` objective graph sits on top and holds only pointers.

Scheduled desk work (news) needs a Flyd-side trigger that writes briefs: firstmate secondmates are idle by default and never self-initiate (`AGENTS.md` §6).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// George's live memory, journal, profile, and council records must never be
// read or written by tests. Point every personal store at a throwaway dir;
// tests that need one set their own path explicitly.
const sandbox = mkdtempSync(join(tmpdir(), "flyd-test-home-"));
process.env.FLYD_USER_PROFILE ??= join(sandbox, "USER.md");
process.env.FLYD_MEMORY_DIR ??= join(sandbox, "memory-home");
process.env.FLYD_JOURNAL_DIR ??= join(sandbox, "journal");
process.env.FLYD_COUNCIL_DIR ??= join(sandbox, "council");
process.env.FLYD_ADVISORIES_PATH ??= join(sandbox, "council", "advisories.jsonl");
process.env.FLYD_LIBRARIAN_STATE ??= join(sandbox, "council", "librarian-state.json");
process.env.FLYD_AGENDA_DIR ??= join(sandbox, "agenda");
process.env.FLYD_SCOUT_DIR ??= join(sandbox, "scout");
process.env.FLYD_CREW_DIR ??= join(sandbox, "crew");
process.env.FLYD_CREW_WORKTREES ??= join(sandbox, "worktrees");
process.env.FLYD_SELF_IMPROVE_DIR ??= join(sandbox, "self-improve");
process.env.FLYD_SOUL_PATH ??= join(sandbox, "SOUL.md");
process.env.FLYD_INVESTIGATOR_DIR ??= join(sandbox, "investigator");
process.env.FLYD_MORNING_PATH ??= join(sandbox, "morning.json");
process.env.FLYD_PROJECTS_PATH ??= join(sandbox, "projects.json");
process.env.FLYD_SKILLS_DIR ??= join(sandbox, "skills");
process.env.FLYD_BACKGROUND_JOBS_DIR ??= join(sandbox, "jobs");
process.env.FLYD_INVESTIGATOR ??= "0";
// Self-improvement dispatches real crew work; tests opt in explicitly.
process.env.FLYD_SELF_IMPROVE ??= "0";
// Belt and braces: even an opted-in launch cannot reach the real OpenCode.
process.env.FLYD_OPENCODE_PATH = "/usr/bin/false";

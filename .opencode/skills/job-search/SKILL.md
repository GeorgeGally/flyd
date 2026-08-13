---
name: job-search
description: End-to-end job search assistant — builds candidate profiles from resumes/documents, searches job portals, ranks jobs against your profile, generates tailored CVs and cover letters, autofills Greenhouse/ATS forms via browser, tracks application outcomes, and identifies skill gaps. Use when the user wants to find jobs, apply to jobs, prepare application materials, or needs help with any part of the job search process.
---

# Job Search Assistant

End-to-end job search pipeline: profile → search → rank → apply → autofill → track → improve.

## Core Principles

- **Ground everything in evidence.** Never fabricate experience, skills, education, dates, employers, or metrics. Mark uncertainty clearly.
- **Ask before assuming.** Work authorization, sponsorship, relocation, salary, and legal answers must come from explicit user confirmation.
- **Never auto-submit.** Autofill stops before submission. The user always reviews and clicks submit themselves.
- **Track everything.** Every application goes into `job_search_tracker.csv`.

## Quick Start

Tell me: "Help me find a job" or "Let's set up my profile" and I'll walk through the full pipeline interactively.

If you have a resume: `Setup my profile from my resume at <path>`

If you have a job posting: `Apply to this job: <URL or paste description>`

## Pipeline

### 1. Profile Setup (`profile/`)

Build a grounded candidate profile from source documents. Three modes:

- **Resume import**: Parse PDF/TXT/MD resume via `scripts/resume_to_profile.py`
- **Documents import**: Read from `documents/cv/`, `documents/linkedin/`, `documents/diplomas/`, `documents/references/`
- **Interview mode**: Ask the user structured questions

Always read existing `profile/` files before writing. Cross-check dates, titles, education. Label inferred info. Ask before resolving factual conflicts.

After setup, review with user and save to `profile/candidate_profile.json` using the schema at `references/profile-schema.md`.

### 2. Profile Expansion (`profile-expand`)

Search the user's documents and public profile links for source-traceable competencies that may be missing. Additive only — never remove confirmed facts.

### 3. Job Search (`job-scrape`)

Search for jobs by role and location. Methods:

- **Web search** for public job board listings (primary)
- **User-provided URLs**: Accept pasted job links or descriptions
- **Portal CLIs**: If specific portal adapters are available (e.g., LinkedIn, Indeed, Greenhouse)

Deduplicate results against previously seen jobs. Save to `job_scraper/results/`.

### 4. Job Ranking (`job-rank`)

Score jobs against the user's profile using posting text and profile evidence only. Output:

- **Apply**: strong match, minimal gaps
- **Maybe**: partial match, addressable gaps
- **Skip**: deal-breaker gaps or misalignment

Ranking is triage. Re-evaluate any job before applying.

### 5. Application Preparation (`job-apply`)

For each target job, run a drafter-reviewer workflow:

1. Parse and save the job posting
2. Evaluate fit against profile
3. Generate tailored CV (LaTeX or markdown)
4. Generate tailored cover letter
5. Review for grounding, tone, fit, keywords
6. If LaTeX available: compile PDF, run ATS extraction check
7. Present for user review

Never claim PDFs are ready without compilation. Report any missing tools.

### 6. Autofill (`autofill`)

For Greenhouse-hosted applications, build an application packet and autofill via Chrome DevTools Protocol:

```bash
python3 scripts/resume_to_profile.py --resume <path> --out candidate_profile.json
python3 scripts/build_application_packet.py --profile candidate_profile.json --job-url "<url>" --job-title "<title>" --company "<name>" --job-description-file jd.txt --out application_packet.json
node scripts/greenhouse_autofill.mjs --packet application_packet.json --cdp-port 9223
```

Requires: Python 3.10+, Node.js, Chrome with `--remote-debugging-port=9223`. Always stop before submit.

For non-Greenhouse forms, provide the user with a filled field map and manual copy-paste instructions.

### 7. Record Outcome (`record-outcome`)

Update `job_search_tracker.csv` with: application date, company, role, status, notes. Archive submitted materials.

### 8. Skill Gap Analysis (`job-upskill`)

Analyze tracked jobs for recurring gaps. Produce a prioritized learning plan with concrete resources.

## Safety Boundaries

- **Never submit applications.** Always stop before the final submit button.
- **Never invent answers** for work authorization, sponsorship, relocation, disability, veteran status, gender, race, salary expectations, or legal certifications.
- **Never fabricate experience.** All profile content must trace back to documents or explicit user statements.
- **Respect rate limits** on job portals. Do not bypass anti-bot protections.
- **Privacy**: CVs, diplomas, references, generated applications, passwords, and secrets are gitignored. Do not commit them.

## Output Format

After each action, report:
- Files created or changed
- Checks passed / failed / skipped
- Missing tools
- Next action to take

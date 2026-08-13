import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface JobsWorkspaceSnapshot {
  root: string;
  available: boolean;
  profileSummary?: string;
  trackerRows: number;
  recentApplications: string[];
  nextAction?: string;
  provenance: string[];
}

function jobsRoot(): string {
  const configured = process.env.FLYD_JOBS_DIR?.trim();
  if (configured) return configured;
  return join(homedir(), "Documents", "jobs");
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseCsvLines(raw: string): string[][] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
}

/** Read the local jobs workspace without copying private docs into memory. */
export function readJobsWorkspace(root = jobsRoot()): JobsWorkspaceSnapshot {
  const provenance: string[] = [];
  if (!existsSync(root)) {
    return {
      root,
      available: false,
      trackerRows: 0,
      recentApplications: [],
      provenance: [`missing:${root}`],
    };
  }

  provenance.push(`workspace:${root}`);
  const profilePath = join(root, "profile", "candidate_profile.json");
  const trackerPath = join(root, "job_search_tracker.csv");
  const cvPath = join(root, "cv", "george_galanakis_cv.md");

  let profileSummary: string | undefined;
  const profile = readJson(profilePath);
  if (profile) {
    provenance.push("profile/candidate_profile.json");
    const name = typeof profile.name === "string" ? profile.name : "candidate";
    const title = typeof profile.target_title === "string"
      ? profile.target_title
      : typeof profile.headline === "string"
        ? profile.headline
        : undefined;
    profileSummary = title ? `${name} — ${title}` : name;
  }

  let trackerRows = 0;
  const recentApplications: string[] = [];
  if (existsSync(trackerPath)) {
    provenance.push("job_search_tracker.csv");
    try {
      const rows = parseCsvLines(readFileSync(trackerPath, "utf8"));
      const body = rows.slice(1);
      trackerRows = body.length;
      for (const row of body.slice(-5).reverse()) {
        const company = row[0] || row[1] || "application";
        const role = row[1] || row[2] || "";
        const status = row.find((cell) => /applied|draft|interview|offer|reject/i.test(cell)) || "";
        recentApplications.push([company, role, status].filter(Boolean).join(" · "));
      }
    } catch {
      // ignore corrupt tracker
    }
  }

  if (existsSync(cvPath)) provenance.push("cv/george_galanakis_cv.md");

  let nextAction: string | undefined;
  if (trackerRows === 0) {
    nextAction = "Open the jobs workspace and pick one target role to tailor the resume against.";
  } else if (!existsSync(cvPath)) {
    nextAction = "Restore or regenerate the CV in the jobs workspace before the next application.";
  } else {
    nextAction = "Pick one open tracker row and submit a tailored application today.";
  }

  return {
    root,
    available: true,
    profileSummary,
    trackerRows,
    recentApplications,
    nextAction,
    provenance,
  };
}

export function formatJobsWorkspaceStatus(snap = readJobsWorkspace()): string {
  if (!snap.available) {
    return [
      "Jobs workspace is not available.",
      `Expected path: ${snap.root}`,
      "Set FLYD_JOBS_DIR or keep the workspace under ~/Documents/jobs.",
    ].join("\n");
  }

  const lines = [
    "Job search evidence (local workspace — not invented):",
    `Workspace: ${snap.root}`,
  ];
  if (snap.profileSummary) lines.push(`Profile: ${snap.profileSummary}`);
  lines.push(`Tracker rows: ${snap.trackerRows}`);
  if (snap.recentApplications.length) {
    lines.push("Recent tracker entries:");
    for (const row of snap.recentApplications.slice(0, 3)) lines.push(`- ${row}`);
  }
  if (snap.nextAction) lines.push(`Next action: ${snap.nextAction}`);
  lines.push(`Evidence: ${snap.provenance.join("; ")}`);
  return lines.join("\n");
}

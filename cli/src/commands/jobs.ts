import {
  listJobs,
  getJob,
  setJobEnabled,
  ensureDefaultMorningBriefingJob,
  listJobAudits,
} from '../work-intelligence/jobs/store.js';
import { pauseJobs, resumeJobs, killJobs, clearKillJobs, isJobsGloballyPaused, readPauseReason } from '../work-intelligence/jobs/controls.js';
import {
  runMorningBriefing,
  runJobById,
  runDueJobs,
} from '../work-intelligence/jobs/runner.js';

export async function runJobsCommand(
  action: string,
  target?: string,
  opts?: { project?: string; force?: boolean },
): Promise<void> {
  switch (action) {
    case 'list': {
      const jobs = listJobs();
      if (jobs.length === 0) {
        console.log('No work jobs configured. Run: flyd jobs enable morning-briefing');
        return;
      }
      for (const job of jobs) {
        console.log(
          `${job.id.slice(0, 8)}  ${job.type}  ${job.enabled ? 'on' : 'off'}  ${job.schedule}` +
            (job.projectId ? `  project=${job.projectId}` : ''),
        );
      }
      if (isJobsGloballyPaused()) {
        console.log(`\nGlobal pause: ${readPauseReason()}`);
      }
      return;
    }

    case 'enable': {
      if (target === 'morning-briefing' || target === 'morning_briefing' || !target) {
        const job = ensureDefaultMorningBriefingJob(opts?.project);
        setJobEnabled(job.id, true);
        console.log(`Enabled morning-briefing job ${job.id}`);
        return;
      }
      const job = getJob(target) ?? listJobs().find((j) => j.id.startsWith(target));
      if (!job) {
        console.error(`Job not found: ${target}`);
        process.exitCode = 1;
        return;
      }
      setJobEnabled(job.id, true);
      console.log(`Enabled ${job.id}`);
      return;
    }

    case 'disable':
    case 'pause-job': {
      if (!target) {
        console.error('Usage: flyd jobs disable <id|morning-briefing>');
        process.exitCode = 1;
        return;
      }
      if (target === 'morning-briefing' || target === 'morning_briefing') {
        const job = ensureDefaultMorningBriefingJob();
        setJobEnabled(job.id, false);
        console.log(`Disabled morning-briefing job ${job.id}`);
        return;
      }
      const job = getJob(target) ?? listJobs().find((j) => j.id.startsWith(target));
      if (!job) {
        console.error(`Job not found: ${target}`);
        process.exitCode = 1;
        return;
      }
      setJobEnabled(job.id, false);
      console.log(`Disabled ${job.id}`);
      return;
    }

    case 'pause': {
      pauseJobs();
      console.log('Global jobs pause set (~/.flyd/work-jobs/PAUSE)');
      return;
    }

    case 'resume': {
      resumeJobs();
      clearKillJobs();
      console.log('Global jobs pause cleared');
      return;
    }

    case 'kill': {
      killJobs();
      console.log('Global jobs KILL set');
      return;
    }

    case 'run': {
      if (!target || target === 'morning-briefing' || target === 'morning_briefing') {
        const result = runMorningBriefing({ projectId: opts?.project, force: true });
        if (result.artifactPath) console.log(`Artifact: ${result.artifactPath}`);
        if (!result.ok) {
          console.error(result.error ?? result.status);
          process.exitCode = 1;
          return;
        }
        console.log(`Status: ${result.status}`);
        return;
      }
      const result = runJobById(target, { force: true });
      if (result.artifactPath) console.log(`Artifact: ${result.artifactPath}`);
      if (!result.ok) {
        console.error(result.error ?? result.status);
        process.exitCode = 1;
        return;
      }
      console.log(`Status: ${result.status}`);
      return;
    }

    case 'run-due': {
      const results = runDueJobs({ force: opts?.force });
      if (results.length === 0) {
        console.log('No due jobs');
        return;
      }
      for (const result of results) {
        console.log(
          `${result.audit.jobId.slice(0, 8)}  ${result.status}` +
            (result.artifactPath ? `  ${result.artifactPath}` : '') +
            (result.error ? `  ${result.error}` : ''),
        );
      }
      return;
    }

    case 'audits': {
      const audits = listJobAudits(20);
      if (audits.length === 0) {
        console.log('No job audits');
        return;
      }
      for (const audit of audits) {
        console.log(
          `${audit.runId.slice(0, 8)}  ${audit.jobId.slice(0, 8)}  ${audit.status}  ${audit.scheduleSlot}` +
            (audit.artifactPath ? `  ${audit.artifactPath}` : ''),
        );
      }
      return;
    }

    default:
      console.error(
        'Usage: flyd jobs <list|enable|disable|pause|resume|kill|run|run-due|audits> [target]',
      );
      process.exitCode = 1;
  }
}

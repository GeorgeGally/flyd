module IntelligenceState
  class RuntimeTaskProvider < Provider
    PROVIDER = "flyd-runtime"
    SCHEMA_VERSION = "1.0"
    FRESH_FOR = 2.minutes
    RECENT_COMPLETION_WINDOW = 24.hours
    MAX_RECORDS = 8

    def snapshot
      generated_at = Time.current
      task = current_task
      data = task ? task_evidence(task) : empty_data
      payload = {
        "version" => SCHEMA_VERSION,
        "source" => PROVIDER,
        "generatedAt" => generated_at.iso8601,
        "data" => data
      }
      digest = IntelligenceSnapshot.semantic_digest_for(payload)
      record = IntelligenceSnapshot.find_or_initialize_by(provider: PROVIDER, state_digest: digest)
      record.update!(
        schema_version: SCHEMA_VERSION,
        status: "fresh",
        generated_at: generated_at,
        received_at: generated_at,
        fresh_until: generated_at + FRESH_FOR,
        payload: payload,
        provider_errors: []
      )

      Snapshot.new(
        source: PROVIDER,
        snapshot_id: record.id,
        state_digest: digest,
        generated_at: generated_at,
        fresh: true,
        data: data.deep_symbolize_keys,
        errors: []
      )
    rescue ActiveRecord::ActiveRecordError => error
      Snapshot.new(
        source: PROVIDER,
        snapshot_id: nil,
        state_digest: nil,
        generated_at: nil,
        fresh: false,
        data: empty_data.deep_symbolize_keys,
        errors: [ error.message ]
      )
    end

    private

    def current_task
      AgentTask
        .includes(:project, :task_grants, :task_assignments, :worker_sessions, :task_artifacts, :task_corrections, :runtime_events)
        .unfinished
        .recent
        .first ||
        AgentTask
          .includes(:project, :task_grants, :task_assignments, :worker_sessions, :task_artifacts, :task_corrections, :runtime_events)
          .where(completed_at: RECENT_COMPLETION_WINDOW.ago..)
          .recent
          .first
    end

    def task_evidence(task)
      grants = task.task_grants.sort_by(&:created_at).last(MAX_RECORDS)
      assignments = task.task_assignments.sort_by(&:created_at).last(MAX_RECORDS)
      workers = task.worker_sessions.sort_by(&:created_at).last(MAX_RECORDS)
      artifacts = task.task_artifacts.verified.sort_by(&:created_at).last(MAX_RECORDS)
      corrections = task.task_corrections.sort_by(&:task_revision).last(MAX_RECORDS)
      latest_event = task.runtime_events.max_by(&:task_revision)

      {
        "runtime_tasks" => [ evidence(
          id: task.task_key,
          type: "runtime_task",
          generated_at: task.updated_at,
          content: {
            "taskKey" => task.task_key,
            "status" => task.status,
            "revision" => task.revision,
            "intendedOutcome" => task.intended_outcome,
            "successCriteria" => Array(task.success_criteria).first(8),
            "verificationCriteria" => Array(task.verification_criteria).first(8),
            "recommendedNextAction" => task.recommended_next_action,
            "outcomeSummary" => task.outcome_summary,
            "projectId" => task.project_id,
            "projectName" => task.project.name,
            "projectRoot" => task.project.root_path,
            "grantKeys" => grants.map(&:grant_key),
            "assignmentKeys" => assignments.map(&:assignment_key),
            "workerKeys" => workers.map(&:worker_key),
            "artifactKeys" => artifacts.map(&:artifact_key),
            "correctionKeys" => corrections.map(&:correction_key),
            "latestEventType" => latest_event&.event_type,
            "updatedAt" => task.updated_at.iso8601
          }.compact
        ) ],
        "task_grants" => grants.map { |grant| grant_evidence(grant) },
        "task_assignments" => assignments.map { |assignment| assignment_evidence(assignment) },
        "worker_sessions" => workers.map { |worker| worker_evidence(worker) },
        "task_artifacts" => artifacts.map { |artifact| artifact_evidence(artifact) },
        "task_corrections" => corrections.map { |correction| correction_evidence(correction) }
      }
    end

    def grant_evidence(grant)
      evidence(
        id: grant.grant_key,
        type: "task_grant",
        generated_at: grant.updated_at,
        content: {
          "taskKey" => grant.agent_task.task_key,
          "grantKey" => grant.grant_key,
          "status" => grant.status,
          "repositoryRoots" => Array(grant.repository_roots).first(4),
          "workerAdapters" => Array(grant.worker_adapters).first(4),
          "fileOperations" => Array(grant.file_operations).first(8),
          "commandClasses" => Array(grant.command_classes).first(8),
          "verificationCommands" => Array(grant.verification_commands).first(8),
          "maxConcurrency" => grant.max_concurrency,
          "providerIdentity" => grant.provider_identity,
          "expiresAt" => grant.expires_at&.iso8601,
          "decisionReason" => grant.decision_reason
        }.compact
      )
    end

    def assignment_evidence(assignment)
      evidence(
        id: assignment.assignment_key,
        type: "task_assignment",
        generated_at: assignment.updated_at,
        content: {
          "taskKey" => assignment.agent_task.task_key,
          "assignmentKey" => assignment.assignment_key,
          "status" => assignment.status,
          "title" => assignment.title,
          "instructions" => assignment.instructions.to_s.truncate(2_000),
          "successCriteria" => Array(assignment.success_criteria).first(8),
          "declaredFileScope" => Array(assignment.declared_file_scope).first(20),
          "branchName" => assignment.branch_name,
          "baseHead" => assignment.base_head,
          "verificationPassed" => assignment.verification_result.to_h["passed"]
        }.compact
      )
    end

    def worker_evidence(worker)
      evidence(
        id: worker.worker_key,
        type: "worker_session",
        generated_at: worker.updated_at,
        content: {
          "taskKey" => worker.agent_task.task_key,
          "assignmentKey" => worker.task_assignment.assignment_key,
          "workerKey" => worker.worker_key,
          "status" => worker.status,
          "adapter" => worker.adapter,
          "workingDirectory" => worker.working_directory,
          "startedAt" => worker.started_at&.iso8601,
          "endedAt" => worker.ended_at&.iso8601,
          "lastObservedAt" => worker.last_observed_at&.iso8601,
          "exitStatus" => worker.exit_status,
          "errorSummary" => worker.error_summary.to_s.truncate(1_000).presence
        }.compact
      )
    end

    def artifact_evidence(artifact)
      evidence(
        id: artifact.artifact_key,
        type: "task_artifact",
        generated_at: artifact.created_at,
        content: {
          "taskKey" => artifact.agent_task.task_key,
          "assignmentKey" => artifact.task_assignment&.assignment_key,
          "artifactKey" => artifact.artifact_key,
          "kind" => artifact.kind,
          "title" => artifact.title,
          "mediaType" => artifact.media_type,
          "byteSize" => artifact.byte_size,
          "sha256Digest" => artifact.sha256_digest,
          "verificationStatus" => artifact.verification_status,
          "sourceRevision" => artifact.source_revision,
          "repositoryHead" => artifact.repository_head
        }.compact
      )
    end

    def correction_evidence(correction)
      evidence(
        id: correction.correction_key,
        type: "task_correction",
        generated_at: correction.created_at,
        epistemic_status: "user_confirmed",
        content: {
          "taskKey" => correction.agent_task.task_key,
          "correctionKey" => correction.correction_key,
          "originalClaim" => correction.original_claim,
          "correctedValue" => correction.corrected_value,
          "taskRevision" => correction.task_revision,
          "surfaceRevision" => correction.surface_revision,
          "authority" => correction.authority,
          "supersedesCorrectionKey" => correction.supersedes_task_correction&.correction_key
        }.compact
      )
    end

    def evidence(id:, type:, generated_at:, content:, epistemic_status: "observation")
      {
        "id" => id,
        "type" => type,
        "source" => PROVIDER,
        "epistemicStatus" => epistemic_status,
        "confidence" => 1.0,
        "generatedAt" => generated_at&.iso8601,
        "evidenceRefs" => [],
        "content" => content
      }
    end

    def empty_data
      {
        "runtime_tasks" => [],
        "task_grants" => [],
        "task_assignments" => [],
        "worker_sessions" => [],
        "task_artifacts" => [],
        "task_corrections" => []
      }
    end
  end
end

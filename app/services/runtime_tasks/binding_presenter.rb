module RuntimeTasks
  class BindingPresenter
    BindingError = Class.new(StandardError)

    attr_reader :item, :task, :grants, :assignments, :workers, :artifacts

    def self.call(item)
      new(item).call
    end

    def initialize(item)
      @item = item
    end

    def call
      task_keys = reference_ids("runtime_task")
      raise BindingError, "Runtime task binding requires exactly one task" unless task_keys.one?

      @task = AgentTask.includes(:project).find_by!(task_key: task_keys.first)
      @grants = resolve(TaskGrant, :grant_key, reference_ids("task_grant"))
      @assignments = resolve(TaskAssignment, :assignment_key, reference_ids("task_assignment"))
      @workers = resolve(WorkerSession, :worker_key, reference_ids("worker_session"))
      @artifacts = resolve(TaskArtifact.verified, :artifact_key, reference_ids("task_artifact"))
      validate_ownership!
      self
    rescue ActiveRecord::RecordNotFound => error
      raise BindingError, "Runtime task binding is unavailable: #{error.message}"
    end

    def stale?
      expected_revision != task.revision || delivery_stale?
    end

    def controls_enabled?
      !stale? && task.unfinished?
    end

    def expected_revision
      Integer(item.metadata["task_revision"])
    rescue ArgumentError, TypeError
      -1
    end

    def proposed_grant
      grants.find { |grant| grant.status == "proposed" }
    end

    def active_grant
      grants.find(&:approved?)
    end

    def live_workers
      workers.select { |worker| worker.status.in?(%w[queued starting running stopping]) }
    end

    def blocked_assignments
      assignments.select { |assignment| assignment.status == "blocked" }
    end

    def verified_artifacts
      artifacts.select { |artifact| artifact.verification_status == "verified" }
    end

    def status_label
      {
        "awaiting_grant" => "Awaiting permission",
        "ready" => "Ready for review",
        "running" => "Working",
        "blocked" => "Needs intervention",
        "completed" => "Completed",
        "failed" => "Failed",
        "cancelled" => "Cancelled"
      }.fetch(task.status, task.status.humanize)
    end

    private

    def delivery_stale?
      state = RuntimeDeliveryState.find_by(listener_key: AgentRuntime::EventListener::LISTENER_KEY)
      state.nil? || !state.covers?(task)
    end

    def reference_ids(type)
      Array(item.source_refs).filter_map do |reference|
        reference = reference.to_h.deep_stringify_keys
        reference["id"].to_s if reference["type"] == type
      end
    end

    def resolve(scope, key, ids)
      return [] if ids.empty?

      records = scope.where(key => ids).index_by { |record| record.public_send(key).to_s }
      missing = ids - records.keys
      raise BindingError, "Unknown #{key}: #{missing.join(", ")}" if missing.any?

      ids.map { |id| records.fetch(id) }
    end

    def validate_ownership!
      records = grants + assignments + workers + artifacts
      foreign = records.find { |record| record.agent_task_id != task.id }
      raise BindingError, "Runtime binding crosses task boundaries" if foreign
    end
  end
end

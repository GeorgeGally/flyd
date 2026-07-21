module RuntimeTasks
  class ActionExecutor
    TASK_ACTIONS = %w[
      approve_task_grant reject_task_grant stop_worker retry_worker redirect_worker
      replace_worker correct_task confirm_task_completion
    ].freeze
    INPUT_FIELDS = {
      "approve_task_grant" => [],
      "reject_task_grant" => %w[reason],
      "stop_worker" => [],
      "retry_worker" => [],
      "redirect_worker" => %w[instruction],
      "replace_worker" => [],
      "correct_task" => %w[corrected_value],
      "confirm_task_completion" => []
    }.freeze
    ACTION_MAP = {
      "approve_task_grant" => "task.approve_grant",
      "reject_task_grant" => "task.reject_grant",
      "stop_worker" => "task.stop_worker",
      "retry_worker" => "task.retry_worker",
      "redirect_worker" => "task.redirect_worker",
      "replace_worker" => "task.replace_worker",
      "correct_task" => "task.correct",
      "confirm_task_completion" => "task.confirm_completion"
    }.freeze

    def self.call(item:, action_id:, input: {}, bridge: AgentRuntime::Bridge.new)
      new(item:, action_id:, input:, bridge:).call
    end

    def initialize(item:, action_id:, input:, bridge:)
      @item = item
      @action_id = action_id.to_s
      @input = input.to_h.deep_stringify_keys
      @bridge = bridge
    end

    def call
      raise ArgumentError, "Unsupported runtime action" unless TASK_ACTIONS.include?(@action_id)

      action = @item.offered_action(@action_id)
      raise ArgumentError, "Action is not available for this item" unless action

      @payload = action.fetch("payload", {}).to_h.deep_stringify_keys
      binding = BindingPresenter.call(@item)
      raise ArgumentError, "This task scene is stale. Flyd is refreshing it." if binding.stale?
      raise ArgumentError, "Task action does not match the bound task" unless @payload["task_key"] == binding.task.task_key
      raise ArgumentError, "Task action revision is stale" unless @payload["task_revision"] == binding.task.revision

      validate_input!
      result = @bridge.call(runtime_request(binding))
      record_recommendation_action
      enqueue_surface_refresh
      result
    end

    private

    def record_recommendation_action
      recommendation = @item.task_recommendations.where(disposition: "offered").order(:created_at, :id).first
      return unless recommendation

      recommendation.update!(
        disposition: recommendation.action_id == @action_id ? "accepted" : "adapted",
        acted_at: Time.current
      )
    end

    def validate_input!
      allowed = INPUT_FIELDS.fetch(@action_id)
      unknown = @input.keys - allowed
      raise ArgumentError, "Unexpected task action input: #{unknown.first}" if unknown.any?

      bounded_input!("reason", 1_000) if @action_id == "reject_task_grant"
      bounded_input!("instruction", 4_000) if @action_id == "redirect_worker"
      bounded_input!("corrected_value", 4_000) if @action_id == "correct_task"
    end

    def bounded_input!(key, maximum)
      value = @input[key].to_s.strip
      raise ArgumentError, "#{key.humanize} is required" if value.blank?
      raise ArgumentError, "#{key.humanize} is too long" if value.length > maximum

      @input[key] = value
    end

    def runtime_request(binding)
      request = {
        schemaVersion: 1,
        action: ACTION_MAP.fetch(@action_id),
        actorSurface: "rails",
        taskKey: binding.task.task_key,
        expectedTaskRevision: binding.task.revision,
        idempotencyKey: idempotency_key
      }
      case @action_id
      when "approve_task_grant"
        request[:grantKey] = @payload.fetch("grant_key")
      when "reject_task_grant"
        request[:grantKey] = @payload.fetch("grant_key")
        request[:reason] = @input.fetch("reason")
      when "stop_worker", "retry_worker", "replace_worker"
        request[:workerKey] = @payload.fetch("worker_key")
      when "redirect_worker"
        request[:workerKey] = @payload.fetch("worker_key")
        request[:instruction] = @input.fetch("instruction")
      when "correct_task"
        request[:correctedValue] = @input.fetch("corrected_value")
        request[:originalClaim] = @payload["original_claim"] if @payload["original_claim"].present?
        request[:surfaceRevision] = @item.surface_id
      when "confirm_task_completion"
        request[:summary] = @payload.fetch("summary")
      end
      request
    end

    def idempotency_key
      digest = Digest::SHA256.hexdigest(JSON.generate(@input.sort.to_h))[0, 20]
      "rails:surface-item:#{@item.id}:#{@action_id}:#{@payload["task_revision"]}:#{digest}"
    end

    def enqueue_surface_refresh
      ComposeSurfaceJob.enqueue(reason: "runtime_task_action")
    rescue StandardError => error
      Rails.logger.error("Runtime task command succeeded but surface refresh could not be enqueued: #{error.message}")
    end
  end
end

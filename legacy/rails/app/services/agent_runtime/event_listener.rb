require "pg"

module AgentRuntime
  class EventListener
    LISTENER_KEY = "primary"
    CHANNEL = "flyd_runtime_events"
    BATCH_SIZE = 100
    WAIT_SECONDS = 5

    def initialize(
      owner: "rails-#{Process.pid}-#{SecureRandom.hex(4)}",
      lease: nil,
      broadcast_job: BroadcastRuntimeTaskJob,
      observation_job: BroadcastRuntimeObservationJob,
      recompose_job: RecomposeRuntimeTaskSurfaceJob,
      runtime_bridge: AgentRuntime::Bridge.new,
      connection_factory: nil
    )
      @owner = owner
      @lease = lease || Lease.new(listener_key: LISTENER_KEY, owner: owner)
      @broadcast_job = broadcast_job
      @observation_job = observation_job
      @recompose_job = recompose_job
      @runtime_bridge = runtime_bridge
      @connection_factory = connection_factory || method(:postgres_connection)
    end

    def deliver_pending(limit: BATCH_SIZE)
      return 0 unless @lease.acquire

      verify_runtime!
      state = RuntimeDeliveryState.find_by!(listener_key: LISTENER_KEY)
      events = RuntimeEvent.where("id > ?", state.last_event_id).order(:id).limit(limit)
      events.each do |event|
        dispatch(event)
        state.update!(
          last_event_id: event.id,
          last_received_at: event.occurred_at,
          last_error: nil
        )
      end
      @lease.renew
      events.length
    rescue StandardError => error
      record_error(error)
      raise
    end

    def run
      loop do
        connection = nil
        begin
          connection = @connection_factory.call
          connection.exec("LISTEN #{CHANNEL}")
          loop do
            next if deliver_pending == BATCH_SIZE

            connection.wait_for_notify(WAIT_SECONDS) do |_channel, _pid, payload|
              deliver_notification(payload)
            end
          end
        rescue StandardError => error
          record_error(error)
          sleep 1
        ensure
          connection&.close
        end
      end
    ensure
      @lease.release
    end

    def deliver_notification(payload)
      notification = JSON.parse(payload.to_s)
      return false unless notification["event_type"] == "worker.observed"

      task_key = notification["task_key"].to_s
      revision = Integer(notification["task_revision"], exception: false)
      return false if task_key.blank? || revision.nil? || revision.negative?

      @observation_job.perform_later(task_key, revision)
      true
    rescue JSON::ParserError
      false
    end

    private

    def dispatch(event)
      @broadcast_job.perform_later(event.id)
      @recompose_job.perform_later(event.agent_task_id, event.task_revision) if semantic_phase_change?(event)
    end

    def semantic_phase_change?(event)
      event.event_type != "worker.observed"
    end

    def verify_runtime!
      response = @runtime_bridge.call(
        schemaVersion: 1,
        action: "health",
        actorSurface: "rails"
      )
      healthy = response["action"] == "health" && response.dig("data", "healthy") == true
      raise AgentRuntime::Bridge::Error, "Runtime command bridge health check failed" unless healthy
    end

    def record_error(error)
      state = RuntimeDeliveryState.find_or_create_by!(listener_key: LISTENER_KEY)
      state.update!(last_error: error.message.to_s.truncate(2_000))
    rescue ActiveRecord::ActiveRecordError
      Rails.logger.error("Runtime listener failed to record error: #{error.message}")
    end

    def postgres_connection
      configuration = ActiveRecord::Base.connection_db_config.configuration_hash.symbolize_keys
      PG.connect({
        dbname: configuration[:database],
        host: configuration[:host],
        port: configuration[:port],
        user: configuration[:username],
        password: configuration[:password]
      }.compact)
    end
  end
end

require "json"
require "pathname"
require "time"

module IntelligenceState
  class CliProvider < Provider
    MAX_AGE = 15.minutes
    SUPPORTED_VERSION = "1.0"
    REFRESH_LOCK_KEY = "intelligence_state:cli_refresh_enqueued"
    REFRESH_LOCK_TTL = 2.minutes

    def initialize(path: default_path, max_age: MAX_AGE, refresh: true)
      @path = Pathname(path)
      @max_age = max_age
      @refresh = refresh
    end

    def snapshot
      enqueue_refresh if @refresh && refresh_required?
      read_snapshot
    end

    private

    def read_snapshot
      return missing_snapshot unless @path.exist?

      payload = JSON.parse(@path.read)
      validate!(payload)
      generated_at = Time.iso8601(payload.fetch("generatedAt"))

      Snapshot.new(
        source: payload.fetch("source"),
        generated_at: generated_at,
        fresh: generated_at >= @max_age.ago,
        data: normalize(payload),
        errors: generated_at >= @max_age.ago ? [] : ["Intelligence state is stale; refresh queued"]
      )
    rescue JSON::ParserError, KeyError, ArgumentError => error
      Snapshot.new(source: "flyd-cli", generated_at: nil, fresh: false, data: {}, errors: [error.message])
    end

    def refresh_required?
      return true unless @path.exist?

      payload = JSON.parse(@path.read)
      generated_at = Time.iso8601(payload.fetch("generatedAt"))
      generated_at < @max_age.ago
    rescue JSON::ParserError, KeyError, ArgumentError
      true
    end

    def enqueue_refresh
      return unless Rails.cache.write(REFRESH_LOCK_KEY, true, expires_in: REFRESH_LOCK_TTL, unless_exist: true)

      RefreshIntelligenceStateJob.perform_later
    rescue ActiveJob::EnqueueError => error
      Rails.cache.delete(REFRESH_LOCK_KEY)
      Rails.logger.warn("Could not enqueue intelligence state refresh: #{error.message}")
    end

    def default_path
      config = Rails.application.config_for(:flyd)
      config.fetch(:intelligence_state_path, File.join(config.fetch(:data_directory), "intelligence-state.json"))
    end

    def validate!(payload)
      version = payload.fetch("version")
      raise ArgumentError, "Unsupported intelligence state version: #{version}" unless version == SUPPORTED_VERSION
      raise ArgumentError, "Invalid intelligence state source" unless payload.fetch("source") == "flyd-cli"
    end

    def normalize(payload)
      {
        goals: Array(payload["goals"]),
        tensions: Array(payload["tensions"]),
        signals: Array(payload["signals"]),
        curiosity: Array(payload["curiosity"]),
        nudges: Array(payload["nudges"]),
        reports: Array(payload["reports"]),
        recent_events: Array(payload["recentEvents"])
      }
    end

    def missing_snapshot
      Snapshot.new(
        source: "flyd-cli",
        generated_at: nil,
        fresh: false,
        data: {},
        errors: ["Intelligence state unavailable; refresh queued"]
      )
    end
  end
end

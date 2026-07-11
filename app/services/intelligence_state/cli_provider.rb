require "json"

module IntelligenceState
  class CliProvider < Provider
    MAX_AGE = 15.minutes
    SUPPORTED_VERSION = "1.0"

    def initialize(path: default_path, max_age: MAX_AGE)
      @path = Pathname(path)
      @max_age = max_age
    end

    def snapshot
      return missing_snapshot unless @path.exist?

      payload = JSON.parse(@path.read)
      validate!(payload)
      generated_at = Time.iso8601(payload.fetch("generatedAt"))

      Snapshot.new(
        source: payload.fetch("source"),
        generated_at: generated_at,
        fresh: generated_at >= @max_age.ago,
        data: normalize(payload),
        errors: []
      )
    rescue JSON::ParserError, KeyError, ArgumentError => error
      Snapshot.new(source: "flyd-cli", generated_at: nil, fresh: false, data: {}, errors: [error.message])
    end

    private

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
        errors: ["Intelligence state file not found at #{@path}"]
      )
    end
  end
end

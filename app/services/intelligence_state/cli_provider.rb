require "json"
require "open3"
require "pathname"
require "time"
require "timeout"

module IntelligenceState
  class CliProvider < Provider
    MAX_AGE = 15.minutes
    SUPPORTED_VERSION = "1.0"
    REFRESH_TIMEOUT = 20.seconds

    def initialize(path: default_path, max_age: MAX_AGE, refresh: true)
      @path = Pathname(path)
      @max_age = max_age
      @refresh = refresh
    end

    def snapshot
      refresh_state if @refresh && refresh_required?
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
        errors: []
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

    def refresh_state
      cli_dir = Rails.root.join("cli")
      return unless cli_dir.join("package.json").exist?

      Timeout.timeout(REFRESH_TIMEOUT) do
        _stdout, stderr, status = Open3.capture3(
          "npm", "--prefix", cli_dir.to_s, "run", "export-state", "--silent"
        )
        Rails.logger.warn("CLI intelligence state refresh failed: #{stderr}") unless status.success?
      end
    rescue Timeout::Error
      Rails.logger.warn("CLI intelligence state refresh timed out")
    rescue Errno::ENOENT => error
      Rails.logger.warn("CLI intelligence state refresh unavailable: #{error.message}")
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
        errors: ["Intelligence state file not found at #{@path}"]
      )
    end
  end
end

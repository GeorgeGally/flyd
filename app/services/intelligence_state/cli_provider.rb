require "json"
require "time"

module IntelligenceState
  class CliProvider < Provider
    PROVIDER = "flyd-cli"
    MAX_AGE = 15.minutes
    SUPPORTED_VERSION = "1.0"

    def initialize(max_age: MAX_AGE)
      @max_age = max_age
    end

    def snapshot
      usable = IntelligenceSnapshot.latest_for(PROVIDER)
      latest = IntelligenceSnapshot.latest_record_for(PROVIDER)
      return unavailable_snapshot unless usable

      errors = if latest && latest.id != usable.id && !latest.status.in?(IntelligenceSnapshot::USABLE_STATUSES)
        Array(latest.errors)
      else
        Array(usable.errors)
      end

      Snapshot.new(
        source: usable.provider,
        generated_at: usable.generated_at,
        fresh: usable.fresh?,
        data: normalize(usable.payload),
        errors: errors
      )
    end

    def persist!(payload)
      validate!(payload)
      generated_at = Time.iso8601(payload.fetch("generatedAt"))
      digest = IntelligenceSnapshot.digest_for(payload.except("generatedAt"))
      record = IntelligenceSnapshot.find_or_initialize_by(provider: PROVIDER, state_digest: digest)
      changed = !record.persisted?

      record.update!(
        schema_version: payload.fetch("version"),
        status: generated_at >= @max_age.ago ? "fresh" : "stale",
        generated_at: generated_at,
        received_at: Time.current,
        fresh_until: generated_at + @max_age,
        payload: payload,
        errors: []
      )

      [record, changed]
    rescue JSON::ParserError, KeyError, ArgumentError => error
      record_failure!(error, payload: payload, status: "invalid")
      raise
    end

    def record_failure!(error, payload: {}, status: "unavailable")
      IntelligenceSnapshot.create!(
        provider: PROVIDER,
        schema_version: payload.is_a?(Hash) ? payload["version"].presence || SUPPORTED_VERSION : SUPPORTED_VERSION,
        status: status,
        generated_at: nil,
        received_at: Time.current,
        fresh_until: nil,
        state_digest: IntelligenceSnapshot.digest_for({ error: error.message, received_at: Time.current.to_f }),
        payload: payload.is_a?(Hash) ? payload : {},
        errors: [error.message]
      )
    end

    private

    def validate!(payload)
      version = payload.fetch("version")
      raise ArgumentError, "Unsupported intelligence state version: #{version}" unless version == SUPPORTED_VERSION
      raise ArgumentError, "Invalid intelligence state source" unless payload.fetch("source") == PROVIDER
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

    def unavailable_snapshot
      latest = IntelligenceSnapshot.latest_record_for(PROVIDER)
      Snapshot.new(
        source: PROVIDER,
        generated_at: nil,
        fresh: false,
        data: {},
        errors: latest ? Array(latest.errors) : ["No persisted intelligence snapshot is available"]
      )
    end
  end
end

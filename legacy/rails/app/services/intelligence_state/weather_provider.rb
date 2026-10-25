module IntelligenceState
  class WeatherProvider < Provider
    PROVIDER = "weather"
    MAX_AGE = 1.hour
    SCHEMA_VERSION = "1.0"

    def initialize(max_age: MAX_AGE)
      @max_age = max_age
    end

    def snapshot
      usable = IntelligenceSnapshot.latest_for(PROVIDER)
      latest = IntelligenceSnapshot.latest_record_for(PROVIDER)
      return unavailable_snapshot unless usable

      Snapshot.new(
        source: PROVIDER,
        snapshot_id: usable.id,
        state_digest: usable.state_digest,
        generated_at: usable.generated_at,
        fresh: usable.fresh?,
        data: { forecasts: Array(usable.payload["forecasts"]) },
        errors: provider_errors(usable, latest)
      )
    end

    def persist!(forecasts:, generated_at: Time.current)
      validate!(forecasts)
      payload = {
        "version" => SCHEMA_VERSION,
        "source" => PROVIDER,
        "generatedAt" => generated_at.iso8601,
        "forecasts" => forecasts
      }
      digest = IntelligenceSnapshot.semantic_digest_for(payload)
      record = IntelligenceSnapshot.find_or_initialize_by(provider: PROVIDER, state_digest: digest)
      changed = !record.persisted?
      record.update!(
        schema_version: SCHEMA_VERSION,
        status: generated_at >= @max_age.ago ? "fresh" : "stale",
        generated_at: generated_at,
        received_at: Time.current,
        fresh_until: generated_at + @max_age,
        payload: payload,
        provider_errors: []
      )
      [ record, changed ]
    end

    def record_failure!(error)
      IntelligenceSnapshot.create!(
        provider: PROVIDER,
        schema_version: SCHEMA_VERSION,
        status: "unavailable",
        generated_at: nil,
        received_at: Time.current,
        fresh_until: nil,
        state_digest: IntelligenceSnapshot.digest_for(error: error.message, received_at: Time.current.to_f),
        payload: {},
        provider_errors: [ error.message ]
      )
    end

    private

    def validate!(forecasts)
      raise ArgumentError, "Forecasts must be an array" unless forecasts.is_a?(Array)

      forecasts.each do |forecast|
        item = forecast.to_h
        raise ArgumentError, "Invalid weather forecast evidence" unless item["id"].present? && item["type"] == "forecast"
        raise ArgumentError, "Forecast content is required" unless item["content"].is_a?(Hash)
      end
    end

    def provider_errors(usable, latest)
      if latest && latest.id != usable.id && !latest.status.in?(IntelligenceSnapshot::USABLE_STATUSES)
        Array(latest.provider_errors)
      else
        Array(usable.provider_errors)
      end
    end

    def unavailable_snapshot
      latest = IntelligenceSnapshot.latest_record_for(PROVIDER)
      Snapshot.new(
        source: PROVIDER,
        snapshot_id: nil,
        state_digest: nil,
        generated_at: nil,
        fresh: false,
        data: {},
        errors: latest ? Array(latest.provider_errors) : [ "No persisted weather snapshot is available" ]
      )
    end
  end
end

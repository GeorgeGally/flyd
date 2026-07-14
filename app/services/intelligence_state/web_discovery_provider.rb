module IntelligenceState
  class WebDiscoveryProvider < Provider
    PROVIDER = "web-discovery"
    MAX_AGE = 2.hours
    SCHEMA_VERSION = "1.0"

    def initialize(max_age: MAX_AGE)
      @max_age = max_age
    end

    def snapshot
      usable = IntelligenceSnapshot.latest_for(PROVIDER)
      latest = IntelligenceSnapshot.latest_record_for(PROVIDER)
      return unavailable_snapshot unless usable

      errors = if latest && latest.id != usable.id && !latest.status.in?(IntelligenceSnapshot::USABLE_STATUSES)
        Array(latest.provider_errors)
      else
        Array(usable.provider_errors)
      end

      Snapshot.new(
        source: PROVIDER,
        snapshot_id: usable.id,
        state_digest: usable.state_digest,
        generated_at: usable.generated_at,
        fresh: usable.fresh?,
        data: { discoveries: Array(usable.payload["discoveries"]) },
        errors: errors
      )
    end

    def persist!(discoveries:, generated_at: Time.current)
      validate!(discoveries)
      payload = {
        "version" => SCHEMA_VERSION,
        "source" => PROVIDER,
        "generatedAt" => generated_at.iso8601,
        "discoveries" => discoveries
      }
      digest = IntelligenceSnapshot.digest_for(payload.except("generatedAt"))
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

    def validate!(discoveries)
      raise ArgumentError, "Discoveries must be an array" unless discoveries.is_a?(Array)

      discoveries.each do |item|
        item = item.to_h
        raise ArgumentError, "Invalid discovery evidence" unless item["id"].present? && item["type"] == "discovery"
        raise ArgumentError, "Discovery content is required" unless item["content"].is_a?(Hash)
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
        errors: latest ? Array(latest.provider_errors) : [ "No persisted web discovery snapshot is available" ]
      )
    end
  end
end

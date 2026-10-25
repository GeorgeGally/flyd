module IntelligenceState
  class PersonalContextProvider < Provider
    PROVIDER = "personal-context"
    MAX_AGE = 6.hours
    SCHEMA_VERSION = "1.0"

    def initialize(max_age: MAX_AGE)
      @max_age = max_age
    end

    def snapshot
      usable = IntelligenceSnapshot.latest_for(PROVIDER)
      return unavailable_snapshot unless usable

      Snapshot.new(
        source: PROVIDER,
        snapshot_id: usable.id,
        state_digest: usable.state_digest,
        generated_at: usable.generated_at,
        fresh: usable.fresh?,
        data: {
          activities: Array(usable.payload["activities"]),
          horoscopes: Array(usable.payload["horoscopes"])
        },
        errors: Array(usable.provider_errors)
      )
    end

    def persist!(activities:, horoscopes:, generated_at: Time.current)
      payload = {
        "version" => SCHEMA_VERSION,
        "source" => PROVIDER,
        "generatedAt" => generated_at.iso8601,
        "activities" => validate!(activities, "activity"),
        "horoscopes" => validate!(horoscopes, "horoscope")
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
        received_at: Time.current,
        state_digest: IntelligenceSnapshot.digest_for(error: error.message, received_at: Time.current.to_f),
        payload: {},
        provider_errors: [ error.message ]
      )
    end

    private

    def validate!(items, expected_type)
      raise ArgumentError, "#{expected_type.pluralize.humanize} must be an array" unless items.is_a?(Array)

      items.each do |item|
        raise ArgumentError, "Invalid #{expected_type} evidence" unless item.to_h["id"].present? && item.to_h["type"] == expected_type
      end
      items
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
        errors: latest ? Array(latest.provider_errors) : [ "No persisted personal context snapshot is available" ]
      )
    end
  end
end

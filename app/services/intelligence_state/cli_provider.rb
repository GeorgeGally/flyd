require "json"
require "time"

module IntelligenceState
  class CliProvider < Provider
    PROVIDER = "flyd-cli"
    MAX_AGE = 15.minutes
    SUPPORTED_VERSION = "1.0"
    COLLECTION_KEYS = {
      goals: "goals",
      tensions: "tensions",
      signals: "signals",
      curiosity: "curiosity",
      nudges: "nudges",
      reports: "reports",
      recent_events: "recentEvents",
      brain_health: "brainHealth",
      profile: "profile",
      knowledge: "knowledge",
      review: "review",
      suggestions: "suggestions",
      capabilities: "capabilities"
    }.freeze
    COLLECTIONS = COLLECTION_KEYS.values.freeze
    EVIDENCE_FIELDS = %w[id type source epistemicStatus confidence generatedAt evidenceRefs content].freeze
    EPISTEMIC_STATUSES = %w[observation user_confirmed inferred heuristic llm_generated contradicted superseded].freeze

    def initialize(max_age: MAX_AGE)
      @max_age = max_age
    end

    def snapshot
      usable = IntelligenceSnapshot.latest_for(PROVIDER)
      latest = IntelligenceSnapshot.latest_record_for(PROVIDER)
      return unavailable_snapshot unless usable

      provider_errors = if latest && latest.id != usable.id && !latest.status.in?(IntelligenceSnapshot::USABLE_STATUSES)
        Array(latest.provider_errors)
      else
        Array(usable.provider_errors)
      end

      Snapshot.new(
        source: usable.provider,
        snapshot_id: usable.id,
        state_digest: usable.state_digest,
        generated_at: usable.generated_at,
        fresh: usable.fresh?,
        data: normalize(usable.payload),
        errors: provider_errors
      )
    end

    def persist!(payload)
      validate!(payload)
      generated_at = Time.iso8601(payload.fetch("generatedAt"))
      digest = IntelligenceSnapshot.semantic_digest_for(payload)
      record = IntelligenceSnapshot.find_or_initialize_by(provider: PROVIDER, state_digest: digest)
      changed = !record.persisted?

      record.update!(
        schema_version: payload.fetch("version"),
        status: generated_at >= @max_age.ago ? "fresh" : "stale",
        generated_at: generated_at,
        received_at: Time.current,
        fresh_until: generated_at + @max_age,
        payload: payload,
        provider_errors: []
      )

      [ record, changed ]
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
        provider_errors: [ error.message ]
      )
    end

    private

    def validate!(payload)
      raise ArgumentError, "Intelligence state must be an object" unless payload.is_a?(Hash)

      version = payload.fetch("version")
      raise ArgumentError, "Unsupported intelligence state version: #{version}" unless version == SUPPORTED_VERSION
      raise ArgumentError, "Invalid intelligence state source" unless payload.fetch("source") == PROVIDER
      Time.iso8601(payload.fetch("generatedAt"))

      COLLECTIONS.each do |collection|
        items = payload.fetch(collection)
        raise ArgumentError, "#{collection} must be an array" unless items.is_a?(Array)
        items.each { |item| validate_evidence!(item, collection) }
      end
    end

    def validate_evidence!(item, collection)
      raise ArgumentError, "#{collection} evidence must be an object" unless item.is_a?(Hash)

      missing = EVIDENCE_FIELDS.reject { |field| item.key?(field) }
      raise ArgumentError, "#{collection} evidence missing: #{missing.join(", ")}" if missing.any?
      raise ArgumentError, "Invalid epistemic status: #{item["epistemicStatus"]}" unless EPISTEMIC_STATUSES.include?(item["epistemicStatus"])
      confidence = Float(item["confidence"], exception: false)
      raise ArgumentError, "Evidence confidence must be between 0 and 1" unless confidence&.between?(0, 1)
      raise ArgumentError, "Evidence content must be an object" unless item["content"].is_a?(Hash)
      raise ArgumentError, "Evidence references must be an array" unless item["evidenceRefs"].is_a?(Array)
    end

    def normalize(payload)
      COLLECTION_KEYS.transform_values { |payload_key| Array(payload[payload_key]) }
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
        errors: latest ? Array(latest.provider_errors) : [ "No persisted intelligence snapshot is available" ]
      )
    end
  end
end

require "digest"
require "time"

module IntelligenceState
  class CliQueryProvider < Provider
    PROVIDER = "flyd-cli-query"
    SUPPORTED_VERSION = "1.0"
    MAX_AGE = 15.minutes

    def initialize(bridge: CliBridge.new)
      @bridge = bridge
    end

    def snapshot(query:)
      payload = @bridge.retrieve(query)
      validate!(payload)
      generated_at = Time.iso8601(payload.fetch("generatedAt"))
      assessment = assessment_evidence(payload, generated_at)
      persisted_payload = payload.merge("memoryAssessment" => [ assessment ])
      digest = IntelligenceSnapshot.semantic_digest_for(persisted_payload)
      record = IntelligenceSnapshot.find_or_initialize_by(provider: PROVIDER, state_digest: digest)
      record.update!(
        schema_version: SUPPORTED_VERSION,
        status: generated_at >= MAX_AGE.ago ? "fresh" : "stale",
        generated_at: generated_at,
        received_at: Time.current,
        fresh_until: generated_at + MAX_AGE,
        payload: persisted_payload,
        provider_errors: []
      )

      snapshot_from(record)
    rescue CliBridge::Error, JSON::ParserError, KeyError, ArgumentError => error
      usable = usable_snapshot_for(query)
      return snapshot_from(usable, errors: [ error.message ]) if usable

      Snapshot.new(
        source: PROVIDER,
        snapshot_id: nil,
        state_digest: nil,
        generated_at: nil,
        fresh: false,
        data: {},
        errors: [ error.message ]
      )
    end

    private

    def usable_snapshot_for(query)
      IntelligenceSnapshot.where(provider: PROVIDER).usable.newest_first.detect do |record|
        record.payload["query"].to_s == query.to_s
      end
    end

    def snapshot_from(record, errors: [])
      Snapshot.new(
        source: PROVIDER,
        snapshot_id: record.id,
        state_digest: record.state_digest,
        generated_at: record.generated_at,
        fresh: record.fresh?,
        data: {
          memory_matches: Array(record.payload["matches"]),
          memory_assessment: Array(record.payload["memoryAssessment"])
        },
        errors: errors
      )
    end

    def validate!(payload)
      raise ArgumentError, "CLI brain retrieval must be an object" unless payload.is_a?(Hash)
      raise ArgumentError, "Unsupported CLI brain retrieval version" unless payload.fetch("version") == SUPPORTED_VERSION
      raise ArgumentError, "Invalid CLI brain retrieval source" unless payload.fetch("source") == "flyd-cli"
      raise ArgumentError, "CLI brain matches must be an array" unless payload.fetch("matches").is_a?(Array)

      Time.iso8601(payload.fetch("generatedAt"))
      payload.fetch("matches").each { |match| validate_match!(match) }
      sufficiency = payload.fetch("sufficiency")
      raise ArgumentError, "CLI brain sufficiency must be an object" unless sufficiency.is_a?(Hash)
    end

    def validate_match!(match)
      required = %w[id type source epistemicStatus confidence generatedAt evidenceRefs content]
      raise ArgumentError, "CLI brain match must be an object" unless match.is_a?(Hash)
      raise ArgumentError, "CLI brain match is incomplete" if required.any? { |field| !match.key?(field) }
      raise ArgumentError, "CLI brain match confidence is invalid" unless Float(match["confidence"], exception: false)&.between?(0, 1)
    end

    def assessment_evidence(payload, generated_at)
      content = payload.fetch("sufficiency").merge("query" => payload.fetch("query"))
      digest = Digest::SHA256.hexdigest(JSON.generate(content))[0, 16]
      {
        "id" => "memory_assessment:#{digest}",
        "type" => "memory_assessment",
        "source" => "cli.retrieval",
        "epistemicStatus" => "heuristic",
        "confidence" => 0.8,
        "generatedAt" => generated_at.iso8601,
        "evidenceRefs" => Array(payload["matches"]).map { |match| "#{match["type"]}:#{match["id"]}" },
        "content" => content
      }
    end
  end
end

module Flyd
  class EvidenceCandidates
    MAX_REFERENCES = 5
    MAX_EPHEMERAL_AGE = 14.days
    EPHEMERAL_TYPES = %w[curiosity signal nudge event].freeze
    DISQUALIFIED_STATUSES = %w[contradicted superseded].freeze

    def self.call(state)
      new(state).call
    end

    def initialize(state)
      @state = state.deep_symbolize_keys
    end

    def call
      [
        build_candidate("decision", decision_evidence, "Blocked or high-tension evidence may require a choice", 0.76),
        build_candidate("investigation", investigation_evidence, "Explicit unanswered questions may require investigation", 0.72),
        build_candidate("monitoring", monitoring_evidence, "Unresolved or outcome-bearing evidence may require monitoring", 0.68)
      ].compact
    end

    private

    def build_candidate(mode, evidence, reason, confidence)
      references = evidence.filter_map { |item| evidence_reference(item) }.uniq.first(MAX_REFERENCES)
      return if references.empty?

      {
        mode: mode,
        reason: reason,
        confidence: confidence,
        evidence_refs: references
      }
    end

    def decision_evidence
      collection(:tensions).select do |item|
        next false unless eligible?(item)

        content = item[:content].to_h
        content[:blockers].to_i.positive? || content[:tension].to_f >= 0.5
      end
    end

    def investigation_evidence
      collection(:curiosity).select do |item|
        content = item[:content].to_h
        eligible?(item) && content[:question].present? && missing_evidence(content).present?
      end
    end

    def monitoring_evidence
      unresolved_signals + supported_nudges + outcome_events
    end

    def unresolved_signals
      collection(:signals).select do |item|
        content = item[:content].to_h
        details = content[:details].to_h
        eligible?(item) && (content[:unresolved].to_i.positive? || details[:unresolvedCount].to_i.positive?)
      end
    end

    def supported_nudges
      collection(:nudges).select do |item|
        content = item[:content].to_h
        eligible?(item) &&
          epistemic_status(item).in?(%w[observation user_confirmed]) &&
          item[:confidence].to_f >= 0.6 &&
          content[:text].present?
      end
    end

    def outcome_events
      collection(:recent_events, :recentEvents).select do |item|
        eligible?(item) && item.dig(:content, :outcome).present?
      end
    end

    def collection(*keys)
      providers.flat_map do |provider|
        data = provider[:data].to_h
        Array(keys.filter_map { |key| data[key] }.first)
      end
    end

    def providers
      Array(@state.dig(:provider_state, :providers))
    end

    def eligible?(item)
      return false if item[:id].blank? || item[:type].blank?
      return false if DISQUALIFIED_STATUSES.include?(epistemic_status(item))
      return false if EPHEMERAL_TYPES.include?(item[:type].to_s) && !recent?(item)
      return generated_evidence_grounded?(item) if epistemic_status(item) == "llm_generated"

      true
    end

    def evidence_reference(item)
      return unless eligible?(item)

      { type: item[:type].to_s, id: item[:id] }
    end

    def missing_evidence(content)
      content[:missingEvidence].presence || content[:missing_evidence].presence
    end

    def epistemic_status(item)
      (item[:epistemic_status] || item[:epistemicStatus]).to_s
    end

    def generated_evidence_grounded?(item)
      item[:confidence].to_f >= 0.6 && evidence_refs(item).any?
    end

    def evidence_refs(item)
      Array(item[:evidence_refs] || item[:evidenceRefs])
    end

    def recent?(item)
      timestamp = evidence_timestamp(item)
      timestamp.present? && timestamp >= MAX_EPHEMERAL_AGE.ago
    end

    def evidence_timestamp(item)
      content = item[:content].to_h
      details = content[:details].to_h
      raw = item[:generated_at] || item[:generatedAt] || content[:date] || details[:lastActivity] || details[:last_activity]
      Time.zone.parse(raw.to_s) if raw.present?
    rescue ArgumentError, TypeError
      nil
    end
  end
end

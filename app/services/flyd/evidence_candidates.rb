module Flyd
  class EvidenceCandidates
    MAX_REFERENCES = 5
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
          item[:epistemicStatus].to_s.in?(%w[observation user_confirmed]) &&
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
      item[:id].present? &&
        item[:type].present? &&
        !DISQUALIFIED_STATUSES.include?(item[:epistemicStatus].to_s)
    end

    def evidence_reference(item)
      return unless eligible?(item)

      { type: item[:type].to_s, id: item[:id] }
    end

    def missing_evidence(content)
      content[:missingEvidence].presence || content[:missing_evidence].presence
    end
  end
end

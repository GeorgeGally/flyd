require "set"

module Flyd
  class EvidenceCandidates
    MAX_REFERENCES = 5
    MAX_EPHEMERAL_AGE = 14.days
    MAX_ARCHIVE_DISCOVERY_AGE = 180.days
    MONITORING_EVIDENCE_WINDOW = 12.hours
    MONITORING_CLOCK_SKEW = 2.minutes
    EPHEMERAL_TYPES = %w[curiosity signal nudge event].freeze
    DISQUALIFIED_STATUSES = %w[contradicted superseded].freeze

    def self.call(state)
      new(state).call
    end

    def initialize(state)
      @state = state.deep_symbolize_keys
    end

    def call
      runtime = runtime_task_candidate

      candidates = [
        runtime,
        memory_conversation_candidate,
        build_candidate("decision", decision_evidence, "Blocked or high-tension evidence may require a choice", 0.76),
        build_candidate("investigation", investigation_evidence, "Missing or conflicting evidence may require investigation", 0.72),
        build_candidate("monitoring", monitoring_evidence, "Unresolved or outcome-bearing evidence may require monitoring", 0.68),
        discovery_candidate
      ].compact

      demote_ungrounded_candidates(candidates, has_runtime: runtime.present?)
    end

    private

    # Evidence-only decision, investigation, and monitoring candidates
    # frequently trigger modes the LLM cannot satisfy — they lack the exact
    # runtime selectors the validator enforces.  Demote them below discovery
    # so the LLM composes what it can, while genuine runtime work still takes
    # the stage at full confidence.
    def demote_ungrounded_candidates(candidates, has_runtime:)
      return candidates if has_runtime

      candidates.map do |candidate|
        next candidate unless %w[decision investigation monitoring].include?(candidate[:mode].to_s)

        candidate.merge(confidence: 0.35)
      end
    end

    def runtime_task_candidate
      task = collection(:runtime_tasks).first
      return unless task && eligible?(task)

      content = evidence_content(task)
      status = content[:status].to_s
      return if settled_completion?(task, content, status)

      related = collection(:task_corrections).last(1) + case status
      when "awaiting_grant"
        collection(:task_grants).select { |grant| evidence_content(grant)[:status].to_s == "proposed" }
      when "running"
        collection(:worker_sessions).select { |worker| evidence_content(worker)[:status].to_s.in?(%w[queued starting running stopping]) } +
          collection(:task_assignments)
      when "blocked"
        collection(:task_assignments).select { |assignment| evidence_content(assignment)[:status].to_s == "blocked" } +
          collection(:worker_sessions).select { |worker| evidence_content(worker)[:status].to_s.in?(%w[failed interrupted]) }
      when "ready", "completed"
        collection(:task_artifacts) + collection(:task_assignments)
      else
        []
      end
      references = ([ task ] + related).filter_map { |item| evidence_reference(item) }.uniq.first(MAX_REFERENCES)
      mode, renderer, reason = runtime_task_direction(status, related)

      {
        mode: mode,
        renderer: renderer,
        reason: reason,
        confidence: 1.0,
        evidence_refs: references
      }
    end

    def runtime_task_direction(status, related)
      case status
      when "awaiting_grant"
        if related.any?
          [ "decision", "task_plan", "A persisted coding plan is waiting for an explicit permission decision" ]
        else
          [ "action", "task_orientation", "A coding task needs a precise orientation before work can begin" ]
        end
      when "running"
        [ "monitoring", "worker_monitor", "Active coding work has live progress and bounded controls" ]
      when "blocked"
        [ "investigation", "task_review", "Coding work is blocked and needs a grounded intervention" ]
      when "ready"
        if related.any? { |item| item[:type].to_s == "task_artifact" }
          [ "action", "task_review", "Verified coding work is ready for review and completion" ]
        else
          [ "action", "task_orientation", "The coding task is ready to resume from its exact re-entry point" ]
        end
      when "completed"
        [ "action", "task_completion", "A verified coding outcome is ready to return to the user" ]
      else
        [ "action", "task_orientation", "The coding task is the most concrete current situation" ]
      end
    end

    # A completed task earns the stage once, then yields it: the outcome has
    # been returned, and holding the stage for a day makes the portal look
    # dead. Completion stays dominant only while genuine follow-up remains.
    def settled_completion?(task, content, status)
      RuntimeTasks::NextAction.settled?(status: status, recommended_next_action: content[:recommendedNextAction]) &&
        completion_presented?(task)
    end

    def completion_presented?(task)
      recent_surface_items.any? do |item|
        item[:id].to_s.end_with?(":task_completion") &&
          Array(item[:source_refs]).any? { |ref| ref[:type].to_s == "runtime_task" && ref[:id].to_s == task[:id].to_s }
      end
    end

    # Presented means presented: a completion that earned the stage on any
    # recent surface has had its moment, even if another scene intervened.
    def recent_surface_items
      previous = @state[:previous_surface].to_h
      items = Array(previous[:recent_items])
      items.any? ? items : Array(previous[:items])
    end

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

    def discovery_candidate
      items = discovery_evidence
      return if items.empty?

      {
        mode: "discovery",
        reason: "Grounded personal or current evidence is worth rediscovering",
        confidence: 0.45,
        evidence_refs: discovery_selection(items).map { |item| { type: item[:type].to_s, id: item[:id] } }
      }
    end

    def decision_evidence
      collection(:tensions).select do |item|
        next false unless eligible?(item)

        content = evidence_content(item)
        content[:blockers].to_i.positive? || content[:tension].to_f >= 0.5
      end
    end

    def investigation_evidence
      curiosity = collection(:curiosity).select do |item|
        content = evidence_content(item)
        eligible?(item) && content[:question].present? && missing_evidence(content).present?
      end
      curiosity + memory_investigation_evidence
    end

    def memory_conversation_candidate
      return if @state[:active_intent].blank?
      return unless memory_verdict == "sufficient"

      build_candidate(
        "conversation",
        memory_matches,
        "Targeted personal memory can answer the active intent",
        0.74
      )
    end

    def memory_investigation_evidence
      return [] unless memory_verdict.in?(%w[partial conflicting])

      memory_assessments + memory_matches
    end

    def memory_matches
      collection(:memory_matches).select { |item| eligible?(item) }
    end

    def memory_assessments
      collection(:memory_assessment).select { |item| eligible?(item) }
    end

    def memory_verdict
      evidence_content(memory_assessments.first || {})[:verdict].to_s
    end

    # Monitoring means a live, changing condition. Evidence that is merely
    # recent enough to keep (MAX_EPHEMERAL_AGE) is still far too stale to
    # drive the current interface — yesterday's record is not today's moment.
    def monitoring_evidence
      (unresolved_signals + supported_nudges + outcome_events).select do |item|
        timestamp = evidence_timestamp(item)
        timestamp.present? &&
          timestamp >= MONITORING_EVIDENCE_WINDOW.ago &&
          timestamp <= Time.current + MONITORING_CLOCK_SKEW
      end
    end

    def unresolved_signals
      collection(:signals).select do |item|
        content = evidence_content(item)
        details = content[:details].to_h.deep_symbolize_keys
        eligible?(item) && (content[:unresolved].to_i.positive? || details[:unresolvedCount].to_i.positive?)
      end
    end

    def supported_nudges
      collection(:nudges).select do |item|
        content = evidence_content(item)
        eligible?(item) &&
          epistemic_status(item).in?(%w[observation user_confirmed]) &&
          item[:confidence].to_f >= 0.6 &&
          content[:text].present?
      end
    end

    def outcome_events
      collection(:recent_events, :recentEvents).select do |item|
        eligible?(item) && evidence_content(item)[:outcome].present?
      end
    end

    def discovery_evidence
      items = fresh_collection(:activities) + fresh_collection(:horoscopes) + fresh_collection(:forecasts) + fresh_collection(:discoveries) +
        collection(:recent_events, :recentEvents) + collection(:reports) + memory_matches +
        collection(:quotes) + collection(:ideas) + collection(:facts)
      items.select do |item|
        discoverable?(item) && !previously_shown?(item)
      end.sort_by { |item| -discovery_score(item) }
    end

    def discovery_selection(items)
      anchors = %w[activity horoscope discovery quote fact idea].filter_map do |type|
        items.find { |item| item[:type].to_s == type }
      end
      (anchors + (items - anchors)).first(12)
    end

    def discoverable?(item)
      return false if item[:id].blank? || item[:type].blank?
      return false unless epistemic_status(item).in?(%w[observation user_confirmed])
      return false if item[:confidence].to_f < 0.7

      content = evidence_content(item)
      return false if content.values_at(:title, :excerpt, :description).compact_blank.empty?
      return false if polluted_test_evidence?(content)
      return content[:description].to_s.length >= 40 if item[:type].to_s == "discovery"
      return true if item[:type].to_s == "report"
      return true if item[:type].to_s == "forecast"

      timestamp = evidence_timestamp(item)
      timestamp.present? && timestamp >= MAX_ARCHIVE_DISCOVERY_AGE.ago
    end

    def discovery_score(item)
      content = evidence_content(item)
      title = content[:title].to_s
      score = case item[:type].to_s
      when "activity" then 1_500
      when "horoscope" then 1_250
      when "quote" then 1_100
      when "discovery" then 1_000
      when "idea" then 950
      when "forecast" then 925
      when "fact" then 900
      when "event" then 500
      else 100
      end
      score += Array(content[:topics]).compact_blank.size * 12
      score += 500 if content[:rabbitHole] || content[:rabbit_hole]
      score += 180 if (content[:interestVerdict] || content[:interest_verdict]) == "hot"
      score += 60 if (content[:interestVerdict] || content[:interest_verdict]) == "worth_a_look"
      score += 120 if title.match?(/research|finding|fact|insight/i)
      score += 70 if title.match?(/concept|history|news/i)
      score -= 100 if title.match?(/attention report|tension report|implementation plan|deep review|test/i)
      score
    end

    def polluted_test_evidence?(content)
      text = [ content[:title], content[:excerpt] ].compact.join(" ")
      text.match?(/\Atest:/i) || text.match?(/hello from test suite/i) || text.match?(/(.)\1{12,}/)
    end

    def previously_shown?(item)
      return false if item[:type].to_s.in?(%w[activity horoscope])

      shown_references.include?("#{item[:type]}:#{item[:id]}")
    end

    def shown_references
      @shown_references ||= Array(@state.dig(:previous_surface, :items)).flat_map do |surface_item|
        Array(surface_item[:source_refs]).map do |reference|
          "#{reference[:type]}:#{reference[:id]}"
        end
      end.to_set
    end

    def collection(*keys)
      providers.flat_map do |provider|
        data = provider[:data].to_h
        Array(keys.filter_map { |key| data[key] }.first)
      end
    end

    def fresh_collection(*keys)
      providers.select { |provider| provider[:fresh] }.flat_map do |provider|
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
      content = evidence_content(item)
      details = content[:details].to_h.deep_symbolize_keys
      raw = item[:generated_at] || item[:generatedAt] || content[:date] || details[:lastActivity] || details[:last_activity]
      Time.zone.parse(raw.to_s) if raw.present?
    rescue ArgumentError, TypeError
      nil
    end

    def evidence_content(item)
      item[:content].to_h.deep_symbolize_keys
    end
  end
end

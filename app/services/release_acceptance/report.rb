module ReleaseAcceptance
  class Report
    TARGET_PROPAGATION_MS = 2_000

    def self.call(now: Time.current)
      new(Evidence.call, now: now).build
    end

    def self.build(evidence, now: Time.current)
      new(evidence, now: now).build
    end

    def initialize(evidence, now:)
      @evidence = evidence
      @now = now
    end

    def build
      primary = primary_product_trial
      technical_status = evidence[:real_sessions] < 10 || evidence[:resumed_sessions] < 5 ?
        "insufficient_evidence" : "passed"
      p95 = nearest_rank_p95(evidence[:propagation_latencies_ms])
      propagation_status = if p95.nil? || evidence[:propagation_latencies_ms].length < 10
        "insufficient_evidence"
      else
        p95 < TARGET_PROPAGATION_MS ? "passed" : "failed"
      end
      interpretation_total = evidence.values_at(
        :accepted_interpretations, :corrected_interpretations, :replaced_interpretations
      ).sum
      measures = [
        measure("resume_without_restatement", "Resumed without manual restatement",
          ratio_status(evidence[:resumed_without_restatement], evidence[:resumed_sessions], 0.7),
          "#{evidence[:resumed_without_restatement]}/#{evidence[:resumed_sessions]}"),
        measure("startup_interpretations", "Startup interpretations accepted or focused-corrected",
          ratio_status(evidence[:accepted_interpretations] + evidence[:corrected_interpretations], interpretation_total, 0.8),
          "#{evidence[:accepted_interpretations] + evidence[:corrected_interpretations]}/#{interpretation_total}"),
        measure("recommended_actions", "Recommended actions accepted or directly adapted",
          ratio_status(evidence[:accepted_or_adapted_actions], evidence[:recommended_actions], 0.5),
          "#{evidence[:accepted_or_adapted_actions]}/#{evidence[:recommended_actions]}"),
        measure("proactive_interventions", "Accepted reversible intervention per working week",
          primary[:status] != "passed" ? "insufficient_evidence" :
            (primary[:qualifying_weeks].all? { |week| evidence[:accepted_intervention_week_dates].include?(week) } ? "passed" : "failed"),
          "#{evidence[:accepted_intervention_weeks]}/2 weeks"),
        measure("verified_outcomes", "Completed tasks have verified outcomes and useful re-entry points",
          evidence[:completed_tasks].zero? ? "insufficient_evidence" :
            (evidence[:completed_tasks_with_verified_outcome_and_reentry] == evidence[:completed_tasks] ? "passed" : "failed"),
          "#{evidence[:completed_tasks_with_verified_outcome_and_reentry]}/#{evidence[:completed_tasks]}"),
        measure("cross_surface_parity", "CLI and Rails expose the same committed task state",
          evidence[:parity_evidence_count].zero? || propagation_status == "insufficient_evidence" ? "insufficient_evidence" :
            (evidence[:parity_evidence_count] >= evidence[:real_sessions] && propagation_status == "passed" ? "passed" : "failed"),
          "#{evidence[:parity_evidence_count]} observations"),
        measure("memory_safety", "No stale or unsupported memory confirmed as current",
          all_recorded(evidence[:memory_safety_reviews]), "#{evidence[:memory_safety_reviews].length} reviews"),
        measure("recommendation_rationale", "Recommendation rationale is identifiable without evidence noise",
          all_recorded(evidence[:rationale_reviews]), "#{evidence[:rationale_reviews].length} reviews")
      ]
      automated_status = all_recorded(evidence[:automated_acceptance_runs].map do |run|
        run[:idempotent] && run[:permissions_enforced] && run[:no_duplicate_effects]
      end)
      statuses = [
        primary[:status], technical_status, propagation_status, automated_status, *measures.pluck(:status)
      ]
      hard_failure = primary[:status] == "failed" ||
        propagation_status == "failed" ||
        automated_status == "failed" ||
        measures.select { |measure| measure[:key].in?(%w[memory_safety recommendation_rationale]) }
          .any? { |measure| measure[:status] == "failed" }
      status = if hard_failure
        "failed"
      elsif primary[:status] == "insufficient_evidence" || technical_status == "insufficient_evidence"
        "insufficient_evidence"
      else
        overall(statuses)
      end

      {
        status: status,
        generated_at: @now.iso8601,
        primary_product_trial: primary,
        technical_trial: {
          status: technical_status,
          real_sessions: evidence[:real_sessions],
          resumed_sessions: evidence[:resumed_sessions]
        },
        measures: measures,
        propagation: {
          status: propagation_status,
          p95_ms: p95,
          sample_size: evidence[:propagation_latencies_ms].length,
          target_ms: TARGET_PROPAGATION_MS
        },
        automated_acceptance: { status: automated_status, runs: evidence[:automated_acceptance_runs].length }
      }
    end

    private

    attr_reader :evidence

    def ratio_status(numerator, denominator, threshold)
      return "insufficient_evidence" if denominator.zero?

      numerator.fdiv(denominator) >= threshold ? "passed" : "failed"
    end

    def all_recorded(values)
      return "insufficient_evidence" if values.empty?

      values.all? ? "passed" : "failed"
    end

    def overall(statuses)
      return "failed" if statuses.include?("failed")
      return "insufficient_evidence" if statuses.include?("insufficient_evidence")

      "qualified"
    end

    def measure(key, label, status, result)
      { key: key, label: label, status: status, result: result }
    end

    def nearest_rank_p95(values)
      return if values.empty?

      values.sort[(values.length * 0.95).ceil - 1]
    end

    def primary_product_trial
      available_at = evidence[:release1c_available_at]
      return primary_result("insufficient_evidence", nil, [], 0) if available_at.blank?

      time_zone = evidence[:time_zone].present? ? ActiveSupport::TimeZone[evidence[:time_zone]] : Time.zone
      available_date = Time.iso8601(available_at.to_s).in_time_zone(time_zone).to_date
      dates = evidence[:real_session_dates].map { |date| Date.parse(date.to_s) }
        .uniq.select { |date| date >= available_date && date.on_weekday? }
      counts = dates.group_by(&:beginning_of_week).transform_values(&:length)
      qualifying = counts.select { |_week, count| count >= 5 }.keys.sort
      first = qualifying.find { |week| qualifying.include?(week + 7.days) }
      unless first
        available_week = available_date.beginning_of_week
        first_eligible_week = available_date == available_week ? available_week : available_week + 7.days
        trial_end = first_eligible_week + 14.days
        status = @now.in_time_zone(time_zone).to_date < trial_end ? "insufficient_evidence" : "failed"
        return primary_result(status, available_at, qualifying, dates.length)
      end

      weeks = [ first, first + 7.days ]
      primary_result("passed", available_at, weeks, dates.count { |date| weeks.include?(date.beginning_of_week) })
    end

    def primary_result(status, available_at, weeks, days)
      {
        status: status,
        release1c_available_at: available_at,
        qualifying_weeks: weeks.map(&:to_s),
        qualifying_working_days: days
      }
    end
  end
end

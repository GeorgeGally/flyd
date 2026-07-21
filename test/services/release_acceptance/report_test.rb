require "test_helper"

class ReleaseAcceptance::ReportTest < ActiveSupport::TestCase
  test "qualifies complete persisted evidence" do
    report = ReleaseAcceptance::Report.build(complete_evidence, now: Time.utc(2026, 7, 20))

    assert_equal "qualified", report[:status]
    assert_equal "passed", report.dig(:primary_product_trial, :status)
    assert_equal 1_200, report.dig(:propagation, :p95_ms)
    assert report[:measures].all? { |measure| measure[:status] == "passed" }
  end

  test "reports missing evidence without claiming success" do
    evidence = complete_evidence.merge(
      release1c_available_at: nil,
      recommended_actions: 0,
      accepted_or_adapted_actions: 0,
      propagation_latencies_ms: [],
      memory_safety_reviews: [],
      rationale_reviews: [],
      automated_acceptance_runs: []
    )

    report = ReleaseAcceptance::Report.build(evidence, now: Time.utc(2026, 7, 20))

    assert_equal "insufficient_evidence", report[:status]
    assert_equal "insufficient_evidence", report.dig(:primary_product_trial, :status)
    assert_nil report.dig(:propagation, :p95_ms)
  end

  test "keeps an unfinished trial insufficient instead of failing it early" do
    evidence = complete_evidence.merge(
      real_sessions: 1,
      resumed_sessions: 0,
      resumed_without_restatement: 0,
      real_session_dates: ["2026-07-06"],
      propagation_latencies_ms: [120]
    )

    report = ReleaseAcceptance::Report.build(evidence, now: Time.utc(2026, 7, 8))

    assert_equal "insufficient_evidence", report[:status]
    assert_equal "insufficient_evidence", report.dig(:primary_product_trial, :status)
    assert_equal "insufficient_evidence", report.dig(:technical_trial, :status)
    assert_equal "insufficient_evidence", report.dig(:propagation, :status)
  end

  test "treats partial parity coverage as missing evidence rather than a failed comparison" do
    evidence = complete_evidence.merge(
      real_sessions: 3,
      parity_evidence_count: 2,
      propagation_latencies_ms: Array.new(24, 200)
    )

    report = ReleaseAcceptance::Report.build(evidence, now: Time.utc(2026, 7, 20))

    parity = report[:measures].find { |measure| measure[:key] == "cross_surface_parity" }
    assert_equal "insufficient_evidence", parity[:status]
  end

  test "reports a failed elapsed trial even when another measure is missing" do
    evidence = complete_evidence.merge(
      real_session_dates: ["2026-07-06"],
      recommended_actions: 0,
      accepted_or_adapted_actions: 0
    )

    report = ReleaseAcceptance::Report.build(evidence, now: Time.utc(2026, 7, 20))

    assert_equal "failed", report[:status]
    assert_equal "failed", report.dig(:primary_product_trial, :status)
  end

  test "preserves a failed automated run for the active release" do
    evidence = complete_evidence.merge(
      automated_acceptance_runs: [
        { idempotent: false, permissions_enforced: false, no_duplicate_effects: false },
        { idempotent: true, permissions_enforced: true, no_duplicate_effects: true }
      ]
    )

    report = ReleaseAcceptance::Report.build(evidence, now: Time.utc(2026, 7, 20))

    assert_equal "failed", report[:status]
    assert_equal({ status: "failed", runs: 2 }, report[:automated_acceptance])
  end

  test "does not fail provisional ratios or a partial first week" do
    evidence = complete_evidence.merge(
      release1c_available_at: "2026-07-08T00:00:00Z",
      real_sessions: 1,
      resumed_sessions: 1,
      resumed_without_restatement: 0,
      accepted_interpretations: 0,
      corrected_interpretations: 0,
      replaced_interpretations: 1,
      recommended_actions: 1,
      accepted_or_adapted_actions: 0,
      accepted_intervention_weeks: 1,
      real_session_dates: [ "2026-07-08" ],
      propagation_latencies_ms: []
    )

    report = ReleaseAcceptance::Report.build(evidence, now: Time.utc(2026, 7, 20))

    assert_equal "insufficient_evidence", report[:status]
    assert_equal "insufficient_evidence", report.dig(:primary_product_trial, :status)
  end

  private

  def complete_evidence
    {
      release1c_available_at: "2026-07-05T12:00:00Z",
      real_sessions: 10,
      resumed_sessions: 5,
      resumed_without_restatement: 4,
      accepted_interpretations: 7,
      corrected_interpretations: 1,
      replaced_interpretations: 2,
      recommended_actions: 10,
      accepted_or_adapted_actions: 6,
      accepted_intervention_weeks: 2,
      accepted_intervention_week_dates: %w[2026-07-06 2026-07-13],
      completed_tasks: 2,
      completed_tasks_with_verified_outcome_and_reentry: 2,
      parity_evidence_count: 10,
      propagation_latencies_ms: [120, 180, 250, 300, 350, 410, 500, 620, 800, 1_200],
      memory_safety_reviews: [true],
      rationale_reviews: [true],
      automated_acceptance_runs: [
        { idempotent: true, permissions_enforced: true, no_duplicate_effects: true }
      ],
      real_session_dates: %w[
        2026-07-06 2026-07-07 2026-07-08 2026-07-09 2026-07-10
        2026-07-13 2026-07-14 2026-07-15 2026-07-16 2026-07-17
      ]
    }
  end
end

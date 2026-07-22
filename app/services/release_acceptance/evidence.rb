module ReleaseAcceptance
  class Evidence
    QUALIFYING_ARTIFACT_KINDS = %w[diff test log code].freeze

    def self.call
      new.call
    end

    def call
      marker = ReleaseMarker.find_by(release_key: "release_1c")
      return empty_evidence unless marker

      sessions = real_sessions(marker.available_at)
      session_ids = sessions.select(:id)
      completed = AgentTask.where(status: "completed", completed_at: marker.available_at..)
      observations = ReleaseAcceptanceObservation.where(observed_at: marker.available_at..).order(:observed_at, :id)
      if marker.metadata["commit"].present?
        observations = observations.where("evidence->>'commit' = ?", marker.metadata["commit"])
      end
      delivery_evidence = delivery_evidence(marker.available_at)
      intervention_weeks = accepted_intervention_weeks(marker.available_at)
      recommendations = visible_recommendations(marker: marker, session_ids: session_ids)

      {
        release1c_available_at: marker.available_at.iso8601,
        time_zone: Time.zone.tzinfo.name,
        real_sessions: sessions.count,
        resumed_sessions: sessions.where(resumed: true).count,
        resumed_without_restatement: sessions.where(resumed: true, manual_context_restatement: false).count,
        accepted_interpretations: sessions.where(interpretation_status: "accepted").count,
        corrected_interpretations: sessions.where(interpretation_status: "focused_corrected").count,
        replaced_interpretations: sessions.where(interpretation_status: "replaced").count,
        recommended_actions: recommendations.count,
        accepted_or_adapted_actions: recommendations.where(disposition: %w[accepted adapted]).count,
        accepted_intervention_weeks: intervention_weeks.length,
        accepted_intervention_week_dates: intervention_weeks.map(&:to_s),
        completed_tasks: completed.count,
        completed_tasks_with_verified_outcome_and_reentry: completed
          .where.not(verification_result: {}).where.not(outcome_summary: [ nil, "" ])
          .where.not(recommended_next_action: [ nil, "" ]).count,
        parity_evidence_count: delivery_evidence[:session_ids].uniq.length,
        propagation_latencies_ms: delivery_evidence[:latencies],
        memory_safety_reviews: observations.where(kind: "memory_safety").pluck(:passed),
        rationale_reviews: observations.where(kind: "recommendation_rationale").pluck(:passed),
        automated_acceptance_runs: observations.where(kind: "automated_acceptance").map do |observation|
          evidence = observation.evidence.deep_symbolize_keys
          {
            idempotent: observation.passed? && evidence[:idempotent] == true,
            permissions_enforced: observation.passed? && evidence[:permissions_enforced] == true,
            no_duplicate_effects: observation.passed? && evidence[:no_duplicate_effects] == true
          }
        end,
        real_session_dates: TaskSession.where(id: session_ids).pluck(:started_at)
          .map { |started_at| started_at.in_time_zone.to_date.to_s }.uniq
      }
    end

    private

    def real_sessions(available_at)
      TaskSession.where(status: "ended", started_at: available_at..)
        .where(<<~SQL.squish)
          EXISTS (
            SELECT 1
            FROM worker_sessions workers
            JOIN task_artifacts artifacts ON artifacts.worker_session_id = workers.id
            WHERE workers.agent_task_id = task_sessions.agent_task_id
              AND workers.started_at BETWEEN task_sessions.started_at AND task_sessions.ended_at
              AND artifacts.created_at BETWEEN task_sessions.started_at AND task_sessions.ended_at
              AND artifacts.verification_status = 'verified'
              AND artifacts.kind IN ('diff', 'test', 'log', 'code')
          )
        SQL
    end

    def accepted_intervention_weeks(available_at)
      WorkerCommand.joins(worker_session: :task_assignment)
        .where(status: "completed", created_at: available_at..)
        .where(task_assignments: { status: "integrated" })
        .where("worker_commands.payload ? 'evidence_digest'")
        .pluck(:created_at)
        .map { |created_at| created_at.in_time_zone.to_date.beginning_of_week }
        .uniq
    end

    def visible_recommendations(marker:, session_ids:)
      recommendations = TaskRecommendation.where(
        release_key: marker.release_key,
        created_at: marker.available_at..
      )
      recommendations.where(task_session_id: session_ids).or(
        recommendations.where(<<~SQL.squish)
          EXISTS (
            SELECT 1
            FROM surface_items recommendation_items
            JOIN runtime_delivery_receipts recommendation_receipts
              ON recommendation_receipts.surface_item_id = recommendation_items.id
              AND recommendation_receipts.task_revision = task_recommendations.task_revision
            WHERE recommendation_items.id = task_recommendations.surface_item_id
          )
        SQL
      )
    end

    def delivery_evidence(available_at)
      sql = ActiveRecord::Base.sanitize_sql_array([ <<~SQL.squish, available_at, QUALIFYING_ARTIFACT_KINDS ])
        WITH real_sessions AS (
          SELECT sessions.id, sessions.agent_task_id, sessions.started_at, sessions.ended_at
          FROM task_sessions sessions
          WHERE sessions.status = 'ended'
            AND sessions.started_at >= ?
            AND EXISTS (
              SELECT 1
              FROM worker_sessions workers
              JOIN task_artifacts artifacts ON artifacts.worker_session_id = workers.id
              WHERE workers.agent_task_id = sessions.agent_task_id
                AND workers.started_at BETWEEN sessions.started_at AND sessions.ended_at
                AND artifacts.created_at BETWEEN sessions.started_at AND sessions.ended_at
                AND artifacts.verification_status = 'verified'
                AND artifacts.kind IN (?)
            )
        )
        SELECT real_sessions.id AS session_id,
          events.id AS event_id,
          MIN(receipts.delivery_latency_ms)::int AS delivery_latency_ms
        FROM real_sessions
        JOIN runtime_events events
          ON events.agent_task_id = real_sessions.agent_task_id
          AND events.occurred_at BETWEEN real_sessions.started_at AND real_sessions.ended_at
        JOIN runtime_delivery_receipts receipts ON receipts.runtime_event_id = events.id
          AND receipts.task_revision = events.task_revision
          AND receipts.surface_item_id IS NOT NULL
          AND NULLIF(receipts.binding_digest, '') IS NOT NULL
        GROUP BY real_sessions.id, events.id
        ORDER BY events.id
      SQL
      rows = ActiveRecord::Base.connection.select_all(sql)
      {
        session_ids: rows.map { |row| row.fetch("session_id").to_i },
        latencies: rows.map { |row| row.fetch("delivery_latency_ms").to_i }
      }
    end

    def empty_evidence
      {
        release1c_available_at: nil,
        time_zone: Time.zone.tzinfo.name,
        real_sessions: 0,
        resumed_sessions: 0,
        resumed_without_restatement: 0,
        accepted_interpretations: 0,
        corrected_interpretations: 0,
        replaced_interpretations: 0,
        recommended_actions: 0,
        accepted_or_adapted_actions: 0,
        accepted_intervention_weeks: 0,
        accepted_intervention_week_dates: [],
        completed_tasks: 0,
        completed_tasks_with_verified_outcome_and_reentry: 0,
        parity_evidence_count: 0,
        propagation_latencies_ms: [],
        memory_safety_reviews: [],
        rationale_reviews: [],
        automated_acceptance_runs: [],
        real_session_dates: []
      }
    end
  end
end

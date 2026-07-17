class AddRelease1bOrchestration < ActiveRecord::Migration[8.0]
  LIVE_WORKER_STATUSES = %w[queued starting running stopping].freeze

  def up
    create_table :task_assignments do |t|
      t.references :agent_task, null: false, foreign_key: true
      t.string :assignment_key, null: false
      t.string :status, null: false, default: "pending"
      t.string :title, null: false
      t.text :instructions, null: false
      t.jsonb :success_criteria, null: false, default: []
      t.jsonb :capability_requirements, null: false, default: []
      t.jsonb :dependency_keys, null: false, default: []
      t.jsonb :declared_file_scope, null: false, default: []
      t.jsonb :excluded_adapters, null: false, default: []
      t.string :worktree_path
      t.string :branch_name
      t.string :base_head
      t.jsonb :verification_result, null: false, default: {}
      t.jsonb :integration_result, null: false, default: {}
      t.bigint :revision, null: false, default: 1
      t.datetime :started_at
      t.datetime :ended_at
      t.timestamps
    end

    add_index :task_assignments, :assignment_key, unique: true
    add_index :task_assignments, [ :agent_task_id, :status ]
    add_check_constraint :task_assignments,
      "status IN ('pending','running','verified','blocked','integrated','failed','cancelled')",
      name: "task_assignments_status_check"
    add_check_constraint :task_assignments, "revision > 0", name: "task_assignments_revision_check"

    add_reference :worker_sessions, :task_assignment, foreign_key: true
    add_column :worker_sessions, :capabilities, :jsonb, null: false, default: []
    add_column :worker_sessions, :last_observed_at, :datetime
    add_column :worker_sessions, :stop_reason, :text

    backfill_assignments
    change_column_null :worker_sessions, :task_assignment_id, false

    remove_index :worker_sessions, name: "index_worker_sessions_one_live_per_task"
    add_index :worker_sessions, :task_assignment_id, unique: true,
      where: "status IN ('#{LIVE_WORKER_STATUSES.join("','")}')",
      name: "index_worker_sessions_one_live_per_assignment"
    remove_check_constraint :worker_sessions, name: "worker_sessions_status_check"
    add_check_constraint :worker_sessions,
      "status IN ('queued','starting','running','stopping','completed','failed','interrupted','cancelled','stopped','replaced')",
      name: "worker_sessions_status_check"

    create_table :worker_commands do |t|
      t.references :agent_task, null: false, foreign_key: true
      t.references :worker_session, null: false, foreign_key: true
      t.string :command_key, null: false
      t.string :kind, null: false
      t.string :status, null: false, default: "queued"
      t.string :idempotency_key, null: false
      t.jsonb :payload, null: false, default: {}
      t.datetime :dispatched_at
      t.datetime :completed_at
      t.text :error_summary
      t.timestamps
    end

    add_index :worker_commands, :command_key, unique: true
    add_index :worker_commands, :idempotency_key, unique: true
    add_index :worker_commands, [ :worker_session_id, :status ]
    add_check_constraint :worker_commands,
      "kind IN ('stop','retry','redirect','replace')",
      name: "worker_commands_kind_check"
    add_check_constraint :worker_commands,
      "status IN ('queued','dispatched','completed','failed','cancelled')",
      name: "worker_commands_status_check"
  end

  def down
    drop_table :worker_commands

    remove_check_constraint :worker_sessions, name: "worker_sessions_status_check"
    add_check_constraint :worker_sessions,
      "status IN ('queued','starting','running','completed','failed','interrupted','cancelled')",
      name: "worker_sessions_status_check"
    remove_index :worker_sessions, name: "index_worker_sessions_one_live_per_assignment"
    add_index :worker_sessions, :agent_task_id, unique: true,
      where: "status IN ('queued','starting','running')",
      name: "index_worker_sessions_one_live_per_task"
    remove_column :worker_sessions, :stop_reason
    remove_column :worker_sessions, :last_observed_at
    remove_column :worker_sessions, :capabilities
    remove_reference :worker_sessions, :task_assignment, foreign_key: true

    drop_table :task_assignments
  end

  private

  def backfill_assignments
    execute <<~SQL.squish
      INSERT INTO task_assignments
        (agent_task_id, assignment_key, status, title, instructions, success_criteria,
         capability_requirements, dependency_keys, declared_file_scope, excluded_adapters,
         worktree_path, base_head, verification_result, integration_result, revision,
         started_at, ended_at, created_at, updated_at)
      SELECT
        worker_sessions.agent_task_id,
        gen_random_uuid()::text,
        CASE worker_sessions.status
          WHEN 'completed' THEN 'verified'
          WHEN 'failed' THEN 'failed'
          WHEN 'cancelled' THEN 'cancelled'
          ELSE 'running'
        END,
        'Release 1A worker',
        agent_tasks.intended_outcome,
        '[]'::jsonb,
        jsonb_build_array('implementation'),
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        worker_sessions.working_directory,
        agent_tasks.repository_snapshot->>'head',
        '{}'::jsonb,
        '{}'::jsonb,
        GREATEST(worker_sessions.assignment_revision, 1),
        worker_sessions.started_at,
        worker_sessions.ended_at,
        worker_sessions.created_at,
        worker_sessions.updated_at
      FROM worker_sessions
      JOIN agent_tasks ON agent_tasks.id = worker_sessions.agent_task_id
    SQL

    execute <<~SQL.squish
      UPDATE worker_sessions
      SET task_assignment_id = task_assignments.id
      FROM task_assignments
      WHERE task_assignments.agent_task_id = worker_sessions.agent_task_id
        AND task_assignments.created_at = worker_sessions.created_at
    SQL
  end
end

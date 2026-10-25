class CreateRelease1aRuntime < ActiveRecord::Migration[8.0]
  ACTIVE_TASK_STATUSES = %w[awaiting_grant ready running blocked].freeze
  ACTIVE_WORKER_STATUSES = %w[queued starting running].freeze

  def change
    create_table :agent_tasks do |t|
      t.references :project, null: false, foreign_key: true
      t.string :task_key, null: false
      t.string :status, null: false, default: "awaiting_grant"
      t.text :intended_outcome, null: false
      t.jsonb :success_criteria, null: false, default: []
      t.jsonb :verification_criteria, null: false, default: []
      t.jsonb :plan, null: false, default: {}
      t.jsonb :context_snapshot, null: false, default: {}
      t.jsonb :repository_snapshot, null: false, default: {}
      t.text :recommended_next_action
      t.text :outcome_summary
      t.jsonb :verification_result, null: false, default: {}
      t.bigint :revision, null: false, default: 0
      t.datetime :started_at
      t.datetime :completed_at
      t.datetime :cancelled_at
      t.timestamps
    end

    add_index :agent_tasks, :task_key, unique: true
    add_index :agent_tasks, :project_id, unique: true,
      where: "status IN ('#{ACTIVE_TASK_STATUSES.join("','")}')",
      name: "index_agent_tasks_one_unfinished_per_project"
    add_check_constraint :agent_tasks,
      "status IN ('awaiting_grant','ready','running','blocked','completed','failed','cancelled')",
      name: "agent_tasks_status_check"
    add_check_constraint :agent_tasks, "revision >= 0", name: "agent_tasks_revision_check"

    create_table :task_grants do |t|
      t.references :agent_task, null: false, foreign_key: true
      t.string :grant_key, null: false
      t.string :status, null: false, default: "proposed"
      t.string :scope_digest, null: false
      t.jsonb :repository_roots, null: false, default: []
      t.jsonb :worktree_paths, null: false, default: []
      t.jsonb :worker_adapters, null: false, default: []
      t.jsonb :file_operations, null: false, default: []
      t.jsonb :command_classes, null: false, default: []
      t.jsonb :verification_commands, null: false, default: []
      t.jsonb :renewal_required_actions, null: false, default: []
      t.integer :max_concurrency, null: false, default: 1
      t.jsonb :budget, null: false, default: {}
      t.datetime :approved_at
      t.datetime :expires_at
      t.datetime :ended_at
      t.timestamps
    end

    add_index :task_grants, :grant_key, unique: true
    add_index :task_grants, :agent_task_id, unique: true,
      where: "status = 'approved'",
      name: "index_task_grants_one_approved_per_task"
    add_check_constraint :task_grants,
      "status IN ('proposed','approved','expired','revoked','exhausted','completed')",
      name: "task_grants_status_check"
    add_check_constraint :task_grants, "max_concurrency > 0", name: "task_grants_concurrency_check"

    create_table :worker_sessions do |t|
      t.references :agent_task, null: false, foreign_key: true
      t.references :task_grant, null: false, foreign_key: true
      t.references :resumes_worker_session, foreign_key: { to_table: :worker_sessions }
      t.string :worker_key, null: false
      t.string :status, null: false, default: "queued"
      t.string :adapter, null: false
      t.string :executable_path
      t.string :executable_version
      t.string :working_directory, null: false
      t.string :external_session_id
      t.bigint :process_id
      t.integer :assignment_revision, null: false, default: 1
      t.datetime :last_heartbeat_at
      t.datetime :started_at
      t.datetime :ended_at
      t.integer :exit_status
      t.text :error_summary
      t.text :output
      t.jsonb :usage, null: false, default: {}
      t.timestamps
    end

    add_index :worker_sessions, :worker_key, unique: true
    add_index :worker_sessions, :agent_task_id, unique: true,
      where: "status IN ('#{ACTIVE_WORKER_STATUSES.join("','")}')",
      name: "index_worker_sessions_one_live_per_task"
    add_check_constraint :worker_sessions,
      "status IN ('queued','starting','running','completed','failed','interrupted','cancelled')",
      name: "worker_sessions_status_check"

    create_table :task_sessions do |t|
      t.references :agent_task, null: false, foreign_key: true
      t.string :session_key, null: false
      t.string :status, null: false, default: "active"
      t.boolean :resumed, null: false, default: false
      t.string :interpretation_status, null: false, default: "pending"
      t.boolean :manual_context_restatement, null: false, default: false
      t.boolean :tool_escape, null: false, default: false
      t.jsonb :startup_snapshot, null: false, default: {}
      t.datetime :started_at, null: false
      t.datetime :ended_at
      t.timestamps
    end

    add_index :task_sessions, :session_key, unique: true
    add_check_constraint :task_sessions, "status IN ('active','ended')", name: "task_sessions_status_check"
    add_check_constraint :task_sessions,
      "interpretation_status IN ('pending','accepted','focused_corrected','replaced')",
      name: "task_sessions_interpretation_check"

    create_table :runtime_events do |t|
      t.references :agent_task, null: false, foreign_key: true
      t.references :task_grant, foreign_key: true
      t.references :worker_session, foreign_key: true
      t.string :event_key, null: false
      t.string :event_type, null: false
      t.string :idempotency_key
      t.bigint :task_revision, null: false
      t.jsonb :payload, null: false, default: {}
      t.datetime :occurred_at, null: false
      t.datetime :archive_delivered_at
      t.datetime :broadcast_delivered_at
      t.integer :delivery_attempts, null: false, default: 0
      t.datetime :next_delivery_at
      t.text :last_delivery_error
      t.timestamps
    end

    add_index :runtime_events, :event_key, unique: true
    add_index :runtime_events, :idempotency_key, unique: true, where: "idempotency_key IS NOT NULL"
    add_index :runtime_events, [ :agent_task_id, :task_revision ], unique: true
    add_index :runtime_events, [ :archive_delivered_at, :next_delivery_at ], name: "index_runtime_events_pending_archive"
  end
end

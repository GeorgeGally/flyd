class CreateTaskArtifacts < ActiveRecord::Migration[8.0]
  def change
    create_table :task_artifacts do |t|
      t.references :agent_task, null: false, foreign_key: true
      t.references :task_assignment, foreign_key: true
      t.references :worker_session, foreign_key: true
      t.string :artifact_key, null: false
      t.string :kind, null: false
      t.string :title, null: false
      t.string :media_type, null: false
      t.bigint :byte_size, null: false
      t.string :sha256_digest, null: false
      t.string :verification_status, null: false, default: "pending"
      t.bigint :source_revision, null: false
      t.text :content
      t.string :relative_path
      t.string :repository_head
      t.jsonb :provenance, null: false, default: {}
      t.timestamps
    end

    add_index :task_artifacts, :artifact_key, unique: true
    add_index :task_artifacts, [ :agent_task_id, :source_revision ]
    add_check_constraint :task_artifacts,
      "kind IN ('diff','test','log','code','image','document')",
      name: "task_artifacts_kind_check"
    add_check_constraint :task_artifacts,
      "verification_status IN ('pending','verified','rejected')",
      name: "task_artifacts_verification_status_check"
    add_check_constraint :task_artifacts, "byte_size >= 0", name: "task_artifacts_byte_size_check"
    add_check_constraint :task_artifacts, "source_revision >= 0", name: "task_artifacts_source_revision_check"
  end
end

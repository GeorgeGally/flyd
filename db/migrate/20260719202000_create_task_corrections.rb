class CreateTaskCorrections < ActiveRecord::Migration[8.0]
  def change
    create_table :task_corrections do |t|
      t.references :agent_task, null: false, foreign_key: true
      t.references :supersedes_task_correction, foreign_key: { to_table: :task_corrections }
      t.string :correction_key, null: false
      t.text :original_claim
      t.text :corrected_value, null: false
      t.bigint :task_revision, null: false
      t.bigint :surface_revision
      t.string :authority, null: false, default: "user"
      t.jsonb :provenance, null: false, default: {}
      t.timestamps
    end

    add_index :task_corrections, :correction_key, unique: true
    add_index :task_corrections, [ :agent_task_id, :task_revision ], unique: true
    add_check_constraint :task_corrections, "task_revision >= 0", name: "task_corrections_revision_check"
    add_check_constraint :task_corrections, "surface_revision IS NULL OR surface_revision >= 0",
      name: "task_corrections_surface_revision_check"
    add_check_constraint :task_corrections, "authority IN ('user')", name: "task_corrections_authority_check"
  end
end

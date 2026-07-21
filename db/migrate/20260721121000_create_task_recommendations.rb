class CreateTaskRecommendations < ActiveRecord::Migration[8.0]
  def change
    create_table :task_recommendations do |t|
      t.references :agent_task, null: false, foreign_key: true
      t.references :task_session, null: false, foreign_key: true
      t.string :release_key, null: false
      t.bigint :task_revision, null: false
      t.text :action, null: false
      t.string :action_digest, null: false
      t.string :disposition, null: false, default: "offered"
      t.datetime :acted_at
      t.jsonb :metadata, null: false, default: {}
      t.timestamps
    end

    add_index :task_recommendations, [ :task_session_id, :action_digest ], unique: true
    add_index :task_recommendations, [ :release_key, :created_at ]
    add_check_constraint :task_recommendations,
      "task_revision >= 0",
      name: "task_recommendations_revision_check"
    add_check_constraint :task_recommendations,
      "disposition IN ('offered', 'accepted', 'adapted', 'rejected')",
      name: "task_recommendations_disposition_check"
  end
end

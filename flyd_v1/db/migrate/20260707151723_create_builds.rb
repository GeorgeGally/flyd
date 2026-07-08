class CreateBuilds < ActiveRecord::Migration[8.0]
  def change
    create_table :builds do |t|
      t.references :project, null: false, foreign_key: true
      t.references :conversation, null: false, foreign_key: true
      t.string :status
      t.jsonb :context_snapshot
      t.text :output
      t.text :outcome_summary
      t.datetime :started_at
      t.datetime :completed_at

      t.timestamps
    end
  end
end

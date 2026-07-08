class CreateBehaviours < ActiveRecord::Migration[8.0]
  def change
    create_table :behaviours do |t|
      t.string :name
      t.string :trigger_phrase
      t.text :description
      t.jsonb :steps
      t.integer :success_count
      t.integer :failure_count
      t.datetime :last_used_at
      t.references :project, null: true, foreign_key: true
      t.float :decay_score

      t.timestamps
    end
  end
end

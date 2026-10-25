class CreateBeliefs < ActiveRecord::Migration[8.0]
  def change
    create_table :beliefs do |t|
      t.text :statement
      t.float :confidence
      t.references :project, null: true, foreign_key: true
      t.string :status
      t.float :decay_score
      t.datetime :last_used_at

      t.timestamps
    end
  end
end

class CreateDecisions < ActiveRecord::Migration[8.0]
  def change
    create_table :decisions do |t|
      t.references :conversation, null: false, foreign_key: true
      t.references :project, null: false, foreign_key: true
      t.text :content
      t.references :source_message, foreign_key: { to_table: :messages }
      t.float :confidence, default: 0.5
      t.datetime :extracted_at

      t.timestamps
    end
    add_index :decisions, :extracted_at
  end
end

class CreateConversations < ActiveRecord::Migration[8.0]
  def change
    create_table :conversations do |t|
      t.references :project, null: false, foreign_key: true
      t.string :status, default: "active"
      t.text :summary
      t.boolean :active, default: false

      t.timestamps
    end
    add_index :conversations, [:project_id, :active]
  end
end

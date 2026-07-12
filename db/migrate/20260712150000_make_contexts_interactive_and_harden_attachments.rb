class MakeContextsInteractiveAndHardenAttachments < ActiveRecord::Migration[8.0]
  def change
    change_column_null :conversations, :project_id, true
    add_reference :conversations, :context, foreign_key: true
    add_reference :conversations, :superseded_by_conversation, foreign_key: { to_table: :conversations }
    add_index :conversations, :context_id, unique: true, where: "active = true", name: "idx_conversations_one_active_per_context"

    add_column :intent_attachments, :expires_at, :datetime
    add_index :intent_attachments, [ :intent_id, :checksum ], unique: true
    add_index :intent_attachments, :expires_at
  end
end

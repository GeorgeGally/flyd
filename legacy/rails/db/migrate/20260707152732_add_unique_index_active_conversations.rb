class AddUniqueIndexActiveConversations < ActiveRecord::Migration[8.0]
  def change
    add_index :conversations, :project_id,
      unique: true,
      where: "active = true",
      name: "idx_conversations_one_active_per_project"
  end
end

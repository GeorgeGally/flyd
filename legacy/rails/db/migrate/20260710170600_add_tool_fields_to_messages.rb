class AddToolFieldsToMessages < ActiveRecord::Migration[8.0]
  def change
    add_column :messages, :tool_call_id, :string
    add_column :messages, :name, :string
    add_index :messages, :tool_call_id
  end
end

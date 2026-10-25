class ConstrainPersonalContext < ActiveRecord::Migration[8.0]
  def change
    add_index :contexts,
      %i[kind name],
      unique: true,
      where: "kind = 'topic' AND name = 'Personal'",
      name: "index_contexts_on_unique_personal"
  end
end

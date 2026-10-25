class AddCompositeUniqueIndexToMemoryEdges < ActiveRecord::Migration[8.0]
  def change
    add_index :memory_edges, [:source_type, :source_id, :target_type, :target_id, :relationship_type],
      unique: true,
      name: "index_memory_edges_on_source_target_type_uniq"
  end
end

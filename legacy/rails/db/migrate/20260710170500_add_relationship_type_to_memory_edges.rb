class AddRelationshipTypeToMemoryEdges < ActiveRecord::Migration[8.0]
  def change
    add_column :memory_edges, :relationship_type, :string, null: false, default: "relates_to"
    add_index :memory_edges, :relationship_type
  end
end

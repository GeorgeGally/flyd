class CreateMemoryEdges < ActiveRecord::Migration[8.0]
  def change
    create_table :memory_edges do |t|
      t.string :source_type
      t.integer :source_id
      t.string :target_type
      t.integer :target_id
      t.float :confidence
      t.integer :citation_count
      t.datetime :last_cited_at

      t.timestamps
    end
  end
end

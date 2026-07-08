class AddNotNullConstraints < ActiveRecord::Migration[8.0]
  def change
    change_column_null :beliefs, :confidence, false, 0.5
    change_column_default :beliefs, :confidence, 0.5

    change_column_null :memory_edges, :source_type, false
    change_column_null :memory_edges, :source_id, false
    change_column_null :memory_edges, :target_type, false
    change_column_null :memory_edges, :target_id, false
  end
end

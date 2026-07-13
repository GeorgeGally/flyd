class AddBeliefProvenance < ActiveRecord::Migration[8.0]
  def change
    add_column :beliefs, :source_decision_ids, :jsonb, null: false, default: []
  end
end

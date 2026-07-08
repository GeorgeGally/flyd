class AddDecayFieldsToDecisions < ActiveRecord::Migration[8.0]
  def change
    add_column :decisions, :decay_score, :float
    add_column :decisions, :last_used_at, :datetime
    add_column :decisions, :decay_type, :string
  end
end

class AddDecisionToTaskGrants < ActiveRecord::Migration[8.0]
  def change
    add_column :task_grants, :decision_reason, :text
    add_column :task_grants, :decided_at, :datetime
  end
end

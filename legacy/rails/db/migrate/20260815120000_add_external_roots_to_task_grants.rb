class AddExternalRootsToTaskGrants < ActiveRecord::Migration[8.0]
  def change
    add_column :task_grants, :external_roots, :jsonb, default: [], null: false
  end
end
class AddRepositoryRootToTaskAssignments < ActiveRecord::Migration[8.0]
  def change
    add_column :task_assignments, :repository_root, :text
    add_index :task_assignments, [ :agent_task_id, :repository_root ],
      name: "index_task_assignments_on_task_and_repository"
  end
end

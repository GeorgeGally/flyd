class BackfillAssignmentRepositoryRoots < ActiveRecord::Migration[8.0]
  def up
    execute <<~SQL.squish
      UPDATE task_assignments
      SET repository_root = projects.root_path
      FROM agent_tasks, projects
      WHERE task_assignments.agent_task_id = agent_tasks.id
        AND agent_tasks.project_id = projects.id
        AND task_assignments.repository_root IS NULL
    SQL
    change_column_null :task_assignments, :repository_root, false
  end

  def down
    change_column_null :task_assignments, :repository_root, true
  end
end

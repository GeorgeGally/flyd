class ConstrainActiveTaskSessions < ActiveRecord::Migration[8.0]
  def change
    add_index :task_sessions, :agent_task_id,
      unique: true,
      where: "status = 'active'",
      name: "index_task_sessions_one_active_per_task"
  end
end

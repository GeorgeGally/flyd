class AddProcessGroupToWorkerSessions < ActiveRecord::Migration[8.0]
  def change
    add_column :worker_sessions, :process_group_id, :bigint
  end
end

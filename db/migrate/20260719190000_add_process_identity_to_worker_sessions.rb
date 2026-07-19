class AddProcessIdentityToWorkerSessions < ActiveRecord::Migration[8.0]
  def change
    add_column :worker_sessions, :process_identity, :string
  end
end

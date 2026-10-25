class RequireTaskGrantExpiry < ActiveRecord::Migration[8.0]
  def up
    execute <<~SQL.squish
      UPDATE task_grants
      SET expires_at = COALESCE(approved_at, created_at, CURRENT_TIMESTAMP) + INTERVAL '8 hours'
      WHERE expires_at IS NULL
    SQL
    change_column_null :task_grants, :expires_at, false
  end

  def down
    change_column_null :task_grants, :expires_at, true
  end
end

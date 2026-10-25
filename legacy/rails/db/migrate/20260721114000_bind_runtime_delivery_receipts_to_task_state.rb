class BindRuntimeDeliveryReceiptsToTaskState < ActiveRecord::Migration[8.0]
  def up
    add_column :runtime_delivery_receipts, :task_revision, :bigint
    add_column :runtime_delivery_receipts, :binding_digest, :string

    execute <<~SQL
      UPDATE runtime_delivery_receipts receipts
      SET task_revision = events.task_revision
      FROM runtime_events events
      WHERE events.id = receipts.runtime_event_id
    SQL

    change_column_null :runtime_delivery_receipts, :task_revision, false
    add_check_constraint :runtime_delivery_receipts,
      "task_revision >= 0",
      name: "runtime_delivery_receipts_task_revision_check"
  end

  def down
    remove_check_constraint :runtime_delivery_receipts, name: "runtime_delivery_receipts_task_revision_check"
    remove_column :runtime_delivery_receipts, :binding_digest
    remove_column :runtime_delivery_receipts, :task_revision
  end
end

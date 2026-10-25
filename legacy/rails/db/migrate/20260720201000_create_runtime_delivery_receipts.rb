class CreateRuntimeDeliveryReceipts < ActiveRecord::Migration[8.0]
  def change
    create_table :runtime_delivery_receipts do |t|
      t.references :runtime_event, null: false, foreign_key: true
      t.string :client_id, null: false
      t.bigint :surface_id
      t.datetime :acknowledged_at, null: false
      t.integer :delivery_latency_ms, null: false
      t.timestamps
    end
    add_index :runtime_delivery_receipts,
      [ :runtime_event_id, :client_id ],
      unique: true,
      name: "index_runtime_delivery_receipts_on_event_and_client"
    add_check_constraint :runtime_delivery_receipts,
      "delivery_latency_ms >= 0",
      name: "runtime_delivery_receipts_latency_check"
  end
end

class CreateRuntimeDeliveryStates < ActiveRecord::Migration[8.0]
  def change
    create_table :runtime_delivery_states do |t|
      t.string :listener_key, null: false
      t.bigint :last_event_id, null: false, default: 0
      t.string :lease_owner
      t.datetime :lease_expires_at
      t.datetime :last_received_at
      t.datetime :last_delivered_at
      t.integer :delivery_latency_ms
      t.text :last_error
      t.timestamps
    end

    add_index :runtime_delivery_states, :listener_key, unique: true
    add_check_constraint :runtime_delivery_states, "last_event_id >= 0", name: "runtime_delivery_states_cursor_check"
    add_check_constraint :runtime_delivery_states, "delivery_latency_ms IS NULL OR delivery_latency_ms >= 0",
      name: "runtime_delivery_states_latency_check"
  end
end

class CreateReleaseAcceptanceObservations < ActiveRecord::Migration[8.0]
  def change
    create_table :release_acceptance_observations do |t|
      t.string :kind, null: false
      t.boolean :passed, null: false
      t.jsonb :evidence, null: false, default: {}
      t.string :idempotency_key, null: false
      t.datetime :observed_at, null: false
      t.timestamps
    end
    add_index :release_acceptance_observations, :idempotency_key, unique: true
    add_index :release_acceptance_observations, [ :kind, :observed_at ]
  end
end

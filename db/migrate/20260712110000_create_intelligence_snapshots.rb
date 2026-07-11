class CreateIntelligenceSnapshots < ActiveRecord::Migration[8.0]
  def change
    create_table :intelligence_snapshots do |t|
      t.string :provider, null: false
      t.string :schema_version, null: false
      t.string :status, null: false, default: "fresh"
      t.datetime :generated_at
      t.datetime :received_at, null: false
      t.datetime :fresh_until
      t.string :state_digest, null: false
      t.jsonb :payload, null: false, default: {}
      t.jsonb :errors, null: false, default: []

      t.timestamps
    end

    add_index :intelligence_snapshots, [:provider, :created_at]
    add_index :intelligence_snapshots, [:provider, :state_digest], unique: true
    add_index :intelligence_snapshots, :status
    add_index :intelligence_snapshots, :fresh_until
  end
end

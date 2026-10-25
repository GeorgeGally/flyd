class AddIntentAndSurfaceLifecycle < ActiveRecord::Migration[8.0]
  def change
    create_table :intents do |t|
      t.text :input_text, null: false
      t.string :modality, null: false, default: "text"
      t.string :status, null: false, default: "received"
      t.jsonb :attachments, null: false, default: []
      t.jsonb :interpretation, null: false, default: {}
      t.jsonb :context_candidates, null: false, default: []
      t.jsonb :resolved_contexts, null: false, default: []
      t.string :requested_capability
      t.references :origin_surface, foreign_key: { to_table: :surfaces }
      t.references :result_surface, foreign_key: { to_table: :surfaces }
      t.references :conversation, foreign_key: true
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :intents, :status
    add_index :intents, :created_at

    create_table :context_corrections do |t|
      t.references :intent, foreign_key: true
      t.references :surface_item, foreign_key: true
      t.jsonb :original_contexts, null: false, default: []
      t.jsonb :corrected_contexts, null: false, default: []
      t.text :reason

      t.timestamps
    end

    create_table :surface_feedbacks do |t|
      t.references :surface, null: false, foreign_key: true
      t.references :surface_item, foreign_key: true
      t.string :signal, null: false
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :surface_feedbacks, [ :surface_id, :signal ]

    create_table :surface_composition_logs do |t|
      t.references :surface, foreign_key: true
      t.string :reason
      t.string :state_digest
      t.string :model
      t.integer :input_characters
      t.integer :output_characters
      t.integer :latency_ms
      t.string :status, null: false
      t.jsonb :provider_health, null: false, default: []
      t.jsonb :validation_errors, null: false, default: []
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :surface_composition_logs, :status
    add_index :surface_composition_logs, :created_at
  end
end

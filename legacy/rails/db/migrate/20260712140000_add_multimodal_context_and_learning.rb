class AddMultimodalContextAndLearning < ActiveRecord::Migration[8.0]
  def change
    create_table :intent_attachments do |t|
      t.references :intent, null: false, foreign_key: true
      t.string :modality, null: false
      t.string :filename
      t.string :content_type
      t.bigint :byte_size, null: false, default: 0
      t.string :checksum
      t.binary :data
      t.text :extracted_text
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :intent_attachments, :modality
    add_index :intent_attachments, :checksum

    create_table :contexts do |t|
      t.string :name, null: false
      t.string :kind, null: false, default: "temporary"
      t.text :description
      t.string :status, null: false, default: "active"
      t.datetime :expires_at
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :contexts, :status
    add_index :contexts, :expires_at
    add_index :contexts, [ :kind, :name ]

    create_table :surface_preferences do |t|
      t.string :dimension, null: false
      t.string :value, null: false
      t.float :weight, null: false, default: 0.0
      t.integer :positive_count, null: false, default: 0
      t.integer :negative_count, null: false, default: 0
      t.datetime :last_observed_at
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :surface_preferences, [ :dimension, :value ], unique: true
    add_index :surface_preferences, :weight
  end
end

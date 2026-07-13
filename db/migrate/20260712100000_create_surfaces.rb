class CreateSurfaces < ActiveRecord::Migration[8.0]
  def change
    create_table :surfaces do |t|
      t.string :status, null: false, default: "draft"
      t.text :understanding
      t.text :current_intention
      t.string :focus_item_key
      t.datetime :generated_at
      t.datetime :valid_until
      t.string :source_state_digest
      t.string :composition_version, null: false, default: "1"
      t.references :previous_surface, foreign_key: { to_table: :surfaces }
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :surfaces, :status
    add_index :surfaces, :valid_until
    add_index :surfaces, :source_state_digest
    add_index :surfaces, :status, unique: true, where: "status = 'active'", name: "index_surfaces_one_active"

    create_table :surface_items do |t|
      t.references :surface, null: false, foreign_key: true
      t.string :item_key, null: false
      t.string :kind, null: false
      t.string :intent, null: false
      t.string :renderer, null: false
      t.string :depth, null: false, default: "middle"
      t.string :state, null: false, default: "presented"
      t.string :title, null: false
      t.text :summary
      t.integer :position, null: false, default: 0
      t.jsonb :context_refs, null: false, default: []
      t.jsonb :source_refs, null: false, default: []
      t.jsonb :actions, null: false, default: []
      t.jsonb :relationships, null: false, default: []
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :surface_items, [:surface_id, :item_key], unique: true
    add_index :surface_items, [:surface_id, :position]
  end
end

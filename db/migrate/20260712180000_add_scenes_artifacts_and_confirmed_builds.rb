class AddScenesArtifactsAndConfirmedBuilds < ActiveRecord::Migration[8.0]
  def change
    create_table :scenes do |t|
      t.string :scene_key, null: false
      t.string :kind, null: false, default: "work"
      t.string :status, null: false, default: "active"
      t.string :title, null: false
      t.text :summary
      t.text :desired_outcome
      t.text :resolution_summary
      t.references :project, foreign_key: true
      t.references :context, foreign_key: true
      t.references :conversation, foreign_key: true
      t.references :intent, foreign_key: true
      t.datetime :last_presented_at
      t.datetime :resolved_at
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end
    add_index :scenes, :scene_key, unique: true
    add_index :scenes, [ :status, :updated_at ]

    create_table :artifacts do |t|
      t.references :scene, null: false, foreign_key: true
      t.references :project, foreign_key: true
      t.references :context, foreign_key: true
      t.references :conversation, foreign_key: true
      t.references :build, foreign_key: true
      t.string :kind, null: false
      t.string :status, null: false, default: "ready"
      t.string :title, null: false
      t.text :content
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end
    add_index :artifacts, [ :scene_id, :created_at ]
    add_index :artifacts, [ :kind, :status ]

    add_reference :scenes, :resolved_artifact, foreign_key: { to_table: :artifacts }
    add_reference :surface_items, :scene, foreign_key: true

    add_reference :builds, :scene, foreign_key: true
    add_reference :builds, :artifact, foreign_key: true
    add_reference :builds, :requested_by_surface_item, foreign_key: { to_table: :surface_items }
    add_column :builds, :instructions, :text
    add_column :builds, :confirmation_summary, :text
    add_column :builds, :confirmed_at, :datetime
  end
end

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

    reversible do |direction|
      direction.up do
        execute <<~SQL
          INSERT INTO scenes (
            scene_key, kind, status, title, summary, desired_outcome,
            project_id, context_id, conversation_id, last_presented_at,
            metadata, created_at, updated_at
          )
          SELECT
            'conversation:' || conversations.id,
            'conversation',
            'active',
            COALESCE(NULLIF(conversations.summary, ''), 'Continue current work'),
            conversations.summary,
            conversations.summary,
            conversations.project_id,
            conversations.context_id,
            conversations.id,
            conversations.updated_at,
            '{}'::jsonb,
            conversations.created_at,
            conversations.updated_at
          FROM conversations
          WHERE conversations.active = TRUE
          ON CONFLICT (scene_key) DO NOTHING
        SQL

        execute <<~SQL
          INSERT INTO scenes (
            scene_key, kind, status, title, summary, last_presented_at,
            metadata, created_at, updated_at
          )
          SELECT DISTINCT ON (surface_items.item_key)
            surface_items.item_key,
            CASE WHEN surface_items.kind = 'conversation' THEN 'conversation' ELSE 'work' END,
            CASE WHEN surface_items.state = 'dismissed' THEN 'dismissed' ELSE 'active' END,
            surface_items.title,
            surface_items.summary,
            surface_items.updated_at,
            '{}'::jsonb,
            surface_items.created_at,
            surface_items.updated_at
          FROM surface_items
          ORDER BY surface_items.item_key, surface_items.updated_at DESC
          ON CONFLICT (scene_key) DO NOTHING
        SQL

        execute <<~SQL
          UPDATE surface_items
          SET scene_id = scenes.id
          FROM scenes
          WHERE scenes.scene_key = surface_items.item_key
        SQL
      end
    end
  end
end

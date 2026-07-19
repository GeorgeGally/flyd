class CreateReleaseMarkers < ActiveRecord::Migration[8.0]
  def up
    create_table :release_markers do |t|
      t.string :release_key, null: false
      t.datetime :available_at, null: false
      t.jsonb :metadata, null: false, default: {}
      t.timestamps
    end
    add_index :release_markers, :release_key, unique: true

    execute <<~SQL
      INSERT INTO release_markers
        (release_key, available_at, metadata, created_at, updated_at)
      VALUES
        (
          'release_1c',
          '2026-07-19 14:56:22',
          '{"commit":"e171c4b34b3888f9118e17d878b405ac321b3ece"}'::jsonb,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      ON CONFLICT (release_key) DO NOTHING
    SQL
  end

  def down
    drop_table :release_markers
  end
end

class CreateReleaseMarkers < ActiveRecord::Migration[8.0]
  def up
    create_table :release_markers do |t|
      t.string :release_key, null: false
      t.datetime :available_at, null: false
      t.jsonb :metadata, null: false, default: {}
      t.timestamps
    end
    add_index :release_markers, :release_key, unique: true
  end

  def down
    drop_table :release_markers
  end
end

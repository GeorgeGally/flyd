class RemoveSyntheticRelease1cMarker < ActiveRecord::Migration[8.0]
  SYNTHETIC_COMMIT = "e171c4b34b3888f9118e17d878b405ac321b3ece"

  def up
    execute <<~SQL
      DELETE FROM release_markers
      WHERE release_key = 'release_1c'
        AND available_at = '2026-07-19 14:56:22'
        AND metadata->>'commit' = '#{SYNTHETIC_COMMIT}'
    SQL
  end

  def down
    # Synthetic dogfood time must not be recreated.
  end
end

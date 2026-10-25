# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).
#
ReleaseMarker.find_or_create_by!(release_key: "release_1c") do |marker|
  marker.available_at = Time.utc(2026, 7, 19, 14, 56, 22)
  marker.metadata = { "commit" => "e171c4b34b3888f9118e17d878b405ac321b3ece" }
end

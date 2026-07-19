class ReleaseMarker < ApplicationRecord
  validates :release_key, presence: true, uniqueness: true
  validates :available_at, presence: true
end

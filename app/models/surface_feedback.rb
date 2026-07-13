class SurfaceFeedback < ApplicationRecord
  SIGNALS = %w[opened ignored discussed dismissed resolved corrected useful not_useful].freeze

  belongs_to :surface
  belongs_to :surface_item, optional: true

  validates :signal, inclusion: { in: SIGNALS }
end

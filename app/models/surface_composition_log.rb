class SurfaceCompositionLog < ApplicationRecord
  STATUSES = %w[succeeded failed invalid].freeze

  belongs_to :surface, optional: true

  validates :status, inclusion: { in: STATUSES }
end

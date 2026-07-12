class Context < ApplicationRecord
  KINDS = %w[temporary topic person place event].freeze
  STATUSES = %w[active resolved expired archived].freeze

  validates :name, presence: true
  validates :kind, inclusion: { in: KINDS }
  validates :status, inclusion: { in: STATUSES }

  scope :active, -> { where(status: "active").where("expires_at IS NULL OR expires_at > ?", Time.current) }

  def expire!
    update!(status: "expired")
  end
end

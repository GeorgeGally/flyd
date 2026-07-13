class Context < ApplicationRecord
  KINDS = %w[temporary topic person place event].freeze
  STATUSES = %w[active resolved expired archived].freeze

  has_many :conversations, dependent: :destroy
  has_many :scenes, dependent: :nullify
  has_many :artifacts, dependent: :nullify

  validates :name, presence: true
  validates :kind, inclusion: { in: KINDS }
  validates :status, inclusion: { in: STATUSES }

  scope :active, -> { where(status: "active").where("expires_at IS NULL OR expires_at > ?", Time.current) }

  def active_conversation
    conversations.find_by(active: true)
  end

  def expire!
    update!(status: "expired")
  end
end

class Context < ApplicationRecord
  PERSONAL_KIND = "topic"
  PERSONAL_NAME = "Personal"
  KINDS = %w[temporary topic person place event].freeze
  STATUSES = %w[active resolved expired archived].freeze

  has_many :conversations, dependent: :destroy
  has_many :scenes, dependent: :nullify
  has_many :artifacts, dependent: :nullify

  validates :name, presence: true
  validates :kind, inclusion: { in: KINDS }
  validates :status, inclusion: { in: STATUSES }

  scope :active, -> { where(status: "active").where("expires_at IS NULL OR expires_at > ?", Time.current) }

  def self.personal
    context = create_or_find_by!(kind: PERSONAL_KIND, name: PERSONAL_NAME) do |record|
      record.description = "George's ongoing conversation with Flyd."
      record.status = "active"
    end
    context.update!(status: "active", expires_at: nil) unless context.status == "active" && context.expires_at.nil?
    context
  end

  def active_conversation
    conversations.find_by(active: true)
  end

  def expire!
    update!(status: "expired")
  end
end

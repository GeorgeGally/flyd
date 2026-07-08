class Message < ApplicationRecord
  belongs_to :conversation

  validates :role, presence: true, inclusion: { in: %w[user assistant system] }

  scope :ordered, -> { order(created_at: :asc) }
end

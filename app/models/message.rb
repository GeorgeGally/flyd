class Message < ApplicationRecord
  belongs_to :conversation, touch: true

  validates :role, presence: true, inclusion: { in: %w[user assistant system] }

  scope :ordered, -> { order(created_at: :asc) }

  def context_superseded?
    ActiveModel::Type::Boolean.new.cast(metadata["context_superseded"])
  end
end

class IntentAttachment < ApplicationRecord
  MODALITIES = %w[audio image file clipboard screen].freeze
  MAX_BYTES = 10.megabytes

  belongs_to :intent

  validates :modality, inclusion: { in: MODALITIES }
  validates :byte_size, numericality: { greater_than_or_equal_to: 0, less_than_or_equal_to: MAX_BYTES }

  def textual?
    content_type.to_s.start_with?("text/") || content_type.in?(%w[application/json application/xml])
  end
end

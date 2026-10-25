class IntentAttachment < ApplicationRecord
  MODALITIES = %w[audio image file clipboard screen].freeze
  MAX_BYTES = 10.megabytes
  SAFE_INLINE_TYPES = %w[
    image/jpeg image/png image/gif image/webp
    audio/mpeg audio/wav audio/x-wav audio/ogg audio/mp4
  ].freeze
  TEXT_TYPES = %w[text/plain text/markdown text/csv application/json application/xml text/xml].freeze

  belongs_to :intent
  has_one_attached :file

  validates :modality, inclusion: { in: MODALITIES }
  validates :byte_size, numericality: { greater_than_or_equal_to: 0, less_than_or_equal_to: MAX_BYTES }
  validates :checksum, uniqueness: { scope: :intent_id }, allow_blank: true

  scope :available, -> { where("expires_at IS NULL OR expires_at > ?", Time.current) }
  scope :expired, -> { where("expires_at IS NOT NULL AND expires_at <= ?", Time.current) }

  def textual?
    content_type.in?(TEXT_TYPES) || content_type.to_s.start_with?("text/")
  end

  def safe_inline?
    content_type.in?(SAFE_INLINE_TYPES)
  end

  def stored_data
    return file.download if file.attached?

    data.presence || extracted_text.to_s.b
  end

  def purge_storage!
    file.purge if file.attached?
  end
end

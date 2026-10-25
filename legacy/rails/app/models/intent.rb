class Intent < ApplicationRecord
  STATUSES = %w[received interpreting clarification_required accepted executing resolved failed].freeze
  MODALITIES = %w[text audio image file clipboard screen].freeze

  belongs_to :origin_surface, class_name: "Surface", optional: true
  belongs_to :result_surface, class_name: "Surface", optional: true
  belongs_to :conversation, optional: true

  has_many :context_corrections, dependent: :destroy
  has_many :intent_attachments, dependent: :destroy

  validates :status, inclusion: { in: STATUSES }
  validates :modality, inclusion: { in: MODALITIES }
  validate :has_input

  scope :unresolved, -> { where.not(status: %w[resolved failed]) }

  def resolve!(surface: nil)
    update!(status: "resolved", result_surface: surface)
  end

  def fail!(error)
    update!(status: "failed", metadata: metadata.merge("error" => error.message, "error_class" => error.class.name))
  end

  private

  def has_input
    return if input_text.present? || intent_attachments.loaded? && intent_attachments.any?
    return if attachments.present?

    errors.add(:base, "Intent requires text or an attachment")
  end
end

class ContextCorrection < ApplicationRecord
  belongs_to :intent, optional: true
  belongs_to :surface_item, optional: true

  validate :has_subject

  private

  def has_subject
    errors.add(:base, "Correction must belong to an intent or surface item") unless intent || surface_item
  end
end

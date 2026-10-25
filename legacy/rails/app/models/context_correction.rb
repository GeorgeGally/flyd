class ContextCorrection < ApplicationRecord
  belongs_to :intent, optional: true
  belongs_to :surface_item, optional: true

  validate :has_subject
  after_create_commit :export_to_shared_archive

  private

  def has_subject
    errors.add(:base, "Correction must belong to an intent or surface item") unless intent || surface_item
  end

  def export_to_shared_archive
    corrected_names = Array(corrected_contexts).filter_map { |context| context["name"] || context[:name] }
    original_names = Array(original_contexts).filter_map { |context| context["name"] || context[:name] }
    body = [
      reason.presence || "Context corrected",
      ("From: #{original_names.join(", ")}" if original_names.any?),
      ("To: #{corrected_names.join(", ")}" if corrected_names.any?)
    ].compact.join("\n")

    ArchiveEventJob.perform_later(
      "event_key" => "context_correction:#{id}",
      "body" => body,
      "event_type" => "context_correction",
      "outcome" => "corrected",
      "project" => corrected_names.first,
      "record_type" => "ContextCorrection",
      "record_id" => id,
      "timestamp" => created_at.iso8601
    )
  end
end
